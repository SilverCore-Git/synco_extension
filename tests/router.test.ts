import { describe, expect, test } from 'bun:test';
import { fromB64 } from '../src/vault/encoding';
import { recordKey } from '../src/vault/record';
import { Router } from '../src/background/router';
import { ALLOWED, BASE, EXT_ID, makeBackground, optionsSender, pageSender, promptSender, until } from './helpers/bgFixtures';
import { DEVICE, DEVICE_2, FAST, ORIGIN, OTHER_ORIGIN, PIN, WRONG_PIN } from './helpers/vaultFixtures';

type Resp = { id: number | null; ok: boolean; result?: any; error?: { code: string; message?: string; retryAfterSeconds?: number } };

describe('opérations sans PIN', () => {
  test('status : présence, version du protocole, origines autorisées, enregistrements de CETTE origine', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    await bg.vault.create(OTHER_ORIGIN, DEVICE_2, PIN);
    const r = (await bg.router.handle(bg.vaultMsg('status'), pageSender(ORIGIN))) as Resp;
    expect(r).toEqual({
      id: 1,
      ok: true,
      result: { present: true, protocol: 1, version: '9.9.9', allowedOrigins: [...ALLOWED], records: [DEVICE] },
    });
  });

  test('has et remove : limités à l\'origine appelante', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);

    const other = (await bg.router.handle(bg.vaultMsg('has', { deviceId: DEVICE }), pageSender(OTHER_ORIGIN))) as Resp;
    expect(other.result).toEqual({ exists: false });
    await bg.router.handle(bg.vaultMsg('remove', { deviceId: DEVICE }), pageSender(OTHER_ORIGIN));
    expect(await bg.vault.has(ORIGIN, DEVICE)).toBe(true); // intact

    const own = (await bg.router.handle(bg.vaultMsg('has', { deviceId: DEVICE }), pageSender(ORIGIN))) as Resp;
    expect(own.result).toEqual({ exists: true });
    const rm = (await bg.router.handle(bg.vaultMsg('remove', { deviceId: DEVICE }), pageSender(ORIGIN))) as Resp;
    expect(rm.ok).toBe(true);
    expect(await bg.vault.has(ORIGIN, DEVICE)).toBe(false);
  });

  test('remove ne demande pas de PIN et n\'ouvre aucune fenêtre', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    await bg.router.handle(bg.vaultMsg('remove', { deviceId: DEVICE }), pageSender());
    expect(bg.host.opened).toHaveLength(0);
  });
});

