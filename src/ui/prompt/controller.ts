import type { PromptInfo, SubmitOutcome } from '../../background/prompt';
import { describeError } from '../format';

export type Phase = 'loading' | 'enter' | 'confirm' | 'verifying' | 'fatal' | 'done' | 'expired';

/** Canal vers le worker : la page d'invite ne parle qu'à lui, jamais à la page web. */
export interface PromptBackend {
  hello(): Promise<{ ok: true; info: PromptInfo } | { ok: false }>;
  ping(): Promise<boolean>;
  submit(pin: string): Promise<SubmitOutcome>;
  cancel(): Promise<void>;
}

export interface PromptView {
  phase: Phase;
  mode: 'create' | 'load' | null;
  origin: string | null;
  reason: string | null;
  replacing: boolean;
  title: string;
  hint: string;
  error: string | null;
  /** Compteur qui change à chaque nouvelle erreur : l'affichage s'en sert pour rejouer l'animation. */
  errorSeq: number;
  /** Nombre de chiffres saisis (jamais les chiffres eux-mêmes). */
  dots: number;
  /** Emplacements vides affichés (longueur minimale du PIN) : le champ se remplit au fil de la saisie. */
  slots: number;
  keypadEnabled: boolean;
  canSubmit: boolean;
  submitLabel: string;
  /** Secondes avant expiration de l'invite. */
  remainingSeconds: number | null;
  /** Secondes avant le prochain essai possible. */
  lockSeconds: number | null;
}

export interface PromptDeps {
  backend: PromptBackend;
  /** Ferme la fenêtre (window.close en production). */
  close(): void;
  now?: () => number;
  pingEveryMs?: number;
  /** Planifie une action différée (setTimeout en production). */
  schedule?: (fn: () => void, ms: number) => void;
  /** Durée pendant laquelle le message de réussite reste affiché avant de fermer la fenêtre. */
  successHoldMs?: number;
}

const DIGIT = /^[0-9]$/;

/**
 * Logique de la fenêtre de saisie du PIN. Le PIN n'existe qu'ici et dans le message vers le worker : il est
 * vidé dès l'envoi, en cas d'annulation, d'expiration et de discordance de la confirmation. Les chaînes JavaScript
 * ne s'effacent pas de la mémoire ; on en limite seulement la durée de vie et le nombre.
 */
export class PromptController {
  private phase: Phase = 'loading';
  private info: PromptInfo | null = null;
  private pin = '';
  private first = '';
  private error: string | null = null;
  private errorSeq = 0;
  private lockedUntil: number | null = null;
  private lastPing = 0;
  private listener: (view: PromptView) => void = () => undefined;
  private readonly now: () => number;

  constructor(private readonly deps: PromptDeps) {
    this.now = deps.now ?? Date.now;
  }

  subscribe(listener: (view: PromptView) => void): void {
    this.listener = listener;
    listener(this.view());
  }

  async start(): Promise<void> {
    this.lastPing = this.now();
    let res: Awaited<ReturnType<PromptBackend['hello']>>;
    try {
      res = await this.deps.backend.hello();
    } catch {
      res = { ok: false };
    }
    if (!res.ok) {
      this.phase = 'expired';
      this.fail(describeError('cancelled'));
    } else {
      this.info = res.info;
      this.phase = 'enter';
    }
    this.notify();
  }

  press(digit: string): void {
    if (!this.canType() || !DIGIT.test(digit) || this.pin.length >= (this.info?.maxPin ?? 0)) return;
    this.pin += digit;
    this.error = null;
    this.notify();
  }

  backspace(): void {
    if (!this.canType()) return;
    this.pin = this.pin.slice(0, -1);
    this.notify();
  }

  clear(): void {
    if (!this.canType()) return;
    this.pin = '';
    this.notify();
  }

