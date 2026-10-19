/**
 * Accès élargi à tous les sites : `optional_host_permissions`, jamais demandé à l'installation.
 * `request` doit être appelée directement dans le gestionnaire d'un clic (geste de l'utilisateur).
 * Cet accès ne donne rien au coffre : le coffre ne répond qu'aux origines de sa liste blanche, validées sur `sender`.
 */
export const BROAD_ACCESS = { origins: ['<all_urls>'] } as const;

export interface PermissionsLike {
  contains(p: { origins: string[] }): Promise<boolean>;
  request(p: { origins: string[] }): Promise<boolean>;
  remove(p: { origins: string[] }): Promise<boolean>;
}

const asRequest = () => ({ origins: [...BROAD_ACCESS.origins] });

export async function hasBroadAccess(api: PermissionsLike): Promise<boolean> {
  try {
    return await api.contains(asRequest());
  } catch {
    return false;
  }
}

export async function requestBroadAccess(api: PermissionsLike): Promise<boolean> {
  try {
    return await api.request(asRequest());
  } catch {
    return false; // pas de geste de l'utilisateur, ou refus
  }
}

export async function revokeBroadAccess(api: PermissionsLike): Promise<boolean> {
  try {
    return await api.remove(asRequest());
  } catch {
    return false;
  }
}
