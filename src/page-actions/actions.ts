import { buildDraft } from './contract';
import type { DraftStore } from './store';

/** Informations d'un clic dans le menu contextuel (sous-ensemble de `contextMenus.OnClickData`). */
export interface MenuClick {
  menuItemId: string | number;
  selectionText?: string | undefined;
  pageUrl?: string | undefined;
}

export interface MenuTab {
  url?: string | undefined;
  title?: string | undefined;
}

/** Ce dont les actions de page ont besoin du navigateur (adaptateur réel dans background/index.ts). */
export interface PageActionsHost {
  createMenu(item: { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }): Promise<void>;
  removeAllMenus(): Promise<void>;
  onInstalled(cb: () => void): void;
  onMenuClicked(cb: (info: MenuClick, tab: MenuTab | undefined) => void): void;
  setBadge(text: string): Promise<void>;
}

/** Une action de page. Les futures (par exemple Tinko) s'ajoutent ici ; aucune n'a accès au coffre. */
export interface PageAction {
  id: string;
  title: string;
  contexts: string[];
  handle(info: MenuClick, tab: MenuTab | undefined): Promise<void>;
}

export const CREATE_TASK_ID = 'synco-create-task';
const WEB_PAGES = ['http://*/*', 'https://*/*'];

export function createTaskAction(deps: { store: DraftStore; host: Pick<PageActionsHost, 'setBadge'>; now?: () => number }): PageAction {
  return {
    id: CREATE_TASK_ID,
    title: 'Créer une tâche dans Synco',
    contexts: ['selection'],
    async handle(info, tab) {
      // `activeTab` donne l'URL et le titre de l'onglet au moment du clic ; le texte vient du menu lui-même.
      const built = buildDraft(
        { selectionText: info.selectionText, pageUrl: info.pageUrl ?? tab?.url, title: tab?.title },
        (deps.now ?? Date.now)(),
      );
      if (!built.ok) return;
      await deps.store.save(built.draft);
      await deps.host.setBadge('1'); // signale un brouillon en attente ; rien n'est envoyé nulle part
    },
  };
}

/** Enregistre les actions. Les écouteurs sont posés de façon synchrone (le worker peut être réveillé par un clic). */
export function registerPageActions(host: PageActionsHost, actions: PageAction[]): void {
  host.onInstalled(() => {
    void (async () => {
      await host.removeAllMenus();
      for (const a of actions) await host.createMenu({ id: a.id, title: a.title, contexts: a.contexts, documentUrlPatterns: WEB_PAGES });
    })().catch(() => undefined);
  });

  host.onMenuClicked((info, tab) => {
    const action = actions.find((a) => a.id === info.menuItemId);
    if (action) void action.handle(info, tab).catch(() => undefined);
  });
}

/** Ignorer le brouillon en attente (popup). */
export async function dismissDraft(deps: { store: DraftStore; host: Pick<PageActionsHost, 'setBadge'> }): Promise<void> {
  await deps.store.clear();
  await deps.host.setBadge('');
}
