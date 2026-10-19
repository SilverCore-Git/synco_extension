import { formatClock, formatDuration } from '../format';
import { h } from '../dom';
import { banner, icon, tile, wordmark } from '../kit';
import type { PromptView } from './controller';

export interface PromptHandlers {
  press(digit: string): void;
  backspace(): void;
  clear(): void;
  submit(): void;
  cancel(): void;
  close(): void;
}

/**
 * Squelette stable (créé une fois) mis à jour à chaque changement d'état : le focus clavier n'est pas perdu.
 * Tout ce qui vient de la page web (origine, raison) est inséré en texte, jamais en HTML.
 */
export function createPromptView(doc: Document, handlers: PromptHandlers): { root: HTMLElement; update(view: PromptView): void } {
  const title = h(doc, 'h1', { attrs: { id: 'title' } });
  const originEl = h(doc, 'div', { class: 'origin' });
  const reasonEl = h(doc, 'p', { class: 'reason' });
  const requester = h(
    doc,
    'section',
    { class: 'requester', attrs: { 'aria-labelledby': 'requester-label' } },
    tile(doc, 'shield-lock-fill', 'primary'),
    h(doc, 'div', { class: 'who' }, h(doc, 'div', { class: 'label', text: 'Demandé par', attrs: { id: 'requester-label' } }), originEl),
    reasonEl,
  );
  const replacing = banner(doc, 'warn', 'Un enregistrement existe déjà pour cet appareil : il sera remplacé.');
  const hint = h(doc, 'p', { class: 'muted' });
  const dots = h(doc, 'div', { class: 'dots', attrs: { role: 'img' } });
  const errorText = h(doc, 'span');
  const error = h(doc, 'p', { class: 'banner error', attrs: { role: 'alert', 'aria-live': 'polite' } }, icon(doc, 'x-circle-fill'), errorText);

  const keyButtons: HTMLButtonElement[] = [];
  const key = (label: string, aria: string, onClick: () => void, cls?: string) => {
    const b = h(doc, 'button', { ...(cls ? { class: cls } : {}), text: label, attrs: { type: 'button', 'aria-label': aria }, on: { click: onClick } });
    keyButtons.push(b);
    return b;
  };
  const keypad = h(
    doc,
    'div',
    { class: 'keypad', attrs: { role: 'group', 'aria-label': 'Pavé numérique' } },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, `Chiffre ${d}`, () => handlers.press(d))),
    key('Effacer', 'Tout effacer', handlers.clear, 'aux'),
    key('0', 'Chiffre 0', () => handlers.press('0')),
    key('⌫', 'Supprimer le dernier chiffre', handlers.backspace, 'aux'),
  );

  const cancelBtn = h(doc, 'button', { class: 'default', text: 'Annuler', attrs: { type: 'button' }, on: { click: handlers.cancel } });
  const submitBtn = h(doc, 'button', { class: 'primary', attrs: { type: 'button' }, on: { click: handlers.submit } });
  const actions = h(doc, 'div', { class: 'actions fill' }, cancelBtn, submitBtn);

  const countdown = h(doc, 'p', { class: 'muted countdown' });
  const limits = h(doc, 'p', { class: 'fine' }, icon(doc, 'lock-fill'), h(doc, 'span', {
    text: 'Ce code est vérifié par l\'extension, pas par le site. Après 10 erreurs, la clé de cet appareil est effacée.',
  }));
  const form = h(doc, 'div', {}, hint, dots, keypad, actions, countdown, limits);

  const closeBtn = h(doc, 'button', { class: 'primary', text: 'Fermer', attrs: { type: 'button' }, on: { click: handlers.close } });
  const closeRow = h(doc, 'div', { class: 'actions fill' }, closeBtn);

  const head = h(doc, 'header', { class: 'prompt-head' }, wordmark(doc), h(doc, 'span', { class: 'chip chip-off', text: 'Coffre de clés' }));
  const root = h(doc, 'main', { class: 'prompt', attrs: { 'aria-live': 'polite' } }, head, title, requester, replacing, error, form, closeRow);

  function update(view: PromptView): void {
    const showForm = view.phase === 'enter' || view.phase === 'confirm' || view.phase === 'verifying';
    title.textContent = view.title;

    requester.hidden = view.origin === null;
    originEl.textContent = view.origin ?? '';
    reasonEl.hidden = view.reason === null;
    reasonEl.textContent = view.reason === null ? '' : `« ${view.reason} »`;
    replacing.hidden = !(view.replacing && view.mode === 'create' && view.phase !== 'verifying');

    error.hidden = view.error === null;
    errorText.textContent = view.error ?? '';

    form.hidden = !showForm;
    closeRow.hidden = showForm || view.phase === 'loading' || view.phase === 'done';
    hint.textContent = view.hint;
    root.setAttribute('aria-busy', view.phase === 'verifying' || view.phase === 'loading' ? 'true' : 'false');

    dots.setAttribute('aria-label', `${view.dots} chiffre${view.dots > 1 ? 's' : ''} saisi${view.dots > 1 ? 's' : ''}`);
    dots.replaceChildren(
      ...(view.dots === 0
        ? [h(doc, 'span', { class: 'placeholder', text: 'Aucun chiffre saisi' })]
        : Array.from({ length: view.dots }, () => h(doc, 'span', { class: 'dot' }))),
    );

    for (const b of keyButtons) b.disabled = !view.keypadEnabled;
    submitBtn.textContent = view.phase === 'verifying' ? 'Vérification…' : view.submitLabel;
    submitBtn.setAttribute('class', view.phase === 'verifying' ? 'primary busy' : 'primary');
    submitBtn.disabled = !view.canSubmit;
    cancelBtn.disabled = false;

    countdown.textContent =
      view.lockSeconds !== null
        ? `Prochain essai possible dans ${formatDuration(view.lockSeconds)}.`
        : view.remainingSeconds !== null
          ? `Cette demande expire dans ${formatClock(view.remainingSeconds)}.`
          : '';
  }

  return { root, update };
}
