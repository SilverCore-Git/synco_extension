import { h, type Child } from '../dom';
import { formatDate, formatDuration, shortId } from '../format';
import { button, card, chip, emptyState, icon, panelHeader, skeleton, tile, type IconName } from '../kit';
import type { ModuleContext, UiModule } from '../modules';
import type { VaultEntry } from '../../vault/vault';
import type { OptionsState } from '../options/model';

/**
 * Module « Coffre » : accès aux sites Synco et clés enregistrées. Tout texte venant du stockage ou d'une page web
 * est inséré en texte (jamais en HTML). Il ne lit que des métadonnées : jamais de clé, jamais de PIN.
 */
export const vaultModule: UiModule = {
  id: 'vault',
  title: 'Coffre',
  icon: 'shield-lock-fill',
  render: renderVault,
  badge: ({ state }) => (state.options.status === 'ready' && state.options.hosts.some((x) => !x.granted) ? { text: '!', tone: 'warn' } : null),
};

function entryStatus(doc: Document, e: VaultEntry, active: boolean, now: number): HTMLElement[] {
  const chips: HTMLElement[] = [];
  const locked = e.lockedUntil !== null && e.lockedUntil > now;
  if (!e.readable) chips.push(chip(doc, 'bad', 'Illisible'));
  else if (locked) chips.push(chip(doc, 'warn', `Verrouillé ${formatDuration((e.lockedUntil! - now) / 1000)}`));
  else if (e.failures) chips.push(chip(doc, 'warn', `${e.failures} échec${e.failures > 1 ? 's' : ''} de PIN`));
  else chips.push(chip(doc, 'ok', 'Prêt'));
  if (!active) chips.push(chip(doc, 'warn', 'Origine inactive dans cette version'));
  return chips;
}

function renderVault(ctx: ModuleContext): HTMLElement {
  return ctx.surface === 'popup' ? renderVaultPopup(ctx) : renderVaultFull(ctx);
}

/** Ce que le popup dit en un coup d'œil : un état, une phrase, et au plus une action. */
export interface Hero {
  tone: 'ok' | 'warn';
  icon: IconName;
  title: string;
  text: string;
  /** L'action attendue de l'utilisateur, s'il y en a une. */
  action: 'grant' | 'manage' | 'open' | null;
  /** Le lien entre Synco et la clé de cet appareil, tel que le schéma du popup le montre. */
  link: { tone: 'ok' | 'warn' | 'off'; label: string };
  /** Ce que l'extension garde pour cet appareil, en mots simples (« 1 clé », « Aucune clé »). */
  keys: string;
}

/**
 * État du coffre pour quelqu'un qui n'est pas technicien. Priorité : ce qui bloque (accès refusé), puis ce qui
 * demande une réparation, puis l'attente, puis « tout va bien ». Aucun identifiant, aucune adresse, aucun jargon.
 * `null` quand l'extension ne répond pas : le bandeau d'erreur du cadre dit déjà quoi faire.
 */
export function vaultHero(o: OptionsState, now: number): Hero | null {
  if (o.status !== 'ready') return null;
  const entries = o.groups.filter((g) => g.active).flatMap((g) => g.entries);
  const keys = entries.length === 0 ? 'Aucune clé' : entries.length === 1 ? '1 clé' : `${entries.length} clés`;
  if (o.hosts.some((x) => !x.granted)) {
    return {
      tone: 'warn', icon: 'exclamation-triangle-fill', action: 'grant', keys,
      title: 'Autorisation nécessaire',
      text: 'Autorisez l\'extension à fonctionner avec Synco pour qu\'elle protège vos clés.',
      link: { tone: 'warn', label: 'Pas encore autorisé' },
    };
  }
  if (entries.some((e) => !e.readable)) {
    return {
      tone: 'warn', icon: 'exclamation-triangle-fill', action: 'manage', keys,
      title: 'Une clé est illisible',
      text: 'Supprimez-la, puis reconnectez l\'appareil depuis Synco.',
      link: { tone: 'warn', label: 'Clé illisible' },
    };
  }
  const locked = entries.filter((e) => e.lockedUntil !== null && e.lockedUntil > now);
  if (locked.length > 0) {
    const wait = formatDuration(Math.max(...locked.map((e) => e.lockedUntil! - now)) / 1000);
    return {
      tone: 'warn', icon: 'hourglass-split', action: null, keys,
      title: 'Trop d\'essais',
      text: `Réessayez dans ${wait}.`,
      link: { tone: 'warn', label: `En pause, ${wait}` },
    };
  }
  if (entries.length > 0) {
    return {
      tone: 'ok', icon: 'shield-check', action: null, keys,
      title: entries.length === 1 ? 'Cet appareil est protégé' : `${entries.length} appareils protégés`,
      text: 'Vos clés sont gardées par l\'extension, hors de la page Synco.',
      link: { tone: 'ok', label: 'Sur votre accord' },
    };
  }
  return {
    tone: 'ok', icon: 'shield-lock-fill', action: 'open', keys,
    title: 'Prête à protéger vos clés',
    text: 'Ouvrez Synco pour connecter cet appareil à l\'extension.',
    link: { tone: 'off', label: 'Pas encore relié' },
  };
}

