/** Stockage clé / valeur : `storage.local` en production (adaptateur dans background/), une Map en test. */
export interface VaultStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Second secret : clé AES-GCM non extractable propre à l'extension, qui scelle encore `wrapped`.
 * Ce n'est pas du matériel : copier tout le profil du navigateur donne la clé et les enregistrements.
 */
export interface DeviceSecret {
  getKey(): Promise<CryptoKey>;
}
