import { describe, expect, test } from 'bun:test';
import { MemoryLimiterStore, SlidingWindowLimiter } from '../src/background/rateLimit';
import { ExtensionVaultStorage, SessionLimiterStore, type StorageAreaLike } from '../src/background/storage';
import { Vault } from '../src/vault/vault';
import { DEVICE, FAST, MemorySecret, ORIGIN, PIN } from './helpers/vaultFixtures';

/** `storage.local` simulé : sérialise en JSON comme le vrai (pas de structuredClone, pas de types riches). */
class FakeArea implements StorageAreaLike {
  data: Record<string, string> = {};
  async get(keys: string | string[] | null) {
    const names = keys === null ? Object.keys(this.data) : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of names) if (k in this.data) out[k] = JSON.parse(this.data[k]!);
    return out;
  }
  async set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) this.data[k] = JSON.stringify(v);
  }
  async remove(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete this.data[k];
  }
}

describe('adaptateur storage.local', () => {
  test('le coffre fonctionne sur un stockage JSON, et un « redémarrage du worker » le retrouve intact', async () => {
    const area = new FakeArea();
    const secret = new MemorySecret(); // le second secret vit dans IndexedDB : il survit au worker
    const make = () => new Vault({ storage: new ExtensionVaultStorage(area), secret, ...FAST });

    const dk = await make().create(ORIGIN, DEVICE, PIN);
    const afterRestart = make(); // nouvelle instance : aucun état en mémoire
    expect(await afterRestart.has(ORIGIN, DEVICE)).toBe(true);
    expect(await afterRestart.load(ORIGIN, DEVICE, PIN)).toEqual(dk);
    expect(await afterRestart.list()).toHaveLength(1);
  });

  test('le compteur d\'échecs survit au redémarrage du worker', async () => {
    const area = new FakeArea();
    const secret = new MemorySecret();
    const make = () => new Vault({ storage: new ExtensionVaultStorage(area), secret, ...FAST });
    await make().create(ORIGIN, DEVICE, PIN);
    for (let i = 0; i < 3; i++) await make().load(ORIGIN, DEVICE, '0000').catch(() => undefined);
    const raw = JSON.parse(area.data[`vault:${ORIGIN}:${DEVICE}`]!);
    expect(raw.failures).toBe(3);
  });
});

describe('limiteur : état persistant', () => {
  const opts = (store: MemoryLimiterStore | SessionLimiterStore, t: { now: number }) => ({
    max: 3,
    windowMs: 60_000,
    store,
    now: () => t.now,
  });

  test('un worker qui redémarre ne remet pas les compteurs à zéro (storage.session)', async () => {
    const area = new FakeArea();
    const t = { now: 1_000_000 };
    const first = new SlidingWindowLimiter(opts(new SessionLimiterStore(area), t));
    for (let i = 0; i < 3; i++) expect((await first.take('o')).ok).toBe(true);

    const restarted = new SlidingWindowLimiter(opts(new SessionLimiterStore(area), t)); // nouvelle instance
    expect((await restarted.take('o')).ok).toBe(false);
  });

  test('sans persistance, un redémarrage contournerait la limite (c\'est ce que la persistance évite)', async () => {
    const t = { now: 1_000_000 };
    const a = new SlidingWindowLimiter(opts(new MemoryLimiterStore(), t));
    for (let i = 0; i < 3; i++) await a.take('o');
    const b = new SlidingWindowLimiter(opts(new MemoryLimiterStore(), t));
    expect((await b.take('o')).ok).toBe(true);
  });

  test('fenêtre glissante et délai restant', async () => {
    const t = { now: 1_000_000 };
    const l = new SlidingWindowLimiter(opts(new MemoryLimiterStore(), t));
    await l.take('o');
    t.now += 10_000;
    await l.take('o');
    t.now += 10_000;
    await l.take('o');
    t.now += 10_000;
    expect(await l.take('o')).toEqual({ ok: false, retryAfterSeconds: 30 }); // le plus ancien expire dans 30 s
    t.now += 30_000;
    expect((await l.take('o')).ok).toBe(true);
  });

  test('appels simultanés : jamais plus de `max` jetons accordés', async () => {
    const t = { now: 1_000_000 };
    const l = new SlidingWindowLimiter(opts(new MemoryLimiterStore(), t));
    const results = await Promise.all(Array.from({ length: 20 }, () => l.take('o')));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });

  test('clés indépendantes, et état altéré dans le stockage ignoré', async () => {
    const area = new FakeArea();
    await area.set({ 'rate-limit:prompts': { a: ['x', 1], b: 'pas une liste', c: [5] } });
    const store = new SessionLimiterStore(area);
    expect(await store.load()).toEqual({ c: [5] });
    await area.set({ 'rate-limit:prompts': 42 });
    expect(await store.load()).toEqual({});
  });
});
