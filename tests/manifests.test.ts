import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { assertNoLocalOrigins, buildManifest, originsFor, validateOrigin } from '../scripts/lib/manifest.mjs';

const read = (rel: string) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const config = read('config/origins.json');
const base = read('manifests/base.json');
const targets = { chrome: read('manifests/chrome.json'), firefox: read('manifests/firefox.json') };

type Name = 'chrome' | 'firefox';
const gen = (targetName: Name, mode: 'prod' | 'dev'): any =>
  buildManifest({ base, target: targets[targetName], targetName, mode, version: '1.2.3', origins: originsFor(config, mode) });

const combos: [Name, 'prod' | 'dev'][] = [
  ['chrome', 'prod'],
  ['chrome', 'dev'],
  ['firefox', 'prod'],
  ['firefox', 'dev'],
];

describe('validation des origines', () => {
  test.each([
    'https://*.synco.one',
    'https://synco.one/',
    'https://synco.one/chemin',
    'http://app.synco.one',
    'https://app.synco.one:',
    'https://user@app.synco.one',
    'app.synco.one',
    'https://APP.synco.one',
    '*',
    '<all_urls>',
    '',
    42,
  ])('refuse %p', (origin) => {
    expect(() => validateOrigin(origin)).toThrow();
  });

  test.each(['https://app.synco.one', 'https://localhost:5174', 'https://a.b.c:8443'])('accepte %s', (origin) => {
    expect(validateOrigin(origin)).toBe(origin);
  });

  test('refuse les doublons, un mode inconnu et une liste vide', () => {
    expect(() => originsFor({ production: ['https://a.one', 'https://a.one'], development: [] }, 'prod')).toThrow();
    expect(() => originsFor({ production: ['https://a.one'], development: [] }, 'staging' as never)).toThrow();
    expect(() => originsFor({ production: [], development: [] }, 'prod')).toThrow();
  });

  test('la configuration réelle ne contient aucun joker', () => {
    for (const o of [...config.production, ...config.development]) expect(o).not.toContain('*');
  });
});

describe.each(combos)('manifeste %s (%s)', (targetName, mode) => {
  const m = gen(targetName, mode);

  test('Manifest V3, version injectée, CSP stricte', () => {
    expect(m.manifest_version).toBe(3);
    expect(m.version).toBe('1.2.3');
    expect(m.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'none'");
  });

  test('content script limité aux origines exactes, monde isolé, cadre principal seul', () => {
    expect(m.content_scripts).toHaveLength(1);
    const cs = m.content_scripts[0];
    expect(cs.matches).toEqual(originsFor(config, mode).map((o: string) => `${o}/*`));
    expect(cs.all_frames).toBe(false);
    expect(cs.match_about_blank).toBe(false);
    expect(cs.world).toBeUndefined();
    for (const match of cs.matches) expect(match).not.toMatch(/\*[^/]|<all_urls>|^\*|http:/);
  });

  test('aucune permission large requise à l\'installation, pas de externally_connectable', () => {
    const text = JSON.stringify(m);
    expect(text).not.toContain('<all_urls>');
    expect(m.host_permissions).toBeUndefined();
    expect(m.externally_connectable).toBeUndefined();
    expect(m.permissions).not.toContain('tabs');
    expect(m.permissions).not.toContain('offscreen');
  });

  test('mode de fond propre au navigateur', () => {
    if (targetName === 'chrome') {
      expect(m.background).toEqual({ service_worker: 'background.js' });
    } else {
      expect(m.background).toEqual({ scripts: ['background.js'] });
      const gecko = m.browser_specific_settings.gecko;
      expect(gecko.id).toMatch(/^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/);
      expect(gecko.data_collection_permissions.required).toEqual(['none']);
    }
  });
});

describe('séparation prod / dev', () => {
  test.each(['chrome', 'firefox'] as Name[])('le paquet de production %s ne contient aucune origine locale', (t) => {
    const text = JSON.stringify(gen(t, 'prod'));
    expect(text).not.toMatch(/localhost|127\.0\.0\.1|\[::1\]/);
    expect(text).toContain('https://app.synco.one/*');
  });

  test.each(['chrome', 'firefox'] as Name[])('le build dev %s n\'autorise que les origines de développement', (t) => {
    const matches = gen(t, 'dev').content_scripts[0].matches;
    expect(matches).toEqual(['https://localhost:5174/*']);
  });

  test('le build dev est identifiable et ne partage pas l\'identifiant Firefox', () => {
    const dev = gen('firefox', 'dev');
    const prod = gen('firefox', 'prod');
    expect(dev.name).toContain('(dev)');
    expect(dev.browser_specific_settings.gecko.id).not.toBe(prod.browser_specific_settings.gecko.id);
  });

  test('la garde refuse une origine locale glissée dans un paquet de production', () => {
    expect(() => assertNoLocalOrigins('{"matches":["https://localhost:5174/*"]}', 'x')).toThrow();
    expect(() => assertNoLocalOrigins('const o = "https://127.0.0.1:8443";', 'x')).toThrow();
    expect(() => assertNoLocalOrigins('{"matches":["https://app.synco.one/*"]}', 'x')).not.toThrow();
    // Une configuration de production polluée par une origine locale fait échouer l'assemblage.
    expect(() =>
      buildManifest({
        base,
        target: targets.chrome,
        targetName: 'chrome',
        mode: 'prod',
        version: '1.0.0',
        origins: ['https://localhost:5174'],
      }),
    ).toThrow();
  });

  test('Firefox sans identifiant gecko est refusé', () => {
    expect(() =>
      buildManifest({
        base,
        target: { background: { scripts: ['background.js'] } },
        targetName: 'firefox',
        mode: 'prod',
        version: '1.0.0',
        origins: ['https://app.synco.one'],
      }),
    ).toThrow();
  });
});
