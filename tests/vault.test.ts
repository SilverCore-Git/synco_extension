import { describe, expect, test } from 'bun:test';
import { aadDeviceSecret, aadDeviceSecretV2, aesGcmOpen, aesGcmSeal } from '../src/vault/crypto';
import { fromB64, toB64 } from '../src/vault/encoding';
import { recordKey } from '../src/vault/record';
import { Vault } from '../src/vault/vault';
import {
  caught,
  DEVICE,
  DEVICE_2,
  LEGACY_ITERATIONS,
  makeVault,
  MemorySecret,
  MemoryStorage,
  ORIGIN,
  OTHER_ORIGIN,
  PIN,
  seedLegacy,
  WRONG_PIN,
} from './helpers/vaultFixtures';

const key = (origin = ORIGIN, device = DEVICE) => recordKey(origin, device);
const stored = (s: MemoryStorage, k = key()) => s.data.get(k) as Record<string, unknown>;

/** Coffre de test avec un ANCIEN enregistrement (format 1, PIN) pour ORIGIN/DEVICE. */
async function legacyVault() {
  const ctx = makeVault();
  const dk = await seedLegacy(ctx.storage, ctx.secret, { now: ctx.clock.t });
  return { ...ctx, dk };
}

// ---------------------------------------------------------------------------------------------------------------------
// Format 2 : sans PIN
// ---------------------------------------------------------------------------------------------------------------------

describe('création et ouverture (format 2, sans PIN)', () => {
  test('load restitue la DK créée (32 octets), sans PIN, et elle diffère à chaque création', async () => {
    const { vault } = makeVault();
    const dk = await vault.create(ORIGIN, DEVICE);
    expect(dk).toHaveLength(32);
    expect(toB64(await vault.load(ORIGIN, DEVICE))).toBe(toB64(dk));
    const other = await vault.create(ORIGIN, DEVICE_2);
    expect(toB64(other)).not.toBe(toB64(dk));
  });

  test('un PIN fourni à un enregistrement sans PIN est ignoré', async () => {
    const { vault } = makeVault();
    const dk = await vault.create(ORIGIN, DEVICE);
    expect(toB64(await vault.load(ORIGIN, DEVICE, WRONG_PIN))).toBe(toB64(dk));
  });

  test('format 2 : version, wrapped (60 octets), date ; ni DK en clair, ni sel, ni compteur', async () => {
    const { vault, storage, clock } = makeVault();
    const dk = await vault.create(ORIGIN, DEVICE);
    const r = stored(storage);
    expect(Object.keys(r).sort()).toEqual(['createdAt', 'v', 'wrapped']);
    expect(r.v).toBe(2);
    expect(fromB64(r.wrapped)).toHaveLength(60);
    expect(r.createdAt).toBe(clock.t);
    expect(JSON.stringify([...storage.data.entries()])).not.toContain(toB64(dk));
    expect([...storage.data.keys()]).toEqual([`vault:${ORIGIN}:${DEVICE}`]);
  });

  test('re-création : nouvelle DK, l\'ancienne n\'ouvre plus rien', async () => {
    const { vault } = makeVault();
    const first = await vault.create(ORIGIN, DEVICE);
    const second = await vault.create(ORIGIN, DEVICE);
    expect(toB64(second)).not.toBe(toB64(first));
    expect(toB64(await vault.load(ORIGIN, DEVICE))).toBe(toB64(second));
  });

  test('create remplace aussi un ancien enregistrement à PIN', async () => {
    const { vault, storage } = await legacyVault();
    const dk = await vault.create(ORIGIN, DEVICE);
    expect(stored(storage).v).toBe(2);
    expect(toB64(await vault.load(ORIGIN, DEVICE))).toBe(toB64(dk));
  });

  test('has et remove : idempotent', async () => {
    const { vault } = makeVault();
    expect(await vault.has(ORIGIN, DEVICE)).toBe(false);
    await vault.create(ORIGIN, DEVICE);
    expect(await vault.has(ORIGIN, DEVICE)).toBe(true);
    await vault.remove(ORIGIN, DEVICE);
    await vault.remove(ORIGIN, DEVICE);
    expect(await vault.has(ORIGIN, DEVICE)).toBe(false);
    expect((await caught(() => vault.load(ORIGIN, DEVICE))).code).toBe('missing');
  });

  test('needsPin : vrai seulement pour un ancien enregistrement à PIN', async () => {
    const { vault, storage, secret } = makeVault();
    expect(await vault.needsPin(ORIGIN, DEVICE)).toBe(false); // absent
    await vault.create(ORIGIN, DEVICE);
    expect(await vault.needsPin(ORIGIN, DEVICE)).toBe(false);
    await seedLegacy(storage, secret, { deviceId: DEVICE_2 });
    expect(await vault.needsPin(ORIGIN, DEVICE_2)).toBe(true);
  });
});

