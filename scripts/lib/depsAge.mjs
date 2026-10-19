// Politique de dépendances : versions épinglées et publiées depuis au moins 7 jours.
// S'applique à tout ce qui figure dans bun.lock (directes, transitives, devDependencies).

export const MIN_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Une version exacte, sans opérateur, sans plage, sans étiquette (`^`, `~`, `*`, `latest`, `>=`…). */
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Retourne la liste des déclarations de package.json qui ne sont pas des versions exactes. */
export function findUnpinned(pkg) {
  const bad = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (!EXACT_VERSION.test(range)) bad.push({ section, name, range });
    }
  }
  return bad;
}

/** Extrait `{ name, version }` de chaque entrée de la section `packages` de bun.lock (JSONC). */
export function parseBunLock(text) {
  const json = JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));
  const out = [];
  for (const entry of Object.values(json.packages ?? {})) {
    const id = Array.isArray(entry) ? entry[0] : undefined;
    if (typeof id !== 'string') continue;
    const at = id.lastIndexOf('@');
    if (at <= 0) continue;
    out.push({ name: id.slice(0, at), version: id.slice(at + 1) });
  }
  return out;
}

/** @param {string | undefined} publishedIso */
export function isOldEnough(publishedIso, now = Date.now(), days = MIN_AGE_DAYS) {
  if (!publishedIso) return false;
  const t = Date.parse(publishedIso);
  return Number.isFinite(t) && now - t >= days * DAY_MS;
}

/**
 * @param {{ name: string, version: string }[]} packages
 * @param {(name: string) => Promise<Record<string, string>>} getTimes  date de publication par version
 */
export async function checkAges(packages, getTimes, now = Date.now(), days = MIN_AGE_DAYS) {
  const cache = new Map();
  const problems = [];
  for (const { name, version } of packages) {
    if (!cache.has(name)) cache.set(name, getTimes(name));
    const times = await cache.get(name);
    const published = times[version];
    if (!isOldEnough(published, now, days)) problems.push({ name, version, published: published ?? null });
  }
  return problems;
}
