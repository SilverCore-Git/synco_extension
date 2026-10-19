import { describe, expect, test } from 'bun:test';
import { startBridge, type BridgeWindow } from '../src/bridge/bridge';
import type { VaultEnvelope } from '../src/shared/protocol';
import { toB64 } from '../src/vault/encoding';
import { DEVICE, ORIGIN } from './helpers/vaultFixtures';

class FakeWindow implements BridgeWindow {
  location = { origin: ORIGIN };
  posted: { msg: any; targetOrigin: string; transfer: Transferable[] }[] = [];
  private listeners: ((e: { source: unknown; origin: string; data: unknown }) => void)[] = [];
  addEventListener(_type: 'message', cb: (e: { source: unknown; origin: string; data: unknown }) => void) {
    this.listeners.push(cb);
  }
  postMessage(msg: unknown, targetOrigin: string, transfer: Transferable[]) {
    this.posted.push({ msg, targetOrigin, transfer });
  }
  /** Un message reçu par la fenêtre (par défaut : de la page elle-même, même origine). */
  receive(data: unknown, over: { source?: unknown; origin?: string } = {}) {
    for (const l of this.listeners) l({ source: 'source' in over ? over.source : this, origin: over.origin ?? ORIGIN, data });
  }
}

const hello = { source: 'synco-page', type: 'hello', protocol: 1 };

function setup(respond: (e: VaultEnvelope) => unknown | Promise<unknown> = (e) => ({ id: e.request.id, ok: true, result: { exists: true } })) {
  const win = new FakeWindow();
  const sent: VaultEnvelope[] = [];
  startBridge({
    win,
    send: async (envelope) => {
      sent.push(envelope);
      return respond(envelope);
    },
    maxPorts: 3,
    allowedOrigins: [ORIGIN],
  });
  const connect = () => {
    const before = win.posted.length;
    win.receive(hello);
    expect(win.posted.length).toBe(before + 1);
    const port = win.posted.at(-1)!.transfer[0] as MessagePort;
    return port;
  };
  return { win, sent, connect };
}

/** Envoie une requête sur le port et attend la réponse portant le même identifiant (ou null après un court délai). */
function call(port: MessagePort, request: unknown, waitMs = 200): Promise<any> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), waitMs);
    port.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data);
    };
    port.postMessage(request);
  });
}

describe('handshake', () => {
  test('hello valide : « ready » avec un MessagePort transféré, vers l\'origine de la page (jamais « * »)', () => {
    const { win, connect } = setup();
    const port = connect();
    expect(port).toBeInstanceOf(MessagePort);
    expect(win.posted[0]).toMatchObject({ msg: { source: 'synco-extension', type: 'ready', protocol: 1 }, targetOrigin: ORIGIN });
    expect(win.posted[0]!.transfer).toHaveLength(1);
  });

  test.each([
    ['source différente (iframe, autre fenêtre)', { source: {} }],
    ['source absente', { source: null }],
    ['origine différente', { origin: 'https://evil.example' }],
    ['origine voisine', { origin: 'https://app.synco.one:444' }],
  ])('hello ignoré : %s', (_n, over) => {
    const { win } = setup();
    win.receive(hello, over);
    expect(win.posted).toHaveLength(0);
  });

  test.each([
    ['mauvaise source de message', { ...hello, source: 'autre' }],
    ['mauvais type', { ...hello, type: 'ready' }],
    ['champ supplémentaire', { ...hello, extra: 1 }],
    ['sans protocole', { source: 'synco-page', type: 'hello', x: 1 }],
    ['texte', 'hello'],
    ['null', null],
    ['tableau', ['hello']],
  ])('hello ignoré : %s', (_n, data) => {
    const { win } = setup();
    win.receive(data);
    expect(win.posted).toHaveLength(0);
  });

  test('protocole non pris en charge : « unsupported », aucun port', () => {
    const { win } = setup();
    win.receive({ ...hello, protocol: 2 });
    expect(win.posted).toHaveLength(1);
    expect(win.posted[0]!.msg).toEqual({ source: 'synco-extension', type: 'unsupported', protocol: 1 });
    expect(win.posted[0]!.transfer).toHaveLength(0);
  });

  test('origine de la page absente de la liste blanche (Firefox ne filtre pas le port) : aucune réponse', () => {
    const win = new FakeWindow();
    win.location = { origin: 'https://localhost:9999' }; // même hôte que la liste, autre port
    const labels: string[] = [];
    startBridge({ win, send: async () => ({}), allowedOrigins: ['https://localhost:5174'], debug: (l) => labels.push(l) });
    win.receive(hello, { origin: 'https://localhost:9999' });
    expect(win.posted).toHaveLength(0);
    expect(labels).toEqual(['hello-refusé:liste']);
  });

  test('aucune diffusion : seules les réponses « ready » sortent sur window', async () => {
    const { win, connect } = setup();
    const port = connect();
    await call(port, { id: 1, op: 'status', args: {} });
    await call(port, { id: 2, op: 'nope', args: {} });
    expect(win.posted).toHaveLength(1);
  });

  test('le plus ancien canal est fermé au-delà du plafond', async () => {
    const { connect } = setup();
    const oldest = connect();
    connect();
    connect();
    expect((await call(oldest, { id: 1, op: 'status', args: {} }))?.ok).toBe(true);
    connect(); // 4ᵉ canal, plafond à 3
    expect(await call(oldest, { id: 2, op: 'status', args: {} }, 50)).toBeNull();
  });
});