describe('validation des entrées', () => {
  test('origine et deviceId invalides sont refusés', async () => {
    const { vault } = makeVault();
    for (const origin of ['https://*.synco.one', 'http://app.synco.one', 'https://app.synco.one/', '', 'app.synco.one']) {
      expect((await caught(() => vault.has(origin, DEVICE))).name).toBe('TypeError');
    }
    for (const id of ['', 'pas-un-uuid', '../../x', `${DEVICE}:x`, DEVICE.slice(1)]) {
      expect((await caught(() => vault.has(ORIGIN, id))).name).toBe('TypeError');
    }
  });

  test('le deviceId est normalisé en minuscules : une seule clé par appareil', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE.toUpperCase());
    expect([...storage.data.keys()]).toEqual([key()]);
    expect(await vault.has(ORIGIN, DEVICE)).toBe(true);
  });
});

describe('espace de noms par origine (format 2)', () => {
  test('une origine ne voit ni n\'ouvre l\'enregistrement d\'une autre', async () => {
    const { vault } = makeVault();
    await vault.create(ORIGIN, DEVICE);
    expect(await vault.has(OTHER_ORIGIN, DEVICE)).toBe(false);
    expect((await caught(() => vault.load(OTHER_ORIGIN, DEVICE))).code).toBe('missing');
    await vault.remove(OTHER_ORIGIN, DEVICE); // ne supprime rien chez l'autre
    expect(await vault.has(ORIGIN, DEVICE)).toBe(true);
  });

  test('un hôte et le même hôte avec un port sont deux origines distinctes (pas de collision de préfixe)', async () => {
    const { vault } = makeVault();
    await vault.create('https://app.synco.one:8443', DEVICE);
    expect(await vault.has('https://app.synco.one', DEVICE)).toBe(false);
    expect(await vault.list({ origin: 'https://app.synco.one' })).toEqual([]);
    expect(await vault.list({ origin: 'https://app.synco.one:8443' })).toHaveLength(1);
  });

  test('enregistrement copié vers une autre origine ou un autre appareil : refusé', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE);
    storage.data.set(key(OTHER_ORIGIN), structuredClone(stored(storage)));
    storage.data.set(key(ORIGIN, DEVICE_2), structuredClone(stored(storage)));
    expect((await caught(() => vault.load(OTHER_ORIGIN, DEVICE))).code).toBe('unavailable');
    expect((await caught(() => vault.load(ORIGIN, DEVICE_2))).code).toBe('unavailable');
  });

  test('l\'AAD du format 2 diffère de celle du format 1 : une couche ne se substitue pas à l\'autre', async () => {
    const { vault, storage, secret } = makeVault();
    await vault.create(ORIGIN, DEVICE);
    const deviceKey = await secret.getKey();
    const dk = await aesGcmOpen(deviceKey, fromB64(stored(storage).wrapped)!, aadDeviceSecretV2(ORIGIN, DEVICE));
    // Même DK scellée avec l'AAD du format 1 et présentée comme du format 2 : refusée.
    const wrongLayer = await aesGcmSeal(deviceKey, dk, aadDeviceSecret(ORIGIN, DEVICE));
    storage.data.set(key(), { ...stored(storage), wrapped: toB64(wrongLayer) });
    expect((await caught(() => vault.load(ORIGIN, DEVICE))).code).toBe('unavailable');
  });
});

