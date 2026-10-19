import { VaultError } from './errors';
import type { DeviceSecret } from './ports';

const DB_NAME = 'synco-ext-vault';
const STORE = 'keys';
const KEY_ID = 'device-secret-v1';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function isUsableKey(k: unknown): k is CryptoKey {
  return k instanceof CryptoKey && k.type === 'secret' && k.algorithm.name === 'AES-GCM' && !k.extractable;
}

/**
 * Second secret dans IndexedDB de l'extension (origine moz-extension:// ou chrome-extension://, inaccessible aux
 * pages web). La clé n'est jamais extractable : on ne peut pas la lire, seulement l'utiliser dans cette origine.
 * Création paresseuse et sans course : la clé candidate est générée avant la transaction (une transaction IndexedDB
 * se ferme dès qu'elle attend autre chose qu'une requête), puis la première écrite gagne.
 */
export class IdbDeviceSecret implements DeviceSecret {
  private pending: Promise<CryptoKey> | null = null;

  getKey(): Promise<CryptoKey> {
    this.pending ??= this.load().catch((e: unknown) => {
      this.pending = null;
      throw e instanceof VaultError ? e : new VaultError('unavailable', 'Le stockage de l\'extension est indisponible.');
    });
    return this.pending;
  }

  private async open(): Promise<IDBDatabase> {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    return request(req);
  }

  private async load(): Promise<CryptoKey> {
    const db = await this.open();
    try {
      const existing = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID));
      if (existing !== undefined) {
        if (!isUsableKey(existing)) throw new VaultError('unavailable', 'Le second secret de l\'extension est invalide.');
        return existing;
      }

      const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const winner = await request(store.get(KEY_ID));
      if (winner === undefined) store.put(candidate, KEY_ID);
      await done(tx);
      if (winner !== undefined) {
        if (!isUsableKey(winner)) throw new VaultError('unavailable', 'Le second secret de l\'extension est invalide.');
        return winner;
      }
      return candidate;
    } finally {
      db.close();
    }
  }
}
