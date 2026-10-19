import { describe, expect, test } from 'bun:test';
import { aadDeviceSecret, aesGcmOpen, aesGcmSeal } from '../src/vault/crypto';
import { fromB64, toB64 } from '../src/vault/encoding';
import { recordKey } from '../src/vault/record';
import { Vault } from '../src/vault/vault';
import {
  caught,
  DEVICE,
  DEVICE_2,
  FAST,
  makeVault,
  MemorySecret,
  MemoryStorage,
  ORIGIN,
  OTHER_ORIGIN,
  PIN,
  WRONG_PIN,
} from './helpers/vaultFixtures';

const key = (origin = ORIGIN, device = DEVICE) => recordKey(origin, device);
const stored = (s: MemoryStorage, k = key()) => s.data.get(k) as Record<string, unknown>;

describe('création et déverrouillage', () => {
  test('load restitue la DK créée (32 octets) et elle diffère à chaque création', async () => {
    const { vault } = makeVault();
    const dk = await vault.create(ORIGIN, DEVICE, PIN);
    expect(dk).toHaveLength(32);
    const again = await vault.load(ORIGIN, DEVICE, PIN);
    expect(toB64(again)).toBe(toB64(dk));
    const other = await vault.create(ORIGIN, DEVICE_2, PIN);
    expect(toB64(other)).not.toBe(toB64(dk));
  });

  test('format v1 : sel 16 octets, itérations, wrapped, compteur, date ; ni DK ni PIN en clair', async () => {
    const { vault, storage, clock } = makeVault();
    const dk = await vault.create(ORIGIN, DEVICE, PIN);
    const r = stored(storage);
    expect(r.v).toBe(1);
    expect(fromB64(r.salt)).toHaveLength(16);
    expect(r.iterations).toBe(FAST.iterations);
    expect(fromB64(r.wrapped)).toHaveLength(88);
    expect(r.failures).toBe(0);
    expect(r.lockedUntil).toBeNull();
    expect(r.createdAt).toBe(clock.t);
    const dump = JSON.stringify([...storage.data.entries()]);
    expect(dump).not.toContain(toB64(dk));
    expect(dump).not.toContain(PIN);
    expect([...storage.data.keys()]).toEqual([`vault:${ORIGIN}:${DEVICE}`]);
  });

  test('coût réel de production : 600 000 itérations, aller-retour complet', async () => {
    const storage = new MemoryStorage();
    const vault = new Vault({ storage, secret: new MemorySecret() }); // aucune option : valeurs de production
    const dk = await vault.create(ORIGIN, DEVICE, PIN);
    expect(stored(storage).iterations).toBe(600_000);
    expect(toB64(await vault.load(ORIGIN, DEVICE, PIN))).toBe(toB64(dk));
  });

  test('un coffre de production refuse un enregistrement à faible coût de dérivation', async () => {
    const storage = new MemoryStorage();
    await new Vault({ storage, secret: new MemorySecret(), ...FAST }).create(ORIGIN, DEVICE, PIN);
    const prod = new Vault({ storage, secret: new MemorySecret() });
    expect((await caught(() => prod.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
  });

  test('re-création : nouvelle DK, compteur remis à zéro', async () => {
    const { vault, storage } = makeVault();
    const first = await vault.create(ORIGIN, DEVICE, PIN);
    await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN));
    expect(stored(storage).failures).toBe(1);
    const second = await vault.create(ORIGIN, DEVICE, '9999');
    expect(toB64(second)).not.toBe(toB64(first));
    expect(stored(storage).failures).toBe(0);
    expect(toB64(await vault.load(ORIGIN, DEVICE, '9999'))).toBe(toB64(second));
  });

  test('has et remove : sans PIN, idempotent', async () => {
    const { vault } = makeVault();
    expect(await vault.has(ORIGIN, DEVICE)).toBe(false);
    await vault.create(ORIGIN, DEVICE, PIN);
    expect(await vault.has(ORIGIN, DEVICE)).toBe(true);
    await vault.remove(ORIGIN, DEVICE);
    await vault.remove(ORIGIN, DEVICE);
    expect(await vault.has(ORIGIN, DEVICE)).toBe(false);
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('missing');
  });
});

describe('validation des entrées', () => {
  test('PIN absent : pin-required ; format invalide : wrong-pin sans toucher au compteur', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    expect((await caught(() => vault.load(ORIGIN, DEVICE, ''))).code).toBe('pin-required');
    for (const bad of ['123', 'abcd', '12 34', '1234\n', '9'.repeat(33)]) {
      expect((await caught(() => vault.load(ORIGIN, DEVICE, bad))).code).toBe('wrong-pin');
    }
    expect(stored(storage).failures).toBe(0);
    expect((await caught(() => vault.create(ORIGIN, DEVICE_2, '12'))).code).toBe('wrong-pin');
    expect(await vault.has(ORIGIN, DEVICE_2)).toBe(false);
  });

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
    await vault.create(ORIGIN, DEVICE.toUpperCase(), PIN);
    expect([...storage.data.keys()]).toEqual([key()]);
    expect(await vault.has(ORIGIN, DEVICE)).toBe(true);
  });
});

