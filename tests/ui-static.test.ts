import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { ENTRIES, STATIC } from '../scripts/lib/entries.mjs';
import { OPTIONS_PAGE, PROMPT_PAGE } from '../src/shared/protocol';

const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8');
const walk = (rel: string): string[] =>
  readdirSync(new URL(rel, root)).flatMap((n) => (statSync(new URL(`${rel}/${n}`, root)).isDirectory() ? walk(`${rel}/${n}`) : [`${rel}/${n}`]));
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const uiSources = walk('src/ui').filter((f) => f.endsWith('.ts'));
const htmlFiles = Object.values(STATIC).filter((f) => f.endsWith('.html'));

describe('interface : garde-fous statiques', () => {
  test('les sources de l\'interface sont analysées', () => {
    expect(uiSources.length).toBeGreaterThan(8);
  });

  test.each([
    ['dialogues natifs', /\b(alert|confirm|prompt)\s*\(/],
    ['injection HTML', /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/],
    ['exécution dynamique', /\b(eval|new Function)\b|setTimeout\(\s*['"`]|setInterval\(\s*['"`]/],
    ['journalisation', /\bconsole\s*\./],
    ['réseau', /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/],
    ['stockage web', /\b(localStorage|sessionStorage|indexedDB)\b/],
    ['gestionnaires en ligne', /\.on(click|error|load|submit)\s*=|setAttribute\(\s*['"]on/i],
  ])('aucun usage de : %s', (_name, re) => {
    for (const f of uiSources) expect({ f, hit: re.test(strip(read(f))) }).toEqual({ f, hit: false });
  });

  test('l\'interface n\'importe jamais le coffre à l\'exécution (types seulement)', () => {
    for (const f of uiSources) {
      for (const line of read(f).split('\n')) {
        if (/^\s*import\b/.test(line) && /(vault|background)\//.test(line)) {
          expect({ f, line, typeOnly: /^\s*import type\b/.test(line) }).toEqual({ f, line, typeOnly: true });
        }
      }
    }
  });
});

describe('pages HTML : CSP stricte (script-src \'self\')', () => {
  test.each(htmlFiles)('%s : aucun script ni style en ligne, aucune ressource distante', (file) => {
    const html = read(file);
    for (const m of html.matchAll(/<script\b([^>]*)>/gi)) expect(m[1]).toMatch(/\bsrc="[a-z.]+\.js"/);
    expect(html).not.toMatch(/<script[^>]*>\s*(?!<\/script>)\S/); // pas de contenu dans une balise <script>
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\s(on[a-z]+|style)\s*=/i);
    expect(html).not.toMatch(/(https?:)?\/\/[a-z]/i);
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<html lang="fr">');
  });

  test('les scripts et feuilles de style référencés sont bien produits par le build', () => {
    const produced = new Set([...Object.keys(ENTRIES).map((n) => `${n}.js`), ...Object.keys(STATIC)]);
    for (const file of htmlFiles) {
      for (const m of read(file).matchAll(/(?:src|href)="([^"]+)"/g)) expect(produced.has(m[1]!)).toBe(true);
    }
  });

  test('les noms de pages correspondent aux constantes du protocole', () => {
    expect(Object.keys(STATIC)).toContain(PROMPT_PAGE);
    expect(Object.keys(STATIC)).toContain(OPTIONS_PAGE);
  });

  test('toutes les sources et tous les fichiers statiques existent', () => {
    for (const p of [...Object.values(ENTRIES), ...Object.values(STATIC)]) expect(() => read(p as string)).not.toThrow();
  });
});

describe('thème', () => {
  const css = read('src/ui/ui.css');
  test('couleur primaire Synco, thème clair et sombre, focus visible', () => {
    expect(css).toContain('--primary: #16ac77');
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain(':focus-visible');
  });
  test('aucune ressource distante ni @import', () => {
    expect(css).not.toMatch(/@import|url\(\s*['"]?https?:|\/\/fonts\./);
  });
});