describe('create et load via l\'invite', () => {
  test('create : la DK revient en base64 (32 octets) et load la restitue après saisie du PIN', async () => {
    const bg = makeBackground();
    const created = await bg.promptFlow('create', PIN);
    expect(created.submit).toEqual({ ok: true });
    const dk = fromB64(created.response.result.dk)!;
    expect(dk).toHaveLength(32);
    expect(bg.host.opened).toHaveLength(1);

    const loaded = await bg.promptFlow('load', PIN);
    expect(loaded.response.result.dk).toBe(created.response.result.dk);
  });

  test('l\'invite affiche l\'origine vue par le worker et une raison nettoyée', async () => {
    const bg = makeBackground();
    const done = bg.router.handle(
      bg.vaultMsg('create', { deviceId: DEVICE, reason: 'Relier\ncet appareil' }),
      pageSender(OTHER_ORIGIN),
    );
    await until(() => bg.host.opened.length === 1);
    const hello = (await bg.router.handle({ kind: 'prompt', type: 'hello', sessionId: bg.host.sessionId }, promptSender(bg.host.sessionId))) as any;
    expect(hello.info).toMatchObject({ origin: OTHER_ORIGIN, mode: 'create', reason: 'Relier cet appareil', replacing: false });
    await bg.router.handle({ kind: 'prompt', type: 'cancel', sessionId: bg.host.sessionId }, promptSender(bg.host.sessionId));
    expect(((await done) as Resp).error?.code).toBe('cancelled');
  });

  test('load sans enregistrement : missing, sans afficher de fenêtre', async () => {
    const bg = makeBackground();
    const r = (await bg.router.handle(bg.vaultMsg('load', { deviceId: DEVICE }), pageSender())) as Resp;
    expect(r.error?.code).toBe('missing');
    expect(bg.host.opened).toHaveLength(0);
  });

  test('create sur un appareil déjà enregistré : l\'invite le signale (remplacement)', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    const done = bg.router.handle(bg.vaultMsg('create', { deviceId: DEVICE }), pageSender());
    await until(() => bg.host.opened.length === 1);
    const hello = (await bg.router.handle({ kind: 'prompt', type: 'hello', sessionId: bg.host.sessionId }, promptSender(bg.host.sessionId))) as any;
    expect(hello.info.replacing).toBe(true);
    bg.prompts.cancel(bg.host.sessionId);
    await done;
  });

  test('mauvais PIN : l\'invite reste ouverte pour une nouvelle saisie, la page n\'a pas encore de réponse', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);

    let settled = false;
    const done = (bg.router.handle(bg.vaultMsg('load', { deviceId: DEVICE }), pageSender()) as Promise<Resp>).then((r) => {
      settled = true;
      return r;
    });
    await until(() => bg.host.opened.length === 1);
    const wrong = (await bg.router.handle(
      { kind: 'prompt', type: 'submit', sessionId: bg.host.sessionId, pin: WRONG_PIN },
      promptSender(bg.host.sessionId),
    )) as any;
    expect(wrong).toEqual({ ok: false, error: { code: 'wrong-pin', terminal: false } });
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    expect(bg.host.opened).toHaveLength(1); // jamais une deuxième fenêtre

    await bg.router.handle({ kind: 'prompt', type: 'submit', sessionId: bg.host.sessionId, pin: PIN }, promptSender(bg.host.sessionId));
    expect((await done).ok).toBe(true);
  });

  test('10 mauvais PIN dans la même invite : wiped renvoyé à la page, enregistrement effacé', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    const done = bg.router.handle(bg.vaultMsg('load', { deviceId: DEVICE }), pageSender()) as Promise<Resp>;
    await until(() => bg.host.opened.length === 1);
    let last: any;
    for (let i = 0; i < 10; i++) {
      last = await bg.router.handle(
        { kind: 'prompt', type: 'submit', sessionId: bg.host.sessionId, pin: WRONG_PIN },
        promptSender(bg.host.sessionId),
      );
      bg.timers.advance(0);
      // le délai croissant : on avance l'horloge du coffre en vidant les verrous en réécrivant lockedUntil
      const key = recordKey(ORIGIN, DEVICE);
      const rec = bg.storage.data.get(key) as any;
      if (rec) bg.storage.data.set(key, { ...rec, lockedUntil: null });
    }
    expect(last.error).toMatchObject({ code: 'wiped', terminal: true });
    expect(((await done) as Resp).error?.code).toBe('wiped');
    expect(await bg.vault.has(ORIGIN, DEVICE)).toBe(false);
  });

  test('origine = celle de sender, jamais celle que le message prétendrait : namespace de l\'expéditeur', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    // L'expéditeur est la page de développement ; le message prétend venir de la production.
    const forged = { ...bg.vaultMsg('load', { deviceId: DEVICE }), origin: ORIGIN, request: { id: 1, op: 'load', args: { deviceId: DEVICE } } };
    const r = (await bg.router.handle(forged, pageSender(OTHER_ORIGIN))) as Resp;
    expect(r.error?.code).toBe('missing'); // cherché sous l'origine de dev : rien
    expect(bg.host.opened).toHaveLength(0);
  });

  test('un champ d\'origine glissé dans la requête est refusé (requête mal formée)', async () => {
    const bg = makeBackground();
    const msg = { kind: 'vault', protocol: 1, request: { id: 1, op: 'status', args: {}, origin: ORIGIN } };
    const r = (await bg.router.handle(msg, pageSender())) as Resp;
    expect(r.error?.code).toBe('bad-request');
  });

  test('la DK de l\'appelant est effacée côté worker après encodage', async () => {
    const bg = makeBackground();
    const dk = new Uint8Array(32).fill(0xab);
    const fake = new Router({
      vault: { ...bg.vault, has: async () => false, list: async () => [], remove: async () => {}, load: async () => dk, create: async () => dk } as never,
      prompts: bg.prompts,
      allowedOrigins: ALLOWED,
      extensionId: EXT_ID,
      baseUrl: BASE,
      version: '1',
      hostAccess: async () => [],
    });
    const done = fake.handle(bg.vaultMsg('create', { deviceId: DEVICE }), pageSender()) as Promise<Resp>;
    await until(() => bg.host.opened.length === 1);
    await fake.handle({ kind: 'prompt', type: 'submit', sessionId: bg.host.sessionId, pin: PIN }, promptSender(bg.host.sessionId));
    const r = await done;
    expect(fromB64(r.result.dk)).toEqual(new Uint8Array(32).fill(0xab));
    expect(dk.every((b) => b === 0)).toBe(true);
  });
});

