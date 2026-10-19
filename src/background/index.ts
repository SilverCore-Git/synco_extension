// Service worker (Chrome) / page événementielle (Firefox).
// Tous les écouteurs sont enregistrés de façon synchrone au chargement : un worker rendormi est réveillé par
// l'événement, et rien du coffre ne vit en mémoire entre deux messages (tout est relu depuis storage.local).
import { api } from '../shared/api';
import { BUILT_IN_ORIGINS } from '../shared/origins';
import { errorResponse, PROMPT_PAGE } from '../shared/protocol';
import { IdbDeviceSecret } from '../vault/idbSecret';
import { Vault } from '../vault/vault';
import { PromptManager, type PromptHost } from './prompt';
import { MemoryLimiterStore, SlidingWindowLimiter } from './rateLimit';
import { Router } from './router';
import { ExtensionVaultStorage, SessionLimiterStore, type StorageAreaLike } from './storage';

const secret = new IdbDeviceSecret();
const vault = new Vault({ storage: new ExtensionVaultStorage(api.storage.local as StorageAreaLike), secret });

const host: PromptHost = {
  async openWindow(sessionId) {
    const w = await api.windows.create({
      url: api.runtime.getURL(`${PROMPT_PAGE}?s=${sessionId}`),
      type: 'popup',
      width: 400,
      height: 660,
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
    return Promise.all(
      BUILT_IN_ORIGINS.map(async (origin) => ({
        origin,
        granted: await api.permissions.contains({ origins: [`${origin}/*`] }),
      })),
    );
  },
});

// `sendResponse` + `return true` : seule forme qui fonctionne à la fois sur Chrome et sur Firefox.
api.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  router.handle(message, sender).then(sendResponse, () => sendResponse(errorResponse(null, 'unavailable')));
  return true;
});

// Création du second secret dès l'installation (sinon, au premier usage).
api.runtime.onInstalled.addListener(() => {
  void secret.getKey().catch(() => undefined);
});
