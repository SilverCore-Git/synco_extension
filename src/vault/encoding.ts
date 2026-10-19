/** Base64 pour `storage.local` (JSON). Les chaînes produites ne peuvent pas être effacées de la mémoire. */
export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Retourne `null` si la chaîne n'est pas du base64 valide. */
export function fromB64(b64: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof b64 !== 'string' || b64.length > 4096) return null;
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
