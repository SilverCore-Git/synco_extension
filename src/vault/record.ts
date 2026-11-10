import { isUuid, UUID_LENGTH } from '../shared/origin';
import { isValidOrigin } from '../shared/origin';
import {
  KEY_PREFIX,
  LEGACY_PIN_RECORD_VERSION,
  MAX_FAILURES,
  MAX_ITERATIONS,
  RECORD_VERSION,
  SALT_LENGTH,
  WRAPPED_LENGTH,
  WRAPPED_V2_LENGTH,
} from './constants';
import { fromB64 } from './encoding';

/**
 * Enregistrement v2 (format écrit) : sans PIN. DK n'est scellée que par le second secret de l'extension ; l'accès
 * passe par la fenêtre de l'extension (bouton « Autoriser »), voir doc §16.4.
 */
export interface VaultRecordV2 {
  v: 2;
  /** IV ‖ AES-GCM_secret(DK), base64. */
  wrapped: string;
  createdAt: number;
}

export type VaultRecord = VaultRecordV1 | VaultRecordV2;

/** Enregistrement v1 (ancien format, lu seulement) : scellé par un PIN puis par le second secret. */
export interface VaultRecordV1 {
  v: 1;
  /** Sel PBKDF2 (16 octets, base64). */
  salt: string;
  iterations: number;
  /** IV ‖ AES-GCM_secret( IV ‖ AES-GCM_PIN(DK) ), base64. */
  wrapped: string;
  failures: number;
  /** Instant (ms) jusqu'auquel les essais sont refusés. */
  lockedUntil: number | null;
  createdAt: number;
}

/** Clé de stockage : `vault:<origine>:<deviceId>`. */
export function recordKey(origin: string, deviceId: string): string {
  return `${KEY_PREFIX}${origin}:${deviceId}`;
}

/**
 * Découpe une clé de stockage. Un deviceId (UUID) a une longueur fixe : on le lit par la fin, ce qui évite de
 * confondre `https://hôte` et `https://hôte:8443` (le port contient aussi des deux-points).
 */
export function parseRecordKey(key: string): { origin: string; deviceId: string } | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const rest = key.slice(KEY_PREFIX.length);
  const deviceId = rest.slice(-UUID_LENGTH);
  const origin = rest.slice(0, -UUID_LENGTH - 1);
  if (rest.charAt(rest.length - UUID_LENGTH - 1) !== ':' || !isUuid(deviceId) || !isValidOrigin(origin)) return null;
  return { origin, deviceId };
}

/**
 * Validation stricte à la lecture. Retourne `null` pour une version inconnue ou tout enregistrement altéré :
 * l'appelant le traite comme illisible et ne le modifie pas.
 */
export function parseRecord(raw: unknown, minIterations: number): VaultRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v === RECORD_VERSION) {
    if (fromB64(r.wrapped)?.length !== WRAPPED_V2_LENGTH) return null;
    if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return null;
    return { v: 2, wrapped: r.wrapped as string, createdAt: r.createdAt };
  }
  if (r.v !== LEGACY_PIN_RECORD_VERSION) return null;

  if (fromB64(r.salt)?.length !== SALT_LENGTH) return null;
  if (fromB64(r.wrapped)?.length !== WRAPPED_LENGTH) return null;

  const { iterations, failures, lockedUntil, createdAt } = r;
  if (!Number.isInteger(iterations) || (iterations as number) < minIterations || (iterations as number) > MAX_ITERATIONS) return null;
  if (!Number.isInteger(failures) || (failures as number) < 0 || (failures as number) > MAX_FAILURES) return null;
  if (lockedUntil !== null && !(typeof lockedUntil === 'number' && Number.isFinite(lockedUntil))) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;

  return {
    v: 1,
    salt: r.salt as string,
    iterations: iterations as number,
    wrapped: r.wrapped as string,
    failures: failures as number,
    lockedUntil: lockedUntil as number | null,
    createdAt,
  };
}