describe('requêtes sur le port', () => {
  test('relayées au worker sous une enveloppe versionnée, la réponse porte l\'identifiant', async () => {
    const { connect, sent } = setup();
    const r = await call(connect(), { id: 41, op: 'has', args: { deviceId: DEVICE } });
    expect(r).toEqual({ id: 41, ok: true, result: { exists: true } });
    expect(sent).toEqual([{ kind: 'vault', protocol: 1, request: { id: 41, op: 'has', args: { deviceId: DEVICE } } }]);
  });

  test.each([
    ['opération inconnue', { id: 5, op: 'exportAll', args: {} }],
    ['deviceId non UUID', { id: 5, op: 'has', args: { deviceId: 'abc' } }],
    ['champ falsifié (origine)', { id: 5, op: 'status', args: {}, origin: 'https://app.synco.one' }],
    ['argument en trop', { id: 5, op: 'load', args: { deviceId: DEVICE, pin: '1234' } }],
    ['message surdimensionné', { id: 5, op: 'status', args: {}, pad: 'x'.repeat(5000) }],
    ['pas un objet', 'texte'],
  ])('refusée sans atteindre le worker : %s', async (_n, request) => {
    const { connect, sent } = setup();
    const r = await call(connect(), request);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('bad-request');
    expect(sent).toHaveLength(0);
  });

  test('l\'identifiant d\'une requête invalide est renvoyé pour que la page puisse la rapprocher', async () => {
    const { connect } = setup();
    expect((await call(connect(), { id: 77, op: 'nope', args: {} })).id).toBe(77);
  });

  test('worker injoignable : unavailable (jamais d\'attente infinie, ni de détail)', async () => {
    const { connect } = setup(() => {
      throw new Error('Extension context invalidated 0xsecret');
    });
    const r = await call(connect(), { id: 1, op: 'status', args: {} });
    expect(r.error.code).toBe('unavailable');
    expect(JSON.stringify(r)).not.toContain('0xsecret');
  });
});

describe('réponses du worker vers la page', () => {
  test('DK : base64 → ArrayBuffer de 32 octets transféré, jamais de chaîne', async () => {
    const dk = new Uint8Array(32).map((_, i) => i + 1);
    const { connect } = setup((e) => ({ id: e.request.id, ok: true, result: { dk: toB64(dk) } }));
    const r = await call(connect(), { id: 3, op: 'load', args: { deviceId: DEVICE } });
    expect(r.ok).toBe(true);
    expect(r.result.dk).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(r.result.dk)).toEqual(dk);
    expect(JSON.stringify(Object.keys(r.result))).toBe('["dk"]');
  });

  test.each([
    ['DK de mauvaise taille', { id: 1, ok: true, result: { dk: toB64(new Uint8Array(16)) } }],
    ['DK non base64', { id: 1, ok: true, result: { dk: '***' } }],
    ['DK d\'un autre type', { id: 1, ok: true, result: { dk: 12 } }],
    ['réponse qui n\'est pas un objet', 'ok'],
    ['réponse nulle', null],
  ])('réponse du worker invalide : %s → unavailable', async (_n, raw) => {
    const { connect } = setup(() => raw);
    const r = await call(connect(), { id: 1, op: 'load', args: { deviceId: DEVICE } });
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('unavailable');
  });

  test('erreur : code connu conservé, code inconnu ramené à unavailable, champs superflus supprimés', async () => {
    let next: unknown;
    const { connect } = setup(() => next);
    const port = connect();

    next = { id: 1, ok: false, error: { code: 'locked', message: 'Attendez', retryAfterSeconds: 30, secret: 'x' } };
    expect(await call(port, { id: 1, op: 'status', args: {} })).toEqual({
      id: 1,
      ok: false,
      error: { code: 'locked', message: 'Attendez', retryAfterSeconds: 30 },
    });

    next = { id: 2, ok: false, error: { code: 'code-invente', message: 'm' } };
    expect((await call(port, { id: 2, op: 'status', args: {} })).error.code).toBe('unavailable');

    next = { id: 3, ok: false, error: { code: 'wrong-pin', message: 'a'.repeat(1000) } };
    expect((await call(port, { id: 3, op: 'status', args: {} })).error.message).toHaveLength(300);
  });
});

describe('diagnostic de développement', () => {
  function withDebug() {
    const win = new FakeWindow();
    const labels: string[] = [];
    startBridge({ win, send: async () => ({}), allowedOrigins: [ORIGIN], debug: (l) => labels.push(l) });
    return { win, labels };
  }

  test('étiquettes fixes pour chaque issue du handshake, jamais de données', () => {
    const { win, labels } = withDebug();
    win.receive(hello, { source: {} });
    win.receive(hello, { origin: 'https://evil.example' });
    win.receive({ ...hello, extra: 1 });
    win.receive({ ...hello, protocol: 2 });
    win.receive(hello);
    expect(labels).toEqual(['hello-refusé:source', 'hello-refusé:origine', 'hello-refusé:forme', 'hello-refusé:protocole', 'hello-accepté', 'ready-envoyé']);
  });

  test('un message étranger à Synco n\'est pas signalé', () => {
    const { win, labels } = withDebug();
    win.receive({ type: 'autre' }, { source: {} });
    win.receive('texte');
    expect(labels).toEqual([]);
  });

  test('échec de l\'envoi du canal : étiquette d\'erreur (nom seulement) et le pont continue', () => {
    const { win, labels } = withDebug();
    win.postMessage = () => {
      throw new DOMException('détail interne', 'DataCloneError');
    };
    win.receive(hello);
    expect(labels).toEqual(['hello-accepté', 'ready-erreur:DataCloneError']);
    expect(JSON.stringify(labels)).not.toContain('détail interne');
  });
});
