// Sélection et contrôle des fichiers de l'archive source remise à l'AMO (purs, testés).
import { looksBinary, scanPath, scanText } from './secrets.mjs';

const MODE_FILE = new Set(['100644', '100755']);

/**
 * Analyse `git ls-files -s -z` (« <mode> <objet> <étape>\t<chemin> »). Seuls les fichiers ordinaires sont admis :
 * un lien symbolique (120000) ferait lire, à la construction de l'archive, un fichier hors du dépôt ; un sous-module
 * (160000) n'a pas de contenu dans ce dépôt. Les deux sont refusés plutôt qu'ignorés.
 * @returns {{ files: string[], rejected: { path: string, mode: string }[] }}
 */
export function parseLsFilesStage(output) {
  const files = [];
  const rejected = [];
  for (const record of output.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const meta = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (tab < 0 || meta.length !== 3 || path === '') {
      rejected.push({ path: record, mode: 'illisible' });
      continue;
    }
    if (MODE_FILE.has(meta[0])) files.push(path);
    else rejected.push({ path, mode: meta[0] });
  }
  return { files, rejected };
}

/** Même contrôle de secrets que le hook de commit, appliqué au contenu exact de l'archive. */
export function scanSourceFiles(files) {
  const findings = [];
  for (const { name, data } of files) {
    findings.push(...scanPath(name));
    if (!looksBinary(data)) findings.push(...scanText(name, Buffer.from(data).toString('utf8')));
  }
  return findings;
}
