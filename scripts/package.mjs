#!/usr/bin/env node
// Construit la production et prépare les paquets de publication dans dist/ :
//   synco-extension-<version>-chrome.zip   → Chrome Web Store
//   synco-extension-<version>-firefox.zip  → AMO (module)
//   synco-extension-<version>-source.zip   → AMO (code source, obligatoire pour un code regroupé par esbuild)
//   SHA256SUMS.txt                         → empreintes des archives et de chaque fichier de chaque paquet
// Usage : node scripts/package.mjs [--allow-dirty]   (à lancer sous Node, pas sous Bun)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackage } from './lib/packageChecks.mjs';
import { parseLsFilesStage, scanSourceFiles } from './lib/sourceArchive.mjs';
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

/** Fichiers ordinaires seulement : un lien symbolique dans dist/ ferait embarquer un fichier extérieur. */
function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = lstatSync(full);
    if (st.isDirectory()) return listFiles(full, rel);
    if (!st.isFile()) throw new Error(`fichier non ordinaire dans le paquet : ${rel}`);
    return [rel];
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

// Source : uniquement les fichiers ordinaires suivis par Git (le même état que le commit publié).
const { files: tracked, rejected } = parseLsFilesStage(git('ls-files', '-s', '-z').toString('utf8'));
if (rejected.length > 0) {
  console.error(`archive source refusée : entrées non ordinaires (lien symbolique, sous-module) :\n  - ${rejected.map((r) => `${r.path} (${r.mode})`).join('\n  - ')}`);
  process.exit(1);
}
const sourceFiles = tracked.map((name) => ({ name, data: readFileSync(join(root, name)) }));
// Même contrôle de secrets que le hook de commit, sur le contenu exact de l'archive (dépôt public).
const leaks = scanSourceFiles(sourceFiles);
if (leaks.length > 0) {
  console.error(`archive source refusée : éléments sensibles :\n  - ${leaks.map((f) => `${f.file}${f.line ? `:${f.line}` : ''} [${f.rule}]`).join('\n  - ')}`);
  process.exit(1);
}
const sourceName = `synco-extension-${version}-source.zip`;
const source = createZip(sourceFiles);
writeFileSync(join(dist, sourceName), source);
sums.push(`${sha256(source)}  ${sourceName}`);
console.log(`dist/${sourceName} (${sourceFiles.length} fichiers, commit ${git('rev-parse', '--short', 'HEAD').toString().trim()}${dirty ? ', MODIFICATIONS NON COMMITÉES' : ''})`);

writeFileSync(join(dist, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log('dist/SHA256SUMS.txt');
