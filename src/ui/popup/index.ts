import { api } from '../../shared/api';
import { mount } from '../dom';
import { createOptionsBackend } from '../options/backend';
import { OptionsModel } from '../options/model';
import { renderOptions } from '../options/view';

// Popup de la barre d'outils : même contenu que la page d'options, en version compacte.
const root = document.getElementById('app')!;
const model = new OptionsModel(createOptionsBackend());

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
  mount(root, page);
  page.querySelector<HTMLElement>('[data-autofocus]')?.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && model.current.confirm && !model.current.busy) model.cancelRemove();
});

void model.refresh();
