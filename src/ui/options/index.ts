import { mount } from '../dom';
import { createOptionsBackend } from './backend';
import { OptionsModel } from './model';
import { renderOptions } from './view';

const root = document.getElementById('app')!;
const model = new OptionsModel(createOptionsBackend());

const handlers = {
  grantAccess: () => void model.grantAccess(), // premier appel du gestionnaire : le geste de l'utilisateur est conservé
  toggleBroad: () => void model.toggleBroad(), // premier appel du gestionnaire : le geste de l'utilisateur est conservé
  askRemove: (origin: string, deviceId: string) => model.askRemove(origin, deviceId),
  cancelRemove: () => model.cancelRemove(),
  confirmRemove: () => void model.confirmRemove(),
};

model.subscribe((state) => {
  const page = renderOptions(document, state, handlers);
  mount(root, page);
  page.querySelector<HTMLElement>('[data-autofocus]')?.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && model.current.confirm && !model.current.busy) model.cancelRemove();
});

void model.refresh();
// Le verrouillage et l'accès changent avec le temps et les réglages du navigateur : rafraîchissement discret.
setInterval(() => {
  if (!model.current.confirm && !model.current.busy) void model.refresh();
}, 15000);
