import { describe, expect, test } from 'bun:test';
import type { PromptView } from '../src/ui/prompt/controller';
import { createPromptView } from '../src/ui/prompt/view';
import { asEl, buttonByText, fakeDoc, type FakeElement } from './helpers/fakeDom';

const base: PromptView = {
  phase: 'enter', mode: 'load', origin: 'https://app.synco.one', reason: null, replacing: false,
  title: 'Entrez votre code PIN', hint: 'Pour déverrouiller.', error: null, errorSeq: 0, dots: 0, slots: 4,
  keypadEnabled: true, canSubmit: false, submitLabel: 'Déverrouiller', remainingSeconds: 90, lockSeconds: null,
};

function make() {
  const calls: string[] = [];
  const v = createPromptView(fakeDoc(), {
    press: (d) => calls.push(`press:${d}`), backspace: () => calls.push('backspace'), clear: () => calls.push('clear'),
    submit: () => calls.push('submit'), cancel: () => calls.push('cancel'), close: () => calls.push('close'),
  });
  const root = asEl(v.root);
  return { v, root, calls };
}
const all = (root: FakeElement) => root.textContent;

describe('fenêtre de saisie : affichage', () => {
  test('ni l\'origine ni la raison fournie par la page ne sont affichées : rien de la page n\'entre dans cette fenêtre', () => {
    const { v, root } = make();
    const hostile = '<img src=x onerror=alert(1)>';
    v.update({ ...base, origin: 'https://app.synco.one', reason: hostile });
    expect(all(root)).not.toContain('https://app.synco.one');
    expect(all(root)).not.toContain(hostile);
    expect(all(root)).not.toContain('Demandé par');
    expect(root.findAll((e) => ['img', 'script', 'iframe'].includes(e.tagName))).toEqual([]);
  });

  test('pavé numérique : 0 à 9, effacer, retour arrière, avec libellés accessibles', () => {
    const { v, root, calls } = make();
    v.update(base);
    for (const d of '0123456789') buttonByText(root, d).click();
    buttonByText(root, 'Effacer').click();
    buttonByText(root, '⌫').click();
    expect(calls).toEqual([...'0123456789'].map((d) => `press:${d}`).concat(['clear', 'backspace']));
    const keypad = root.findAll((e) => e.getAttribute('class') === 'keypad')[0]!;
    expect(keypad.findAll((e) => e.tagName === 'button').every((b) => !!b.getAttribute('aria-label'))).toBe(true);
  });

  test('points : un par chiffre, aucun chiffre affiché', () => {
    const { v, root } = make();
    v.update({ ...base, dots: 5 });
    expect(root.findAll((e) => e.getAttribute('class') === 'dot')).toHaveLength(5);
    v.update({ ...base, dots: 0 });
    expect(root.findAll((e) => e.getAttribute('class') === 'dot')).toHaveLength(0);
  });

  test('emplacements vides jusqu\'à la longueur minimale : le champ se remplit au fil de la saisie', () => {
    const { v, root } = make();
    const count = (cls: string) => root.findAll((e) => e.getAttribute('class') === cls).length;
    v.update({ ...base, dots: 0, slots: 4 });
    expect([count('dot'), count('slot')]).toEqual([0, 4]);
    v.update({ ...base, dots: 3, slots: 4 });
    expect([count('dot'), count('slot')]).toEqual([3, 1]);
    v.update({ ...base, dots: 6, slots: 4 });
    expect([count('dot'), count('slot')]).toEqual([6, 0]); // au-delà du minimum : un point par chiffre
  });

  test('boutons : annuler, valider (activé selon l\'état), pavé désactivé pendant le verrouillage', () => {
    const { v, root, calls } = make();
    v.update({ ...base, dots: 4, canSubmit: true });
    buttonByText(root, 'Déverrouiller').click();
    buttonByText(root, 'Annuler').click();
    expect(calls).toEqual(['submit', 'cancel']);
    expect(buttonByText(root, 'Déverrouiller').disabled).toBe(false);

    v.update({ ...base, keypadEnabled: false, canSubmit: false, lockSeconds: 30, remainingSeconds: null });
    expect(buttonByText(root, '5').disabled).toBe(true);
    expect(buttonByText(root, 'Déverrouiller').disabled).toBe(true);
    expect(all(root)).toContain('Prochain essai possible dans 30 s');
  });

  test('vérification en cours : état annoncé, pavé inactif', () => {
    const { v, root } = make();
    v.update({ ...base, phase: 'verifying', keypadEnabled: false, hint: 'Vérification en cours…' });
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(all(root)).toContain('Vérification…');
    expect(buttonByText(root, '1').disabled).toBe(true);
  });

  test('erreur annoncée aux lecteurs d\'écran (role=alert)', () => {
    const { v, root } = make();
    v.update({ ...base, error: 'Code PIN incorrect.' });
    const err = root.findAll((e) => e.getAttribute('role') === 'alert')[0]!;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe('Code PIN incorrect.');
    v.update(base);
    expect(err.hidden).toBe(true);
  });

  test('erreur terminale ou expirée : plus de formulaire, bouton Fermer', () => {
    const { v, root, calls } = make();
    v.update({ ...base, phase: 'fatal', keypadEnabled: false, error: 'Trop d\'erreurs.', remainingSeconds: null });
    const form = root.findAll((e) => e.tagName === 'div' && e.children.some((c) => (c as FakeElement).getAttribute?.('class') === 'keypad'))[0]!;
    expect(form.hidden).toBe(true);
    buttonByText(root, 'Fermer').click();
    expect(calls).toEqual(['close']);
  });

  test('remplacement : l\'avertissement n\'apparaît que pour une création sur un appareil déjà enregistré', () => {
    const { v, root } = make();
    const banner = () => root.findAll((e) => e.textContent.startsWith('Un enregistrement existe déjà'))[0]!;
    v.update({ ...base, mode: 'create', replacing: true });
    expect(banner().hidden).toBe(false);
    v.update({ ...base, mode: 'load', replacing: true });
    expect(banner().hidden).toBe(true);
    v.update({ ...base, mode: 'create', replacing: false });
    expect(banner().hidden).toBe(true);
  });

  test('les limites sont dites : vérifié par l\'extension, effacement après 10 erreurs', () => {
    const { v, root } = make();
    v.update(base);
    expect(all(root)).toContain('Après 10 erreurs');
    expect(all(root)).toContain('Vérifié par l\'extension, pas par le site');
  });

  test('scène de connexion : son état suit la phase de la fenêtre', async () => {
    const { sceneState } = await import('../src/ui/prompt/view');
    expect(sceneState('loading')).toBe('connecting');
    for (const phase of ['enter', 'confirm'] as const) expect(sceneState(phase)).toBe('waiting');
    expect(sceneState('verifying')).toBe('working');
    expect(sceneState('done')).toBe('success');
    for (const phase of ['fatal', 'expired'] as const) expect(sceneState(phase)).toBe('error');
    const { v, root } = make();
    const scene = () => root.findAll((e) => e.getAttribute('class') === 'scene')[0]!;
    v.update(base);
    expect(scene().getAttribute('data-state')).toBe('waiting');
    v.update({ ...base, phase: 'done', title: 'Déverrouillé', hint: 'Vous pouvez retourner sur Synco.' });
    expect(scene().getAttribute('data-state')).toBe('success');
    expect(all(root)).toContain('Déverrouillé');
  });

  test('succès : le formulaire n\'est plus affiché, pas de bouton Fermer', () => {
    const { v, root } = make();
    v.update({ ...base, phase: 'done', keypadEnabled: false, canSubmit: false });
    expect(root.findAll((e) => e.getAttribute('class') === 'form')[0]!.hidden).toBe(true);
    expect(root.findAll((e) => e.tagName === 'button' && e.textContent === 'Fermer')[0]!.parent!.hidden).toBe(true);
  });

  test('chaque nouvelle erreur rejoue la secousse (classes en alternance), l\'absence d\'erreur l\'enlève', () => {
    const { v, root } = make();
    const cls = () => root.findAll((e) => (e.getAttribute('class') ?? '').startsWith('dots'))[0]!.getAttribute('class');
    v.update({ ...base, error: 'Code PIN incorrect.', errorSeq: 1 });
    const first = cls();
    v.update({ ...base, error: 'Code PIN incorrect.', errorSeq: 1 });
    expect(cls()).toBe(first); // même erreur : pas de nouvelle secousse
    v.update({ ...base, error: 'Code PIN incorrect.', errorSeq: 2 });
    expect(cls()).not.toBe(first);
    v.update({ ...base, error: null, errorSeq: 2 });
    expect(cls()).toBe('dots');
  });
});
