import { formatClock, formatDuration } from '../format';
import { h } from '../dom';
import { banner, icon, wordmark } from '../kit';
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

/** État affiché par la marque d'état au-dessus du titre, déduit de la phase de la fenêtre. */
export type SceneState = 'connecting' | 'waiting' | 'working' | 'success' | 'error';

export function sceneState(phase: Phase): SceneState {
  switch (phase) {
    case 'loading':
      return 'connecting';
    case 'verifying':
      return 'working';
    case 'approve':
      return 'waiting';
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
 * Marque d'état, sobre : rien pendant la saisie (le pavé suffit), un indicateur pendant la connexion, une coche à la
 * réussite, une croix à l'échec. Aucune animation décorative.
 */
function createStatus(doc: Document): { root: HTMLElement; set(state: SceneState): void } {
  const root = h(
    doc,
    'div',
    { class: 'status', attrs: { 'aria-hidden': 'true' } },
    h(doc, 'span', { class: 'status-spin' }),
    h(doc, 'span', { class: 'status-check' }),
    h(doc, 'span', { class: 'status-error' }, icon(doc, 'x-circle-fill')),
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
  const status = createStatus(doc);
  const title = h(doc, 'h1', { attrs: { id: 'title' } });
  const hint = h(doc, 'p', { class: 'hint' });

  const replacing = banner(doc, 'warn', 'Un enregistrement existe déjà pour cet appareil : il sera remplacé.');

  const dots = h(doc, 'div', { class: 'dots', attrs: { role: 'img' } });
  // L'erreur prend la place d'une ligne réservée sous les points : rien ne saute quand elle apparaît.
  const error = h(doc, 'p', { class: 'pin-error', attrs: { role: 'alert', 'aria-live': 'polite' } });

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
    key('EFFACER', 'Tout effacer', handlers.clear, 'aux'),
    key('0', 'Chiffre 0', () => handlers.press('0')),
  );
  // « OK » ferme le pavé, comme celui de Synco (PinPad.vue). Au déverrouillage, le dernier chiffre valide déjà seul.
  const submitBtn = h(doc, 'button', { class: 'primary ok', attrs: { type: 'button', 'aria-label': 'Valider' }, on: { click: handlers.submit } });
  keypad.appendChild(submitBtn);

  const cancelBtn = h(doc, 'button', { class: 'cancel', text: 'Annuler', attrs: { type: 'button' }, on: { click: handlers.cancel } });
  const actions = h(doc, 'div', { class: 'prompt-cancel' }, cancelBtn);

  const countdown = h(doc, 'p', { class: 'muted countdown' });
  const fine = h(doc, 'p', { class: 'fine', text: 'Après 10 erreurs, la clé de cet appareil est effacée.' });
  // Pavé : seulement pour un ancien enregistrement scellé par un PIN (demandé une dernière fois).
  const form = h(doc, 'div', { class: 'form' }, dots, error, keypad, actions, fine);

  // Cas normal : un accord, sans code. Le bouton reste la seule action principale de la fenêtre.
  const approveBtn = h(doc, 'button', { class: 'primary', attrs: { type: 'button' }, on: { click: handlers.submit } });
  const approveCancel = h(doc, 'button', { class: 'cancel', attrs: { type: 'button' }, on: { click: handlers.cancel } });
  const approve = h(doc, 'div', { class: 'approve' }, approveBtn, approveCancel);

  const closeBtn = h(doc, 'button', { class: 'primary', text: 'Fermer', attrs: { type: 'button' }, on: { click: handlers.close } });
  const closeRow = h(doc, 'div', { class: 'actions fill' }, closeBtn);

  // Repère de provenance : la fenêtre se présente comme celle de l'extension (le contenu de la page n'y entre jamais).
  const head = h(doc, 'header', { class: 'prompt-head' }, wordmark(doc), h(doc, 'span', { class: 'chip chip-off', text: 'Synco Extension' }));
  const root = h(
    doc,
    'main',
    { class: 'prompt', attrs: { 'aria-live': 'polite' } },
    head,
    h(doc, 'div', { class: 'heading' }, status.root, title, hint),
    replacing,
    form,
    approve,
    countdown,
    closeRow,
  );

  function update(view: PromptView): void {
    const active = view.phase === 'approve' || view.phase === 'enter' || view.phase === 'confirm' || view.phase === 'verifying';
    const showForm = active && view.pinEntry;
    const showApprove = active && !view.pinEntry;
    status.set(sceneState(view.phase));
    root.setAttribute('data-phase', view.phase);
    title.textContent = view.title;
    hint.textContent = view.phase === 'fatal' || view.phase === 'expired' ? (view.error ?? view.hint) : view.hint;
    hint.hidden = hint.textContent === '';

    replacing.hidden = !(view.replacing && view.mode === 'create' && view.phase !== 'verifying' && view.phase !== 'done');

    // Pendant la saisie, l'erreur s'affiche sous les points ; après un échec définitif, elle devient le texte d'aide.
    error.textContent = showForm ? (view.error ?? '') : '';
    error.hidden = !showForm || view.error === null;
    // Deux classes en alternance : chaque nouvelle erreur rejoue la secousse (rajouter la même classe ne le ferait pas).
    dots.setAttribute('class', view.error !== null && view.errorSeq > 0 ? `dots shake-${view.errorSeq % 2 === 0 ? 'a' : 'b'}` : 'dots');

    form.hidden = !showForm;
    approve.hidden = !showApprove;
    // Un seul bouton porte le libellé à la fois : le pavé et l'accord ne sont jamais affichés ensemble.
    approveBtn.textContent = !showApprove ? '' : view.phase === 'verifying' ? 'Ouverture…' : view.submitLabel;
    approveBtn.setAttribute('class', view.phase === 'verifying' ? 'primary busy' : 'primary');
    approveBtn.disabled = view.phase === 'verifying';
    approveCancel.textContent = showApprove ? 'Annuler' : '';
    closeRow.hidden = active || view.phase === 'loading' || view.phase === 'done';
    root.setAttribute('aria-busy', view.phase === 'verifying' || view.phase === 'loading' ? 'true' : 'false');

    dots.setAttribute('aria-label', `${view.dots} chiffre${view.dots > 1 ? 's' : ''} saisi${view.dots > 1 ? 's' : ''}`);
    // Emplacements vides jusqu'à la longueur minimale, puis un point par chiffre au-delà : le champ « se remplit ».
    const empty = Math.max(0, view.slots - view.dots);
    // Cases du pavé de Synco : une case par chiffre, qui se remplit (bord vert, point vert) à la saisie.
    dots.replaceChildren(
      ...Array.from({ length: view.dots }, () => h(doc, 'span', { class: 'dot' }, h(doc, 'i'))),
      ...Array.from({ length: empty }, () => h(doc, 'span', { class: 'slot' }, h(doc, 'i'))),
    );

    for (const b of keyButtons) b.disabled = !view.keypadEnabled;
    submitBtn.textContent = view.pinEntry ? view.submitLabel : 'OK';
    submitBtn.setAttribute('class', view.phase === 'verifying' ? 'primary ok busy' : 'primary ok');
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
