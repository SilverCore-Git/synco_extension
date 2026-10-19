import { api } from '../../shared/api';
import { createDraftBackend } from '../draftBackend';
import type { UiHandlers } from '../modules';
import { createOptionsBackend } from '../options/backend';
import { OptionsModel } from '../options/model';
import { runApp } from '../runApp';

// Popup de la barre d'outils : les mêmes modules que la page d'options, en version compacte. S'il y a un brouillon de
// tâche en attente, c'est l'onglet qui s'ouvre (pastille).
const model = new OptionsModel(createOptionsBackend());
const drafts = createDraftBackend();

const handlers: UiHandlers = {
  grantAccess: () => void model.grantAccess(), // premier appel du gestionnaire : le geste de l'utilisateur est conservé
  askRemove: (origin, deviceId) => model.askRemove(origin, deviceId),
  cancelRemove: () => model.cancelRemove(),
  confirmRemove: () => void model.confirmRemove(),
  dismissDraft: () => void drafts.dismiss().then(loadDraft),
  openFull: () => {
    void api.runtime.openOptionsPage();
    window.close();
  },
};

const app = runApp({ root: document.getElementById('app')!, surface: 'popup', model, handlers, initialActive: null });

async function loadDraft(): Promise<void> {
  app.setDraft(await drafts.load());
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && model.current.confirm && !model.current.busy) model.cancelRemove();
});

void loadDraft();
void model.refresh();
