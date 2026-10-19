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
  /** Nombre de chiffres saisis (jamais les chiffres eux-mêmes). */
  dots: number;
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
      this.error = describeError('cancelled');
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
      this.error = `Le code doit contenir au moins ${this.info.minPin} chiffres.`;
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
      this.error = 'Les deux codes ne correspondent pas. Choisissez-le de nouveau.';
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
      this.phase = 'done';
      this.notify();
      this.deps.close();
      return;
    }
    const { code, retryAfterSeconds, terminal } = outcome.error;
    if (code === 'wrong-pin' && !terminal) {
      this.phase = 'enter';
      this.error = describeError(code, retryAfterSeconds);
      if (retryAfterSeconds !== undefined) this.lockedUntil = this.now() + retryAfterSeconds * 1000;
    } else {
      this.phase = 'fatal';
      this.error = describeError(code, retryAfterSeconds);
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
      dots: this.pin.length,
      keypadEnabled: typing && !locked,
      canSubmit: typing && !locked && info !== null && this.pin.length >= info.minPin,
      submitLabel: mode === 'create' ? (this.phase === 'confirm' ? 'Valider' : 'Continuer') : 'Déverrouiller',
      remainingSeconds: info && typing ? Math.max(0, Math.ceil((info.expiresAt - now) / 1000)) : null,
      lockSeconds: locked && this.lockedUntil !== null ? Math.ceil((this.lockedUntil - now) / 1000) : null,
    };
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
    this.error = describeError('cancelled');
    this.notify();
  }

  private wipe(): void {
    this.pin = '';
    this.first = '';
  }

  private title(): string {
    switch (this.phase) {
      case 'loading':
        return 'Ouverture…';
      case 'done':
        return 'Terminé';
      case 'fatal':
        return 'Impossible de continuer';
      case 'expired':
        return 'Demande expirée';
      default:
        if (this.info?.mode === 'create') return this.phase === 'confirm' ? 'Confirmer le code PIN' : 'Choisir un code PIN';
        return 'Déverrouiller la clé de cet appareil';
    }
  }

  private hint(): string {
    const info = this.info;
    if (this.phase === 'verifying') return 'Vérification en cours…';
    if (!info || (this.phase !== 'enter' && this.phase !== 'confirm')) return '';
    if (info.mode === 'load') return `Saisissez le code PIN de l'extension (${info.minPin} à ${info.maxPin} chiffres).`;
    if (this.phase === 'confirm') return 'Saisissez de nouveau le même code pour le confirmer.';
    return `Choisissez ${info.minPin} chiffres au minimum. Ce code protège la clé de cet appareil dans l'extension ; il n'est jamais envoyé à Synco.`;
  }

  private notify(): void {
    this.listener(this.view());
  }
}