describe('second secret de l\'extension (format 2)', () => {
  test('sans le second secret, l\'enregistrement ne s\'ouvre pas', async () => {
    const storage = new MemoryStorage();
    await makeVault({ storage }).vault.create(ORIGIN, DEVICE);
    const stranger = makeVault({ storage, secret: new MemorySecret() }).vault; // autre profil : autre clé
    expect((await caught(() => stranger.load(ORIGIN, DEVICE))).code).toBe('unavailable');
  });

  test('second secret indisponible : unavailable, rien n\'est écrit', async () => {
    const storage = new MemoryStorage();
    await makeVault({ storage }).vault.create(ORIGIN, DEVICE);
    const broken = makeVault({
      storage,
      secret: { getKey: () => Promise.reject(new Error('IndexedDB indisponible')) },
    }).vault;
    expect((await caught(() => broken.load(ORIGIN, DEVICE))).code).toBe('unavailable');
    expect((await caught(() => broken.create(ORIGIN, DEVICE_2))).code).toBe('unavailable');
    expect(await broken.has(ORIGIN, DEVICE_2)).toBe(false);
  });
});

describe('enregistrements invalides (format 2)', () => {
  test.each([
    ['wrapped tronqué', { wrapped: toB64(new Uint8Array(40)) }],
    ['wrapped qui n\'est pas du base64', { wrapped: '***' }],
    ['createdAt manquant', { createdAt: undefined }],
  ])('%s : unavailable, enregistrement laissé intact', async (_name, patch) => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE);
    const before = { ...stored(storage), ...patch };
    storage.data.set(key(), before);
    expect((await caught(() => vault.load(ORIGIN, DEVICE))).code).toBe('unavailable');
    expect(storage.data.get(key())).toEqual(before);
  });

  test('wrapped altéré : unavailable', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE);
    const bytes = fromB64(stored(storage).wrapped)!;
    bytes[20]! ^= 1;
    storage.data.set(key(), { ...stored(storage), wrapped: toB64(bytes) });
    expect((await caught(() => vault.load(ORIGIN, DEVICE))).code).toBe('unavailable');
  });

  test.each([[null], ['texte'], [42], [[]], [{ v: 3 }], [{ v: undefined }]])('valeur stockée %p : unavailable', async (junk) => {
    const { vault, storage } = makeVault();
    storage.data.set(key(), junk);
    expect((await caught(() => vault.load(ORIGIN, DEVICE))).code).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Format 1 : anciens enregistrements à PIN (lecture, compteur d'essais, migration)
// ---------------------------------------------------------------------------------------------------------------------

describe('ancien format à PIN : migration', () => {
  test('le bon PIN rend la même DK et réécrit l\'enregistrement en format 2', async () => {
    const { vault, storage, dk } = await legacyVault();
    expect(toB64(await vault.load(ORIGIN, DEVICE, PIN))).toBe(toB64(dk));
    const r = stored(storage);
    expect(r.v).toBe(2);
    expect(r).not.toHaveProperty('salt');
    expect(r).not.toHaveProperty('failures');
    // Le PIN n'est plus jamais demandé.
    expect(await vault.needsPin(ORIGIN, DEVICE)).toBe(false);
    expect(toB64(await vault.load(ORIGIN, DEVICE))).toBe(toB64(dk));
  });

  test('PIN absent : pin-required, sans compter d\'essai ni migrer', async () => {
    const { vault, storage } = await legacyVault();
    expect((await caught(() => vault.load(ORIGIN, DEVICE))).code).toBe('pin-required');
    expect((await caught(() => vault.load(ORIGIN, DEVICE, ''))).code).toBe('pin-required');
    expect(stored(storage).v).toBe(1);
    expect(stored(storage).failures).toBe(0);
  });

  test('format de PIN invalide : wrong-pin sans toucher au compteur', async () => {
    const { vault, storage } = await legacyVault();
    for (const bad of ['123', 'abcd', '12 34', '1234\n', '9'.repeat(33)]) {
      expect((await caught(() => vault.load(ORIGIN, DEVICE, bad))).code).toBe('wrong-pin');
    }
    expect(stored(storage).failures).toBe(0);
  });

  test('coût réel de production : 600 000 itérations, lu puis migré', async () => {
    const storage = new MemoryStorage();
    const secret = new MemorySecret();
    const dk = await seedLegacy(storage, secret, { iterations: 600_000 });
    const vault = new Vault({ storage, secret }); // aucune option : valeurs de production
    expect(toB64(await vault.load(ORIGIN, DEVICE, PIN))).toBe(toB64(dk));
    expect(stored(storage).v).toBe(2);
  });

  test('un coffre de production refuse un ancien enregistrement à faible coût de dérivation', async () => {
    const storage = new MemoryStorage();
    const secret = new MemorySecret();
    await seedLegacy(storage, secret, { iterations: LEGACY_ITERATIONS });
    const prod = new Vault({ storage, secret });
    expect((await caught(() => prod.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
  });

  test('échec de la réécriture : DK non rendue, ancien enregistrement conservé', async () => {
    const { vault, storage } = await legacyVault();
    const realSet = storage.set.bind(storage);
    let writes = 0;
    storage.set = async (k, v) => {
      if (++writes === 2) throw new Error('processus tué'); // 1ʳᵉ écriture : échec compté ; 2ᵉ : migration
      return realSet(k, v);
    };
    await caught(() => vault.load(ORIGIN, DEVICE, PIN));
    expect(stored(storage).v).toBe(1);
    expect(stored(storage).failures).toBe(1);
  });
});

describe('ancien format à PIN : compteur d\'essais (sécurité)', () => {
  test('mauvais PIN : wrong-pin, échec compté', async () => {
    const { vault, storage } = await legacyVault();
    for (let i = 1; i <= 3; i++) {
      expect((await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))).code).toBe('wrong-pin');
      expect(stored(storage).failures).toBe(i);
    }
    await vault.load(ORIGIN, DEVICE, PIN);
    expect(stored(storage).v).toBe(2);
  });

  test('barème de l\'application : 5 essais gratuits, puis 30 s, 2 min, 10 min, 1 h, 24 h', async () => {
    const { vault, clock } = await legacyVault();
    for (let i = 1; i <= 5; i++) {
      expect((await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))).retryAfterSeconds).toBeUndefined();
    }
    for (const delay of [30, 120, 600, 3600]) {
      const err = await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN));
      expect(err.code).toBe('wrong-pin');
      expect(err.retryAfterSeconds).toBe(delay);
      clock.advanceSeconds(delay);
    }
    expect((await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))).code).toBe('wiped');
  });

  test('pendant le délai : locked, même avec le bon PIN, sans consommer d\'essai', async () => {
    const { vault, storage, clock } = await legacyVault();
    for (let i = 0; i < 6; i++) await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN));
    expect(stored(storage).failures).toBe(6);

    const locked = await caught(() => vault.load(ORIGIN, DEVICE, PIN));
    expect(locked.code).toBe('locked');
    expect(locked.retryAfterSeconds).toBe(30);
    expect(stored(storage).failures).toBe(6);

    clock.advanceSeconds(29);
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('locked');
    clock.advanceSeconds(1);
    expect(await vault.load(ORIGIN, DEVICE, PIN)).toHaveLength(32);
  });

  test('10 échecs = effacement : code wiped, enregistrement supprimé', async () => {
    const { vault, storage, clock } = await legacyVault();
    let last: { code?: string } = {};
    for (let i = 1; i <= 10; i++) {
      last = await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN));
      clock.advanceSeconds(100_000);
    }
    expect(last.code).toBe('wiped');
    expect(storage.data.size).toBe(0);
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('missing');
  });

  test('9 échecs puis le bon PIN : accepté (l\'effacement est au 10ᵉ échec, pas avant)', async () => {
    const { vault, clock } = await legacyVault();
    for (let i = 0; i < 9; i++) {
      await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN));
      clock.advanceSeconds(100_000);
    }
    expect(await vault.load(ORIGIN, DEVICE, PIN)).toHaveLength(32);
  });

  test('un compteur déjà au maximum dans le stockage mène à l\'effacement', async () => {
    const { vault, storage } = await legacyVault();
    storage.data.set(key(), { ...stored(storage), failures: 10 });
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('wiped');
    expect(storage.data.size).toBe(0);
  });

  test('l\'échec est enregistré AVANT l\'essai : un processus tué pendant la vérification n\'offre pas d\'essai gratuit', async () => {
    const storage = new MemoryStorage();
    const secret = new MemorySecret();
    await seedLegacy(storage, secret);

    let seenAtVerification: unknown;
    const killed = makeVault({
      storage,
      secret,
      deriveKey: async () => {
        seenAtVerification = stored(storage).failures;
        throw new Error('processus tué');
      },
    }).vault;

    await caught(() => killed.load(ORIGIN, DEVICE, PIN));
    expect(seenAtVerification).toBe(1);
    expect(stored(storage).failures).toBe(1);
  });

  test('essais simultanés : chacun est compté, aucun essai gratuit', async () => {
    const { vault, storage } = await legacyVault();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))),
    );
    expect(results.filter((r) => r.code === 'wrong-pin')).toHaveLength(6);
    expect(results.filter((r) => r.code === 'locked')).toHaveLength(6);
    expect(stored(storage).failures).toBe(6);
  });

  test('essais simultanés sans délai (horloge avancée) : effacement exactement au 10ᵉ', async () => {
    const { vault, storage, clock } = await legacyVault();
    const codes: (string | undefined)[] = [];
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        codes.push((await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))).code);
        clock.advanceSeconds(100_000);
      }),
    );
    expect(codes.filter((c) => c === 'wiped')).toHaveLength(1);
    expect(codes.filter((c) => c === 'missing')).toHaveLength(2);
    expect(storage.data.size).toBe(0);
  });
});