describe('refus avant toute opération', () => {
  const unauthorized: [string, Parameters<typeof pageSender>[0], Parameters<typeof pageSender>[1]][] = [
    ['origine non autorisée', 'https://evil.example', {}],
    ['iframe', ORIGIN, { frameId: 2 }],
    ['sans onglet', ORIGIN, { tab: undefined }],
  ];

  test.each(unauthorized)('%s : aucune opération, aucune fenêtre, aucun effet', async (_n, origin, over) => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    const before = JSON.stringify([...bg.storage.data]);
    for (const op of ['status', 'has', 'remove', 'load', 'create']) {
      const r = (await bg.router.handle(bg.vaultMsg(op, op === 'status' ? {} : { deviceId: DEVICE }), pageSender(origin, over))) as Resp;
      expect(r.ok).toBe(false);
      expect(r.error?.code).toBe('unavailable');
    }
    expect(bg.host.opened).toHaveLength(0);
    expect(bg.vaultCalls).toEqual([]); // le coffre n'a même pas été sollicité
    expect(JSON.stringify([...bg.storage.data])).toBe(before);
  });

  test('protocole inconnu : unsupported-protocol', async () => {
    const bg = makeBackground();
    const r = (await bg.router.handle({ ...bg.vaultMsg('status'), protocol: 2 }, pageSender())) as Resp;
    expect(r.error?.code).toBe('unsupported-protocol');
  });

  test.each([undefined, null, 'texte', 42, [], {}, { kind: 'autre' }, { kind: 'vault' }])('message inconnu %p : refusé', async (msg) => {
    const bg = makeBackground();
    const r = (await bg.router.handle(msg, pageSender())) as Resp;
    expect(r.ok).toBe(false);
  });

  test('erreur interne : réponse générique, sans détail', async () => {
    const bg = makeBackground();
    const boom = new Router({
      vault: { ...bg.vault, list: async () => { throw new Error('secret interne 1234'); } } as never,
      prompts: bg.prompts,
      allowedOrigins: ALLOWED,
      extensionId: EXT_ID,
      baseUrl: BASE,
      version: '1',
      hostAccess: async () => [],
    });
    const r = (await boom.handle(bg.vaultMsg('status'), pageSender())) as Resp;
    expect(r.error).toEqual({ code: 'unavailable' });
  });
});

