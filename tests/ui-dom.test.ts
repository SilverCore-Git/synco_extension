import { describe, expect, test } from 'bun:test';
import { h, mount } from '../src/ui/dom';
import { asEl, fakeDoc, FakeElement } from './helpers/fakeDom';

const doc = fakeDoc();
const HOSTILE = '<img src=x onerror=alert(1)><script>alert(2)</script>';

describe('construction du DOM sans HTML', () => {
  test('du HTML dans un texte reste un simple texte (textContent)', () => {
    const el = asEl(h(doc, 'p', { text: HOSTILE }));
    expect(el.textContent).toBe(HOSTILE);
    expect(el.children).toHaveLength(1);
    expect(el.findAll((e) => e.tagName === 'img' || e.tagName === 'script')).toEqual([]);
  });

  test('un enfant de type chaîne devient un nœud texte, jamais du HTML', () => {
    const el = asEl(h(doc, 'div', {}, HOSTILE, null, false, undefined));
    expect(el.children).toHaveLength(1);
    expect(el.findAll((e) => e.tagName === 'img')).toEqual([]);
  });

  test('innerHTML est inutilisable dans le faux DOM : toute tentative ferait échouer les tests', () => {
    expect(() => {
      asEl(h(doc, 'div')).innerHTML = '<b>x</b>';
    }).toThrow();
  });

  test.each(['onclick', 'onerror', 'style', 'href', 'src', 'srcdoc', 'formaction', 'ONCLICK'])('attribut %s interdit', (name) => {
    expect(() => h(doc, 'div', { attrs: { [name]: 'x' } })).toThrow(/interdit/);
  });

  test('attributs autorisés : aria-*, data-*, type, disabled (booléen)', () => {
    const el = asEl(h(doc, 'button', { attrs: { type: 'button', 'aria-label': 'x', 'data-autofocus': '', disabled: true, hidden: false } }));
    expect(el.getAttribute('type')).toBe('button');
    expect(el.getAttribute('aria-label')).toBe('x');
    expect(el.attrs.has('data-autofocus')).toBe(true);
    expect(el.getAttribute('disabled')).toBe('');
    expect(el.attrs.has('hidden')).toBe(false);
  });

  test('événements et remplacement du contenu', () => {
    let clicks = 0;
    const b = asEl(h(doc, 'button', { on: { click: () => clicks++ } }));
    b.click();
    expect(clicks).toBe(1);
    const root = asEl(h(doc, 'div', {}, 'ancien'));
    mount(root as unknown as Element, h(doc, 'span', { text: 'nouveau' }));
    expect(root.textContent).toBe('nouveau');
    expect(root).toBeInstanceOf(FakeElement);
  });
});
