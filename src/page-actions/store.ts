import { parseDraft, type TaskDraft } from './contract';

/** Zone de stockage minimale (`storage.session` en production). Jamais `storage.local`, qui contient le coffre. */
export interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export const DRAFT_KEY = 'page-actions:draft';

/** Un seul brouillon en attente (le dernier). Valable jusqu'à la fermeture du navigateur : `storage.session`. */
export class DraftStore {
  constructor(private readonly area: SessionArea) {}

  save(draft: TaskDraft): Promise<void> {
    return this.area.set({ [DRAFT_KEY]: draft });
  }

  /** Un contenu altéré est ignoré et supprimé. */
  async load(): Promise<TaskDraft | null> {
    const raw = (await this.area.get(DRAFT_KEY))[DRAFT_KEY];
    if (raw === undefined) return null;
    const draft = parseDraft(raw);
    if (!draft) await this.area.remove(DRAFT_KEY);
    return draft;
  }

  clear(): Promise<void> {
    return this.area.remove(DRAFT_KEY);
  }
}