  async submit(): Promise<void> {
    if (!this.canType() || !this.info) return;
    if (this.pin.length < this.info.minPin) {
      this.fail(`Le code doit contenir au moins ${this.info.minPin} chiffres.`);
      this.notify();
      return;
    }

    if (this.info.mode === 'create' && this.phase === 'enter') {
      this.first = this.pin;
      this.pin = '';
      this.error = null;
      this.phase = 'confirm';
      this.notify();
      return;
    }
    if (this.phase === 'confirm' && this.pin !== this.first) {
      this.first = '';
      this.pin = '';
      this.fail('Les deux codes ne correspondent pas. Choisissez-le de nouveau.');
      this.phase = 'enter';
      this.notify();
      return;
    }

    const pin = this.pin;
    this.pin = '';
    this.first = '';
    this.error = null;
    this.phase = 'verifying';
    this.notify();

    let outcome: SubmitOutcome;
    try {
      outcome = await this.deps.backend.submit(pin);
    } catch {
      outcome = { ok: false, error: { code: 'unavailable', terminal: true } };
    }

    if (outcome.ok) {
      // Le message de réussite reste lisible un instant : la page de Synco affiche la même réussite en parallèle.
      this.phase = 'done';
      this.notify();
      (this.deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms)))(() => this.deps.close(), this.deps.successHoldMs ?? 1400);
      return;
    }
    const { code, retryAfterSeconds, terminal } = outcome.error;
    if (code === 'wrong-pin' && !terminal) {
      this.phase = 'enter';
      this.fail(describeError(code, retryAfterSeconds));
      if (retryAfterSeconds !== undefined) this.lockedUntil = this.now() + retryAfterSeconds * 1000;
    } else {
      this.phase = 'fatal';
      this.fail(describeError(code, retryAfterSeconds));
    }
    this.notify();
  }

  async cancel(): Promise<void> {
    this.wipe();
    this.notify();
    try {
      await this.deps.backend.cancel();
    } catch {
      /* le worker a pu s'endormir : la fermeture de la fenêtre annule de toute façon l'invite */
    }
    this.deps.close();
  }

  /** À appeler chaque seconde : compte à rebours, expiration, signe de vie vers le worker. */
  tick(): void {
    const now = this.now();
    const active = this.phase === 'enter' || this.phase === 'confirm' || this.phase === 'verifying';
    if (this.info && active && now >= this.info.expiresAt) {
      this.expire();
      return;
    }
    if (this.lockedUntil !== null && now >= this.lockedUntil) {
      this.lockedUntil = null;
      this.error = null;
    }
    if (active && now - this.lastPing >= (this.deps.pingEveryMs ?? 10_000)) {
      this.lastPing = now;
      this.deps.backend.ping().then(
        (alive) => {
          if (!alive) this.expire();
        },
        () => undefined,
      );
    }
    this.notify();
  }

  view(): PromptView {
    const info = this.info;
    const locked = this.isLocked();
    const typing = this.phase === 'enter' || this.phase === 'confirm';
    const mode = info?.mode ?? null;
    const now = this.now();
    return {
      phase: this.phase,
      mode,
      origin: info?.origin ?? null,
      reason: info?.reason ?? null,
      replacing: info?.replacing ?? false,
      title: this.title(),
      hint: this.hint(),
      error: this.error,
      errorSeq: this.errorSeq,
      dots: this.pin.length,
      slots: info?.minPin ?? 4,
      keypadEnabled: typing && !locked,
      canSubmit: typing && !locked && info !== null && this.pin.length >= info.minPin,
      submitLabel: mode === 'create' ? (this.phase === 'confirm' ? 'Valider' : 'Continuer') : 'Déverrouiller',
      remainingSeconds: info && typing ? Math.max(0, Math.ceil((info.expiresAt - now) / 1000)) : null,
      lockSeconds: locked && this.lockedUntil !== null ? Math.ceil((this.lockedUntil - now) / 1000) : null,
    };
  }

  private fail(message: string): void {
    this.error = message;
    this.errorSeq++;
  }

  private canType(): boolean {
    return (this.phase === 'enter' || this.phase === 'confirm') && !this.isLocked();
  }

  private isLocked(): boolean {
    return this.lockedUntil !== null && this.now() < this.lockedUntil;
  }

  private expire(): void {
    this.wipe();
    this.phase = 'expired';
    this.fail(describeError('cancelled'));
    this.notify();
  }

  private wipe(): void {
    this.pin = '';
    this.first = '';
  }

  private title(): string {
    const create = this.info?.mode === 'create';
    switch (this.phase) {
      case 'loading':
        return 'Connexion à Synco…';
      case 'done':
        return create ? 'Appareil protégé' : 'Déverrouillé';
      case 'fatal':
        return 'Impossible de continuer';
      case 'expired':
        return 'Demande expirée';
      case 'verifying':
        return create ? 'Chiffrement de la clé…' : 'Vérification du code…';
      default:
        if (create) return this.phase === 'confirm' ? 'Confirmez votre code' : 'Choisissez un code PIN';
        return 'Entrez votre code PIN';
    }
  }

  private hint(): string {
    const info = this.info;
    if (this.phase === 'done') return 'Vous pouvez retourner sur Synco.';
    if (this.phase === 'verifying') return 'Un instant…';
    if (!info || (this.phase !== 'enter' && this.phase !== 'confirm')) return '';
    if (info.mode === 'load') return 'Pour déverrouiller vos messages sur cet appareil.';
    if (this.phase === 'confirm') return 'Saisissez le même code une seconde fois.';
    return `${info.minPin} chiffres au minimum. Il protège la clé de cet appareil.`;
  }

  private notify(): void {
    this.listener(this.view());
  }
}
