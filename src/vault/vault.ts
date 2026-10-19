import { isUuid, isValidOrigin } from '../shared/origin';
import {
  BACKOFF_STEPS_SECONDS,
  DK_LENGTH,
  FREE_FAILURES,
  MAX_FAILURES,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  PIN_FORMAT,
  PIN_ITERATIONS,
  RECORD_VERSION,
  SALT_LENGTH,
} from './constants';
import { aadDeviceSecret, aadPin, aesGcmOpen, aesGcmSeal, deriveKeyFromPin } from './crypto';
import { fromB64, toB64 } from './encoding';
import { VaultError } from './errors';
import type { DeviceSecret, VaultStorage } from './ports';
import { parseRecord, parseRecordKey, recordKey, type VaultRecordV1 } from './record';

export interface VaultDeps {
  storage: VaultStorage;
  secret: DeviceSecret;
  /** Horloge (ms) ; injectable pour tester les délais. */
  now?: () => number;
  /** Itérations PBKDF2 des nouveaux enregistrements. Production : toujours la valeur par défaut. */
  iterations?: number;
  /** Plancher accepté à la lecture. Production : toujours la valeur par défaut (tests uniquement). */
  minIterations?: number;
  /** Dérivation de la clé d'enveloppe ; injectable pour tester l'ordre des opérations. */
  deriveKey?: typeof deriveKeyFromPin;
}

export interface VaultEntry {
  origin: string;
  deviceId: string;
  /** `false` : version inconnue ou enregistrement altéré (il reste listé pour pouvoir être supprimé). */
  readable: boolean;
  createdAt: number | null;
  failures: number | null;
  lockedUntil: number | null;
}

/**
 * Cœur du coffre : pur, sans API d'extension, sans réseau, sans journalisation. L'origine est un paramètre de
 * chaque opération : l'appelant (le worker) l'a lue sur `sender`, jamais dans le message de la page.
 *
 * Chaque enregistrement est scellé deux fois : par le PIN (PBKDF2) puis par le second secret de l'extension.
 * Les octets de DK retournés doivent être effacés (`fill(0)`) par l'appelant dès qu'ils ne servent plus.
 */
export class Vault {
  private readonly storage: VaultStorage;
  private readonly secret: DeviceSecret;
  private readonly now: () => number;
  private readonly iterations: number;
  private readonly minIterations: number;
  private readonly deriveKey: typeof deriveKeyFromPin;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(deps: VaultDeps) {
    this.storage = deps.storage;
    this.secret = deps.secret;
    this.now = deps.now ?? Date.now;
    this.iterations = deps.iterations ?? PIN_ITERATIONS;
    this.minIterations = deps.minIterations ?? PIN_ITERATIONS;
    this.deriveKey = deps.deriveKey ?? deriveKeyFromPin;
  }

  /** Produit une nouvelle DK, la scelle sous le PIN et la retourne. Remplace un enregistrement existant. */
  async create(origin: string, deviceId: string, pin: string): Promise<Uint8Array<ArrayBuffer>> {
    const ref = this.ref(origin, deviceId);
    if (typeof pin !== 'string' || pin.length === 0) throw new VaultError('pin-required');
    this.assertPinFormat(pin);

    return this.exclusive(ref.key, async () => {
      const dk = crypto.getRandomValues(new Uint8Array(DK_LENGTH));
      try {
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
        const pinKey = await this.deriveKey(pin, salt, this.iterations);
        const inner = await aesGcmSeal(pinKey, dk, aadPin(ref.origin, ref.deviceId));
        let wrapped: Uint8Array<ArrayBuffer>;
        try {
          wrapped = await aesGcmSeal(await this.deviceKey(), inner, aadDeviceSecret(ref.origin, ref.deviceId));
        } finally {
          inner.fill(0);
        }
        const record: VaultRecordV1 = {
          v: RECORD_VERSION,
          salt: toB64(salt),
          iterations: this.iterations,
          wrapped: toB64(wrapped),
          failures: 0,
          lockedUntil: null,
          createdAt: this.now(),
        };
        await this.storage.set(ref.key, record);
        return dk;
      } catch (e) {
        dk.fill(0);
        throw e;
      }
    });
  }

