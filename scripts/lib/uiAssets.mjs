// Feuille d'icônes de l'interface (src/ui/icons.css), générée à partir de fichiers SVG versionnés :
//  - assets/vendor/bootstrap-icons/*.svg : sous-ensemble de Bootstrap Icons (MIT, voir LICENSE à côté), la
//    bibliothèque d'icônes de l'application Synco ;
//  - assets/brand/wordmark.svg : le logo « Synco. » de l'application.
// Chaque SVG devient un masque CSS (data: URI) : l'icône prend la couleur du texte, en thème clair comme sombre,
// sans <img>, sans SVG construit en JavaScript, sans ressource distante.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ICONS_DIR = 'assets/vendor/bootstrap-icons';
export const WORDMARK = 'assets/brand/wordmark.svg';
export const APP_ICON = 'assets/brand/icon.svg';
export const ICONS_CSS = 'src/ui/icons.css';

const NAME = /^[a-z0-9-]+$/;

/** SVG → data: URI compact (seuls les caractères nécessaires sont échappés). */
export function svgDataUri(svg) {
  const compact = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim()
    .replace(/"/g, "'");
  return `url("data:image/svg+xml,${compact.replace(/[%#<>?\[\]\\^`{|}]/g, (c) => encodeURIComponent(c))}")`;
}

/** Contrôle d'un SVG d'icône : aucun script, aucun lien, aucune ressource externe. */
export function assertInertSvg(svg, file) {
  if (/<script|<foreignObject|\bon[a-z]+\s*=|href\s*=|url\(|<style|<image/i.test(svg)) {
    throw new Error(`${file} : SVG non inerte (script, lien, style ou ressource externe)`);
  }
}

/** Sépare le logo en deux calques de même cadre : les lettres (couleur du texte) et le point (vert Synco). */
export function splitWordmark(svg) {
  const open = svg.match(/<svg\b[^>]*>/)?.[0];
  const paths = [...svg.matchAll(/<path\b[^>]*\/>/g)].map((m) => m[0]);
  if (!open || paths.length === 0) throw new Error(`${WORDMARK} : logo illisible`);
  const isDot = (p) => /fill="#1DD796"/i.test(p);
  const letters = paths.filter((p) => !isDot(p)).map((p) => p.replace(/fill="[^"]*"/, 'fill="#000"'));
  const dot = paths.filter(isDot);
  if (letters.length === 0 || dot.length !== 1) throw new Error(`${WORDMARK} : lettres ou point introuvables`);
  return { letters: `${open}${letters.join('')}</svg>`, dot: `${open}${dot[0]}</svg>` };
}

/** Contenu attendu de src/ui/icons.css. */
export function renderIconsCss(root) {
  const icons = readdirSync(join(root, ICONS_DIR))
    .filter((f) => f.endsWith('.svg'))
    .sort()
    .map((file) => {
      const name = file.slice(0, -4);
      if (!NAME.test(name)) throw new Error(`${file} : nom d'icône invalide`);
      const svg = readFileSync(join(root, ICONS_DIR, file), 'utf8');
      assertInertSvg(svg, file);
      return `.bi-${name} { --bi: ${svgDataUri(svg)}; }`;
    });

  const wordmark = readFileSync(join(root, WORDMARK), 'utf8');
  assertInertSvg(wordmark, WORDMARK);
  const { letters, dot } = splitWordmark(wordmark);
  const appIcon = readFileSync(join(root, APP_ICON), 'utf8');
  assertInertSvg(appIcon, APP_ICON);

  return [
    '/* Fichier généré par scripts/make-ui-assets.mjs : ne pas modifier à la main. */',
    '/* Icônes : Bootstrap Icons (MIT, assets/vendor/bootstrap-icons/LICENSE). Logo : Synco. */',
    '',
    '.bi { display: inline-block; flex: none; width: 1em; height: 1em; vertical-align: -0.125em; background-color: currentColor;',
    '  -webkit-mask: var(--bi) center / contain no-repeat; mask: var(--bi) center / contain no-repeat; }',
    ...icons,
    '',
    `.wordmark { --logo-letters: ${svgDataUri(letters)};`,
    `  --logo-dot: ${svgDataUri(dot)}; }`,
    '',
    `.app-icon { --app-icon: ${svgDataUri(appIcon)}; }`,
    '',
  ].join('\n');
}

/** Noms d'icônes disponibles (sans le préfixe `bi-`). */
export function iconNames(root) {
  return readdirSync(join(root, ICONS_DIR))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4))
    .sort();
}
