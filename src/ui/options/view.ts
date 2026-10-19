import { h, type Child } from '../dom';
import { formatDate, formatDuration, shortId } from '../format';
import type { VaultEntry } from '../../vault/vault';
import type { OptionsState } from './model';

export interface OptionsHandlers {
  grantAccess(): void;
  askRemove(origin: string, deviceId: string): void;
  cancelRemove(): void;
  confirmRemove(): void;
  /** Popup : ouvre la page d'options complète. */
  openFull?(): void;
}

/** Page d'options : tout texte venant du stockage ou d'une page web est inséré en texte (jamais en HTML). */
export function renderOptions(
  doc: Document,
  state: OptionsState,
  handlers: OptionsHandlers,
  now = Date.now(),
  compact = false,
): HTMLElement {
  const badge = (kind: 'ok' | 'bad' | 'warn', text: string) => h(doc, 'span', { class: `badge ${kind}`, text });

  const hostRows = state.hosts.map((host) =>
    h(
      doc,
      'li',
      {},
      h(
        doc,
        'div',
        { class: 'row' },
        h(doc, 'div', { class: 'grow' }, h(doc, 'div', { class: 'mono', text: host.origin }), badge(host.granted ? 'ok' : 'bad', host.granted ? 'Accès accordé' : 'Accès refusé')),
        host.granted ? null : h(doc, 'button', { class: 'primary', text: 'Accorder l\'accès', attrs: { type: 'button' }, on: { click: handlers.grantAccess } }),
      ),
    ),
  );

  const entryRow = (e: VaultEntry, active: boolean) => {
    const locked = e.lockedUntil !== null && e.lockedUntil > now;
    const badges: Child[] = [];
    if (!e.readable) badges.push(badge('bad', 'Illisible'));
    else if (locked) badges.push(badge('warn', `Verrouillé ${formatDuration((e.lockedUntil! - now) / 1000)}`));
    else if (e.failures) badges.push(badge('warn', `${e.failures} échec${e.failures > 1 ? 's' : ''} de PIN`));
    else badges.push(badge('ok', 'Prêt'));
    if (!active) badges.push(badge('warn', 'Origine inactive dans cette version'));
    return h(
      doc,
      'li',
      {},
      h(
        doc,
        'div',
        { class: 'row' },
        h(
          doc,
          'div',
          { class: 'grow' },
          h(doc, 'div', {}, h(doc, 'strong', { text: `Appareil ${shortId(e.deviceId)}` })),
          h(doc, 'div', { class: 'muted', text: e.createdAt === null ? 'Date de création inconnue' : `Créé le ${formatDate(e.createdAt)}` }),
          h(doc, 'div', {}, ...badges),
        ),
        h(doc, 'button', {
          class: 'danger',
          text: 'Supprimer',
          attrs: { type: 'button', 'aria-label': `Supprimer la clé de l'appareil ${shortId(e.deviceId)} pour ${e.origin}` },
          on: { click: () => handlers.askRemove(e.origin, e.deviceId) },
        }),
      ),
    );
  };

  const keys =
    state.groups.length === 0
      ? [h(doc, 'p', { class: 'muted', text: 'Aucune clé n\'est enregistrée dans cette extension.' })]
      : state.groups.map((g) =>
          h(doc, 'div', {}, h(doc, 'h3', { class: 'mono', text: g.origin }), h(doc, 'ul', { class: 'plain' }, ...g.entries.map((e) => entryRow(e, g.active)))),
        );

  const dialog = state.confirm
    ? h(
        doc,
        'div',
        { class: 'overlay' },
        h(
          doc,
          'div',
          { class: 'dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-body' } },
          h(doc, 'h2', { text: 'Supprimer cette clé ?', attrs: { id: 'confirm-title' } }),
          h(doc, 'p', { attrs: { id: 'confirm-body' } },
            `La clé de l'appareil ${shortId(state.confirm.deviceId)} pour `,
            h(doc, 'span', { class: 'mono', text: state.confirm.origin }),
            ' sera effacée de l\'extension. Cet appareil devra être relié de nouveau depuis Synco. Cette action est irréversible.',
          ),
          h(
            doc,
            'div',
            { class: 'actions' },
            h(doc, 'button', { text: 'Annuler', attrs: { type: 'button', 'data-autofocus': '' }, on: { click: handlers.cancelRemove } }),
            h(doc, 'button', { class: 'danger', text: state.busy ? 'Suppression…' : 'Supprimer', attrs: { type: 'button', disabled: state.busy }, on: { click: handlers.confirmRemove } }),
          ),
        ),
      )
    : null;

  return h(
    doc,
    'main',
    { class: compact ? 'options compact' : 'options', attrs: { 'aria-busy': state.status === 'loading' ? 'true' : 'false' } },
    h(doc, 'h1', { text: 'Synco Extension' }),
    h(doc, 'p', { class: 'muted', text: `Version ${state.version} · coffre de clés local pour Synco` }),
    state.error ? h(doc, 'p', { class: 'banner error', text: state.error, attrs: { role: 'alert' } }) : null,
    state.notice ? h(doc, 'p', { class: 'banner warn', text: state.notice, attrs: { role: 'status', 'aria-live': 'polite' } }) : null,

    h(doc, 'section', { class: 'card' },
      h(doc, 'h2', { text: 'Accès aux sites Synco' }),
      h(doc, 'p', { class: 'muted', text: 'L\'extension ne répond qu\'à ces adresses exactes. Selon votre navigateur, cet accès doit être accordé par vous : sans lui, Synco ne peut pas utiliser l\'extension.' }),
      state.status === 'loading' ? h(doc, 'p', { class: 'muted', text: 'Chargement…' }) : h(doc, 'ul', { class: 'plain' }, ...hostRows),
    ),

    h(doc, 'section', { class: 'card' },
      h(doc, 'h2', { text: 'Clés enregistrées' }),
      ...(state.status === 'loading' ? [h(doc, 'p', { class: 'muted', text: 'Chargement…' })] : keys),
    ),

    compact
      ? h(doc, 'section', { class: 'card' },
          h(doc, 'p', { class: 'muted', text: 'La clé reste dans l\'extension, protégée par votre code PIN, et n\'est jamais envoyée à Synco. Après 10 erreurs de PIN, elle est effacée.' }),
          handlers.openFull ? h(doc, 'button', { text: 'Plus d\'informations et réglages', attrs: { type: 'button' }, on: { click: handlers.openFull } }) : null,
        )
      : h(doc, 'section', { class: 'card' },
          h(doc, 'h2', { text: 'À savoir' }),
          h(doc, 'ul', {},
            h(doc, 'li', { text: 'Cette extension garde une clé locale par appareil, protégée par votre code PIN. Elle n\'est jamais envoyée à Synco.' }),
            h(doc, 'li', { text: 'Ce n\'est pas un gestionnaire de passkeys : elle ne répond à aucun autre site que Synco.' }),
            h(doc, 'li', { text: 'La clé n\'est pas protégée par du matériel : quelqu\'un qui copierait tout votre profil de navigateur pourrait tester des codes PIN. Après 10 erreurs, la clé est effacée.' }),
            h(doc, 'li', { text: 'Supprimer une clé ne demande pas de code PIN : l\'appareil devra être relié de nouveau depuis Synco.' }),
          ),
        ),
    dialog,
  );
}
