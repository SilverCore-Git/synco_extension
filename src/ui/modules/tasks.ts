import type { TaskDraft } from '../../page-actions/contract';
import { h } from '../dom';
import { formatDate } from '../format';
import { banner, button, card, chip, panelHeader, tile } from '../kit';
import type { ModuleContext, UiModule } from '../modules';

const EXCERPT = 240;

/**
 * Module « Tâches » (actions de page, tous sites). Il n'affiche que le brouillon capturé par le menu contextuel et
 * le réglage d'accès élargi : rien du coffre. Tout ce qui vient d'une page web est inséré en texte uniquement.
 */
export const tasksModule: UiModule = {
  id: 'tasks',
  title: 'Tâches',
  icon: 'card-checklist',
  render: renderTasks,
  badge: ({ state }) => (state.draft ? { text: '1', tone: 'primary' } : null),
};

/** Brouillon de tâche en attente. */
export function renderDraftCard(doc: Document, draft: TaskDraft, handlers: { dismiss(): void }): HTMLElement {
  const chars = Array.from(draft.text);
  const excerpt = chars.length > EXCERPT ? `${chars.slice(0, EXCERPT).join('')}…` : draft.text;
  return card(doc, { title: 'Brouillon de tâche en attente', icon: 'card-checklist', accent: true },
    h(doc, 'div', { class: 'stack' },
      h(doc, 'p', { class: 'reason', text: `« ${excerpt} »` }),
      draft.title ? h(doc, 'p', { class: 'muted', text: `Page : ${draft.title}` }) : null,
      draft.url ? h(doc, 'p', { class: 'muted mono', text: draft.url }) : null,
      h(doc, 'p', { class: 'muted', text: `Capturé le ${formatDate(draft.capturedAt)}.` }),
      banner(doc, 'warn', 'Ce brouillon n\'est pas encore transmis à Synco : l\'envoi sera ajouté dans une prochaine version. Il reste dans cette extension jusqu\'à la fermeture du navigateur.'),
      button(doc, { label: 'Ignorer le brouillon', kind: 'second', small: true, onClick: handlers.dismiss }),
    ),
  );
}

function renderTasks({ doc, surface, state, handlers }: ModuleContext): HTMLElement | null {
  const { draft, options } = state;
  const compact = surface === 'popup';
  // Popup : minimaliste. Pas d'onglet « Tâches » tant qu'il n'y a rien à y faire ; il apparaît avec le brouillon.
  if (compact && !draft) return null;

  const how = card(doc, { title: 'Créer une tâche depuis une page', icon: 'info-circle-fill' },
    h(doc, 'div', { class: 'row' },
      tile(doc, 'card-checklist', 'primary'),
      h(doc, 'p', { class: 'muted grow', text: 'Sélectionnez du texte sur n\'importe quelle page, faites un clic droit, puis « Créer une tâche dans Synco ». Le texte, l\'adresse et le titre de la page sont gardés ici en brouillon.' }),
    ),
  );

  const broad = compact || !handlers.toggleBroad
    ? null
    : card(doc, { title: 'Actions de page sur tous les sites', icon: 'globe2' },
        h(doc, 'div', { class: 'stack' },
          h(doc, 'p', { class: 'muted', text: 'Aujourd\'hui, « Créer une tâche dans Synco » (clic droit sur un texte sélectionné) fonctionne sans cet accès : le navigateur ne donne accès qu\'à la page où vous faites le clic droit. L\'accès à tous les sites est réservé à de futures fonctions, comme l\'intégration de Tinko. Il n\'est jamais demandé à l\'installation, et il ne donne jamais accès au coffre : le coffre ne répond qu\'aux adresses Synco listées dans l\'onglet Coffre.' }),
          h(doc, 'div', { class: 'row wrap' },
            h(doc, 'div', { class: 'grow' }, chip(doc, options.broad ? 'warn' : 'ok', options.broad ? 'Accès à tous les sites accordé' : 'Accès limité à Synco et au clic droit')),
            button(doc, { label: options.broad ? 'Retirer l\'accès à tous les sites' : 'Autoriser tous les sites', kind: options.broad ? 'default' : 'primary', small: true, ...(options.broad ? {} : { icon: 'globe2' as const }), onClick: handlers.toggleBroad! }),
          ),
        ),
      );

  return h(doc, 'div', { class: 'stack' },
    compact ? null : panelHeader(doc, 'Actions de page', 'Des raccourcis qui marchent sur tous les sites, sans jamais toucher au coffre de clés.'),
    draft ? renderDraftCard(doc, draft, { dismiss: handlers.dismissDraft ?? (() => undefined) }) : how,
    draft && !compact ? how : null,
    broad,
  );
}
