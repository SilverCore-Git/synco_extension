import { describe, expect, test } from 'bun:test';
import { onExtensionInstalled, onPermissionsAdded, returnToSynco, type OnboardingHost, type OnboardingTab } from '../src/background/onboarding';

const PATTERNS = ['https://app.synco.one/*'];

function host(opts: { access: boolean; tabs?: OnboardingTab[]; patterns?: string[] }) {
  const calls = { reloaded: [] as number[], focused: [] as OnboardingTab[], options: 0, queried: [] as string[][] };
  const h: OnboardingHost = {
    hostPatterns: () => opts.patterns ?? PATTERNS,
    hasHostAccess: async () => opts.access,
    async findTabs(patterns) {
      calls.queried.push(patterns);
      if (!opts.access) throw new Error('accès refusé');
      return opts.tabs ?? [];
    },
    async reloadTab(id) {
      calls.reloaded.push(id);
    },
    async focusTab(tab) {
      calls.focused.push(tab);
    },
    async openOptions() {
      calls.options++;
    },
  };
  return { h, calls };
}

describe('retour vers Synco après l\'installation', () => {
  test('accès accordé : recharge chaque onglet Synco et remet au premier plan le plus récent', async () => {
    const tabs = [
      { id: 1, windowId: 10, lastAccessed: 100 },
      { id: 2, windowId: 11, lastAccessed: 300 },
      { id: 3, windowId: 10, lastAccessed: 200 },
    ];
    const { h, calls } = host({ access: true, tabs });
    await onExtensionInstalled('install', h);
    expect(calls.queried).toEqual([PATTERNS]);
    expect(calls.reloaded.sort()).toEqual([1, 2, 3]);
    expect(calls.focused.map((t) => t.id)).toEqual([2]);
    expect(calls.options).toBe(0);
  });

  test('accès refusé : ouvre la page d\'options (qui le demande), sans toucher aux onglets', async () => {
    const { h, calls } = host({ access: false, tabs: [{ id: 1 }] });
    await onExtensionInstalled('install', h);
    expect(calls.options).toBe(1);
    expect(calls.queried).toEqual([]);
    expect(calls.reloaded).toEqual([]);
  });

  test('mise à jour ou redémarrage du navigateur : rien (aucun rechargement inattendu)', async () => {
    for (const reason of ['update', 'browser_update', 'chrome_update', 'shared_module_update', undefined]) {
      const { h, calls } = host({ access: true, tabs: [{ id: 1 }] });
      await onExtensionInstalled(reason, h);
      expect({ reason, reloaded: calls.reloaded, options: calls.options }).toEqual({ reason, reloaded: [], options: 0 });
    }
  });

  test('aucun onglet Synco ouvert : rien à recharger ni à afficher', async () => {
    const { h, calls } = host({ access: true, tabs: [] });
    expect(await returnToSynco(h)).toBe(0);
    expect(calls.reloaded).toEqual([]);
    expect(calls.focused).toEqual([]);
  });

  test('onglets sans identifiant ignorés ; un rechargement qui échoue n\'empêche pas le retour', async () => {
    const { h, calls } = host({ access: true, tabs: [{ windowId: 1 }, { id: 4, lastAccessed: 1 }, { id: 5, lastAccessed: 2 }] });
    h.reloadTab = async (id) => {
      calls.reloaded.push(id);
      if (id === 4) throw new Error('onglet fermé');
    };
    expect(await returnToSynco(h)).toBe(2);
    expect(calls.focused.map((t) => t.id)).toEqual([5]);
  });

  test('aucun motif dans le manifeste : rien', async () => {
    const { h, calls } = host({ access: true, tabs: [{ id: 1 }], patterns: [] });
    await onExtensionInstalled('install', h);
    expect(calls.queried).toEqual([]);
    expect(calls.options).toBe(0);
  });
});

describe('accès au site accordé plus tard', () => {
  test('origines Synco ajoutées : retour vers Synco', async () => {
    const { h, calls } = host({ access: true, tabs: [{ id: 7, windowId: 2 }] });
    await onPermissionsAdded({ origins: PATTERNS }, h);
    expect(calls.reloaded).toEqual([7]);
    expect(calls.focused.map((t) => t.id)).toEqual([7]);
  });

  test('accès à tous les sites (actions de page) ou permission sans origine : aucun rechargement', async () => {
    for (const added of [{ origins: ['<all_urls>'] }, { origins: [] }, {}, undefined]) {
      const { h, calls } = host({ access: true, tabs: [{ id: 7 }] });
      await onPermissionsAdded(added, h);
      expect(calls.reloaded).toEqual([]);
    }
  });
});
