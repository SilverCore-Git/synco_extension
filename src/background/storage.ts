import type { VaultStorage } from '../vault/ports';
import type { LimiterStore } from './rateLimit';

/** Sous-ensemble de `storage.StorageArea` (local ou session). */
export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Adaptateur du coffre sur `storage.local`. Aucune copie en mémoire : le worker peut être tué à tout instant. */
export class ExtensionVaultStorage implements VaultStorage {
  constructor(private readonly area: StorageAreaLike) {}

  async get(key: string): Promise<unknown> {
    return (await this.area.get(key))[key];
  }
  set(key: string, value: unknown): Promise<void> {
    return this.area.set({ [key]: value });
  }
  remove(key: string): Promise<void> {
    return this.area.remove(key);
  }
  async keys(): Promise<string[]> {
    return Object.keys(await this.area.get(null));
  }
}

const LIMITER_KEY = 'rate-limit:prompts';

/** État du limiteur dans `storage.session` : survit à l'endormissement du worker, pas à la fermeture du navigateur. */
export class SessionLimiterStore implements LimiterStore {
  constructor(private readonly area: StorageAreaLike) {}

  async load(): Promise<Record<string, number[]>> {
    const raw = (await this.area.get(LIMITER_KEY))[LIMITER_KEY];
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n))) out[k] = v as number[];
    }
    return out;
  }
  save(state: Record<string, number[]>): Promise<void> {
    return this.area.set({ [LIMITER_KEY]: state });
  }
}
