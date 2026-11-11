// Service worker (Chrome) / page événementielle (Firefox).
// Tous les écouteurs sont enregistrés de façon synchrone au chargement : un worker rendormi est réveillé par
// l'événement, et rien du coffre ne vit en mémoire entre deux messages (tout est relu depuis storage.local).
import { api } from '../shared/api';
import { BUILT_IN_ORIGINS } from '../shared/origins';
import { errorResponse, PROMPT_PAGE } from '../shared/protocol';
import { IdbDeviceSecret } from '../vault/idbSecret';
import { Vault } from '../vault/vault';
import { centerOver } from './placement';
import { onExtensionInstalled, onPermissionsAdded, type OnboardingHost } from './onboarding';
import { PromptManager, type PromptHost } from './prompt';
import { MemoryLimiterStore, SlidingWindowLimiter } from './rateLimit';
import { Router } from './router';
import { ExtensionVaultStorage, SessionLimiterStore, type StorageAreaLike } from './storage';

const secret = new IdbDeviceSecret();
const vault = new Vault({ storage: new ExtensionVaultStorage(api.storage.local as StorageAreaLike), secret });

const host: PromptHost = {
  async openWindow(sessionId, _tabId, size) {
    // Centrée sur le navigateur, comme une boîte de dialogue ; sans coordonnées sûres, le navigateur (ou le
    // gestionnaire de fenêtres, qui peut ignorer la position) choisit. La page n'en dépend pas : sa carte d'attente
    // est ancrée en bas de l'écran.
    const parent = await api.windows.getLastFocused().catch(() => undefined);
    const position = centerOver(parent, size) ?? {};
    const w = await api.windows.create({
      url: api.runtime.getURL(`${PROMPT_PAGE}?s=${sessionId}`),
      type: 'popup',
      ...size,
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

// Actions de page (menu contextuel « Créer une tâche dans Synco ») : masquées tant que l'envoi à Synco n'est pas
// branché, et leurs permissions (contextMenus, activeTab, <all_urls> facultatif) retirées du manifeste : les stores
// refusent une permission demandée mais inutilisée. Pour les rétablir, voir doc/page-actions.md.

// Retour vers l'onglet Synco après l'installation ou l'octroi de l'accès au site (onboarding.ts).
const onboardingHost: OnboardingHost = {
  hostPatterns: () => api.runtime.getManifest().host_permissions ?? [],
  hasHostAccess: (origins) => api.permissions.contains({ origins }),
  findTabs: async (url) => (await api.tabs.query({ url })).map((t) => ({ id: t.id, windowId: t.windowId, lastAccessed: t.lastAccessed })),
  reloadTab: (tabId) => api.tabs.reload(tabId),
  async focusTab(tab) {
    if (tab.id !== undefined) await api.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await api.windows.update(tab.windowId, { focused: true });
  },
  openOptions: () => api.runtime.openOptionsPage(),
};

// Création du second secret dès l'installation (sinon, au premier usage).
api.runtime.onInstalled.addListener((details) => {
  void secret.getKey().catch(() => undefined);
  void onExtensionInstalled(details?.reason, onboardingHost).catch(() => undefined);
});

api.permissions.onAdded.addListener((added) => {
  void onPermissionsAdded(added, onboardingHost).catch(() => undefined);
});
