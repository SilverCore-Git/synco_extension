import { describe, expect, test } from 'bun:test';
import { authenticateSender, isExtensionPage } from '../src/background/auth';
import { isAllowedOrigin } from '../src/shared/origins';
import { ALLOWED, BASE, EXT_ID, optionsSender, pageSender, promptSender } from './helpers/bgFixtures';
import { ORIGIN, OTHER_ORIGIN } from './helpers/vaultFixtures';

const ctx = { allowedOrigins: ALLOWED, extensionId: EXT_ID };
const auth = (sender: Parameters<typeof authenticateSender>[0]) => authenticateSender(sender, ctx);
const reason = (sender: Parameters<typeof authenticateSender>[0]) => {
  const r = auth(sender);
  return r.ok ? 'ok' : r.reason;
};

describe('authentification de l\'appelant sur sender', () => {
  test('origine de la liste blanche, cadre principal, onglet connu : accepté', () => {
    expect(auth(pageSender())).toEqual({ ok: true, origin: ORIGIN, tabId: 7 });
    expect(auth(pageSender(OTHER_ORIGIN))).toEqual({ ok: true, origin: OTHER_ORIGIN, tabId: 7 });
  });

  test.each([
    'https://evil.example',
    'https://app.synco.one.evil.example', // préfixe
    'https://evil.app.synco.one', // sous-domaine implicite
    'https://sub.app.synco.one',
    'https://app.synco.one:444', // autre port
    'https://localhost:5175',
    'http://app.synco.one', // schéma
    'http://localhost:5174',
  ])('origine non autorisée : %s', (origin) => {
    expect(reason(pageSender(origin))).toBe('origin-not-allowed');
  });

  test('hôte en majuscules : refusé (le navigateur normalise, toute divergence est suspecte)', () => {
    expect(auth(pageSender('https://APP.synco.one')).ok).toBe(false);
  });

  test('URL à identifiants : l\'origine réelle est celle de l\'hôte, pas du texte avant @', () => {
    expect(reason({ ...pageSender(), origin: undefined, url: 'https://app.synco.one@evil.example/' })).toBe('origin-not-allowed');
  });

  test('iframe : refusé (frameId ≠ 0), y compris dans un onglet Synco légitime', () => {
    expect(reason(pageSender(ORIGIN, { frameId: 3 }))).toBe('not-top-frame');
    expect(reason(pageSender(ORIGIN, { frameId: undefined }))).toBe('not-top-frame');
  });

  test('sans onglet (page d\'extension, worker…) : refusé', () => {
    expect(reason(pageSender(ORIGIN, { tab: undefined }))).toBe('no-tab');
    expect(reason(pageSender(ORIGIN, { tab: {} }))).toBe('no-tab');
    expect(reason(pageSender(ORIGIN, { tab: { id: -1 } }))).toBe('no-tab');
  });

  test('autre extension, ou extension inconnue : refusé', () => {
    expect(reason(pageSender(ORIGIN, { id: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }))).toBe('foreign-extension');
    expect(reason(pageSender(ORIGIN, { id: undefined }))).toBe('foreign-extension');
    expect(authenticateSender(pageSender(), { allowedOrigins: ALLOWED, extensionId: '' }).ok).toBe(false);
  });

  test('sender.origin et sender.url qui divergent : refusé', () => {
    expect(reason({ ...pageSender(), origin: ORIGIN, url: `${OTHER_ORIGIN}/` })).toBe('origin-mismatch');
  });

  test('origine déduite de sender.url quand sender.origin est absent (Firefox ancien)', () => {
    expect(auth({ ...pageSender(), origin: undefined })).toEqual({ ok: true, origin: ORIGIN, tabId: 7 });
  });

  test('ni origine ni URL, URL illisible, origine opaque : refusé', () => {
    expect(reason({ ...pageSender(), origin: undefined, url: undefined })).toBe('no-origin');
    expect(reason({ ...pageSender(), origin: undefined, url: 'pas une url' })).toBe('bad-url');
    expect(reason({ ...pageSender(), origin: 'null', url: undefined })).toBe('origin-not-allowed');
    expect(reason({ ...pageSender(), origin: undefined, url: 'data:text/html,x' })).toBe('origin-not-allowed');
  });

  test('pas d\'expéditeur : refusé', () => {
    expect(reason(undefined)).toBe('no-sender');
  });

  test('liste blanche vide : tout est refusé', () => {
    expect(authenticateSender(pageSender(), { allowedOrigins: [], extensionId: EXT_ID }).ok).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  test('jamais de joker, jamais de sous-domaine implicite', () => {
    expect(isAllowedOrigin('https://app.synco.one', ['https://app.synco.one'])).toBe(true);
    expect(isAllowedOrigin('https://x.synco.one', ['https://*.synco.one'])).toBe(false);
    expect(isAllowedOrigin('https://x.synco.one', ['https://synco.one'])).toBe(false);
    expect(isAllowedOrigin('https://app.synco.one/', ['https://app.synco.one'])).toBe(false);
    expect(isAllowedOrigin(undefined, ['https://app.synco.one'])).toBe(false);
  });
});

describe('pages de l\'extension', () => {
  const pctx = { extensionId: EXT_ID, baseUrl: BASE };

  test('prompt.html et options.html sont reconnues, chacune pour elle-même', () => {
    expect(isExtensionPage(promptSender(), pctx, 'prompt.html')).toBe(true);
    expect(isExtensionPage(promptSender(), pctx, 'options.html')).toBe(false);
    expect(isExtensionPage(optionsSender(), pctx, 'options.html')).toBe(true);
    expect(isExtensionPage(optionsSender(), pctx, 'prompt.html')).toBe(false);
  });

  test.each([
    ['page web qui prétend être l\'invite', { url: 'https://app.synco.one/prompt.html' }],
    ['page web à chemin imité', { url: `https://evil.example/${BASE}prompt.html` }],
    ['autre extension', { id: 'zzzz', url: 'chrome-extension://zzzz/prompt.html' }],
    ['autre page de la même extension', { url: `${BASE}other.html` }],
    ['sous-chemin', { url: `${BASE}x/prompt.html` }],
    ['sans URL', { url: undefined }],
  ])('refuse : %s', (_name, over) => {
    expect(isExtensionPage(promptSender('0'.repeat(32), over), pctx, 'prompt.html')).toBe(false);
  });
});
