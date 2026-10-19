import { dismissDraft } from '../page-actions/actions';
import type { TaskDraft } from '../page-actions/contract';
import { DraftStore, type SessionArea } from '../page-actions/store';
import { api } from '../shared/api';

/** Brouillon de tâche (storage.session) vu par l'interface. Aucun lien avec le coffre. */
export function createDraftBackend(): { load(): Promise<TaskDraft | null>; dismiss(): Promise<void> } {
  const store = new DraftStore(api.storage.session as SessionArea);
  return {
    load: () => store.load().catch(() => null),
    dismiss: () => dismissDraft({ store, host: { setBadge: (text) => api.action.setBadgeText({ text }) } }),
  };
}