describe('ancien format à PIN : liaisons et altérations', () => {
  test('copié vers une autre origine : refusé, sans compter d\'essai', async () => {
    const { vault, storage } = await legacyVault();
    storage.data.set(key(OTHER_ORIGIN), structuredClone(stored(storage)));
    expect((await caught(() => vault.load(OTHER_ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
    expect(stored(storage, key(OTHER_ORIGIN)).failures).toBe(0);
  });

  test('la couche PIN est aussi liée à l\'origine, même si la couche du second secret est refaite', async () => {
    const { vault, storage, secret } = await legacyVault();
    const rec = stored(storage);
    const deviceKey = await secret.getKey();
    const inner = await aesGcmOpen(deviceKey, fromB64(rec.wrapped)!, aadDeviceSecret(ORIGIN, DEVICE));
    const rewrapped = await aesGcmSeal(deviceKey, inner, aadDeviceSecret(OTHER_ORIGIN, DEVICE));
    storage.data.set(key(OTHER_ORIGIN), { ...rec, wrapped: toB64(rewrapped) });

    expect((await caught(() => vault.load(OTHER_ORIGIN, DEVICE, PIN))).code).toBe('wrong-pin');
    expect(await vault.load(ORIGIN, DEVICE, PIN)).toHaveLength(32);
  });

  test('sans le second secret, le bon PIN ne suffit pas (et aucun essai n\'est compté)', async () => {
    const storage = new MemoryStorage();
    await seedLegacy(storage, new MemorySecret());
    const stranger = makeVault({ storage, secret: new MemorySecret() }).vault;
    expect((await caught(() => stranger.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
    expect(stored(storage).failures).toBe(0);
  });

  test.each([
    ['sel trop court', { salt: toB64(new Uint8Array(8)) }],
    ['sel qui n\'est pas du base64', { salt: '***' }],
    ['wrapped tronqué', { wrapped: toB64(new Uint8Array(40)) }],
    ['itérations sous le plancher', { iterations: 999 }],
    ['itérations démesurées', { iterations: 1_000_000_000 }],
    ['compteur négatif', { failures: -1 }],
    ['compteur non entier', { failures: 1.5 }],
    ['compteur au-delà du maximum', { failures: 11 }],
    ['lockedUntil de mauvais type', { lockedUntil: '0' }],
    ['createdAt manquant', { createdAt: undefined }],
  ])('%s : unavailable, enregistrement laissé intact', async (_name, patch) => {
    const { vault, storage } = await legacyVault();
    const before = { ...stored(storage), ...patch };
    storage.data.set(key(), before);
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
    expect(storage.data.get(key())).toEqual(before);
    expect(await vault.has(ORIGIN, DEVICE)).toBe(true);
  });

  test('wrapped altéré : refusé sans compter d\'essai', async () => {
    const { vault, storage } = await legacyVault();
    const bytes = fromB64(stored(storage).wrapped)!;
    bytes[40]! ^= 1;
    storage.data.set(key(), { ...stored(storage), wrapped: toB64(bytes) });
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
    expect(stored(storage).failures).toBe(0);
  });
});

describe('liste des enregistrements', () => {
  test('métadonnées seulement, par origine, anciens et illisibles inclus', async () => {
    const { vault, storage, secret } = makeVault();
    await vault.create(ORIGIN, DEVICE);
    await seedLegacy(storage, secret, { origin: OTHER_ORIGIN, deviceId: DEVICE_2 });
    storage.data.set(key(ORIGIN, '11111111-2222-3333-4444-555555555555'), { v: 9 });
    storage.data.set('autre-cle', 'ignorée');
    storage.data.set('vault:pas-une-origine:xx', 'ignorée');

    const all = await vault.list();
    expect(all.map((e) => `${e.origin}|${e.deviceId}|${e.readable}|${e.pin}`)).toEqual([
      `${ORIGIN}|11111111-2222-3333-4444-555555555555|false|false`,
      `${ORIGIN}|${DEVICE}|true|false`,
      `${OTHER_ORIGIN}|${DEVICE_2}|true|true`,
    ]);
    expect(all[1]!.failures).toBeNull();
    expect(all[2]!.failures).toBe(0);
    expect(await vault.list({ origin: OTHER_ORIGIN })).toHaveLength(1);

    const dump = JSON.stringify(all);
    expect(dump).not.toContain('wrapped');
    expect(dump).not.toContain('salt');
  });
});

describe('module coffre : aucune fuite possible par construction', () => {
  const dir = new URL('../src/vault/', import.meta.url);
  const sources = [...new Bun.Glob('*.ts').scanSync({ cwd: dir.pathname })].map((f) => ({
    f,
    text: require('node:fs').readFileSync(dir.pathname + f, 'utf8') as string,
  }));

  test('le module existe et est analysé', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  test.each([
    ['console', /\bconsole\s*\./],
    ['réseau', /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b\s*[(.]?/],
    ['eval', /\b(eval|new Function)\b/],
    ['API d\'extension', /\b(chrome|browser)\s*\./],
    ['innerHTML', /innerHTML/],
  ])('aucun usage de : %s', (_name, re) => {
    for (const { f, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect({ f, hit: re.test(code) }).toEqual({ f, hit: false });
    }
  });
});
