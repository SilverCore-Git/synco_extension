import { formatClock, formatDuration } from '../format';
import { h } from '../dom';
import { banner, icon } from '../kit';
import type { Phase, PromptView } from './controller';

export interface PromptHandlers {
  press(digit: string): void;
  backspace(): void;
  clear(): void;
  submit(): void;
  cancel(): void;
  close(): void;
}

/** Secondes restantes à partir desquelles l'expiration est annoncée. */
export const COUNTDOWN_FROM = 30;

/** État de la scène de connexion (Synco ↔ extension), déduit de la phase de la fenêtre. */
export type SceneState = 'connecting' | 'waiting' | 'working' | 'success' | 'error';

export function sceneState(phase: Phase): SceneState {
  switch (phase) {
    case 'loading':
      return 'connecting';
    case 'verifying':
      return 'working';
    case 'done':
      return 'success';
    case 'fatal':
    case 'expired':
      return 'error';
    default:
      return 'waiting';
  }
}

/**
 * Scène de connexion : l'application Synco et l'extension, reliées par un lien animé. Elle raconte ce qui se passe
 * (en attente du code, vérification, réussite, échec) ; les animations sont purement visuelles (CSS).
 */
function createScene(doc: Document): { root: HTMLElement; set(state: SceneState): void } {
  const packets = [0, 1, 2].map((i) => h(doc, 'span', { class: 'packet', attrs: { 'data-i': String(i), 'aria-hidden': 'true' } }));
  const root = h(
    doc,
    'div',
    { class: 'scene', attrs: { role: 'img', 'aria-label': 'Connexion entre Synco et l\'extension' } },
    h(doc, 'div', { class: 'node node-app' }, h(doc, 'span', { class: 'app-icon', attrs: { 'aria-hidden': 'true' } }), h(doc, 'span', { class: 'node-label', text: 'Synco' })),
    h(doc, 'div', { class: 'link', attrs: { 'aria-hidden': 'true' } }, h(doc, 'span', { class: 'track' }), ...packets, h(doc, 'span', { class: 'link-check' }, icon(doc, 'shield-check'))),
    h(doc, 'div', { class: 'node node-ext' }, h(doc, 'span', { class: 'ext-icon' }, icon(doc, 'shield-lock-fill')), h(doc, 'span', { class: 'node-label', text: 'Extension' })),
  );
  root.setAttribute('data-state', 'connecting');
  return { root, set: (state) => root.setAttribute('data-state', state) };
}

/**
 * Squelette stable (créé une fois) mis à jour à chaque changement d'état : le focus clavier n'est pas perdu.
 * Rien de ce que la page fournit (origine, raison) n'est affiché : l'origine est de toute façon l'une des adresses
 * exactes de la liste blanche (une seule en production), donc ne renseigne pas l'utilisateur, et un texte de page
 * dans une fenêtre de sécurité ne ferait qu'ouvrir la porte à l'hameçonnage.
 */
export function createPromptView(doc: Document, handlers: PromptHandlers): { root: HTMLElement; update(view: PromptView): void } {
  const scene = createScene(doc);
  const title = h(doc, 'h1', { attrs: { id: 'title' } });
  const hint = h(doc, 'p', { class: 'hint' });

  const replacing = banner(doc, 'warn', 'Un enregistrement existe déjà pour cet appareil : il sera remplacé.');
  const errorText = h(doc, 'span');
  const error = h(doc, 'p', { class: 'banner error', attrs: { role: 'alert', 'aria-live': 'polite' } }, icon(doc, 'x-circle-fill'), errorText);

  const dots = h(doc, 'div', { class: 'dots', attrs: { role: 'img' } });

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
  const limits = h(doc, 'p', { class: 'fine' }, icon(doc, 'shield-check'), h(doc, 'span', {
    text: 'Vérifié par l\'extension, pas par le site. Après 10 erreurs, la clé de cet appareil est effacée.',
  }));
  const form = h(doc, 'div', { class: 'form' }, dots, keypad, actions, countdown, limits);

  const closeBtn = h(doc, 'button', { class: 'primary', text: 'Fermer', attrs: { type: 'button' }, on: { click: handlers.close } });
  const closeRow = h(doc, 'div', { class: 'actions fill' }, closeBtn);

  const root = h(doc, 'main', { class: 'prompt', attrs: { 'aria-live': 'polite' } }, scene.root, h(doc, 'div', { class: 'heading' }, title, hint), replacing, error, form, closeRow);

  function update(view: PromptView): void {
    const showForm = view.phase === 'enter' || view.phase === 'confirm' || view.phase === 'verifying';
    scene.set(sceneState(view.phase));
    root.setAttribute('data-phase', view.phase);
    title.textContent = view.title;
    hint.textContent = view.hint;
    hint.hidden = view.hint === '';

    replacing.hidden = !(view.replacing && view.mode === 'create' && view.phase !== 'verifying' && view.phase !== 'done');

    error.hidden = view.error === null;
    errorText.textContent = view.error ?? '';
    // Deux classes en alternance : chaque nouvelle erreur rejoue la secousse (rajouter la même classe ne le ferait pas).
    dots.setAttribute('class', view.error !== null && view.errorSeq > 0 ? `dots shake-${view.errorSeq % 2 === 0 ? 'a' : 'b'}` : 'dots');

    form.hidden = !showForm;
    closeRow.hidden = showForm || view.phase === 'loading' || view.phase === 'done';
    root.setAttribute('aria-busy', view.phase === 'verifying' || view.phase === 'loading' ? 'true' : 'false');

    dots.setAttribute('aria-label', `${view.dots} chiffre${view.dots > 1 ? 's' : ''} saisi${view.dots > 1 ? 's' : ''}`);
    // Emplacements vides jusqu'à la longueur minimale, puis un point par chiffre au-delà : le champ « se remplit ».
    const empty = Math.max(0, view.slots - view.dots);
    dots.replaceChildren(
      ...Array.from({ length: view.dots }, () => h(doc, 'span', { class: 'dot' })),
      ...Array.from({ length: empty }, () => h(doc, 'span', { class: 'slot' })),
    );

    for (const b of keyButtons) b.disabled = !view.keypadEnabled;
    submitBtn.textContent = view.phase === 'verifying' ? 'Vérification…' : view.submitLabel;
    submitBtn.setAttribute('class', view.phase === 'verifying' ? 'primary busy' : 'primary');
    submitBtn.disabled = !view.canSubmit;
    cancelBtn.disabled = false;

    // Le compte à rebours n'apparaît que quand il devient utile (la fenêtre est petite : pas de ligne permanente).
    countdown.textContent =
      view.lockSeconds !== null
        ? `Prochain essai possible dans ${formatDuration(view.lockSeconds)}.`
        : view.remainingSeconds !== null && view.remainingSeconds <= COUNTDOWN_FROM
          ? `Cette demande expire dans ${formatClock(view.remainingSeconds)}.`
          : '';
    countdown.hidden = countdown.textContent === '';
  }

  return { root, update };
}
