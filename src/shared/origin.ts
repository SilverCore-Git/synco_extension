/** Origine exacte : https, hôte en minuscules, port facultatif, ni chemin, ni joker, ni identifiants. */
const ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$/;

export function isValidOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || !ORIGIN.test(value)) return false;
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const UUID_LENGTH = 36;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
