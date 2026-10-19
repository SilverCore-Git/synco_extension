import { describe, expect, test } from 'bun:test';
import { groupEntries, OptionsModel, type OptionsBackend, type OptionsState } from '../src/ui/options/model';
import { renderOptions, type OptionsHandlers } from '../src/ui/options/view';
import type { VaultEntry } from '../src/vault/vault';
import { asEl, buttonByText, fakeDoc } from './helpers/fakeDom';
import { DEVICE, DEVICE_2, ORIGIN, OTHER_ORIGIN } from './helpers/vaultFixtures';

const NOW = 1_800_000_000_000;
const entry = (over: Partial<VaultEntry> = {}): VaultEntry => ({
  origin: ORIGIN, deviceId: DEVICE, readable: true, createdAt: NOW - 86_400_000, failures: 0, lockedUntil: null, ...over,
});

function backend(over: Partial<OptionsBackend> & { entries?: VaultEntry[]; allowed?: string[]; hosts?: { origin: string; granted: boolean }[] } = {}) {
  const calls = { remove: [] as string[], request: 0 };
  const state = { entries: over.entries ?? [entry()], hosts: over.hosts ?? [{ origin: ORIGIN, granted: true }] };
  const broad = { granted: false, requests: 0, revokes: 0 };
  const b: OptionsBackend = {
    version: () => '1.2.3',
    list: over.list ?? (async () => ({ entries: [...state.entries], allowedOrigins: over.allowed ?? [ORIGIN] })),
    hostAccess: over.hostAccess ?? (async () => state.hosts),
    remove: over.remove ?? (async (o, d) => {
      calls.remove.push(`${o}|${d}`);
      state.entries = state.entries.filter((e) => !(e.origin === o && e.deviceId === d));
    }),
    broadAccess: over.broadAccess ?? (async () => broad.granted),
    requestBroad: over.requestBroad ?? (async () => { broad.requests++; broad.granted = true; return true; }),
    revokeBroad: over.revokeBroad ?? (async () => { broad.revokes++; broad.granted = false; return true; }),
    requestAccess: over.requestAccess ?? (async () => {
      calls.request++;
      state.hosts = state.hosts.map((h) => ({ ...h, granted: true }));
      return true;
    }),
  };
  return { b, calls, state, broad };
}

const noop: OptionsHandlers = { grantAccess() {}, askRemove() {}, cancelRemove() {}, confirmRemove() {} };