describe('compteur d\'essais (sécurité)', () => {
  test('mauvais PIN : wrong-pin, échec compté, puis le bon PIN remet le compteur à zéro', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    for (let i = 1; i <= 3; i++) {
      expect((await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))).code).toBe('wrong-pin');
      expect(stored(storage).failures).toBe(i);
    }
    await vault.load(ORIGIN, DEVICE, PIN);
    expect(stored(storage).failures).toBe(0);
  });

  test('barème de l\'application : 5 essais gratuits, puis 30 s, 2 min, 10 min, 1 h, 24 h', async () => {
    const { vault, clock } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    for (let i = 1; i <= 5; i++) {
      expect((await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))).retryAfterSeconds).toBeUndefined();
    }
    for (const delay of [30, 120, 600, 3600]) {
      const err = await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN));
      expect(err.code).toBe('wrong-pin');
      expect(err.retryAfterSeconds).toBe(delay);
      clock.advanceSeconds(delay);
    }
    // 10ᵉ échec : effacement (le délai de 24 h n'a plus d'objet).
    expect((await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))).code).toBe('wiped');
  });

  test('pendant le délai : locked, même avec le bon PIN, sans consommer d\'essai', async () => {
    const { vault, storage, clock } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
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
    expect(stored(storage).failures).toBe(0);
  });

  test('10 échecs = effacement : code wiped, enregistrement supprimé, DK définitivement perdue', async () => {
    const { vault, storage, clock } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    let last: { code?: string } = {};
    for (let i = 1; i <= 10; i++) {
      last = await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN));
      clock.advanceSeconds(100_000); // on laisse passer chaque délai
    }
    expect(last.code).toBe('wiped');
    expect(storage.data.size).toBe(0);
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('missing');
  });

  test('9 échecs puis le bon PIN : accepté (l\'effacement est au 10ᵉ échec, pas avant)', async () => {
    const { vault, clock } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    for (let i = 0; i < 9; i++) {
      await caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN));
      clock.advanceSeconds(100_000);
    }
    expect(await vault.load(ORIGIN, DEVICE, PIN)).toHaveLength(32);
  });

  test('un compteur déjà au maximum dans le stockage mène à l\'effacement', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    storage.data.set(key(), { ...stored(storage), failures: 10 });
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('wiped');
    expect(storage.data.size).toBe(0);
  });

  test('l\'échec est enregistré AVANT l\'essai : un processus tué pendant la vérification n\'offre pas d\'essai gratuit', async () => {
    const storage = new MemoryStorage();
    const secret = new MemorySecret();
    await makeVault({ storage, secret }).vault.create(ORIGIN, DEVICE, PIN);

    let seenAtVerification: unknown;
    const killed = makeVault({
      storage,
      secret,
      deriveKey: async () => {
        seenAtVerification = stored(storage).failures;
        throw new Error('processus tué'); // simule la mort du worker en pleine vérification
      },
    }).vault;

    await caught(() => killed.load(ORIGIN, DEVICE, PIN));
    expect(seenAtVerification).toBe(1); // déjà compté quand la vérification commence
    expect(stored(storage).failures).toBe(1); // et conservé après la mort du processus
  });

  test('interruption entre le succès et la remise à zéro : le compteur reste incrémenté', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    const realSet = storage.set.bind(storage);
    let writes = 0;
    storage.set = async (k, v) => {
      if (++writes === 2) throw new Error('processus tué'); // 1ʳᵉ écriture : échec compté ; 2ᵉ : remise à zéro
      return realSet(k, v);
    };
    await caught(() => vault.load(ORIGIN, DEVICE, PIN));
    expect(stored(storage).failures).toBe(1);
  });

  test('essais simultanés : chacun est compté, aucun essai gratuit', async () => {
    const { vault, storage, clock } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    clock.advanceSeconds(0);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => caught(() => vault.load(ORIGIN, DEVICE, WRONG_PIN))),
    );
    // Sérialisés : 5 gratuits, puis les délais (« locked » tant que l'horloge n'avance pas), jamais un compteur figé.
    expect(results.filter((r) => r.code === 'wrong-pin')).toHaveLength(6);
    expect(results.filter((r) => r.code === 'locked')).toHaveLength(6);
    expect(stored(storage).failures).toBe(6);
  });

  test('essais simultanés sans délai (horloge avancée) : effacement exactement au 10ᵉ', async () => {
    const { vault, storage, clock } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
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

describe('espace de noms par origine', () => {
  test('une origine ne voit ni n\'ouvre l\'enregistrement d\'une autre', async () => {
    const { vault } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    expect(await vault.has(OTHER_ORIGIN, DEVICE)).toBe(false);
    expect((await caught(() => vault.load(OTHER_ORIGIN, DEVICE, PIN))).code).toBe('missing');
    await vault.remove(OTHER_ORIGIN, DEVICE); // ne supprime rien chez l'autre
    expect(await vault.has(ORIGIN, DEVICE)).toBe(true);
  });

  test('un hôte et le même hôte avec un port sont deux origines distinctes (pas de collision de préfixe)', async () => {
    const { vault } = makeVault();
    await vault.create('https://app.synco.one:8443', DEVICE, PIN);
    expect(await vault.has('https://app.synco.one', DEVICE)).toBe(false);
    expect(await vault.list({ origin: 'https://app.synco.one' })).toEqual([]);
    expect(await vault.list({ origin: 'https://app.synco.one:8443' })).toHaveLength(1);
  });

  test('enregistrement copié vers une autre origine : refusé, sans compter d\'essai', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    storage.data.set(key(OTHER_ORIGIN), structuredClone(stored(storage)));

    const err = await caught(() => vault.load(OTHER_ORIGIN, DEVICE, PIN));
    expect(err.code).toBe('unavailable');
    expect(stored(storage, key(OTHER_ORIGIN)).failures).toBe(0);
  });

  test('copie vers un autre appareil (même origine) : refusée', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    storage.data.set(key(ORIGIN, DEVICE_2), structuredClone(stored(storage)));
    expect((await caught(() => vault.load(ORIGIN, DEVICE_2, PIN))).code).toBe('unavailable');
  });

  test('la couche PIN est aussi liée à l\'origine, même si la couche du second secret est refaite', async () => {
    // Un attaquant qui possède le second secret (profil copié) re-scelle la couche externe pour l'autre origine :
    // la couche interne, liée par son AAD au PIN et à l'origine d'origine, doit encore refuser.
    const { vault, storage, secret } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    const rec = stored(storage);
    const deviceKey = await secret.getKey();
    const inner = await aesGcmOpen(deviceKey, fromB64(rec.wrapped)!, aadDeviceSecret(ORIGIN, DEVICE));
    const rewrapped = await aesGcmSeal(deviceKey, inner, aadDeviceSecret(OTHER_ORIGIN, DEVICE));
    storage.data.set(key(OTHER_ORIGIN), { ...rec, wrapped: toB64(rewrapped) });

    expect((await caught(() => vault.load(OTHER_ORIGIN, DEVICE, PIN))).code).toBe('wrong-pin');
    expect(await vault.load(ORIGIN, DEVICE, PIN)).toHaveLength(32);
  });
});

