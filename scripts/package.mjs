#!/usr/bin/env node
// Construit la production et prépare les paquets de publication dans dist/ :
//   synco-extension-<version>-chrome.zip   → Chrome Web Store
//   synco-extension-<version>-firefox.zip  → AMO (module)
//   synco-extension-<version>-source.zip   → AMO (code source, obligatoire pour un code regroupé par esbuild)
//   SHA256SUMS.txt                         → empreintes des archives et de chaque fichier de chaque paquet
// Usage : node scripts/package.mjs [--allow-dirty]   (à lancer sous Node, pas sous Bun)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackage } from './lib/packageChecks.mjs';
import { createZip } from './lib/zip.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const allowDirty = process.argv.includes('--allow-dirty');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

// Le code source remis à l'AMO doit correspondre exactement à ce qui est publié.
const dirty = git('status', '--porcelain').toString('utf8').trim();
if (dirty && !allowDirty) {
  console.error('package : des modifications ne sont pas commitées ; la source remise à l\'AMO ne correspondrait pas au paquet.\n' + dirty);
  process.exit(1);
}

execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--prod'], { cwd: root, stdio: 'inherit' });

function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(full).isDirectory() ? listFiles(full, rel) : [rel];
  });
}

const sums = [];
let failed = false;
for (const target of ['chrome', 'firefox']) {
  const dir = join(dist, target);
  const files = listFiles(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }));
  const problems = checkPackage(files, target, version);
  if (problems.length > 0) {
    failed = true;
    console.error(`paquet ${target} refusé :\n  - ${problems.join('\n  - ')}`);
    continue;
  }
  const zipName = `synco-extension-${version}-${target}.zip`;
  const zip = createZip(files);
  writeFileSync(join(dist, zipName), zip);
  sums.push(`${sha256(zip)}  ${zipName}`);
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) sums.push(`${sha256(f.data)}  ${target}/${f.name}`);
  console.log(`dist/${zipName} (${files.length} fichiers, ${zip.length} octets)`);
}
if (failed) process.exit(1);

// Source : uniquement les fichiers suivis par Git (le même état que le commit publié).
const tracked = git('ls-files', '-z').toString('utf8').split('\0').filter(Boolean);
const sourceFiles = tracked.map((name) => ({ name, data: readFileSync(join(root, name)) }));
const sourceName = `synco-extension-${version}-source.zip`;
const source = createZip(sourceFiles);
writeFileSync(join(dist, sourceName), source);
sums.push(`${sha256(source)}  ${sourceName}`);
console.log(`dist/${sourceName} (${sourceFiles.length} fichiers, commit ${git('rev-parse', '--short', 'HEAD').toString().trim()}${dirty ? ', MODIFICATIONS NON COMMITÉES' : ''})`);

writeFileSync(join(dist, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log('dist/SHA256SUMS.txt');
