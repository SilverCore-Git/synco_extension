import { IV_LENGTH } from './constants';

const enc = new TextEncoder();

/** Clé d'enveloppe = PBKDF2-SHA-256(PIN, sel). Les octets du PIN sont effacés ; la chaîne d'origine ne peut pas l'être. */
export async function deriveKeyFromPin(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const pinBytes = enc.encode(pin);
  try {
    const base = await crypto.subtle.importKey('raw', pinBytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    pinBytes.fill(0);
  }
}

/** AES-GCM avec IV aléatoire de 12 octets ; retourne IV ‖ chiffré. */
export async function aesGcmSeal(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext));
  const out = new Uint8Array(IV_LENGTH + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_LENGTH);
  return out;
}

/** Inverse de `aesGcmSeal`. Lève une erreur si l'authentification échoue (mauvaise clé, AAD ou altération). */
export async function aesGcmOpen(
  key: CryptoKey,
  blob: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = blob.slice(0, IV_LENGTH);
  const ct = blob.slice(IV_LENGTH);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct));
}

/**
 * Données authentifiées liées à l'enregistrement : un enregistrement copié vers une autre origine ou un autre
 * appareil ne s'ouvre pas. La couche PIN utilise exactement le format de la spec ; la couche « second secret »
 * ajoute un suffixe pour que les deux couches ne soient pas interchangeables.
 */
export function aadPin(origin: string, deviceId: string): Uint8Array<ArrayBuffer> {
  return enc.encode(`synco-ext-vault|v1|${origin}|${deviceId}`);
}

export function aadDeviceSecret(origin: string, deviceId: string): Uint8Array<ArrayBuffer> {
  return enc.encode(`synco-ext-vault|v1|${origin}|${deviceId}|k2`);
}