describe('messages de l\'invite et de la page d\'options', () => {
  test('un content script (page web) ne peut pas parler à l\'invite, même avec le bon sessionId', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    const done = bg.router.handle(bg.vaultMsg('load', { deviceId: DEVICE }), pageSender()) as Promise<Resp>;
    await until(() => bg.host.opened.length === 1);
    const sid = bg.host.sessionId;

    for (const type of ['hello', 'ping', 'cancel']) {
      const r = (await bg.router.handle({ kind: 'prompt', type, sessionId: sid }, pageSender())) as any;
      expect(r.ok).toBe(false);
    }
    const stolen = (await bg.router.handle({ kind: 'prompt', type: 'submit', sessionId: sid, pin: PIN }, pageSender())) as any;
    expect(stolen.ok).toBe(false);

    // L'invite est toujours en attente et n'a rien délivré.
    expect(bg.prompts.ping(sid)).toBe(true);
    bg.prompts.cancel(sid);
    expect((await done).error?.code).toBe('cancelled');
  });

  test('invite : identifiant de session invalide ou périmé refusé', async () => {
    const bg = makeBackground();
    for (const sessionId of ['', 'x', 'g'.repeat(32), 42, undefined, '0'.repeat(31)]) {
      const r = (await bg.router.handle({ kind: 'prompt', type: 'hello', sessionId }, promptSender())) as any;
      expect(r.ok).toBe(false);
    }
    const stale = (await bg.router.handle({ kind: 'prompt', type: 'hello', sessionId: '1'.repeat(32) }, promptSender())) as any;
    expect(stale.error.code).toBe('cancelled');
  });

  test('page d\'options : liste, suppression, accès aux sites ; réservée à options.html', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    await bg.vault.create(OTHER_ORIGIN, DEVICE_2, PIN);

    const list = (await bg.router.handle({ kind: 'internal', op: 'list' }, optionsSender())) as any;
    expect(list.result.entries.map((e: any) => e.deviceId).sort()).toEqual([DEVICE, DEVICE_2].sort());
    expect(JSON.stringify(list)).not.toContain('wrapped');

    const hosts = (await bg.router.handle({ kind: 'internal', op: 'hostAccess' }, optionsSender())) as any;
    expect(hosts.result.hosts).toEqual(ALLOWED.map((origin) => ({ origin, granted: true })));

    await bg.router.handle({ kind: 'internal', op: 'remove', origin: ORIGIN, deviceId: DEVICE }, optionsSender());
    expect(await bg.vault.has(ORIGIN, DEVICE)).toBe(false);
    expect(await bg.vault.has(OTHER_ORIGIN, DEVICE_2)).toBe(true);
  });

  test.each([
    ['page Synco légitime', pageSender()],
    ['page web à l\'URL imitée', { id: EXT_ID, url: 'https://evil.example/options.html', frameId: 0, tab: { id: 1 } }],
    ['page d\'invite du PIN', promptSender()],
    ['autre extension', optionsSender({ id: 'autre' })],
  ])('opérations internes refusées : %s', async (_n, sender) => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    for (const msg of [
      { kind: 'internal', op: 'list' },
      { kind: 'internal', op: 'hostAccess' },
      { kind: 'internal', op: 'remove', origin: ORIGIN, deviceId: DEVICE },
    ]) {
      const r = (await bg.router.handle(msg, sender)) as Resp;
      expect(r.ok).toBe(false);
    }
    expect(await bg.vault.has(ORIGIN, DEVICE)).toBe(true);
  });

  test('suppression interne : arguments invalides refusés', async () => {
    const bg = makeBackground();
    await bg.vault.create(ORIGIN, DEVICE, PIN);
    for (const bad of [
      { origin: '*', deviceId: DEVICE },
      { origin: ORIGIN, deviceId: 'x' },
      { origin: 42, deviceId: DEVICE },
    ]) {
      const r = (await bg.router.handle({ kind: 'internal', op: 'remove', ...bad }, optionsSender())) as Resp;
      expect(r.ok).toBe(false);
    }
    expect(await bg.vault.has(ORIGIN, DEVICE)).toBe(true);
    expect(FAST.iterations).toBeGreaterThan(0);
  });
});