describe('second secret de l\'extension', () => {
  test('sans le second secret, le bon PIN ne suffit pas (et aucun essai n\'est compté)', async () => {
    const storage = new MemoryStorage();
    await makeVault({ storage }).vault.create(ORIGIN, DEVICE, PIN);
    const stranger = makeVault({ storage, secret: new MemorySecret() }).vault; // autre profil : autre clé
    const err = await caught(() => stranger.load(ORIGIN, DEVICE, PIN));
    expect(err.code).toBe('unavailable');
    expect(stored(storage).failures).toBe(0);
  });

  test('second secret indisponible : unavailable', async () => {
    const storage = new MemoryStorage();
    await makeVault({ storage }).vault.create(ORIGIN, DEVICE, PIN);
    const broken = makeVault({
      storage,
      secret: { getKey: () => Promise.reject(new Error('IndexedDB indisponible')) },
    }).vault;
    expect((await caught(() => broken.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
    expect((await caught(() => broken.create(ORIGIN, DEVICE_2, PIN))).code).toBe('unavailable');
    expect(await broken.has(ORIGIN, DEVICE_2)).toBe(false);
  });
});

describe('enregistrements invalides', () => {
  const tamper = async (patch: Record<string, unknown>) => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    const before = { ...stored(storage), ...patch };
    storage.data.set(key(), before);
    return { vault, storage, before };
  };

  test.each([
    ['version inconnue (2)', { v: 2 }],
    ['version absente', { v: undefined }],
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
    const { vault, storage, before } = await tamper(patch);
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
    expect(storage.data.get(key())).toEqual(before); // ni effacé, ni modifié
    expect(await vault.has(ORIGIN, DEVICE)).toBe(true);
  });

  test.each([[null], ['texte'], [42], [[]]])('valeur stockée %p : unavailable', async (junk) => {
    const { vault, storage } = makeVault();
    storage.data.set(key(), junk);
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
  });

  test('un enregistrement altéré (wrapped modifié) est refusé sans compter d\'essai', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    const bytes = fromB64(stored(storage).wrapped)!;
    bytes[40]! ^= 1;
    storage.data.set(key(), { ...stored(storage), wrapped: toB64(bytes) });
    expect((await caught(() => vault.load(ORIGIN, DEVICE, PIN))).code).toBe('unavailable');
    expect(stored(storage).failures).toBe(0);
  });
});

describe('liste des enregistrements', () => {
  test('métadonnées seulement, par origine, enregistrements illisibles inclus', async () => {
    const { vault, storage } = makeVault();
    await vault.create(ORIGIN, DEVICE, PIN);
    await vault.create(OTHER_ORIGIN, DEVICE_2, PIN);
    storage.data.set(key(ORIGIN, '11111111-2222-3333-4444-555555555555'), { v: 9 });
    storage.data.set('autre-cle', 'ignorée');
    storage.data.set('vault:pas-une-origine:xx', 'ignorée');

    const all = await vault.list();
    expect(all.map((e) => `${e.origin}|${e.deviceId}|${e.readable}`)).toEqual([
      `${ORIGIN}|11111111-2222-3333-4444-555555555555|false`,
      `${ORIGIN}|${DEVICE}|true`,
      `${OTHER_ORIGIN}|${DEVICE_2}|true`,
    ]);
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
      // On ignore les commentaires, qui peuvent légitimement citer ces termes.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect({ f, hit: re.test(code) }).toEqual({ f, hit: false });
    }
  });
});
