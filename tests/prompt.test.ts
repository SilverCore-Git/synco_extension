import { describe, expect, test } from 'bun:test';
import { PromptManager, SUCCESS_LINGER_MS, type PromptRequest } from '../src/background/prompt';
import { MemoryLimiterStore, SlidingWindowLimiter } from '../src/background/rateLimit';
import { VaultError } from '../src/vault/errors';
import { FakeHost, FakeTimers, until } from './helpers/bgFixtures';
import { ORIGIN, OTHER_ORIGIN } from './helpers/vaultFixtures';

function setup(opts: { max?: number; timeoutMs?: number } = {}) {
  const host = new FakeHost();
  const timers = new FakeTimers();
  const store = new MemoryLimiterStore();
  const limiter = new SlidingWindowLimiter({ max: opts.max ?? 3, windowMs: 60_000, store, now: () => timers.now });
  let n = 0;
  const prompts = new PromptManager({
    host,
    limiter,
    timers,
    now: () => timers.now,
    timeoutMs: opts.timeoutMs ?? 120_000,
    randomId: () => String(++n).padStart(32, '0'),
  });
  const req = (over: Partial<PromptRequest<string>> = {}): PromptRequest<string> => ({
    origin: ORIGIN,
    tabId: 7,
    mode: 'load',
    reason: null,
    replacing: false,
    attempt: async (pin) => (pin === '1234' ? 'ok' : Promise.reject(new VaultError('wrong-pin'))),
    ...over,
  });
  return { host, timers, store, limiter, prompts, req };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as VaultError).code;
  }
  return 'resolved';
};

