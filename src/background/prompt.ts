import { MAX_PIN_LENGTH, MIN_PIN_LENGTH } from '../vault/constants';
import { VaultError } from '../vault/errors';
import type { ErrorBody } from '../shared/protocol';
import type { SlidingWindowLimiter } from './rateLimit';

/** Ce dont le gestionnaire d'invite a besoin du navigateur (adaptateur réel dans index.ts, simulé en test). */
export interface PromptHost {
  /** `tabId` : l'onglet de la page qui a fait la demande, pour placer la fenêtre à côté de sa carte. */
  openWindow(sessionId: string, tabId: number): Promise<number>;
  closeWindow(windowId: number): Promise<void>;
  onWindowRemoved(cb: (windowId: number) => void): void;
  onTabRemoved(cb: (tabId: number) => void): void;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Délai laissé à la page d'invite pour montrer la réussite avant que le worker ne ferme la fenêtre. */
export const SUCCESS_LINGER_MS = 2500;

export interface PromptRequest<T> {
  origin: string;
  tabId: number;
  mode: 'create' | 'load';
  /** Raison déjà nettoyée (texte brut, plafonnée). */
  reason: string | null;
  /** Un enregistrement existe déjà et sera remplacé (create). */
  replacing: boolean;
  /** Tente l'opération avec le PIN saisi. Lève une `VaultError` : `wrong-pin` relance la saisie, le reste termine. */
  attempt(pin: string): Promise<T>;
}

export interface PromptInfo {
  origin: string;
  mode: 'create' | 'load';
  reason: string | null;
  replacing: boolean;
  minPin: number;
  maxPin: number;
  expiresAt: number;
}

export type SubmitOutcome = { ok: true } | { ok: false; error: ErrorBody & { terminal: boolean } };

interface Session {
  id: string;
  req: PromptRequest<unknown>;
  windowId: number | null;
  expiresAt: number;
  settled: boolean;
  attempting: boolean;
  timer: unknown;
  resolve(value: unknown): void;
  reject(error: VaultError): void;
}

export interface PromptDeps {
  host: PromptHost;
  limiter: SlidingWindowLimiter;
  timers?: Timers;
  now?: () => number;
  /** Durée maximale d'une invite. */
  timeoutMs?: number;
  randomId?: () => string;
}

const defaultId = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

/**
 * Une seule invite à la fois, jamais deux fenêtres. Le PIN n'existe que dans la page d'invite de l'extension et ici.
 * État en mémoire : si le worker est tué pendant une invite, la page d'invite reçoit « expired » et la demande de la
 * page échoue en `unavailable` (la page d'invite envoie des « ping » pour retarder l'endormissement du worker).
 */
export class PromptManager {
  private session: Session | null = null;
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(private readonly deps: PromptDeps) {
    this.timers = deps.timers ?? realTimers;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 120_000;
    deps.host.onWindowRemoved((id) => {
      if (this.session && this.session.windowId === id) this.settle(this.session, 'reject', new VaultError('cancelled'));
    });
    deps.host.onTabRemoved((tabId) => {
      if (this.session && this.session.req.tabId === tabId) {
        this.settle(this.session, 'reject', new VaultError('cancelled', 'La page qui demandait le déverrouillage a été fermée.'));
      }
    });
  }

  /** Ouvre l'invite et attend son issue. Refuse (sans fenêtre) si une invite est déjà ouverte ou si l'origine abuse. */
  async run<T>(req: PromptRequest<T>): Promise<T> {
    if (this.session) throw new VaultError('cancelled', 'Une autre invite est déjà ouverte.');

    const slot = await this.deps.limiter.take(req.origin);
    if (!slot.ok) {
      throw new VaultError('locked', 'Trop de demandes de déverrouillage. Réessayez dans un instant.', slot.retryAfterSeconds);
    }
    // Deux demandes simultanées ont pu passer le premier contrôle pendant l'attente du limiteur.
    if (this.session) throw new VaultError('cancelled', 'Une autre invite est déjà ouverte.');

    const id = (this.deps.randomId ?? defaultId)();
    const promise = new Promise<unknown>((resolve, reject) => {
      const session: Session = {
        id,
        req: req as PromptRequest<unknown>,
        windowId: null,
        expiresAt: this.now() + this.timeoutMs,
        settled: false,
        attempting: false,
        timer: null,
        resolve,
        reject,
      };
      session.timer = this.timers.set(() => this.settle(session, 'reject', new VaultError('cancelled', 'Délai de saisie dépassé.')), this.timeoutMs);
      this.session = session;
    });

    // L'invite peut être annulée (onglet fermé…) pendant l'attente de `openWindow`, avant que l'appelant ne reçoive la
    // promesse : on la marque comme traitée pour éviter un rejet « non géré ». L'appelant reçoit bien l'erreur.
    promise.catch(() => undefined);

    const session = this.session!;
    // Ouverture en parallèle : l'appelant n'attend pas la fenêtre pour être averti d'une annulation ou d'une erreur.
    this.deps.host.openWindow(id, req.tabId).then(
      (windowId) => {
        session.windowId = windowId;
        if (session.settled) void this.deps.host.closeWindow(windowId).catch(() => undefined); // annulée pendant l'ouverture
      },
      () => this.settle(session, 'reject', new VaultError('unavailable', 'Impossible d\'ouvrir la fenêtre de saisie du PIN.')),
    );
    return promise as Promise<T>;
  }