/**
 * Le schéma du popup : Synco d'un côté, la clé de cet appareil de l'autre, et entre les deux ce qui les relie.
 * Il dit en une image ce que l'extension garantit : la page ne touche à la clé qu'avec votre accord.
 */
function linkDiagram(doc: Document, hero: Hero): HTMLElement {
  const node = (cls: string, mark: HTMLElement, label: string) =>
    h(doc, 'div', { class: `node ${cls}` }, mark, h(doc, 'span', { class: 'node-label', text: label }));
  return h(doc, 'div', { class: `link-diagram ${hero.link.tone}`, attrs: { role: 'img', 'aria-label': `Synco et ${hero.keys.toLowerCase()} sur cet appareil : ${hero.link.label.toLowerCase()}` } },
    node('node-synco', h(doc, 'span', { class: 'app-icon mark' }), 'Synco'),
    h(doc, 'div', { class: 'wire', attrs: { 'aria-hidden': 'true' } },
      h(doc, 'span', { class: 'wire-label', text: hero.link.label }),
      h(doc, 'span', { class: 'wire-line' }, h(doc, 'i', {})),
    ),
    node('node-key', h(doc, 'span', { class: 'mark' }, icon(doc, hero.tone === 'warn' ? hero.icon : 'key-fill')), hero.keys),
  );
}

/** Popup : minimaliste. Le détail (clés, appareils, suppression) est dans la page des réglages, un clic plus loin. */
function renderVaultPopup({ doc, now, state, handlers }: ModuleContext): HTMLElement {
  const hero = vaultHero(state.options, now);
  const loading = state.options.status === 'loading';

  const point = (text: string) => h(doc, 'li', {}, icon(doc, 'shield-check'), h(doc, 'span', { text }));
  const help = state.help
    ? h(doc, 'section', { class: 'help', attrs: { 'aria-label': 'Comment ça marche' } },
        h(doc, 'ul', { class: 'points' },
          point('L\'extension garde la clé de cet appareil. Elle ne quitte jamais votre ordinateur.'),
          point('À chaque ouverture de Synco, une petite fenêtre de l\'extension vous demande d\'autoriser l\'accès.'),
          point('Sans votre accord dans cette fenêtre, le site ne peut pas lire la clé.'),
        ),
        handlers.openFull ? button(doc, { label: 'Plus de détails', small: true, onClick: handlers.openFull }) : null,
      )
    : null;

  const status = loading
    ? h(doc, 'section', { class: 'status-hero', attrs: { 'aria-busy': 'true' } }, h(doc, 'div', { class: 'skeleton title' }), skeleton(doc))
    : hero
      ? h(doc, 'section', { class: `status-hero ${hero.tone}`, attrs: { 'aria-live': 'polite' } },
          h(doc, 'h1', {}, hero.title, h(doc, 'span', { class: 'stop', text: '.' })),
          h(doc, 'p', { class: 'lede', text: hero.text }),
          linkDiagram(doc, hero),
          hero.action === 'grant' ? button(doc, { label: 'Autoriser', kind: 'primary', onClick: handlers.grantAccess }) : null,
          hero.action === 'manage' && handlers.openFull ? button(doc, { label: 'Gérer mes clés', kind: 'primary', onClick: handlers.openFull }) : null,
          hero.action === 'open' && handlers.openSynco ? button(doc, { label: 'Ouvrir Synco', kind: 'primary', onClick: handlers.openSynco }) : null,
        )
      : null;

  return h(doc, 'div', { class: 'vault-popup' },
    status,
    handlers.toggleHelp
      ? h(doc, 'div', { class: 'help-row' },
          button(doc, { label: state.help ? 'Masquer' : 'Comment ça marche ?', icon: 'info-circle-fill', small: true, onClick: handlers.toggleHelp, ariaLabel: state.help ? 'Masquer l\'explication' : 'Comment ça marche ?' }),
        )
      : null,
    help,
  );
}

