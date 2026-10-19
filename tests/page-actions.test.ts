import { describe, expect, test } from 'bun:test';
import { CREATE_TASK_ID, createTaskAction, dismissDraft, registerPageActions, type MenuClick, type MenuTab, type PageActionsHost } from '../src/page-actions/actions';
import { DRAFT_KEY, DraftStore, type SessionArea } from '../src/page-actions/store';
import { BROAD_ACCESS, hasBroadAccess, requestBroadAccess, revokeBroadAccess, type PermissionsLike } from '../src/page-actions/permissions';

class FakeArea implements SessionArea {
  data: Record<string, unknown> = {};
  async get(key: string) {
    return key in this.data ? { [key]: structuredClone(this.data[key]) } : {};
  }
  async set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) this.data[k] = structuredClone(v);
  }
  async remove(key: string) {
    delete this.data[key];
  }
}

class FakeHost implements PageActionsHost {
  menus: { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }[] = [];
  removed = 0;
  badge = '';
  private installed: (() => void)[] = [];
  private clicked: ((i: MenuClick, t: MenuTab | undefined) => void)[] = [];
  async createMenu(item: PageActionsHost extends never ? never : { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }) {
    this.menus.push(item);
  }
  async removeAllMenus() {
    this.removed++;
    this.menus = [];
  }
  onInstalled(cb: () => void) {
    this.installed.push(cb);
  }
  onMenuClicked(cb: (i: MenuClick, t: MenuTab | undefined) => void) {
    this.clicked.push(cb);
  }
  async setBadge(text: string) {
    this.badge = text;
  }
  install() {
    this.installed.forEach((cb) => cb());
  }
  click(info: MenuClick, tab?: MenuTab) {
    this.clicked.forEach((cb) => cb(info, tab));
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const NOW = 1_800_000_000_000;

function setup() {
  const area = new FakeArea();
  const store = new DraftStore(area);
  const host = new FakeHost();
  registerPageActions(host, [createTaskAction({ store, host, now: () => NOW })]);
  return { area, store, host };
}

describe('menu contextuel « Créer une tâche dans Synco »', () => {
  test('créé à l\'installation : sur la sélection de texte seulement, et pas sur les pages du navigateur', async () => {
    const { host } = setup();
    expect(host.menus).toEqual([]); // rien tant que l'installation n'a pas eu lieu
    host.install();
    await tick();
    expect(host.removed).toBe(1); // pas de doublon si l'extension est mise à jour
    expect(host.menus).toEqual([
      { id: CREATE_TASK_ID, title: 'Créer une tâche dans Synco', contexts: ['selection'], documentUrlPatterns: ['http://*/*', 'https://*/*'] },
    ]);
  });

  test('clic : brouillon enregistré (texte, URL, titre) et pastille « 1 », sans aucun envoi', async () => {
    const { host, store } = setup();
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'Relancer le fournisseur', pageUrl: 'https://exemple.fr/devis' }, { title: 'Devis', url: 'https://exemple.fr/devis' });
    await tick();
    expect(await store.load()).toEqual({ v: 1, text: 'Relancer le fournisseur', url: 'https://exemple.fr/devis', title: 'Devis', capturedAt: NOW });
    expect(host.badge).toBe('1');
  });

  test('l\'URL de l\'onglet sert de repli quand le menu ne la donne pas', async () => {
    const { host, store } = setup();
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'x' }, { title: 'T', url: 'https://exemple.fr/ici' });
    await tick();
    expect((await store.load())?.url).toBe('https://exemple.fr/ici');
  });

  test('sans onglet (permission refusée) : le brouillon reste valable avec le texte seul', async () => {
    const { host, store } = setup();
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'x' }, undefined);
    await tick();
    expect(await store.load()).toMatchObject({ text: 'x', url: '', title: '' });
  });

  test('un autre menu, ou une sélection vide : aucun effet', async () => {
    const { host, store, area } = setup();
    host.click({ menuItemId: 'autre-menu', selectionText: 'x' });
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: '   ' });
    host.click({ menuItemId: CREATE_TASK_ID });
    await tick();
    expect(await store.load()).toBeNull();
    expect(area.data).toEqual({});
    expect(host.badge).toBe('');
  });

  test('un échec de stockage n\'interrompt pas le worker', async () => {
    const area = new FakeArea();
    area.set = async () => { throw new Error('quota'); };
    const host = new FakeHost();
    registerPageActions(host, [createTaskAction({ store: new DraftStore(area), host })]);
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'x' });
    await tick(); // aucune exception non gérée
    expect(host.badge).toBe('');
  });

  test('contenu hostile de la page : nettoyé avant stockage', async () => {
    const { host, store } = setup();
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'a‮b', pageUrl: 'javascript:alert(1)' }, { title: 'T\u0000\n2' });
    await tick();
    expect(await store.load()).toMatchObject({ text: 'a b', url: '', title: 'T 2' });
  });
});

describe('brouillon en attente', () => {
  test('un seul brouillon : le dernier remplace le précédent', async () => {
    const { host, store } = setup();
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'premier' });
    await tick();
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'second' });
    await tick();
    expect((await store.load())?.text).toBe('second');
  });

  test('ignorer : brouillon supprimé et pastille retirée', async () => {
    const { host, store } = setup();
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'x' });
    await tick();
    await dismissDraft({ store, host });
    expect(await store.load()).toBeNull();
    expect(host.badge).toBe('');
  });

  test('contenu altéré dans le stockage : ignoré et supprimé, jamais affiché', async () => {
    const { area, store } = setup();
    area.data[DRAFT_KEY] = { v: 1, text: '<b>x</b>', url: 'javascript:alert(1)', title: '', capturedAt: NOW };
    expect(await store.load()).toBeNull();
    expect(area.data[DRAFT_KEY]).toBeUndefined();
  });

  test('le brouillon n\'est écrit que sous sa clé dédiée de storage.session', async () => {
    const { host, area } = setup();
    host.click({ menuItemId: CREATE_TASK_ID, selectionText: 'x' });
    await tick();
    expect(Object.keys(area.data)).toEqual([DRAFT_KEY]);
    expect(DRAFT_KEY.startsWith('page-actions:')).toBe(true);
    expect(DRAFT_KEY.startsWith('vault:')).toBe(false);
  });
});

describe('accès élargi (optionnel)', () => {
  const api = (over: Partial<PermissionsLike> = {}): PermissionsLike & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      contains: async (p) => (calls.push(`contains:${p.origins}`), false),
      request: async (p) => (calls.push(`request:${p.origins}`), true),
      remove: async (p) => (calls.push(`remove:${p.origins}`), true),
      ...over,
    };
  };

  test('seul <all_urls> est concerné, et jamais plus', async () => {
    expect(BROAD_ACCESS.origins).toEqual(['<all_urls>']);
    const a = api();
    await hasBroadAccess(a);
    await requestBroadAccess(a);
    await revokeBroadAccess(a);
    expect(a.calls).toEqual(['contains:<all_urls>', 'request:<all_urls>', 'remove:<all_urls>']);
  });

  test('refus, absence de geste ou erreur : false, sans exception', async () => {
    const boom = async () => { throw new Error('geste requis'); };
    const a = api({ contains: boom, request: boom, remove: boom });
    expect(await hasBroadAccess(a)).toBe(false);
    expect(await requestBroadAccess(a)).toBe(false);
    expect(await revokeBroadAccess(a)).toBe(false);
    expect(await requestBroadAccess(api({ request: async () => false }))).toBe(false);
  });
});
