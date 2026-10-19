// Assemblage des manifestes (pur, testé). Aucune entrée/sortie ici : build.mjs lit et écrit.

/** Origine exacte : https, hôte en minuscules, port facultatif, ni chemin, ni joker, ni identifiants. */
const ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$/;

export function validateOrigin(origin) {
  if (typeof origin !== 'string' || !ORIGIN.test(origin)) {
    throw new Error(`origine invalide (https://hôte[:port] exact, sans joker ni chemin) : ${JSON.stringify(origin)}`);
  }
  if (new URL(origin).origin !== origin) {
    throw new Error(`origine non canonique : ${origin}`);
  }
  return origin;
}

/** Origines autorisées pour un mode. `--prod` : production seule. `--dev` : développement seul. */
export function originsFor(config, mode) {
  if (mode !== 'prod' && mode !== 'dev') throw new Error(`mode inconnu : ${mode}`);
  const list = mode === 'prod' ? config.production : config.development;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`aucune origine configurée pour « ${mode} »`);
  const origins = list.map(validateOrigin);
  if (new Set(origins).size !== origins.length) throw new Error('origines en double');
  return origins;
}

const LOCAL_HOST = /(^|[/.@])(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(:|\/|"|$)/i;

/** Le paquet de production ne doit contenir aucune trace d'origine locale. */
export function assertNoLocalOrigins(text, label) {
  if (LOCAL_HOST.test(text)) throw new Error(`${label} : origine locale (localhost, 127.x…) interdite en production`);
}

/**
 * Fusion de premier niveau : le manifeste de la cible remplace les clés de base du même nom.
 * @param {{ base: object, target: object, targetName: 'chrome' | 'firefox', mode: 'prod' | 'dev', version: string, origins: string[] }} p
 */
export function buildManifest({ base, target, targetName, mode, version, origins }) {
  const manifest = structuredClone({ ...base, ...target });
  manifest.version = version;

  manifest.content_scripts = base.content_scripts.map((cs) => ({
    ...cs,
    matches: origins.map((o) => `${o}/*`),
  }));

  // Accès limité aux origines exactes de la liste blanche, jamais à d'autres sites. Firefox MV3 laisse
  // l'utilisateur accorder ou retirer ces accès ; la page d'options le détecte et le demande (permissions.request).
  manifest.host_permissions = origins.map((o) => `${o}/*`);

  if (mode === 'dev') {
    manifest.name = `${manifest.name} (dev)`;
    // `version_name` n'existe que pour Chrome ; Firefox signale la clé comme inconnue.
    if (targetName === 'chrome') manifest.version_name = `${version}-dev`;
    const gecko = manifest.browser_specific_settings?.gecko;
    if (gecko) gecko.id = gecko.id.replace('@', '-dev@');
  }

  if (targetName === 'firefox' && !manifest.browser_specific_settings?.gecko?.id) {
    throw new Error('Firefox : browser_specific_settings.gecko.id est obligatoire');
  }
  if (mode === 'prod') assertNoLocalOrigins(JSON.stringify(manifest), `manifeste ${targetName}`);
  return manifest;
}
