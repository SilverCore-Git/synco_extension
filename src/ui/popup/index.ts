import { dismissDraft } from '../../page-actions/actions';
import { DraftStore, type SessionArea } from '../../page-actions/store';
import { api } from '../../shared/api';
import { mount } from '../dom';
import { createOptionsBackend } from '../options/backend';
import { OptionsModel } from '../options/model';
import { renderOptions } from '../options/view';
import { renderDraftCard } from './draftView';

// Popup de la barre d'outils : brouillon de tâche en attente, puis le contenu de la page d'options en version compacte.
const root = document.getElementById('app')!;
const draftSlot = document.createElement('div');
const optionsSlot = document.createElement('div');
root.append(draftSlot, optionsSlot);

const store = new DraftStore(api.storage.session as SessionArea);
const model = new OptionsModel(createOptionsBackend());

async function showDraft(): Promise<void> {
  const draft = await store.load().catch(() => null);
  mount(
    draftSlot,
    ...(draft
      ? [
          renderDraftCard(document, draft, {
            dismiss: () => {
              void dismissDraft({ store, host: { setBadge: (text) => api.action.setBadgeText({ text }) } }).then(showDraft);
            },
          }),
        ]
      : []),
  );
}

const handlers = {
  grantAccess: () => void model.grantAccess(), // premier appel du gestionnaire : le geste de l'utilisateur est conservé
  askRemove: (origin: string, deviceId: string) => model.askRemove(origin, deviceId),
  cancelRemove: () => model.cancelRemove(),
  confirmRemove: () => void model.confirmRemove(),
  openFull: () => {
    void api.runtime.openOptionsPage();
    window.close();
  },
};

model.subscribe((state) => {
  const page = renderOptions(document, state, handlers, Date.now(), true);
  mount(optionsSlot, page);
  page.querySelector<HTMLElement>('[data-autofocus]')?.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && model.current.confirm && !model.current.busy) model.cancelRemove();
});

void showDraft();
void model.refresh();
