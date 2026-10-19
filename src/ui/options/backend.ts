import { hasBroadAccess, requestBroadAccess, revokeBroadAccess, type PermissionsLike } from '../../page-actions/permissions';
import { api } from '../../shared/api';
import type { VaultEntry } from '../../vault/vault';
import type { OptionsBackend } from './model';

const send = (message: Record<string, unknown>): Promise<unknown> => api.runtime.sendMessage({ kind: 'internal', ...message });

function result<T>(response: unknown): T {
  const r = response as { ok?: boolean; result?: T } | undefined;
  if (!r || r.ok !== true || r.result === undefined) throw new Error('réponse invalide');
  return r.result;
}

export function createOptionsBackend(): OptionsBackend {
  const permissions = api.permissions as PermissionsLike;
  return {
    version: () => api.runtime.getManifest().version,
    async list() {
      return result<{ entries: VaultEntry[]; allowedOrigins: string[] }>(await send({ op: 'list' }));
    },
    async hostAccess() {
      return result<{ hosts: { origin: string; granted: boolean }[] }>(await send({ op: 'hostAccess' })).hosts;
    },
    async remove(origin, deviceId) {
      result(await send({ op: 'remove', origin, deviceId }));
    },
    // Appelée telle quelle depuis un clic : les motifs viennent du manifeste (sans port sur Firefox).
    requestAccess() {
      return api.permissions.request({ origins: api.runtime.getManifest().host_permissions ?? [] });
    },
    broadAccess: () => hasBroadAccess(permissions),
    requestBroad: () => requestBroadAccess(permissions),
    revokeBroad: () => revokeBroadAccess(permissions),
  };
}
