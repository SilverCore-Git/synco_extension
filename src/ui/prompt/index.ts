import { mount } from '../dom';
import { createPromptBackend } from './backend';
import { PromptController } from './controller';
import { createPromptView } from './view';

const SESSION_ID = /^[0-9a-f]{32}$/;

const root = document.getElementById('app')!;
const sessionId = new URLSearchParams(location.search).get('s') ?? '';

if (!SESSION_ID.test(sessionId)) {
  mount(root, Object.assign(document.createElement('p'), { textContent: 'Cette fenêtre ne peut pas être utilisée directement. Fermez-la et recommencez depuis Synco.' }));
} else {
  const controller = new PromptController({ backend: createPromptBackend(sessionId), close: () => window.close() });
  const view = createPromptView(document, {
    press: (d) => controller.press(d),
    backspace: () => controller.backspace(),
    clear: () => controller.clear(),
    submit: () => void controller.submit(),
    cancel: () => void controller.cancel(),
    close: () => window.close(),
  });
  mount(root, view.root);
  controller.subscribe(view.update);

  // Clavier physique : chiffres, Retour arrière, Entrée, Échap.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) controller.press(e.key);
    else if (e.key === 'Backspace') controller.backspace();
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) void controller.submit();
    else if (e.key === 'Escape') void controller.cancel();
    else return;
    if (e.key !== 'Enter' || !(e.target instanceof HTMLButtonElement)) e.preventDefault();
  });

  setInterval(() => controller.tick(), 1000);
  void controller.start();
}
