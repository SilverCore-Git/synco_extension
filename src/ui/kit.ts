/**
 * Composants de l'interface, à l'image de ceux de l'application Synco (boutons, pastilles, cartes, bandeaux).
 * Tout passe par `h()` : aucun HTML interprété, attributs en liste fermée. Les styles sont dans ui.css.
 */
import { h, type Child } from './dom';

/** Icônes disponibles : les fichiers de assets/vendor/bootstrap-icons (voir scripts/make-ui-assets.mjs). */
export type IconName =
  | 'shield-lock-fill' | 'shield-check' | 'key-fill' | 'globe2' | 'trash3' | 'gear-fill'
  | 'hourglass-split' | 'info-circle-fill' | 'exclamation-triangle-fill' | 'x-circle-fill' | 'card-checklist';

export type Tone = 'ok' | 'warn' | 'bad' | 'off';

/** Icône décorative (masquée aux lecteurs d'écran) ; avec `label`, elle est annoncée. */
export function icon(doc: Document, name: IconName, label?: string): HTMLElement {
  return h(doc, 'span', {
    class: `bi bi-${name}`,
    attrs: label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' },
  });
}

/** Pastille d'état (« Prêt », « Accès accordé »…). */
export const chip = (doc: Document, tone: Tone, text: string): HTMLElement => h(doc, 'span', { class: `chip chip-${tone}`, text });

/** Pastille d'une icône dans un carré arrondi, comme les cartes d'appareils de l'application. */
export const tile = (doc: Document, name: IconName, tone: 'muted' | 'primary' | 'warn' = 'muted'): HTMLElement =>
  h(doc, 'span', { class: tone === 'muted' ? 'tile' : `tile ${tone}` }, icon(doc, name));

export interface ButtonProps {
  label: string;
  onClick: () => void;
  kind?: 'primary' | 'second' | 'default' | 'danger';
  icon?: IconName;
  small?: boolean;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
  autofocus?: boolean;
}

/** Le libellé est un enfant (pas `text`) : l'icône éventuelle reste à côté, et `textContent` du bouton = le libellé. */
export function button(doc: Document, p: ButtonProps): HTMLButtonElement {
  const classes = [p.kind ?? 'default', p.small ? 'small' : '', p.busy ? 'busy' : ''].filter(Boolean).join(' ');
  return h(
    doc,
    'button',
    {
      class: classes,
      attrs: {
        type: 'button',
        disabled: p.disabled === true || p.busy === true,
        'aria-label': p.ariaLabel ?? false,
        'aria-busy': p.busy ? 'true' : false,
        'data-autofocus': p.autofocus ? '' : false,
      },
      on: { click: p.onClick },
    },
    p.icon ? icon(doc, p.icon) : null,
    p.label,
  );
}

/** Bouton d'icône seule : le libellé accessible est obligatoire. */
export const iconButton = (doc: Document, name: IconName, label: string, onClick: () => void): HTMLButtonElement =>
  h(doc, 'button', { class: 'icon-only', attrs: { type: 'button', 'aria-label': label, title: label }, on: { click: onClick } }, icon(doc, name));

export type BannerKind = 'info' | 'warn' | 'error';
const BANNER_ICON: Record<BannerKind, IconName> = { info: 'info-circle-fill', warn: 'exclamation-triangle-fill', error: 'x-circle-fill' };

/** Bandeau de message. `error` est annoncé tout de suite (role=alert), les autres poliment (role=status). */
export function banner(doc: Document, kind: BannerKind, text: string): HTMLElement {
  return h(
    doc,
    'p',
    { class: `banner ${kind}`, attrs: kind === 'error' ? { role: 'alert' } : { role: 'status', 'aria-live': 'polite' } },
    icon(doc, BANNER_ICON[kind]),
    h(doc, 'span', { text }),
  );
}

/** Carte avec son petit titre en capitales, comme les sections des réglages de l'application. */
export function card(doc: Document, p: { title?: string; icon?: IconName; accent?: boolean; label?: string }, ...children: Child[]): HTMLElement {
  return h(
    doc,
    'section',
    { class: p.accent ? 'card accent' : 'card', attrs: p.label ? { 'aria-label': p.label } : {} },
    p.title ? h(doc, 'h2', {}, p.icon ? icon(doc, p.icon) : null, p.title) : null,
    ...children,
  );
}

/** Titre d'un module : grand titre et une phrase d'explication. */
export const panelHeader = (doc: Document, title: string, description?: string): HTMLElement =>
  h(doc, 'header', { class: 'panel-head' }, h(doc, 'h1', { class: 'panel-title', text: title }), description ? h(doc, 'p', { class: 'muted', text: description }) : null);

/** État vide : une icône, ce qui se passe, et quoi faire. */
export const emptyState = (doc: Document, name: IconName, title: string, text: string): HTMLElement =>
  h(doc, 'div', { class: 'empty' }, tile(doc, name, 'primary'), h(doc, 'strong', { text: title }), h(doc, 'p', { class: 'muted', text }));

/** Emplacement de chargement : des barres, pas un texte qui saute. */
export const skeleton = (doc: Document): HTMLElement =>
  h(doc, 'div', { attrs: { 'aria-hidden': 'true' } }, h(doc, 'div', { class: 'skeleton' }), h(doc, 'div', { class: 'skeleton' }));

/** Logo « Synco. » (masque CSS : lettres à la couleur du texte, point vert). */
export const wordmark = (doc: Document): HTMLElement => h(doc, 'span', { class: 'wordmark', attrs: { role: 'img', 'aria-label': 'Synco' } });