describe('une seule invite à la fois', () => {
  test('une demande concurrente est refusée (cancelled) sans seconde fenêtre', async () => {
    const { host, prompts, req } = setup();
    const first = prompts.run(req());
    await until(() => host.opened.length === 1);
    expect(await code(prompts.run(req({ origin: OTHER_ORIGIN })))).toBe('cancelled');
    expect(host.opened).toHaveLength(1);
    prompts.cancel(host.sessionId);
    expect(await code(first)).toBe('cancelled');
  });

  test('deux demandes simultanées : une seule fenêtre s\'ouvre', async () => {
    const { host, prompts, req } = setup();
    const a = code(prompts.run(req()));
    const b = code(prompts.run(req()));
    await until(() => host.opened.length >= 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(host.opened).toHaveLength(1);
    prompts.cancel(host.sessionId);
    expect((await Promise.all([a, b])).sort()).toEqual(['cancelled', 'cancelled']);
  });

  test('après l\'issue d\'une invite, la suivante peut s\'ouvrir', async () => {
    const { host, prompts, req } = setup();
    const first = prompts.run(req());
    await until(() => host.opened.length === 1);
    expect(await prompts.submit(host.sessionId, '1234')).toEqual({ ok: true });
    expect(await first).toBe('ok');
    const second = prompts.run(req());
    await until(() => host.opened.length === 2);
    prompts.cancel(host.sessionId);
    expect(await code(second)).toBe('cancelled');
  });
});

describe('limite de débit par origine', () => {
  test('au-delà de 3 invites par minute : refus (locked + délai) sans afficher de fenêtre', async () => {
    const { host, prompts, req, timers } = setup();
    for (let i = 1; i <= 3; i++) {
      const p = prompts.run(req());
      await until(() => host.opened.length === i);
      prompts.cancel(host.sessionId);
      await code(p);
    }
    let err: VaultError | undefined;
    try {
      await prompts.run(req());
    } catch (e) {
      err = e as VaultError;
    }
    expect(err?.code).toBe('locked');
    expect(err?.retryAfterSeconds).toBeGreaterThan(0);
    expect(err?.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(host.opened).toHaveLength(3); // pas de 4ᵉ fenêtre

    timers.advance(61_000); // la fenêtre glisse
    const again = prompts.run(req());
    await until(() => host.opened.length === 4);
    prompts.cancel(host.sessionId);
    await code(again);
  });

  test('la limite est par origine : une autre origine n\'est pas pénalisée', async () => {
    const { host, prompts, req } = setup({ max: 1 });
    const a = prompts.run(req());
    await until(() => host.opened.length === 1);
    prompts.cancel(host.sessionId);
    await code(a);
    expect(await code(prompts.run(req()))).toBe('locked');
    const b = prompts.run(req({ origin: OTHER_ORIGIN }));
    await until(() => host.opened.length === 2);
    prompts.cancel(host.sessionId);
    await code(b);
  });

  test('une demande refusée parce qu\'une invite est ouverte ne consomme pas de jeton', async () => {
    const { host, prompts, req, store } = setup({ max: 2 });
    const first = prompts.run(req());
    await until(() => host.opened.length === 1);
    for (let i = 0; i < 20; i++) await code(prompts.run(req()));
    expect(Object.values(await store.load()).flat()).toHaveLength(1);
    prompts.cancel(host.sessionId);
    await code(first);
  });
});

describe('fermeture, délai, onglet', () => {
  test('fenêtre fermée par l\'utilisateur : cancelled', async () => {
    const { host, prompts, req } = setup();
    const p = prompts.run(req());
    await until(() => host.opened.length === 1);
    host.removeWindow(host.opened[0]!.windowId);
    expect(await code(p)).toBe('cancelled');
    // La clé de session ne sert plus à rien.
    expect(prompts.ping(host.sessionId)).toBe(false);
  });

  test('la fermeture d\'une autre fenêtre est sans effet', async () => {
    const { host, prompts, req } = setup();
    const p = prompts.run(req());
    await until(() => host.opened.length === 1);
    host.removeWindow(9999);
    expect(prompts.ping(host.sessionId)).toBe(true);
    prompts.cancel(host.sessionId);
    await code(p);
  });

  test('délai maximal dépassé : cancelled et fenêtre fermée', async () => {
    const { host, prompts, req, timers } = setup({ timeoutMs: 120_000 });
    const p = prompts.run(req());
    await until(() => host.opened.length === 1);
    timers.advance(119_000);
    expect(prompts.ping(host.sessionId)).toBe(true);
    timers.advance(1_000);
    expect(await code(p)).toBe('cancelled');
    timers.advance(100);
    expect(host.closed).toEqual([host.opened[0]!.windowId]);
    expect(await prompts.submit(host.sessionId, '1234')).toMatchObject({ ok: false, error: { code: 'cancelled', terminal: true } });
  });

  test('onglet demandeur fermé pendant l\'invite : cancelled et fenêtre fermée', async () => {
    const { host, prompts, req, timers } = setup();
    const p = prompts.run(req({ tabId: 7 }));
    await until(() => host.opened.length === 1);
    host.removeTab(8); // un autre onglet : sans effet
    expect(prompts.ping(host.sessionId)).toBe(true);
    host.removeTab(7);
    expect(await code(p)).toBe('cancelled');
    timers.advance(100);
    expect(host.closed).toHaveLength(1);
  });

  test('annulation pendant l\'ouverture de la fenêtre : la fenêtre est fermée dès qu\'elle existe', async () => {
    const { host, prompts, req, timers } = setup();
    let release!: () => void;
    host.openDelay = new Promise((r) => (release = r));
    const p = prompts.run(req({ tabId: 7 }));
    await new Promise((r) => setTimeout(r, 5));
    host.removeTab(7);
    expect(await code(p)).toBe('cancelled');
    release();
    await until(() => host.opened.length === 1);
    await new Promise((r) => setTimeout(r, 5));
    timers.advance(100);
    expect(host.closed).toEqual([host.opened[0]!.windowId]);
  });

  test('impossible d\'ouvrir la fenêtre : unavailable', async () => {
    const { host, prompts, req } = setup();
    host.failOpen = true;
    expect(await code(prompts.run(req()))).toBe('unavailable');
    // et le gestionnaire n'est pas bloqué
    host.failOpen = false;
    const p = prompts.run(req());
    await until(() => host.opened.length === 1);
    prompts.cancel(host.sessionId);
    await code(p);
  });
});

describe('saisie du PIN', () => {
  test('mauvais PIN : saisie relancée, même fenêtre ; bon PIN : succès et fenêtre fermée', async () => {
    const { host, prompts, req, timers } = setup();
    const p = prompts.run(req());
    await until(() => host.opened.length === 1);
    const wrong = await prompts.submit(host.sessionId, '0000');
    expect(wrong).toEqual({ ok: false, error: { code: 'wrong-pin', terminal: false } });
    expect(host.closed).toHaveLength(0);
    expect(await prompts.submit(host.sessionId, '1234')).toEqual({ ok: true });
    expect(await p).toBe('ok');
    timers.advance(100);
    expect(host.closed).toHaveLength(0); // la page d'invite montre sa réussite avant de se fermer
    timers.advance(SUCCESS_LINGER_MS);
    expect(host.closed).toEqual([host.opened[0]!.windowId]);
  });

  test('erreur terminale (locked) : renvoyée à la page, la fenêtre reste affichée un moment', async () => {
    const { host, prompts, req, timers } = setup();
    const p = prompts.run(req({ attempt: async () => { throw new VaultError('locked', undefined, 30); } }));
    await until(() => host.opened.length === 1);
    expect(await prompts.submit(host.sessionId, '1234')).toEqual({ ok: false, error: { code: 'locked', retryAfterSeconds: 30, terminal: true } });
    expect(await code(p)).toBe('locked');
    timers.advance(100);
    expect(host.closed).toHaveLength(0); // laissée pour que l'utilisateur lise le message
    timers.advance(15_000);
    expect(host.closed).toHaveLength(1);
  });

  test('erreur inattendue : unavailable, sans fuite du message interne', async () => {
    const { host, prompts, req } = setup();
    const p = prompts.run(req({ attempt: async () => { throw new Error('PIN 1234 invalide dans la clé 0xabc'); } }));
    await until(() => host.opened.length === 1);
    const out = await prompts.submit(host.sessionId, '1234');
    expect(JSON.stringify(out)).not.toContain('0xabc');
    expect(JSON.stringify(out)).not.toContain('1234');
    let err: VaultError | undefined;
    try {
      await p;
    } catch (e) {
      err = e as VaultError;
    }
    expect(err?.code).toBe('unavailable');
    expect(err?.message).not.toContain('0xabc');
  });

  test('deux saisies simultanées : la seconde est refusée, une seule vérification a lieu', async () => {
    const { host, prompts, req } = setup();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = prompts.run(req({ attempt: async () => { calls++; await gate; return 'ok'; } }));
    await until(() => host.opened.length === 1);
    const first = prompts.submit(host.sessionId, '1234');
    const second = await prompts.submit(host.sessionId, '1234');
    expect(second).toMatchObject({ ok: false, error: { terminal: false } });
    release();
    expect(await first).toEqual({ ok: true });
    expect(await p).toBe('ok');
    expect(calls).toBe(1);
  });

  test('expirée pendant la vérification : la clé obtenue est effacée et jamais délivrée', async () => {
    const { host, prompts, req, timers } = setup({ timeoutMs: 1000 });
    const dk = new Uint8Array(32).fill(7);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = prompts.run(req({ attempt: async () => { await gate; return dk as never; } }));
    await until(() => host.opened.length === 1);
    const submit = prompts.submit(host.sessionId, '1234');
    timers.advance(1000); // le délai tombe pendant la vérification
    expect(await code(p)).toBe('cancelled');
    release();
    expect(await submit).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(dk.every((b) => b === 0)).toBe(true);
  });

  test('hello : informations affichées, origine issue de la session', async () => {
    const { host, prompts, req } = setup();
    const p = prompts.run(req({ origin: OTHER_ORIGIN, reason: 'Déverrouiller', mode: 'create', replacing: true }));
    await until(() => host.opened.length === 1);
    expect(prompts.hello(host.sessionId)).toMatchObject({
      origin: OTHER_ORIGIN,
      mode: 'create',
      reason: 'Déverrouiller',
      replacing: true,
      minPin: 4,
      maxPin: 32,
      expiresAt: 120_000,
    });
    expect(prompts.hello('f'.repeat(32))).toBeNull();
    prompts.cancel(host.sessionId);
    await code(p);
  });
});
