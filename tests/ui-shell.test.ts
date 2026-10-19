import { describe, expect, test } from 'bun:test';
import { pickActive, renderApp } from '../src/ui/app';
import { h } from '../src/ui/dom';
import type { ModuleContext, UiModule, UiState } from '../src/ui/modules';
import type { OptionsState } from '../src/ui/options/model';
import { renderShell } from '../src/ui/shell';
import { asEl, fakeDoc, type FakeElement } from './helpers/fakeDom';

const opts: OptionsState = { status: 'ready', error: null, notice: null, version: '9.9.9', hosts: [], broad: false, groups: [], confirm: null, busy: false };
const state: UiState = { options: opts, draft: null };
const handlers = { grantAccess() {}, askRemove() {}, cancelRemove() {}, confirmRemove() {} };

const mod = (id: string, over: Partial<UiModule> = {}): UiModule => ({
  id, title: `Titre ${id}`, icon: 'key-fill',
  render: ({ doc }: ModuleContext) => h(doc, 'p', { text: `contenu ${id}` }),
  ...over,
});

const app = (modules: UiModule[], active: string | null = null, surface: 'popup' | 'options' = 'options', onSelect: (id: string) => void = () => {}) =>
  asEl(renderApp({ doc: fakeDoc(), surface, state, handlers, version: '9.9.9', active, onSelect, modules, now: 0 }));
const tabs = (root: FakeElement) => root.findAll((e) => e.getAttribute('role') === 'tab');

describe('interface modulaire', () => {
  test('un onglet par module visible, dans l\'ordre ; seul le contenu du module actif est affiché', () => {
    const root = app([mod('a'), mod('b'), mod('c')], 'b');
    expect(tabs(root).map((t) => t.textContent)).toEqual(['Titre a', 'Titre b', 'Titre c']);
    expect(root.textContent).toContain('contenu b');
    expect(root.textContent).not.toContain('contenu a');
    expect(root.textContent).not.toContain('contenu c');
  });

  test('un module sans contenu pour cette surface disparaît des onglets', () => {
    const root = app([mod('a'), mod('b', { render: () => null })], 'a');
    expect(tabs(root)).toEqual([]); // un seul module visible : pas de barre d'onglets
    expect(root.textContent).toContain('contenu a');
  });

  test('un module qui plante est remplacé par un message, les autres continuent', () => {
    const root = app([mod('a', { render: () => { throw new Error('boum'); } }), mod('b')], 'a');
    expect(root.textContent).toContain('Le module « Titre a » n\'a pas pu s\'afficher.');
    expect(root.textContent).not.toContain('boum');
    expect(tabs(root)).toHaveLength(2);
  });

  test('module actif : celui demandé, sinon le premier avec pastille, sinon le premier', () => {
    const r = (id: string, badge: unknown = null) => ({ module: { id }, badge });
    expect(pickActive([r('a'), r('b', { text: '1' })], 'a')).toBe('a');
    expect(pickActive([r('a'), r('b', { text: '1' })], null)).toBe('b');
    expect(pickActive([r('a'), r('b', { text: '1' })], 'inconnu')).toBe('b');
    expect(pickActive([r('a'), r('b')], null)).toBe('a');
    expect(pickActive([], null)).toBe('');
  });

  test('pastille d\'onglet affichée, avec son ton', () => {
    const root = app([mod('a', { badge: () => ({ text: '2', tone: 'warn' }) }), mod('b')], 'b');
    const badge = root.findAll((e) => (e.getAttribute('class') ?? '').startsWith('tab-badge'))[0]!;
    expect(badge.textContent).toBe('2');
    expect(badge.getAttribute('class')).toBe('tab-badge warn');
  });

  test('onglets accessibles : tablist, aria-selected, aria-controls, panneau relié, un seul tabindex 0', () => {
    const root = app([mod('a'), mod('b')], 'b');
    expect(root.findAll((e) => e.getAttribute('role') === 'tablist')).toHaveLength(1);
    const [ta, tb] = tabs(root);
    expect(ta!.getAttribute('aria-selected')).toBe('false');
    expect(tb!.getAttribute('aria-selected')).toBe('true');
    expect(ta!.getAttribute('tabindex')).toBe('-1');
    expect(tb!.getAttribute('tabindex')).toBe('0');
    const panel = root.findAll((e) => e.getAttribute('role') === 'tabpanel')[0]!;
    expect(panel.getAttribute('id')).toBe(tb!.getAttribute('aria-controls'));
    expect(panel.getAttribute('aria-labelledby')).toBe(tb!.getAttribute('id'));
  });

  test('sans onglets (un seul module), le panneau ne référence pas un onglet inexistant', () => {
    const root = app([mod('a')], 'a');
    expect(root.findAll((e) => e.getAttribute('role') === 'tabpanel')).toEqual([]);
  });

  test('clic et clavier : clic, flèches (avec retour), Début, Fin', () => {
    const picked: string[] = [];
    const root = app([mod('a'), mod('b'), mod('c')], 'a', 'options', (id) => picked.push(id));
    const [ta, , tc] = tabs(root);
    tc!.click();
    const key = (el: FakeElement, k: string) => {
      let prevented = false;
      for (const cb of el.listeners.get('keydown') ?? []) cb({ key: k, preventDefault: () => { prevented = true; } });
      return prevented;
    };
    expect(key(ta!, 'ArrowRight')).toBe(true);
    expect(key(ta!, 'ArrowLeft')).toBe(true); // a → c (retour)
    expect(key(tc!, 'Home')).toBe(true);
    expect(key(ta!, 'End')).toBe(true);
    expect(key(ta!, 'x')).toBe(false); // les autres touches ne sont pas détournées
    expect(picked).toEqual(['c', 'b', 'c', 'a', 'c']);
  });

  test('en-tête : logo, version ; réglages complets seulement sur le popup avec gestionnaire', () => {
    const popup = asEl(renderShell(fakeDoc(), { surface: 'popup', version: '1.0.0', tabs: [], active: '', banners: [], onSelect() {}, openFull: () => {} }));
    expect(popup.textContent).toContain('v1.0.0');
    expect(popup.findAll((e) => e.getAttribute('class') === 'wordmark')).toHaveLength(1);
    expect(popup.findAll((e) => e.getAttribute('aria-label') === 'Ouvrir tous les réglages')).toHaveLength(1);
    const options = asEl(renderShell(fakeDoc(), { surface: 'options', version: '1.0.0', tabs: [], active: '', banners: [], onSelect() {}, openFull: () => {} }));
    expect(options.findAll((e) => e.getAttribute('aria-label') === 'Ouvrir tous les réglages')).toEqual([]);
  });

  test('registre réel : le coffre est le premier module, les actions de page le second', async () => {
    const { MODULES } = await import('../src/ui/registry');
    expect(MODULES.map((m) => m.id)).toEqual(['vault', 'tasks']);
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
    for (const m of MODULES) expect(m.id).toMatch(/^[a-z][a-z-]*$/);
  });

  test('brouillon en attente : pastille sur l\'onglet Tâches, ouvert par défaut dans le popup', async () => {
    const { MODULES } = await import('../src/ui/registry');
    const draft = { v: 1 as const, text: 'Appeler', url: '', title: '', capturedAt: 0 };
    const root = asEl(renderApp({ doc: fakeDoc(), surface: 'popup', state: { options: opts, draft }, handlers, version: '1', active: null, onSelect() {}, modules: MODULES, now: 0 }));
    const selected = tabs(root).filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected.map((t) => t.textContent)).toEqual(['Tâches1']);
    expect(root.textContent).toContain('Brouillon de tâche en attente');
  });
});