  /** Restitue DK si le PIN est bon. Chaque appel redemande le PIN : aucune session de déverrouillage. */
  async load(origin: string, deviceId: string, pin: string): Promise<Uint8Array<ArrayBuffer>> {
    const ref = this.ref(origin, deviceId);
    if (typeof pin !== 'string' || pin.length === 0) throw new VaultError('pin-required');
    this.assertPinFormat(pin);

    return this.exclusive(ref.key, async () => {
      const record = await this.read(ref.key);
      const now = this.now();
      if (record.lockedUntil !== null && record.lockedUntil > now) {
        throw new VaultError('locked', undefined, Math.ceil((record.lockedUntil - now) / 1000));
      }

      // Première couche (second secret) : n'apprend rien sur le PIN, donc ne compte pas comme un essai.
      // Un échec ici veut dire enregistrement copié, altéré, ou second secret perdu : jamais un « mauvais PIN ».
      const inner = await this.openDeviceLayer(record, ref);
      try {
        // L'échec est enregistré AVANT l'essai : un processus tué entre l'essai et l'écriture ne donne pas
        // d'essais gratuits. Il est annulé si le PIN est bon.
        const failures = record.failures + 1;
        if (failures > MAX_FAILURES) {
          await this.storage.remove(ref.key);
          throw new VaultError('wiped', 'Trop d\'essais : cet appareil doit être relié de nouveau.');
        }
        const step = failures - FREE_FAILURES;
        const lockedUntil =
          step > 0
            ? now + BACKOFF_STEPS_SECONDS[Math.min(step - 1, BACKOFF_STEPS_SECONDS.length - 1)]! * 1000
            : null;
        await this.storage.set(ref.key, { ...record, failures, lockedUntil } satisfies VaultRecordV1);

        const salt = fromB64(record.salt)!;
        const pinKey = await this.deriveKey(pin, salt, record.iterations);
        let dk: Uint8Array<ArrayBuffer>;
        try {
          dk = await aesGcmOpen(pinKey, inner, aadPin(ref.origin, ref.deviceId));
        } catch {
          if (failures >= MAX_FAILURES) {
            await this.storage.remove(ref.key);
            throw new VaultError('wiped', 'Trop d\'essais : cet appareil doit être relié de nouveau.');
          }
          throw new VaultError(
            'wrong-pin',
            undefined,
            lockedUntil !== null ? Math.ceil((lockedUntil - now) / 1000) : undefined,
          );
        }

        try {
          await this.storage.set(ref.key, { ...record, failures: 0, lockedUntil: null } satisfies VaultRecordV1);
        } catch (e) {
          dk.fill(0);
          throw e;
        }
        return dk;
      } finally {
        inner.fill(0);
      }
    });
  }

  /** Supprime l'enregistrement de cette origine, sans PIN : supprimer est toujours permis. Idempotent. */
  remove(origin: string, deviceId: string): Promise<void> {
    const ref = this.ref(origin, deviceId);
    return this.exclusive(ref.key, () => this.storage.remove(ref.key));
  }

  /** Existence d'un enregistrement de CETTE origine (quelle qu'en soit la version). */
  async has(origin: string, deviceId: string): Promise<boolean> {
    const ref = this.ref(origin, deviceId);
    return (await this.storage.get(ref.key)) !== undefined;
  }

  /** Métadonnées des enregistrements (jamais de matériel secret), éventuellement d'une seule origine. */
  async list(filter?: { origin: string }): Promise<VaultEntry[]> {
    if (filter !== undefined && !isValidOrigin(filter.origin)) throw new TypeError('origine invalide');
    const entries: VaultEntry[] = [];
    for (const key of await this.storage.keys()) {
      const parsed = parseRecordKey(key);
      if (!parsed || (filter && parsed.origin !== filter.origin)) continue;
      const record = parseRecord(await this.storage.get(key), this.minIterations);
      entries.push({
        origin: parsed.origin,
        deviceId: parsed.deviceId,
        readable: record !== null,
        createdAt: record?.createdAt ?? null,
        failures: record?.failures ?? null,
        lockedUntil: record?.lockedUntil ?? null,
      });
    }
    return entries.sort((a, b) => a.origin.localeCompare(b.origin) || a.deviceId.localeCompare(b.deviceId));
  }

  private ref(origin: string, deviceId: string): { origin: string; deviceId: string; key: string } {
    if (!isValidOrigin(origin)) throw new TypeError('origine invalide');
    if (!isUuid(deviceId)) throw new TypeError('deviceId invalide (UUID attendu)');
    const id = deviceId.toLowerCase();
    return { origin, deviceId: id, key: recordKey(origin, id) };
  }

  private assertPinFormat(pin: string): void {
    if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH || !PIN_FORMAT.test(pin)) {
      throw new VaultError('wrong-pin', `Le PIN doit contenir de ${MIN_PIN_LENGTH} à ${MAX_PIN_LENGTH} chiffres.`);
    }
  }

  private async read(key: string): Promise<VaultRecordV1> {
    const raw = await this.storage.get(key);
    if (raw === undefined) throw new VaultError('missing');
    const record = parseRecord(raw, this.minIterations);
    if (!record) throw new VaultError('unavailable', 'Enregistrement illisible ou de version inconnue.');
    return record;
  }

  private async deviceKey(): Promise<CryptoKey> {
    try {
      return await this.secret.getKey();
    } catch (e) {
      throw e instanceof VaultError ? e : new VaultError('unavailable', 'Le second secret de l\'extension est indisponible.');
    }
  }

  private async openDeviceLayer(
    record: VaultRecordV1,
    ref: { origin: string; deviceId: string },
  ): Promise<Uint8Array<ArrayBuffer>> {
    const key = await this.deviceKey();
    try {
      return await aesGcmOpen(key, fromB64(record.wrapped)!, aadDeviceSecret(ref.origin, ref.deviceId));
    } catch {
      throw new VaultError('unavailable', 'Enregistrement illisible : second secret absent, ou enregistrement déplacé.');
    }
  }

  /**
   * Sérialise les opérations sur un même enregistrement : sans cela, deux essais simultanés liraient le même
   * compteur et l'incrémenteraient une seule fois (essais gratuits).
   */
  private exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }
}