function renderVaultFull({ doc, now, state, handlers }: ModuleContext): HTMLElement {
  const s = state.options;
  const loading = s.status === 'loading';

  const hostRows = s.hosts.map((host) =>
    h(doc, 'li', {},
      h(doc, 'div', { class: 'row wrap' },
        tile(doc, 'globe2', host.granted ? 'primary' : 'warn'),
        h(doc, 'div', { class: 'grow' }, h(doc, 'div', { class: 'mono', text: host.origin }), h(doc, 'div', { class: 'chips' }, chip(doc, host.granted ? 'ok' : 'bad', host.granted ? 'Accès accordé' : 'Accès refusé'))),
        host.granted ? null : button(doc, { label: 'Accorder l\'accès', kind: 'primary', small: true, onClick: handlers.grantAccess }),
      ),
    ),
  );

  const entryRow = (e: VaultEntry, active: boolean) =>
    h(doc, 'li', {},
      h(doc, 'div', { class: 'row wrap' },
        tile(doc, 'key-fill', e.readable ? 'primary' : 'warn'),
        h(doc, 'div', { class: 'grow' },
          h(doc, 'strong', { text: `Appareil ${shortId(e.deviceId)}` }),
          h(doc, 'div', { class: 'muted', text: e.createdAt === null ? 'Date de création inconnue' : `Créé le ${formatDate(e.createdAt)}` }),
          h(doc, 'div', { class: 'chips' }, ...entryStatus(doc, e, active, now)),
        ),
        button(doc, {
          label: 'Supprimer', kind: 'danger', small: true, icon: 'trash3',
          ariaLabel: `Supprimer la clé de l'appareil ${shortId(e.deviceId)} pour ${e.origin}`,
          onClick: () => handlers.askRemove(e.origin, e.deviceId),
        }),
      ),
    );

  const keys: Child[] =
    s.groups.length === 0
      ? [emptyState(doc, 'key-fill', 'Aucune clé enregistrée', 'Quand vous choisirez ce coffre depuis Synco, la clé de votre appareil apparaîtra ici.')]
      : s.groups.map((g) => h(doc, 'div', {}, h(doc, 'h3', { class: 'group-title', text: g.origin }), h(doc, 'ul', { class: 'list' }, ...g.entries.map((e) => entryRow(e, g.active)))));

  const point = (text: string) => h(doc, 'li', {}, icon(doc, 'shield-check'), h(doc, 'span', { text }));
  const about = card(doc, { title: 'À savoir', icon: 'info-circle-fill' },
        h(doc, 'ul', { class: 'points' },
          point('Cette extension garde une clé locale par appareil. Elle n\'est jamais envoyée à Synco, et le site ne l\'obtient qu\'avec votre accord dans la fenêtre de l\'extension.'),
          point('Ce n\'est pas un gestionnaire de passkeys : elle ne répond à aucun autre site que Synco.'),
          point('La clé n\'est pas protégée par du matériel : quelqu\'un qui utilise votre session ou copie votre profil de navigateur peut l\'obtenir. Verrouillez votre ordinateur quand vous le quittez.'),
          point('Supprimer une clé : l\'appareil devra être relié de nouveau depuis Synco.'),
        ),
      );

  const dialog = s.confirm
    ? h(doc, 'div', { class: 'overlay' },
        h(doc, 'div', { class: 'dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-body' } },
          h(doc, 'div', { class: 'dialog-head' }, tile(doc, 'exclamation-triangle-fill'), h(doc, 'h2', { text: 'Supprimer cette clé ?', attrs: { id: 'confirm-title' } })),
          h(doc, 'p', { attrs: { id: 'confirm-body' } },
            `La clé de l'appareil ${shortId(s.confirm.deviceId)} pour `,
            h(doc, 'span', { class: 'mono', text: s.confirm.origin }),
            ' sera effacée de l\'extension. Cet appareil devra être relié de nouveau depuis Synco. Cette action est irréversible.',
          ),
          h(doc, 'div', { class: 'actions' },
            button(doc, { label: 'Annuler', autofocus: true, onClick: handlers.cancelRemove }),
            button(doc, { label: s.busy ? 'Suppression…' : 'Supprimer', kind: 'danger', disabled: s.busy, onClick: handlers.confirmRemove }),
          ),
        ),
      )
    : null;

  return h(doc, 'div', { class: 'stack' },
    panelHeader(doc, 'Coffre de clés', 'Garde la clé de vos appareils Synco hors de la page : l\'accès s\'autorise dans une fenêtre de l\'extension.'),
    card(doc, { title: 'Accès aux sites Synco', icon: 'globe2' },
      h(doc, 'p', { class: 'muted', text: 'L\'extension ne répond qu\'à ces adresses exactes. Selon votre navigateur, cet accès doit être accordé par vous : sans lui, Synco ne peut pas utiliser l\'extension.' }),
      h(doc, 'div', { class: 'stack' }, loading ? skeleton(doc) : h(doc, 'ul', { class: 'list' }, ...hostRows)),
    ),
    card(doc, { title: 'Clés enregistrées', icon: 'key-fill' }, ...(loading ? [skeleton(doc)] : keys)),
    about,
    dialog,
  );
}