describe('modèle de la page d\'options', () => {
  test('chargement : état prêt, groupes par origine, origines inactives en dernier', async () => {
    const { b } = backend({ entries: [entry({ origin: OTHER_ORIGIN, deviceId: DEVICE_2 }), entry()], allowed: [ORIGIN] });
    const m = new OptionsModel(b);
    expect(m.current.status).toBe('loading');
    await m.refresh();
    expect(m.current.status).toBe('ready');
    expect(m.current.version).toBe('1.2.3');
    expect(m.current.groups.map((g) => [g.origin, g.active])).toEqual([[ORIGIN, true], [OTHER_ORIGIN, false]]);
  });

  test('worker injoignable : message d\'erreur en français, pas d\'exception', async () => {
    const { b } = backend({ list: async () => { throw new Error('boom'); } });
    const m = new OptionsModel(b);
    await m.refresh();
    expect(m.current.status).toBe('error');
    expect(m.current.error).toContain('ne répond pas');
    expect(m.current.error).not.toContain('boom');
  });

  test('suppression : demande → confirmation → effacement → liste rafraîchie', async () => {
    const { b, calls } = backend();
    const m = new OptionsModel(b);
    await m.refresh();
    m.askRemove(ORIGIN, DEVICE);
    expect(m.current.confirm?.deviceId).toBe(DEVICE);
    expect(calls.remove).toEqual([]); // rien n'est supprimé avant la confirmation
    await m.confirmRemove();
    expect(calls.remove).toEqual([`${ORIGIN}|${DEVICE}`]);
    expect(m.current).toMatchObject({ confirm: null, busy: false, notice: 'Clé supprimée de l\'extension.' });
    expect(m.current.groups).toEqual([]);
  });

  test('annuler la confirmation ne supprime rien', async () => {
    const { b, calls } = backend();
    const m = new OptionsModel(b);
    await m.refresh();
    m.askRemove(ORIGIN, DEVICE);
    m.cancelRemove();
    await m.confirmRemove(); // rien à confirmer
    expect(calls.remove).toEqual([]);
    expect(m.current.groups).toHaveLength(1);
  });

  test('demande de suppression d\'une clé inconnue : aucune fenêtre', async () => {
    const m = new OptionsModel(backend().b);
    await m.refresh();
    m.askRemove(ORIGIN, DEVICE_2);
    expect(m.current.confirm).toBeNull();
  });

  test('double clic sur « Supprimer » : une seule suppression', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { b, calls } = backend({ remove: async (o, d) => { calls.remove.push(`${o}|${d}`); await gate; } });
    const m = new OptionsModel(b);
    await m.refresh();
    m.askRemove(ORIGIN, DEVICE);
    const first = m.confirmRemove();
    await m.confirmRemove();
    release();
    await first;
    expect(calls.remove).toHaveLength(1);
  });

  test('échec de la suppression : message, la fenêtre se ferme', async () => {
    const { b } = backend({ remove: async () => { throw new Error('x'); } });
    const m = new OptionsModel(b);
    await m.refresh();
    m.askRemove(ORIGIN, DEVICE);
    await m.confirmRemove();
    expect(m.current.notice).toContain('échoué');
    expect(m.current.confirm).toBeNull();
  });

  test('accès au site : demande directe (geste conservé), puis état rafraîchi', async () => {
    const { b, calls } = backend({ hosts: [{ origin: ORIGIN, granted: false }] });
    const m = new OptionsModel(b);
    await m.refresh();
    expect(m.current.hosts[0]!.granted).toBe(false);
    await m.grantAccess();
    expect(calls.request).toBe(1);
    expect(m.current.hosts[0]!.granted).toBe(true);
    expect(m.current.notice).toBe('Accès accordé.');
  });

  test('accès refusé ou demande en échec : le dit clairement', async () => {
    for (const requestAccess of [async () => false, async () => { throw new Error('geste requis'); }]) {
      const m = new OptionsModel(backend({ requestAccess, hosts: [{ origin: ORIGIN, granted: false }] }).b);
      await m.refresh();
      await m.grantAccess();
      expect(m.current.notice).toContain('n\'a pas été accordé');
      expect(m.current.hosts[0]!.granted).toBe(false);
    }
  });

  test('accès élargi : jamais accordé par défaut ; demande puis retrait, état rafraîchi', async () => {
    const { b, broad } = backend();
    const m = new OptionsModel(b);
    await m.refresh();
    expect(m.current.broad).toBe(false);
    await m.toggleBroad();
    expect(broad.requests).toBe(1);
    expect(m.current).toMatchObject({ broad: true, notice: 'Accès élargi accordé.' });
    await m.toggleBroad();
    expect(broad.revokes).toBe(1);
    expect(m.current).toMatchObject({ broad: false, notice: 'Accès élargi retiré.' });
  });

  test('accès élargi refusé ou en échec : le dit, sans exception', async () => {
    for (const requestBroad of [async () => false, async () => { throw new Error('geste requis'); }]) {
      const m = new OptionsModel(backend({ requestBroad }).b);
      await m.refresh();
      await m.toggleBroad();
      expect(m.current.broad).toBe(false);
      expect(m.current.notice).toContain('n\'a pas été accordé');
    }
  });

  test('groupEntries : regroupe et ordonne', () => {
    const groups = groupEntries([entry({ origin: OTHER_ORIGIN }), entry({ deviceId: DEVICE_2 }), entry()], [ORIGIN]);
    expect(groups.map((g) => g.entries.length)).toEqual([2, 1]);
  });
});

