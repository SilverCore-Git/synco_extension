import {
  errorResponse,
  parseRequest,
  PROTOCOL_VERSION,
  type ErrorCode,
  type Response,
  type VaultEnvelope,
} from '../shared/protocol';
import { fromB64 } from '../vault/encoding';

export interface BridgeWindow {
  location: { origin: string };
  addEventListener(type: 'message', listener: (event: { source: unknown; origin: string; data: unknown }) => void): void;
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

export interface BridgeDeps {
  win: BridgeWindow;
  /** Relais vers le worker (`runtime.sendMessage`). */
  send(envelope: VaultEnvelope): Promise<unknown>;
  createChannel?: () => MessageChannel;
  /** Nombre maximal de canaux ouverts : le plus ancien est fermé au-delà. */
  maxPorts?: number;
}

const CODES: readonly ErrorCode[] = [
  'pin-required',
  'wrong-pin',
  'locked',
  'wiped',
  'cancelled',
  'unavailable',
  'missing',
  'bad-request',
  'unsupported-protocol',
];

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Pont page ↔ worker, côté content script (monde isolé : le code de la page ne peut pas l'atteindre ni le modifier).
 *
 * 1. La page envoie `hello` ; seul un message de CETTE fenêtre et de CETTE origine est pris en compte.
 * 2. On répond `ready` en transférant un MessagePort. Tout le reste passe par ce port, jamais en diffusion.
 * 3. Chaque requête est revalidée strictement, reconstruite, puis relayée. Le worker revalide l'origine sur `sender`.
 * 4. DK revient en base64 depuis le worker ; elle est transférée à la page en ArrayBuffer (donc détachée ici).
 */
export function startBridge(deps: BridgeDeps): void {
  const { win } = deps;
  const ports: MessagePort[] = [];
  const maxPorts = deps.maxPorts ?? 8;

  win.addEventListener('message', (event) => {
    if (event.source !== win || event.origin !== win.location.origin) return;
    const d = event.data;
    if (!isPlain(d) || d.source !== 'synco-page' || d.type !== 'hello') return;
    if (Object.keys(d).length !== 3 || !('protocol' in d)) return;

    if (d.protocol !== PROTOCOL_VERSION) {
      win.postMessage({ source: 'synco-extension', type: 'unsupported', protocol: PROTOCOL_VERSION }, win.location.origin, []);
      return;
    }

    const channel = (deps.createChannel ?? (() => new MessageChannel()))();
    const port = channel.port1;
    port.onmessage = (e: MessageEvent) => void handleRequest(port, e.data);
    ports.push(port);
    while (ports.length > maxPorts) ports.shift()?.close();
    win.postMessage({ source: 'synco-extension', type: 'ready', protocol: PROTOCOL_VERSION }, win.location.origin, [channel.port2]);
  });

  async function handleRequest(port: MessagePort, data: unknown): Promise<void> {
    const parsed = parseRequest(data);
    if (!parsed.ok) {
      reply(port, errorResponse(parsed.id, 'bad-request', parsed.message));
      return;
    }
    let raw: unknown;
    try {
      raw = await deps.send({ kind: 'vault', protocol: PROTOCOL_VERSION, request: parsed.request });
    } catch {
      reply(port, errorResponse(parsed.request.id, 'unavailable', 'L\'extension n\'a pas répondu.'));
      return;
    }
    reply(port, normalize(parsed.request.id, raw));
  }

  /** Ne laisse passer vers la page que la forme documentée de la réponse. */
  function normalize(id: number, raw: unknown): Response | { id: number; ok: true; result: { dk: ArrayBuffer } } {
    if (!isPlain(raw)) return errorResponse(id, 'unavailable');
    if (raw.ok === true) {
      const result = raw.result;
      if (isPlain(result) && 'dk' in result) {
        const bytes = typeof result.dk === 'string' ? fromB64(result.dk) : null;
        if (!bytes || bytes.length !== 32) return errorResponse(id, 'unavailable');
        return { id, ok: true, result: { dk: bytes.buffer } };
      }
      return { id, ok: true, result: result ?? null };
    }
    const e = isPlain(raw.error) ? raw.error : {};
    const code = CODES.find((c) => c === e.code) ?? 'unavailable';
    return errorResponse(
      id,
      code,
      typeof e.message === 'string' ? e.message.slice(0, 300) : undefined,
      typeof e.retryAfterSeconds === 'number' && Number.isFinite(e.retryAfterSeconds) ? e.retryAfterSeconds : undefined,
    );
  }

  function reply(port: MessagePort, response: unknown): void {
    const dk = isPlain(response) && isPlain(response.result) && response.result.dk instanceof ArrayBuffer ? response.result.dk : null;
    try {
      port.postMessage(response, dk ? [dk] : []);
    } catch {
      if (dk && dk.byteLength > 0) new Uint8Array(dk).fill(0); // non transférée : on l'efface ici
    }
  }
}
