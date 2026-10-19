import { createDraftBackend } from '../draftBackend';
import type { UiHandlers } from '../modules';
import { runApp } from '../runApp';
import { createOptionsBackend } from './backend';
import { OptionsModel } from './model';

// Page d'options : tous les modules, un onglet par module (adresse `#vault`, `#tasks`…).
const model = new OptionsModel(createOptionsBackend());
const drafts = createDraftBackend();
const hash = () => location.hash.slice(1) || null;

const handlers: UiHandlers = {
  grantAccess: () => void model.grantAccess(), // premier appel du gestionnaire : le geste de l'utilisateur est conservé
  toggleBroad: () => void model.toggleBroad(), // premier appel du gestionnaire : le geste de l'utilisateur est conservé
  askRemove: (origin, deviceId) => model.askRemove(origin, deviceId),
  cancelRemove: () => model.cancelRemove(),
  confirmRemove: () => void model.confirmRemove(),
  dismissDraft: () => void drafts.dismiss().then(loadDraft),
};

const app = runApp({
  root: document.getElementById('app')!,
  surface: 'options',
  model,
  handlers,
  initialActive: hash(),
  onActive: (id) => history.replaceState(null, '', `#${id}`),
});

async function loadDraft(): Promise<void> {
  app.setDraft(await drafts.load());
}

window.addEventListener('hashchange', () => app.setActive(hash()));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && model.current.confirm && !model.current.busy) model.cancelRemove();
});

void model.refresh();
void loadDraft();
// Le verrouillage et l'accès changent avec le temps et les réglages du navigateur : rafraîchissement discret.
setInterval(() => {
  if (!model.current.confirm && !model.current.busy) void model.refresh();
}, 15000);
