import { isUuid } from './origin';

/**
 * Protocole page ↔ extension, version 1.
 *
 * La page parle au content script par un MessagePort (jamais en diffusion sur `window`) ; le content script relaie
 * au worker par `runtime.sendMessage`. Le worker ne se fie jamais à un champ du message pour savoir QUI parle :
 * l'origine vient de `sender`, fourni par le navigateur.
 */
export const PROTOCOL_VERSION = 1;

/** Taille maximale d'une requête de page, sérialisée (octets approximatifs). */
export const MAX_REQUEST_BYTES = 1024;
export const MAX_REASON_LENGTH = 200;
/** Longueur affichée dans l'invite après nettoyage. */
export const MAX_REASON_DISPLAY = 120;

export const PROMPT_PAGE = 'prompt.html';
export const OPTIONS_PAGE = 'options.html';

export const OPS = ['status', 'create', 'load', 'remove', 'has'] as const;
export type Op = (typeof OPS)[number];

export type ErrorCode =
  | 'pin-required'
  | 'wrong-pin'
  | 'locked'
  | 'wiped'
  | 'cancelled'
  | 'unavailable'
  | 'missing'
  // Propres au protocole (l'application doit traiter tout code inconnu comme « unavailable ») :
  | 'bad-request'
  | 'unsupported-protocol';

export interface ErrorBody {
  code: ErrorCode;
  message?: string;
  retryAfterSeconds?: number;
}

export type Args = {
  status: Record<string, never>;
  has: { deviceId: string };
  remove: { deviceId: string };
  create: { deviceId: string; reason?: string };
  load: { deviceId: string; reason?: string };
};

export type Request = { [K in Op]: { id: number; op: K; args: Args[K] } }[Op];

export type Response =
  | { id: number | null; ok: true; result: unknown }
  | { id: number | null; ok: false; error: ErrorBody };

/** Enveloppe `runtime.sendMessage` du content script vers le worker. */
export interface VaultEnvelope {
  kind: 'vault';
  protocol: typeof PROTOCOL_VERSION;
  request: Request;
}

/** Messages de la page d'invite du PIN (page de l'extension) vers le worker. */
export type PromptMessage =
  | { kind: 'prompt'; type: 'hello'; sessionId: string }
  | { kind: 'prompt'; type: 'ping'; sessionId: string }
  | { kind: 'prompt'; type: 'submit'; sessionId: string; pin: string }
  | { kind: 'prompt'; type: 'cancel'; sessionId: string };

/** Messages de la page d'options vers le worker. */
export type InternalMessage =
  | { kind: 'internal'; op: 'list' }
  | { kind: 'internal'; op: 'hostAccess' }
  | { kind: 'internal'; op: 'remove'; origin: string; deviceId: string };

export type ParseResult = { ok: true; request: Request } | { ok: false; id: number | null; message: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  // `Object.prototype` d'un autre contexte (Firefox : content script, page) n'est pas `===` au nôtre : on reconnaît
  // un objet simple à ce que son prototype est lui-même la racine de la chaîne. Une instance de classe est refusée.
  return proto === null || Object.getPrototypeOf(proto) === null;
};

const hasOnly = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).every((k) => keys.includes(k));

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 0x7fffffff;

/** Identifiant de requête s'il est exploitable, pour pouvoir répondre même à une requête invalide. */
function idOf(data: unknown): number | null {
  return isPlainObject(data) && isId(data.id) ? data.id : null;
}

/**
 * Validation stricte d'une requête venue de la page : types, longueurs, clés connues seulement, `deviceId` = UUID.
 * Retourne une requête reconstruite champ par champ : rien de ce que la page a ajouté ne traverse.
 */
export function parseRequest(data: unknown): ParseResult {
  const id = idOf(data);
  const bad = (message: string): ParseResult => ({ ok: false, id, message });

  try {
    if (JSON.stringify(data).length > MAX_REQUEST_BYTES) return bad('Requête trop volumineuse.');
  } catch {
    return bad('Requête non sérialisable.');
  }

  if (!isPlainObject(data) || !hasOnly(data, ['id', 'op', 'args']) || Object.keys(data).length !== 3) {
    return bad('Requête mal formée.');
  }
  if (!isId(data.id)) return bad('Identifiant de requête invalide.');
  const op = data.op;
  if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) return bad('Opération inconnue.');
  const args = data.args;
  if (!isPlainObject(args)) return bad('Arguments invalides.');

  switch (op as Op) {
    case 'status':
      if (Object.keys(args).length !== 0) return bad('Arguments invalides.');
      return { ok: true, request: { id: data.id, op: 'status', args: {} } };
    case 'has':
    case 'remove': {
      if (!hasOnly(args, ['deviceId']) || !isUuid(args.deviceId)) return bad('Arguments invalides.');
      return { ok: true, request: { id: data.id, op: op as 'has' | 'remove', args: { deviceId: args.deviceId } } };
    }
    case 'create':
    case 'load': {
      if (!hasOnly(args, ['deviceId', 'reason']) || !isUuid(args.deviceId)) return bad('Arguments invalides.');
      const reason = args.reason;
      if (reason !== undefined && (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH)) {
        return bad('Raison invalide.');
      }
      return {
        ok: true,
        request: {
          id: data.id,
          op: op as 'create' | 'load',
          args: reason === undefined ? { deviceId: args.deviceId } : { deviceId: args.deviceId, reason },
        },
      };
    }
  }
}

/** Caractères de contrôle, de formatage et de direction (bidi) : remplacés par une espace dans le texte affiché. */
const INVISIBLE = new RegExp(
  '[' + '\\u0000-\\u001f' + '\\u007f-\\u009f' + '\\u200b-\\u200f' + '\\u2028-\\u202e' + '\\u2066-\\u2069' + '\\ufeff' + ']',
  'g',
);

/** Texte de la raison pour l'affichage : sans caractères de contrôle ni retours à la ligne, plafonné. */
export function sanitizeReason(reason: string | undefined): string | null {
  if (reason === undefined) return null;
  const clean = reason.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (clean === '') return null;
  return clean.length > MAX_REASON_DISPLAY ? `${clean.slice(0, MAX_REASON_DISPLAY - 1)}…` : clean;
}

export const errorResponse = (id: number | null, code: ErrorCode, message?: string, retryAfterSeconds?: number): Response => ({
  id,
  ok: false,
  error: {
    code,
    ...(message !== undefined ? { message } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  },
});
