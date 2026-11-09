// Retour vers Synco après l'installation (ou après l'octroi de l'accès au site), sans geste de l'utilisateur.
//
// L'app propose l'extension depuis une carte (« Installer ») qui ouvre la boutique dans un nouvel onglet ; l'onglet
// Synco attend. Chrome n'injecte pas les content scripts dans les onglets déjà ouverts, et l'extension s'interdit la
// permission `scripting` : on recharge donc les onglets Synco (le content script s'y injecte au chargement), puis on
// remet le plus récent au premier plan. Sans accès au site (Firefox peut le refuser à l'installation), on ouvre la page
// d'options, qui le demande ; l'octroi déclenche alors `permissions.onAdded`, qui fait le même retour.
//
// Aucune donnée du coffre ici : seulement des onglets des origines de la liste blanche.

export interface OnboardingTab {
  id?: number | undefined;
  windowId?: number | undefined;
  lastAccessed?: number | undefined;
}

export interface OnboardingHost {
  /** Motifs d'accès du manifeste (sans port sur Firefox). */
  hostPatterns(): string[];
  /** L'accès à ces motifs est-il accordé ? */
  hasHostAccess(patterns: string[]): Promise<boolean>;
  /** Onglets ouverts sur les origines Synco (exige l'accès au site). */
  findTabs(patterns: string[]): Promise<OnboardingTab[]>;
  reloadTab(tabId: number): Promise<void>;
  focusTab(tab: OnboardingTab): Promise<void>;
  openOptions(): Promise<void>;
}

/** Recharge les onglets Synco et remet le plus récemment consulté au premier plan. Renvoie le nombre d'onglets. */
export async function returnToSynco(host: OnboardingHost): Promise<number> {
  const patterns = host.hostPatterns();
  if (patterns.length === 0) return 0;
  const tabs = (await host.findTabs(patterns)).filter((t): t is OnboardingTab & { id: number } => typeof t.id === 'number');
  if (tabs.length === 0) return 0;
  await Promise.all(tabs.map((t) => host.reloadTab(t.id).catch(() => undefined)));
  const latest = tabs.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));
  await host.focusTab(latest).catch(() => undefined);
  return tabs.length;
}

/** `runtime.onInstalled` : seulement pour une première installation (ni mise à jour, ni redémarrage du navigateur). */
export async function onExtensionInstalled(reason: string | undefined, host: OnboardingHost): Promise<void> {
  if (reason !== 'install') return;
  const patterns = host.hostPatterns();
  if (patterns.length === 0) return;
  if (await host.hasHostAccess(patterns)) await returnToSynco(host);
  else await host.openOptions();
}

/**
 * `permissions.onAdded` : seulement si l'ajout concerne les origines Synco. L'accès à tous les sites (actions de page,
 * permission optionnelle `<all_urls>`) ne recharge rien : ce serait recharger des onglets sans rapport avec le coffre.
 */
export async function onPermissionsAdded(added: { origins?: string[] } | undefined, host: OnboardingHost): Promise<void> {
  const patterns = host.hostPatterns();
  const mine = (added?.origins ?? []).filter((o) => patterns.includes(o));
  if (mine.length === 0) return;
  if (await host.hasHostAccess(patterns)) await returnToSynco(host);
}