describe('vue de la page d\'options', () => {
  const state = (over: Partial<OptionsState> = {}): OptionsState => ({
    status: 'ready', error: null, notice: null, version: '1.2.3',
    hosts: [{ origin: ORIGIN, granted: true }], broad: false, groups: groupEntries([entry()], [ORIGIN]), confirm: null, busy: false, ...over,
  });
  const render = (s: OptionsState, h = noop) => asEl(renderOptions(fakeDoc(), s, h, NOW));

  test('état, version, accès au site et clés s\'affichent en français', () => {
    const t = render(state()).textContent;
    expect(t).toContain('Version 1.2.3');
    expect(t).toContain('Accès accordé');
    expect(t).toContain('Appareil 3f2b8c1e…');
    expect(t).toContain('Prêt');
    expect(t).toContain('Créé le');
    expect(t).toContain('pas un gestionnaire de passkeys');
    expect(t).toContain('pas protégée par du matériel');
  });

  test('accès refusé : bouton « Accorder l\'accès » relié au gestionnaire', () => {
    let granted = 0;
    const root = render(state({ hosts: [{ origin: ORIGIN, granted: false }] }), { ...noop, grantAccess: () => { granted++; } });
    expect(root.textContent).toContain('Accès refusé');
    buttonByText(root, 'Accorder l\'accès').click();
    expect(granted).toBe(1);
    expect(render(state()).findAll((e) => e.textContent === 'Accorder l\'accès')).toEqual([]);
  });

  test('popup (mode compact) : même contenu utile, limites résumées, accès aux réglages complets', () => {
    let opened = 0;
    const root = asEl(renderOptions(fakeDoc(), state(), { ...noop, openFull: () => { opened++; } }, NOW, true));
    expect(root.getAttribute('class')).toBe('options compact');
    expect(root.textContent).toContain('Accès accordé');
    expect(root.textContent).toContain('Appareil 3f2b8c1e…');
    expect(root.textContent).toContain('Après 10 erreurs de PIN');
    expect(root.textContent).not.toContain('pas un gestionnaire de passkeys'); // détail réservé à la page complète
    buttonByText(root, 'Plus d\'informations et réglages').click();
    expect(opened).toBe(1);
    // sans gestionnaire, pas de bouton orphelin
    expect(asEl(renderOptions(fakeDoc(), state(), noop, NOW, true)).findAll((e) => e.textContent.startsWith('Plus d'))).toEqual([]);
  });

  test('page complète : carte « tous les sites » avec explications honnêtes ; absente du popup', () => {
    let toggled = 0;
    const full = render(state(), { ...noop, toggleBroad: () => { toggled++; } });
    expect(full.textContent).toContain('Actions de page sur tous les sites');
    expect(full.textContent).toContain('jamais demandé à l\'installation');
    expect(full.textContent).toContain('ne donne jamais accès au coffre');
    buttonByText(full, 'Autoriser tous les sites').click();
    expect(toggled).toBe(1);
    const granted = render(state({ broad: true }), { ...noop, toggleBroad: () => { toggled++; } });
    expect(granted.textContent).toContain('Accès à tous les sites accordé');
    buttonByText(granted, 'Retirer l\'accès à tous les sites').click();
    expect(toggled).toBe(2);
    expect(asEl(renderOptions(fakeDoc(), state(), { ...noop, toggleBroad: () => {} }, NOW, true)).textContent).not.toContain('tous les sites');
  });

  test('aucune clé : message explicite', () => {
    expect(render(state({ groups: [] })).textContent).toContain('Aucune clé n\'est enregistrée');
  });

  test('états de clé : verrouillée, échecs, illisible, origine inactive', () => {
    const entries = [
      entry({ deviceId: '11111111-1111-1111-1111-111111111111', lockedUntil: NOW + 90_000, failures: 6 }),
      entry({ deviceId: '22222222-2222-2222-2222-222222222222', failures: 2 }),
      entry({ deviceId: '33333333-3333-3333-3333-333333333333', readable: false, createdAt: null, failures: null }),
      entry({ origin: OTHER_ORIGIN, deviceId: '44444444-4444-4444-4444-444444444444' }),
    ];
    const t = render(state({ groups: groupEntries(entries, [ORIGIN]) })).textContent;
    expect(t).toContain('Verrouillé 1 min 30 s');
    expect(t).toContain('2 échecs de PIN');
    expect(t).toContain('Illisible');
    expect(t).toContain('Date de création inconnue');
    expect(t).toContain('Origine inactive dans cette version');
  });

  test('« Supprimer » ouvre la confirmation maison, sans dialogue natif', () => {
    const asked: string[] = [];
    const root = render(state(), { ...noop, askRemove: (o: string, d: string) => { asked.push(`${o}|${d}`); } });
    buttonByText(root, 'Supprimer').click();
    expect(asked).toEqual([`${ORIGIN}|${DEVICE}`]);
  });

  test('fenêtre de confirmation : rôle dialog, texte clair, Annuler en premier focus, actions reliées', () => {
    const log: string[] = [];
    const root = render(state({ confirm: entry() }), { ...noop, cancelRemove: () => { log.push('annuler'); }, confirmRemove: () => { log.push('supprimer'); } });
    const dialog = root.findAll((e) => e.getAttribute('role') === 'dialog')[0]!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Supprimer cette clé ?');
    expect(dialog.textContent).toContain('irréversible');
    expect(dialog.textContent).toContain(ORIGIN);
    const focused = root.findAll((e) => e.attrs.has('data-autofocus'));
    expect(focused).toHaveLength(1);
    expect(focused[0]!.textContent).toBe('Annuler'); // l'action destructrice n'a jamais le focus initial
    buttonByText(dialog, 'Annuler').click();
    buttonByText(dialog, 'Supprimer').click();
    expect(log).toEqual(['annuler', 'supprimer']);
  });

  test('suppression en cours : bouton désactivé', () => {
    const root = render(state({ confirm: entry(), busy: true }));
    expect(buttonByText(root, 'Suppression…').getAttribute('disabled')).toBe('');
  });

  test('erreur et notice : annoncées (alert / status)', () => {
    const root = render(state({ error: 'Panne.', notice: 'Fait.' }));
    expect(root.findAll((e) => e.getAttribute('role') === 'alert')[0]!.textContent).toBe('Panne.');
    expect(root.findAll((e) => e.getAttribute('role') === 'status')[0]!.textContent).toBe('Fait.');
  });

  test('données hostiles venant du stockage : insérées en texte, jamais en HTML', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const root = render(state({ hosts: [{ origin: hostile, granted: false }], groups: [{ origin: hostile, active: false, entries: [entry({ origin: hostile, deviceId: hostile })] }], notice: hostile, error: hostile, confirm: entry({ origin: hostile, deviceId: hostile }) }));
    expect(root.textContent).toContain(hostile);
    expect(root.findAll((e) => ['img', 'script', 'iframe', 'a'].includes(e.tagName))).toEqual([]);
  });
});
