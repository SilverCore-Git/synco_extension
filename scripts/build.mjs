#!/usr/bin/env node
// Construit dist/chrome et dist/firefox. Usage : node scripts/build.mjs --prod | --dev
// À lancer sous Node (pas sous Bun). Sortie déterministe : pas d'horodatage, versions épinglées.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRIES, STATIC } from './lib/entries.mjs';
import { assertNoLocalOrigins, buildManifest, originsFor } from './lib/manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

const flags = process.argv.slice(2);
const mode = flags.includes('--prod') ? 'prod' : flags.includes('--dev') ? 'dev' : null;
if (!mode || flags.includes('--prod') === flags.includes('--dev')) {
  console.error('Usage : node scripts/build.mjs --prod | --dev');
  process.exit(2);
}

const pkg = readJson('package.json');
const origins = originsFor(readJson('config/origins.json'), mode);
const base = readJson('manifests/base.json');

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

for (const targetName of ['chrome', 'firefox']) {
  const outdir = join(root, 'dist', targetName);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  const manifest = buildManifest({
    base,
    target: readJson(`manifests/${targetName}.json`),
    targetName,
    mode,
    version: pkg.version,
    origins,
  });
  writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  for (const [name, src] of Object.entries(STATIC)) {
    mkdirSync(dirname(join(outdir, name)), { recursive: true });
    copyFileSync(join(root, src), join(outdir, name));
  }

  await build({
    entryPoints: Object.fromEntries(Object.entries(ENTRIES).map(([out, src]) => [out, join(root, src)])),
    outdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    // Liste blanche du mode de build, aussi injectée dans le code : le worker la revalide sur `sender`.
    define: { __SYNCO_ORIGINS__: JSON.stringify(origins), __SYNCO_DEV__: String(mode === 'dev') },
    logLevel: 'warning',
  });

  if (mode === 'prod') {
    for (const file of listFiles(outdir)) {
      const text = readFileSync(file, 'utf8');
      assertNoLocalOrigins(text, file);
      if (text.includes('syncoDebug')) throw new Error(`${file} : le diagnostic de développement ne doit pas figurer en production`);
    }
  }
  console.log(`dist/${targetName} (${mode}) : ${origins.join(', ')}`);
}
