// Service worker (Chrome) / page événementielle (Firefox).
// Tous les écouteurs sont enregistrés de façon synchrone au chargement : un worker rendormi est réveillé par
// l'événement, et rien du coffre ne vit en mémoire entre deux messages (tout est relu depuis storage.local).
import { api } from '../shared/api';
import { createTaskAction, registerPageActions, type PageActionsHost } from '../page-actions/actions';
import { DraftStore, type SessionArea } from '../page-actions/store';
import { BUILT_IN_ORIGINS } from '../shared/origins';
import { errorResponse, PROMPT_PAGE } from '../shared/protocol';
import { IdbDeviceSecret } from '../vault/idbSecret';
import { Vault } from '../vault/vault';
import { besideApp, centerOver, PROMPT_WINDOW } from './placement';
import { PromptManager, type PromptHost } from './prompt';
import { MemoryLimiterStore, SlidingWindowLimiter } from './rateLimit';
import { Router } from './router';
import { ExtensionVaultStorage, SessionLimiterStore, type StorageAreaLike } from './storage';

const secret = new IdbDeviceSecret();
const vault = new Vault({ storage: new ExtensionVaultStorage(api.storage.local as StorageAreaLike), secret });

const host: PromptHost = {
  async openWindow(sessionId, tabId) {
    // À droite de la carte de Synco (côte à côte) si la page est assez large, sinon centrée sur le navigateur ;
    // sans coordonnées sûres, le navigateur choisit.
    const parent = await api.windows.getLastFocused().catch(() => undefined);
    const tab = await api.tabs.get(tabId).catch(() => undefined);
    const position = besideApp(parent, tab) ?? centerOver(parent) ?? {};
    const w = await api.windows.create({
      url: api.runtime.getURL(`${PROMPT_PAGE}?s=${sessionId}`),
      type: 'popup',
      ...PROMPT_WINDOW,
      ...position,
      focused: true,
    });
    if (w?.id === undefined) throw new Error('fenêtre non créée');
    return w.id;
  },
  closeWindow: (id) => api.windows.remove(id),
  onWindowRemoved: (cb) => api.windows.onRemoved.addListener(cb),
  onTabRemoved: (cb) => api.tabs.onRemoved.addListener((tabId) => cb(tabId)),
};

const limiter = new SlidingWindowLimiter({
  max: 3,
  windowMs: 60_000,
  store: api.storage.session ? new SessionLimiterStore(api.storage.session as StorageAreaLike) : new MemoryLimiterStore(),
});

const router = new Router({
  vault,
  prompts: new PromptManager({ host, limiter }),
  allowedOrigins: BUILT_IN_ORIGINS,
  extensionId: api.runtime.id,
  baseUrl: api.runtime.getURL('/'),
  version: api.runtime.getManifest().version,
  async hostAccess() {
    // Les motifs viennent du manifeste généré : sans port sur Firefox, avec port sur Chrome.
    const patterns = api.runtime.getManifest().host_permissions ?? [];
    return Promise.all(
      BUILT_IN_ORIGINS.map(async (origin) => {
        const host = new URL(origin).hostname;
        const mine = patterns.filter((p: string) => p.startsWith(`https://${host}`));
        const granted = mine.length > 0 && (await api.permissions.contains({ origins: mine }));
        return { origin, granted };
      }),
    );
  },
});

// `sendResponse` + `return true` : seule forme qui fonctionne à la fois sur Chrome et sur Firefox.
api.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  router.handle(message, sender).then(sendResponse, () => sendResponse(errorResponse(null, 'unavailable')));
  return true;
});

// Actions de page (tous sites) : menu contextuel « Créer une tâche dans Synco ». Aucun lien avec le coffre :
// le module n'importe rien de vault/ et n'écrit que dans storage.session (clé page-actions:draft).
const pageHost: PageActionsHost = {
  createMenu: (item) =>
    new Promise<void>((resolve) => {
      api.contextMenus.create(
        { id: item.id, title: item.title, contexts: item.contexts as [chrome.contextMenus.ContextType, ...chrome.contextMenus.ContextType[]], documentUrlPatterns: item.documentUrlPatterns },
        () => {
          void api.runtime.lastError; // lu pour ne pas laisser d'erreur « non vérifiée »
          resolve();
        },
      );
    }),
  removeAllMenus: () => api.contextMenus.removeAll(),
  onInstalled: (cb) => api.runtime.onInstalled.addListener(() => cb()),
  onMenuClicked: (cb) => api.contextMenus.onClicked.addListener((info, tab) => cb(info, tab)),
  async setBadge(text) {
    await api.action.setBadgeText({ text });
    if (text) await api.action.setBadgeBackgroundColor({ color: '#16ac77' });
  },
};
registerPageActions(pageHost, [createTaskAction({ store: new DraftStore(api.storage.session as SessionArea), host: pageHost })]);

// Création du second secret dès l'installation (sinon, au premier usage).
api.runtime.onInstalled.addListener(() => {
  void secret.getKey().catch(() => undefined);
});
