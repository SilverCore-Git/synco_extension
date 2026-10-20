import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { assertInertSvg, ICONS_CSS, ICONS_DIR, iconNames, renderIconsCss, splitWordmark, svgDataUri, WORDMARK, APP_ICON } from '../scripts/lib/uiAssets.mjs';

const root = new URL('../', import.meta.url);
const rootPath = new URL('.', root).pathname;
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8');

describe('icônes et logo de l\'interface', () => {
  test('src/ui/icons.css est à jour (régénérer avec : node scripts/make-ui-assets.mjs)', () => {
    expect(read(ICONS_CSS)).toBe(renderIconsCss(rootPath));
  });

  test('chaque icône déclarée dans kit.ts a son fichier, et chaque fichier est utilisé (aucun poids mort)', () => {
    const union = read('src/ui/kit.ts').match(/export type IconName =([^;]+);/)![1]!;
    const declared = [...union.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!).sort();
    expect(declared.length).toBeGreaterThan(5);
    expect(iconNames(rootPath)).toEqual(declared);
    // Une icône déclarée est utilisée au moins une fois en dehors de la déclaration du type.
    const sources = readdirSync(new URL('src/ui/', root), { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).map((f) => read(`src/ui/${f}`)).join('\n');
    for (const name of declared) expect({ name, uses: sources.split(`'${name}'`).length - 1 >= 2 }).toEqual({ name, uses: true });
  });

  test('chaque icône utilisée dans les sources existe', () => {
    const files = readdirSync(new URL('src/ui/', root), { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    const known = new Set(iconNames(rootPath));
    const used = new Set<string>();
    for (const f of files) {
      for (const m of read(`src/ui/${f}`).matchAll(/\b(?:icon|tile|iconButton|emptyState)\(\s*doc,\s*'([a-z0-9-]+)'|\bicon:\s*'([a-z0-9-]+)'|\bicon\s*=\s*'([a-z0-9-]+)'/g)) {
        used.add((m[1] ?? m[2] ?? m[3])!);
      }
    }
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect({ name, known: known.has(name) }).toEqual({ name, known: true });
  });

  test('chaque icône utilisée par une classe de CSS ou de code a son masque', () => {
    const css = read(ICONS_CSS);
    for (const name of iconNames(rootPath)) expect(css).toContain(`.bi-${name} { --bi: url("data:image/svg+xml,`);
  });

  test('la licence des icônes accompagne les fichiers', () => {
    expect(existsSync(new URL(`${ICONS_DIR}/LICENSE`, root))).toBe(true);
    expect(read(`${ICONS_DIR}/LICENSE`)).toContain('MIT License');
  });

  test('aucune ressource distante dans la feuille générée (hors espace de noms SVG)', () => {
    const css = read(ICONS_CSS).replaceAll('http://www.w3.org/2000/svg', '');
    expect(css).not.toMatch(/https?:|@import|url\(\s*(?!["']?data:)/);
  });

  test('une URL de données ne contient aucun caractère qui casserait la valeur CSS', () => {
    const uri = svgDataUri('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0#"/></svg>');
    const inner = uri.slice('url("'.length, -2);
    expect(inner).not.toMatch(/["<>#]/);
    expect(uri.startsWith('url("data:image/svg+xml,')).toBe(true);
  });

  test.each([
    ['script', '<svg><script>alert(1)</script></svg>'],
    ['gestionnaire d\'événement', '<svg onload="x()"><path d=""/></svg>'],
    ['lien', '<svg><a href="https://x"><path d=""/></a></svg>'],
    ['style', '<svg><style>*{}</style></svg>'],
    ['image externe', '<svg><image xlink:href="x"/></svg>'],
    ['foreignObject', '<svg><foreignObject/></svg>'],
    ['référence url()', '<svg><path fill="url(#x)"/></svg>'],
  ])('SVG non inerte refusé : %s', (_n, svg) => {
    expect(() => assertInertSvg(svg, 'x.svg')).toThrow('SVG non inerte');
  });

  test('tous les SVG versionnés sont inertes', () => {
    for (const f of readdirSync(new URL(`${ICONS_DIR}/`, root)).filter((n) => n.endsWith('.svg'))) {
      expect(() => assertInertSvg(read(`${ICONS_DIR}/${f}`), f)).not.toThrow();
    }
    expect(() => assertInertSvg(read(WORDMARK), WORDMARK)).not.toThrow();
    expect(() => assertInertSvg(read(APP_ICON), APP_ICON)).not.toThrow();
  });

  test('logo : lettres et point séparés (le point garde le vert Synco, les lettres suivent le thème)', () => {
    const { letters, dot } = splitWordmark(read(WORDMARK));
    expect(letters).toContain('fill="#000"');
    expect(letters).not.toMatch(/#1DD796|white/i);
    expect(dot.match(/<path/g)).toHaveLength(1);
    expect(dot).toMatch(/#1DD796/i);
    expect(() => splitWordmark('<svg viewBox="0 0 1 1"><path d="" fill="white"/></svg>')).toThrow('introuvables');
  });
});