  /** Page d'invite : informations à afficher (l'origine vient d'ici, jamais de l'URL de la fenêtre). */
  hello(sessionId: string): PromptInfo | null {
    const s = this.active(sessionId);
    if (!s) return null;
    return {
      origin: s.req.origin,
      mode: s.req.mode,
      reason: s.req.reason,
      replacing: s.req.replacing,
      minPin: MIN_PIN_LENGTH,
      maxPin: MAX_PIN_LENGTH,
      expiresAt: s.expiresAt,
    };
  }

  /** Signe de vie de la page d'invite (retarde l'endormissement du worker). */
  ping(sessionId: string): boolean {
    return this.active(sessionId) !== null;
  }

  /**
   * Annulation demandée par la PAGE qui a ouvert l'invite (son bouton « Annuler »). Elle ne vaut que pour une invite
   * ouverte par cette même origine et ce même onglet : une autre page ne peut pas fermer la fenêtre d'un tiers.
   * Retourne vrai si une invite a été fermée.
   */
  cancelFor(origin: string, tabId: number): boolean {
    const s = this.session;
    if (!s || s.settled || s.req.origin !== origin || s.req.tabId !== tabId) return false;
    this.settle(s, 'reject', new VaultError('cancelled'));
    return true;
  }

  cancel(sessionId: string): void {
    const s = this.active(sessionId);
    if (s) this.settle(s, 'reject', new VaultError('cancelled'));
  }

  async submit(sessionId: string, pin: string): Promise<SubmitOutcome> {
    const s = this.active(sessionId);
    if (!s) return { ok: false, error: { code: 'cancelled', message: 'Cette invite a expiré.', terminal: true } };
    if (s.attempting) return { ok: false, error: { code: 'unavailable', message: 'Une vérification est déjà en cours.', terminal: false } };

    s.attempting = true;
    try {
      const value = await s.req.attempt(pin);
      if (s.settled) {
        // Annulée ou expirée pendant la vérification : personne ne recevra la clé, on l'efface.
        if (value instanceof Uint8Array) value.fill(0);
        return { ok: false, error: { code: 'cancelled', message: 'Cette invite a expiré.', terminal: true } };
      }
      this.settle(s, 'resolve', value);
      return { ok: true };
    } catch (e) {
      const err = e instanceof VaultError ? e : new VaultError('unavailable', 'Erreur interne de l\'extension.');
      s.attempting = false;
      if (err.code === 'wrong-pin' && !s.settled) {
        return {
          ok: false,
          error: {
            code: 'wrong-pin',
            ...(err.message !== 'wrong-pin' ? { message: err.message } : {}),
            ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
            terminal: false,
          },
        };
      }
      this.settle(s, 'reject', err, false);
      return {
        ok: false,
        error: {
          code: err.code,
          ...(err.message !== err.code ? { message: err.message } : {}),
          ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
          terminal: true,
        },
      };
    }
  }

  private active(sessionId: string): Session | null {
    const s = this.session;
    return s && !s.settled && s.id === sessionId ? s : null;
  }

  /**
   * Termine la session. `close` : fermer la fenêtre tout de suite (succès, annulation) ; sinon la page d'invite
   * affiche d'abord l'erreur (effacement, verrouillage) et la fenêtre est fermée après un court délai.
   */
  private settle(s: Session, how: 'resolve' | 'reject', value: unknown, close = true): void {
    if (s.settled) return;
    s.settled = true;
    this.timers.clear(s.timer);
    if (this.session === s) this.session = null;
    if (how === 'resolve') s.resolve(value);
    else s.reject(value as VaultError);

    const windowId = s.windowId;
    if (windowId === null) return;
    const closeIt = () => void this.deps.host.closeWindow(windowId).catch(() => undefined);
    // Réussite : la page d'invite affiche sa réussite puis se ferme d'elle-même ; ceci n'est que le filet de sécurité.
    if (how === 'resolve') this.timers.set(closeIt, SUCCESS_LINGER_MS);
    else if (close) this.timers.set(closeIt, 50);
    else this.timers.set(closeIt, 15_000);
  }
}
