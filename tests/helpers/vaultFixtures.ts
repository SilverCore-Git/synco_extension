import type { DeviceSecret, VaultStorage } from '../../src/vault/ports';
import { Vault, type VaultDeps } from '../../src/vault/vault';

export const ORIGIN = 'https://app.synco.one';
export const OTHER_ORIGIN = 'https://localhost:5174';
export const DEVICE = '3f2b8c1e-5a7d-4e90-9b6a-1c2d3e4f5a6b';
export const DEVICE_2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
export const PIN = '4821';
export const WRONG_PIN = '1111';

/** Itérations réduites : seuls les tests de coût réel utilisent la valeur de production. */
export const FAST = { iterations: 1000, minIterations: 1000 } as const;

export class MemoryStorage implements VaultStorage {
  readonly data = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    const v = this.data.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }
}

export class MemorySecret implements DeviceSecret {
  private key: Promise<CryptoKey> | null = null;
  getKey(): Promise<CryptoKey> {
    this.key ??= crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return this.key;
  }
}

export class Clock {
  t = 1_800_000_000_000;
  now = () => this.t;
  advanceSeconds(s: number) {
    this.t += s * 1000;
  }
}

export function makeVault(over: Partial<VaultDeps> = {}) {
  const storage = (over.storage as MemoryStorage | undefined) ?? new MemoryStorage();
  const secret = over.secret ?? new MemorySecret();
  const clock = new Clock();
  const vault = new Vault({ storage, secret, now: clock.now, ...FAST, ...over });
  return { vault, storage, secret, clock };
}

/** Exécute `fn` et retourne l'erreur levée (échoue si rien n'est levé). */
export async function caught(fn: () => Promise<unknown>): Promise<{ code?: string; retryAfterSeconds?: number; name?: string }> {
  try {
    await fn();
  } catch (e) {
    return e as never;
  }
  throw new Error('une erreur était attendue');
}
