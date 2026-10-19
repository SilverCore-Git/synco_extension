import { isValidOrigin, isUuid } from '../shared/origin';
import {
  errorResponse,
  OPTIONS_PAGE,
  parseRequest,
  PROMPT_PAGE,
  PROTOCOL_VERSION,
  sanitizeReason,
  type Request,
  type Response,
} from '../shared/protocol';
import { toB64 } from '../vault/encoding';
import { VaultError } from '../vault/errors';
import type { Vault } from '../vault/vault';
import { authenticateSender, isExtensionPage, type SenderLike } from './auth';
import type { PromptManager } from './prompt';

export interface RouterDeps {
  vault: Pick<Vault, 'create' | 'load' | 'remove' | 'has' | 'list'>;
  prompts: PromptManager;
  allowedOrigins: readonly string[];
  extensionId: string;
  /** `runtime.getURL('/')` : sert à reconnaître les pages de l'extension. */
  baseUrl: string;
  version: string;
  hostAccess(): Promise<{ origin: string; granted: boolean }[]>;
}

const SESSION_ID = /^[0-9a-f]{32}$/;
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Routeur du worker. Sans état en mémoire propre au coffre : un worker rendormi puis réveillé par un message
 * reconstruit tout depuis `storage.local`. Trois familles de messages, chacune authentifiée sur `sender` :
 *  - `vault`    : depuis le content script, sur une origine de la liste blanche, cadre principal seulement ;
 *  - `prompt`   : depuis prompt.html (page de l'extension) ;
 *  - `internal` : depuis options.html (page de l'extension).
 */
export class Router {
  constructor(private readonly deps: RouterDeps) {}

  async handle(message: unknown, sender: SenderLike | undefined): Promise<unknown> {
    const kind = isPlain(message) ? message.kind : undefined;
    try {
      if (kind === 'vault') return await this.handleVault(message as Record<string, unknown>, sender);
      if (kind === 'prompt') return await this.handlePrompt(message as Record<string, unknown>, sender);
      if (kind === 'internal') return await this.handleInternal(message as Record<string, unknown>, sender);
    } catch {
      // Jamais de détail interne (ni de contenu d'erreur) vers l'appelant.
    }
    return errorResponse(null, 'unavailable');
  }

  // ---- Coffre (depuis une page Synco, via le content script) ----

  private async handleVault(message: Record<string, unknown>, sender: SenderLike | undefined): Promise<Response> {
    // L'origine vient de `sender`. Le message, lui, n'est pas cru sur ce point : il n'a même pas de champ d'origine.
    const auth = authenticateSender(sender, { allowedOrigins: this.deps.allowedOrigins, extensionId: this.deps.extensionId });
    if (!auth.ok) return errorResponse(null, 'unavailable', 'Origine non autorisée.');

    if (message.protocol !== PROTOCOL_VERSION) return errorResponse(null, 'unsupported-protocol');
    const parsed = parseRequest(message.request);
    if (!parsed.ok) return errorResponse(parsed.id, 'bad-request', parsed.message);
    const req = parsed.request;

    try {
      return { id: req.id, ok: true, result: await this.runOp(req, auth.origin, auth.tabId) };
    } catch (e) {
      if (e instanceof VaultError) {
        return errorResponse(req.id, e.code, e.message !== e.code ? e.message : undefined, e.retryAfterSeconds);
      }
      return errorResponse(req.id, 'unavailable');
    }
  }

  private async runOp(req: Request, origin: string, tabId: number): Promise<unknown> {
    const { vault, prompts } = this.deps;
    switch (req.op) {
      case 'status': {
        const records = (await vault.list({ origin })).map((e) => e.deviceId);
        return {
          present: true,
          protocol: PROTOCOL_VERSION,
          version: this.deps.version,
          allowedOrigins: [...this.deps.allowedOrigins],
          records,
        };
      }
      case 'has':
        return { exists: await vault.has(origin, req.args.deviceId) };
      case 'remove':
        await vault.remove(origin, req.args.deviceId);
        return { removed: true };
      case 'create':
      case 'load': {
        const { deviceId } = req.args;
        const exists = await vault.has(origin, deviceId);
        if (req.op === 'load' && !exists) throw new VaultError('missing');

        const dk = await prompts.run<Uint8Array<ArrayBuffer>>({
          origin,
          tabId,
          mode: req.op,
          reason: sanitizeReason(req.args.reason),
          replacing: req.op === 'create' && exists,
          attempt: (pin) => (req.op === 'create' ? vault.create(origin, deviceId, pin) : vault.load(origin, deviceId, pin)),
        });
        try {
          return { dk: toB64(dk) }; // la chaîne ne s'efface pas : elle ne fait qu'un trajet, vers le content script
        } finally {
          dk.fill(0);
        }
      }
    }
  }

  // ---- Page d'invite du PIN ----

  private async handlePrompt(m: Record<string, unknown>, sender: SenderLike | undefined): Promise<unknown> {
    const ctx = { extensionId: this.deps.extensionId, baseUrl: this.deps.baseUrl };
    if (!isExtensionPage(sender, ctx, PROMPT_PAGE)) return { ok: false, error: { code: 'unavailable' } };
    const sessionId = typeof m.sessionId === 'string' && SESSION_ID.test(m.sessionId) ? m.sessionId : null;
    if (!sessionId) return { ok: false, error: { code: 'bad-request' } };
    const { prompts } = this.deps;

    switch (m.type) {
      case 'hello': {
        const info = prompts.hello(sessionId);
        return info ? { ok: true, info } : { ok: false, error: { code: 'cancelled', message: 'Cette invite a expiré.' } };
      }
      case 'ping':
        return { ok: prompts.ping(sessionId) };
      case 'cancel':
        prompts.cancel(sessionId);
        return { ok: true };
      case 'submit': {
        if (typeof m.pin !== 'string' || m.pin.length > 64) return { ok: false, error: { code: 'bad-request', terminal: false } };
        return await prompts.submit(sessionId, m.pin);
      }
      default:
        return { ok: false, error: { code: 'bad-request' } };
    }
  }

  // ---- Page d'options ----

  private async handleInternal(m: Record<string, unknown>, sender: SenderLike | undefined): Promise<unknown> {
    const ctx = { extensionId: this.deps.extensionId, baseUrl: this.deps.baseUrl };
    // Seule la page d'options : ni l'invite du PIN, ni un content script, ni une page web.
    if (!isExtensionPage(sender, ctx, OPTIONS_PAGE)) return errorResponse(null, 'unavailable');

    switch (m.op) {
      case 'list':
        return { ok: true, result: { entries: await this.deps.vault.list(), allowedOrigins: [...this.deps.allowedOrigins] } };
      case 'hostAccess':
        return { ok: true, result: { hosts: await this.deps.hostAccess() } };
      case 'remove': {
        if (!isValidOrigin(m.origin) || !isUuid(m.deviceId)) return errorResponse(null, 'bad-request');
        await this.deps.vault.remove(m.origin, m.deviceId);
        return { ok: true, result: { removed: true } };
      }
      default:
        return errorResponse(null, 'bad-request');
    }
  }
}
