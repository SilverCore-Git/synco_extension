/** Taille de DK (octets). */
export const DK_LENGTH = 32;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;
export const GCM_TAG_LENGTH = 16;

/** PBKDF2-SHA-256 : même coût que le coffre PIN de l'application. */
export const PIN_ITERATIONS = 600_000;
/** Plafond à la lecture, pour qu'un enregistrement altéré ne puisse pas bloquer le worker. */
export const MAX_ITERATIONS = 10_000_000;

export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 32;
export const PIN_FORMAT = /^[0-9]+$/;

/**
 * Barème repris de `PinVault` (synco_app) : les 5 premiers échecs sont sans attente, puis 30 s, 2 min,
 * 10 min, 1 h, 24 h ; le 10ᵉ échec efface l'enregistrement.
 */
export const MAX_FAILURES = 10;
export const FREE_FAILURES = 5;
export const BACKOFF_STEPS_SECONDS = [30, 120, 600, 3600, 86400] as const;

/** `wrapped` décodé : IV(12) + [IV(12) + DK(32) + tag(16)] + tag(16). */
export const WRAPPED_LENGTH = IV_LENGTH + (IV_LENGTH + DK_LENGTH + GCM_TAG_LENGTH) + GCM_TAG_LENGTH;

export const RECORD_VERSION = 1;
export const KEY_PREFIX = 'vault:';
