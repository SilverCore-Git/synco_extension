/** Mêmes codes que l'interface `DeviceVault` de l'application. */
export type VaultErrorCode =
  | 'pin-required' // un PIN est nécessaire et n'a pas été fourni
  | 'wrong-pin' // PIN incorrect (retryAfterSeconds peut être posé)
  | 'locked' // trop d'essais : attendre retryAfterSeconds
  | 'wiped' // trop d'essais : l'enregistrement a été effacé, l'appareil doit être relié de nouveau
  | 'cancelled' // l'utilisateur a annulé l'invite
  | 'unavailable' // enregistrement illisible, version inconnue, stockage ou second secret indisponible
  | 'missing'; // aucune clé pour cet appareil

/** Les messages sont destinés à l'affichage : ils ne contiennent jamais de PIN ni de clé. */
export class VaultError extends Error {
  readonly code: VaultErrorCode;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: VaultErrorCode, message?: string, retryAfterSeconds?: number) {
    super(message ?? code);
    this.name = 'VaultError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
