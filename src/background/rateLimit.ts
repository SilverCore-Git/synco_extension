/** Persistance de l'état du limiteur (storage.session en production) : un worker qui redémarre ne remet pas les compteurs à zéro. */
export interface LimiterStore {
  load(): Promise<Record<string, number[]>>;
  save(state: Record<string, number[]>): Promise<void>;
}

export class MemoryLimiterStore implements LimiterStore {
  private state: Record<string, number[]> = {};
  async load() {
    return structuredClone(this.state);
  }
  async save(state: Record<string, number[]>) {
    this.state = structuredClone(state);
  }
}

export type TakeResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Fenêtre glissante : au plus `max` jetons par clé (origine) sur `windowMs`. */
export class SlidingWindowLimiter {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly opts: { max: number; windowMs: number; store: LimiterStore; now?: () => number },
  ) {}

  /** Consomme un jeton si disponible. Les appels sont sérialisés (lecture-modification-écriture). */
  take(key: string): Promise<TakeResult> {
    const run = this.chain.then(() => this.takeNow(key));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async takeNow(key: string): Promise<TakeResult> {
    const now = (this.opts.now ?? Date.now)();
    const state = await this.opts.store.load();
    for (const k of Object.keys(state)) {
      const fresh = (state[k] ?? []).filter((t) => t > now - this.opts.windowMs && t <= now);
      if (fresh.length === 0) delete state[k];
      else state[k] = fresh;
    }
    const hits = state[key] ?? [];
    if (hits.length >= this.opts.max) {
      const oldest = Math.min(...hits);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.opts.windowMs - now) / 1000)) };
    }
    state[key] = [...hits, now];
    await this.opts.store.save(state);
    return { ok: true };
  }
}
