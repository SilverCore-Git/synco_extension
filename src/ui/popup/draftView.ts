import type { TaskDraft } from '../../page-actions/contract';
import { h } from '../dom';
import { formatDate } from '../format';

const EXCERPT = 240;

/** Brouillon de tâche en attente. Tout vient d'une page web (donnée non fiable) : inséré en texte uniquement. */
export function renderDraftCard(doc: Document, draft: TaskDraft, handlers: { dismiss(): void }): HTMLElement {
  const chars = Array.from(draft.text);
  const excerpt = chars.length > EXCERPT ? `${chars.slice(0, EXCERPT).join('')}…` : draft.text;
  return h(
    doc,
    'section',
    { class: 'card', attrs: { 'aria-label': 'Brouillon de tâche en attente' } },
    h(doc, 'h2', { text: 'Brouillon de tâche en attente' }),
    h(doc, 'p', { class: 'reason', text: `« ${excerpt} »` }),
    draft.title ? h(doc, 'p', { class: 'muted', text: `Page : ${draft.title}` }) : null,
    draft.url ? h(doc, 'p', { class: 'muted mono', text: draft.url }) : null,
    h(doc, 'p', { class: 'muted', text: `Capturé le ${formatDate(draft.capturedAt)}.` }),
    h(doc, 'p', { class: 'banner warn', text: 'Ce brouillon n\'est pas encore transmis à Synco : l\'envoi sera ajouté dans une prochaine version. Il reste dans cette extension jusqu\'à la fermeture du navigateur.' }),
    h(doc, 'button', { text: 'Ignorer le brouillon', attrs: { type: 'button' }, on: { click: handlers.dismiss } }),
  );
}
