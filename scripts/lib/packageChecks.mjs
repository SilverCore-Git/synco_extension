// Contrôles d'un dossier de build avant publication (purs : prennent la liste des fichiers et le manifeste).
import { ENTRIES, STATIC } from './entries.mjs';
import { assertNoLocalOrigins } from './manifest.mjs';

/** Fichiers attendus dans un paquet : manifeste, bundles et fichiers statiques du build, rien d'autre. */
export const EXPECTED_FILES = new Set(['manifest.json', ...Object.keys(ENTRIES).map((n) => `${n}.js`), ...Object.keys(STATIC)]);

export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;

/**
 * @param {{ name: string, data: Uint8Array }[]} files fichiers du paquet (chemins relatifs)
 * @param {'chrome' | 'firefox'} target
 * @param {string} version version de package.json
 * @returns {string[]} problèmes (vide si le paquet est publiable)
 */
export function checkPackage(files, target, version) {
  const problems = [];
  const names = new Set(files.map((f) => f.name));
  for (const n of names) if (!EXPECTED_FILES.has(n)) problems.push(`fichier inattendu : ${n}`);
  for (const n of EXPECTED_FILES) if (!names.has(n)) problems.push(`fichier manquant : ${n}`);

  const total = files.reduce((s, f) => s + f.data.length, 0);
  if (total > MAX_PACKAGE_BYTES) problems.push(`paquet trop gros : ${total} octets`);

  const raw = files.find((f) => f.name === 'manifest.json');
  if (!raw) return problems;
  let m;
  try {
    m = JSON.parse(Buffer.from(raw.data).toString('utf8'));
  } catch {
    return [...problems, 'manifest.json illisible'];
  }

  if (m.manifest_version !== 3) problems.push('manifest_version doit valoir 3');
  if (m.version !== version) problems.push(`version du manifeste (${m.version}) ≠ package.json (${version})`);
  if (/\(dev\)/.test(m.name) || m.version_name) problems.push('manifeste de développement (nom « (dev) » ou version_name)');
  if (target === 'firefox' && /-dev@/.test(m.browser_specific_settings?.gecko?.id ?? '')) problems.push('identifiant Firefox de développement');
  if (target === 'firefox' && !m.browser_specific_settings?.gecko?.id) problems.push('identifiant Firefox (gecko.id) manquant');
  if (target === 'chrome' && !m.background?.service_worker) problems.push('Chrome : background.service_worker manquant');
  if (target === 'firefox' && !m.background?.scripts) problems.push('Firefox : background.scripts manquant');
  if ((m.host_permissions ?? []).some((p) => /<all_urls>|\*:\/\/\*/.test(p))) problems.push('host_permissions trop large');
  if (m.externally_connectable) problems.push('externally_connectable interdit');
  if (m.content_security_policy?.extension_pages !== "script-src 'self'; object-src 'none'") problems.push('CSP des pages d\'extension modifiée');

  for (const f of files) {
    if (!/\.(json|js|html|css)$/.test(f.name)) continue;
    const text = Buffer.from(f.data).toString('utf8');
    try {
      assertNoLocalOrigins(text, f.name);
    } catch (e) {
      problems.push(e.message);
    }
    if (text.includes('syncoDebug')) problems.push(`${f.name} : diagnostic de développement présent`);
    if (/\bconsole\s*\./.test(text) && f.name.endsWith('.js')) problems.push(`${f.name} : appel console.* présent`);
  }
  return problems;
}
