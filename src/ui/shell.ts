import { h } from './dom';
import { iconButton, icon, wordmark } from './kit';
import type { IconName } from './kit';
import type { Surface } from './modules';

export interface ShellTab {
  id: string;
  title: string;
  icon: IconName;
  badge: { text: string; tone: 'primary' | 'warn' } | null;
  content: HTMLElement;
}

export interface ShellProps {
  surface: Surface;
  version: string;
  tabs: ShellTab[];
  active: string;
  /** Messages d'ensemble (erreur, confirmation), affichés au-dessus du contenu. */
  banners: HTMLElement[];
  onSelect(id: string): void;
  /** Popup : ouvre la page d'options complète. */
  openFull?: (() => void) | undefined;
}

const tabId = (id: string) => `tab-${id}`;
const panelId = (id: string) => `panel-${id}`;

/**
 * Cadre commun : en-tête (logo, version), onglets (un par module visible), contenu du module actif.
 * Un seul module visible : pas d'onglets. Les onglets suivent le motif ARIA « tablist » : flèches, Début, Fin.
 */
export function renderShell(doc: Document, p: ShellProps): HTMLElement {
  const current = p.tabs.find((t) => t.id === p.active) ?? p.tabs[0];

  const topbar = h(
    doc,
    'header',
    { class: 'topbar' },
    wordmark(doc),
    p.surface === 'popup' ? null : h(doc, 'span', { class: 'chip chip-off', text: `v${p.version}` }),
    h(doc, 'span', { class: 'grow' }),
    p.surface === 'popup' && p.openFull ? iconButton(doc, 'gear-fill', 'Ouvrir tous les réglages', p.openFull) : null,
  );

  const move = (from: number, delta: number | 'start' | 'end') => {
    const n = p.tabs.length;
    const to = delta === 'start' ? 0 : delta === 'end' ? n - 1 : (from + delta + n) % n;
    const target = p.tabs[to];
    if (target) p.onSelect(target.id);
  };

  const tabButtons = p.tabs.map((t, i) =>
    h(
      doc,
      'button',
      {
        class: 'tab',
        attrs: {
          type: 'button',
          role: 'tab',
          id: tabId(t.id),
          'aria-selected': t.id === current?.id ? 'true' : 'false',
          'aria-controls': panelId(t.id),
          tabindex: t.id === current?.id ? '0' : '-1',
        },
        on: {
          click: () => p.onSelect(t.id),
          keydown: (e) => {
            const key = (e as KeyboardEvent).key;
            const dir = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : key === 'Home' ? 'start' : key === 'End' ? 'end' : null;
            if (dir === null) return;
            e.preventDefault();
            move(i, dir);
          },
        },
      },
      icon(doc, t.icon),
      t.title,
      t.badge ? h(doc, 'span', { class: t.badge.tone === 'warn' ? 'tab-badge warn' : 'tab-badge', text: t.badge.text }) : null,
    ),
  );

  const tabs = p.tabs.length > 1 ? h(doc, 'nav', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Fonctions de l\'extension' } }, ...tabButtons) : null;

  const main = h(
    doc,
    'main',
    { class: 'main', attrs: current && p.tabs.length > 1 ? { id: panelId(current.id), role: 'tabpanel', 'aria-labelledby': tabId(current.id) } : {} },
    h(doc, 'div', { class: 'content' }, ...p.banners, current?.content),
  );

  return h(doc, 'div', { class: 'shell' }, topbar, tabs, main);
}
