import { describe, expect, test } from 'bun:test';
import { buildDraft, cleanUrl, LIMITS, parseDraft, parseMessage, toMessage } from '../src/page-actions/contract';

const NOW = 1_800_000_000_000;
const build = (over: Record<string, unknown> = {}) => buildDraft({ selectionText: 'Appeler le client', pageUrl: 'https://exemple.fr/a?b=1', title: 'Une page', ...over }, NOW);
const draftOf = (over: Record<string, unknown> = {}) => {
  const r = build(over);
  if (!r.ok) throw new Error('brouillon refusé');
  return r.draft;
};

describe('brouillon de tâche : construction', () => {
  test('sélection, URL et titre de la page', () => {
    expect(draftOf()).toEqual({ v: 1, text: 'Appeler le client', url: 'https://exemple.fr/a?b=1', title: 'Une page', capturedAt: NOW });
  });

  test.each([[undefined], [null], [''], ['   '], ['\n\t '], [42], [{}], [['x']]])('sans texte exploitable (%p) : rien n\'est créé', (selectionText) => {
    expect(build({ selectionText })).toEqual({ ok: false, reason: 'no-selection' });
  });

  test('texte : contrôles et marques bidi neutralisés, lignes conservées, blancs normalisés', () => {
    expect(draftOf({ selectionText: 'a\u0000b‮c\r\nd\n\n\n\ne  \t f' }).text).toBe('a b c\nd\n\ne f');
  });

  test('du HTML ou du script dans la sélection reste du texte inerte', () => {
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    expect(draftOf({ selectionText: hostile }).text).toBe(hostile); // jamais interprété : les vues utilisent textContent
  });

  test('plafonds : texte, titre (une seule ligne) et pas de coupure au milieu d\'un caractère', () => {
    expect(Array.from(draftOf({ selectionText: 'a'.repeat(10_000) }).text)).toHaveLength(LIMITS.text);
    expect(draftOf({ selectionText: 'a'.repeat(10_000) }).text.endsWith('…')).toBe(true);
    const title = draftOf({ title: 'ligne1\nligne2 ' + 'b'.repeat(1000) }).title;
    expect(title).not.toContain('\n');
    expect(Array.from(title)).toHaveLength(LIMITS.title);
    const emojis = draftOf({ selectionText: '😀'.repeat(LIMITS.text + 50) }).text;
    expect(Array.from(emojis)).toHaveLength(LIMITS.text);
    expect(emojis).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // pas de moitié de paire orpheline
  });

  test('titre absent ou de mauvais type : vide', () => {
    expect(draftOf({ title: undefined }).title).toBe('');
    expect(draftOf({ title: 12 }).title).toBe('');
  });
});

describe('URL de la page', () => {
  test.each([
    ['https://exemple.fr/p?q=1#h', 'https://exemple.fr/p?q=1#h'],
    ['http://exemple.fr', 'http://exemple.fr/'],
    ['https://user:secret@exemple.fr/p', 'https://exemple.fr/p'], // identifiants retirés
  ])('%s → %s', (input, out) => {
    expect(cleanUrl(input)).toBe(out);
  });

  test.each(['javascript:alert(1)', 'data:text/html,<b>x', 'file:///etc/passwd', 'chrome://extensions', 'moz-extension://x/y', 'ftp://x', 'pas une url', '', undefined, null, 42])(
    'refusée : %p',
    (input) => {
      expect(cleanUrl(input)).toBe('');
    },
  );

  test('trop longue : requête et fragment retirés, puis abandonnée', () => {
    const long = `https://exemple.fr/p?${'a'.repeat(3000)}#frag`;
    expect(cleanUrl(long)).toBe('https://exemple.fr/p');
    expect(cleanUrl(`https://exemple.fr/${'a'.repeat(3000)}`)).toBe('');
  });

  test('URL inutilisable : le brouillon est quand même créé, sans URL', () => {
    expect(draftOf({ pageUrl: 'javascript:alert(1)' }).url).toBe('');
  });
});

describe('relecture stricte (stockage, message)', () => {
  test('un brouillon valide survit à parseDraft, reconstruit', () => {
    const d = draftOf();
    expect(parseDraft(d)).toEqual(d);
    expect(parseDraft(d)).not.toBe(d);
  });

  test.each([
    ['version inconnue', { v: 2 }],
    ['champ en trop', { extra: 1 }],
    ['texte vide', { text: '' }],
    ['texte non nettoyé (contrôle)', { text: 'a\u0000b' }],
    ['texte trop long', { text: 'a'.repeat(LIMITS.text + 1) }],
    ['URL javascript:', { url: 'javascript:alert(1)' }],
    ['URL avec identifiants', { url: 'https://u:p@exemple.fr/' }],
    ['URL non canonique', { url: 'https://EXEMPLE.fr' }],
    ['titre multiligne', { title: 'a\nb' }],
    ['date non finie', { capturedAt: Infinity }],
    ['date en texte', { capturedAt: '1' }],
  ])('refuse : %s', (_name, patch) => {
    expect(parseDraft({ ...draftOf(), ...patch })).toBeNull();
  });

  test.each([[null], [undefined], ['x'], [1], [[]], [[1]]])('refuse une valeur qui n\'est pas un objet : %p', (v) => {
    expect(parseDraft(v)).toBeNull();
    expect(parseMessage(v)).toBeNull();
  });

  test('un champ manquant est refusé', () => {
    const { title: _t, ...rest } = draftOf();
    expect(parseDraft(rest)).toBeNull();
  });

  test('message de transmission : aller-retour, et tout écart est refusé', () => {
    const msg = toMessage(draftOf());
    expect(msg).toMatchObject({ kind: 'synco-page-action', v: 1, action: 'create-task' });
    expect(parseMessage(msg)).toEqual(msg);
    for (const bad of [{ ...msg, kind: 'autre' }, { ...msg, v: 2 }, { ...msg, action: 'delete-all' }, { ...msg, extra: 1 }, { ...msg, draft: { ...msg.draft, text: '' } }]) {
      expect(parseMessage(bad)).toBeNull();
    }
  });
});
