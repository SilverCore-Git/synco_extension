#!/usr/bin/env node
// Génère src/ui/icons.css à partir des SVG versionnés (icônes et logo). `--check` : échoue si le fichier est périmé.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ICONS_CSS, renderIconsCss } from './lib/uiAssets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const css = renderIconsCss(root);
const target = new URL(`../${ICONS_CSS}`, import.meta.url);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    /* absent */
  }
  if (current !== css) {
    console.error(`${ICONS_CSS} est périmé : lancez « node scripts/make-ui-assets.mjs ».`);
    process.exit(1);
  }
  console.log(`${ICONS_CSS} : à jour`);
} else {
  writeFileSync(target, css);
  console.log(`${ICONS_CSS} écrit (${css.length} octets)`);
}
