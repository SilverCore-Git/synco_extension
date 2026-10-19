#!/usr/bin/env node
// Vérifie le paquet Firefox de production avec le même moteur que l'AMO (addons-linter, utilisé par « web-ext lint »).
// Construit la production puis lance la lint ; tout avertissement est traité comme une erreur.
// Usage : node scripts/lint-firefox.mjs   (sous Node)
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--prod'], { cwd: root, stdio: 'inherit' });

const r = spawnSync(process.execPath, [join(root, 'node_modules/addons-linter/bin/addons-linter'), join(root, 'dist/firefox'), '--warnings-as-errors'], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
