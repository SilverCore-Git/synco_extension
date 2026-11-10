import { describe, expect, test } from 'bun:test';
import type { PromptInfo, SubmitOutcome } from '../src/background/prompt';
import { AUTO_SUBMIT_MS, PromptController, type PromptBackend, type PromptView } from '../src/ui/prompt/controller';

const ORIGIN = 'https://app.synco.one';

function setup(over: Partial<PromptInfo> = {}, handlers: { submit?: (pin: string | null) => Promise<SubmitOutcome>; ping?: () => Promise<boolean>; hello?: PromptBackend['hello'] } = {}) {
  let t = 1_000_000;
  // Par défaut, un ancien enregistrement à PIN (le pavé) ; `needsPin: false` donne le bouton « Autoriser ».
  const info: PromptInfo = { origin: ORIGIN, mode: 'load', reason: null, replacing: false, needsPin: true, minPin: 4, maxPin: 8, expiresAt: t + 120_000, ...over };
  const calls = { submit: [] as (string | null)[], ping: 0, cancel: 0, close: 0 };
  const scheduled: { fn: () => void; ms: number }[] = [];
  const backend: PromptBackend = {
    hello: handlers.hello ?? (async () => ({ ok: true, info })),
    ping: async () => {
      calls.ping++;
      return handlers.ping ? handlers.ping() : true;
    },
    submit: async (pin) => {
      calls.submit.push(pin);
      return handlers.submit ? handlers.submit(pin) : { ok: true };
    },
    cancel: async () => {
      calls.cancel++;
    },
  };
  const c = new PromptController({ backend, close: () => calls.close++, now: () => t, pingEveryMs: 10_000, schedule: (fn, ms) => scheduled.push({ fn, ms }), successHoldMs: 1400 });
  let view!: PromptView;
  c.subscribe((v) => (view = v));
  const advance = (ms: number) => {
    t += ms;
    c.tick();
  };
  const type = (digits: string) => [...digits].forEach((d) => c.press(d));
  return { c, calls, scheduled, get view() { return view; }, advance, type };
}

const wrong = (code = 'wrong-pin', extra: object = {}): SubmitOutcome => ({ ok: false, error: { code, terminal: false, ...extra } } as SubmitOutcome);

describe('déverrouillage (load)', () => {
  test('ouverture : affiche l\'origine fournie par le worker, puis la saisie', async () => {
    const s = setup({ reason: 'Ouvrir Synco' });
    expect(s.view.phase).toBe('loading');
    await s.c.start();
    expect(s.view).toMatchObject({ phase: 'enter', origin: ORIGIN, reason: 'Ouvrir Synco', title: 'Entrez votre code PIN', keypadEnabled: true, canSubmit: false });
  });

  test('saisie : seuls les chiffres, plafond de longueur, le nombre de chiffres (jamais leur valeur) est exposé', async () => {
    const s = setup();
    await s.c.start();
    for (const bad of ['a', ' ', '12', '', '٣', '+']) s.c.press(bad);
    expect(s.view.dots).toBe(0);
    s.type('123456789');
    expect(s.view.dots).toBe(4); // PIN_LENGTH : 4 chiffres, comme le PIN local de Synco
    expect(JSON.stringify(s.view)).not.toContain('1234');
    s.c.backspace();
    expect(s.view.dots).toBe(3);
    s.c.clear();
    expect(s.view.dots).toBe(0);
  });

  test('validation automatique au 4e chiffre ; un retour arrière avant l\'échéance l\'annule', async () => {
    const s = setup();
    await s.c.start();
    s.type('482');
    expect(s.scheduled).toEqual([]);
    s.type('1');
    expect(s.scheduled.map((x) => x.ms)).toEqual([AUTO_SUBMIT_MS]);
    s.scheduled[0]!.fn();
    await Promise.resolve();
    expect(s.calls.submit).toEqual(['4821']);

    const t = setup();
    await t.c.start();
    t.type('4821');
    t.c.backspace();
    t.scheduled[0]!.fn();
    await Promise.resolve();
    expect(t.calls.submit).toEqual([]);
    expect(t.view.error).toBeNull();
  });

  test('moins de 4 chiffres : refus local, rien n\'est envoyé', async () => {
    const s = setup();
    await s.c.start();
    s.type('123');
    expect(s.view.canSubmit).toBe(false);
    await s.c.submit();
    expect(s.view.error).toContain('4 chiffres');
    expect(s.calls.submit).toEqual([]);
  });

  test('bon PIN : envoyé une fois, état « vérification », puis la fenêtre se ferme', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({}, { submit: async () => (await gate, { ok: true }) });
    await s.c.start();
    s.type('4821');
    s.scheduled.length = 0; // validation automatique planifiée : on valide ici à la main
    const done = s.c.submit();
    expect(s.view.phase).toBe('verifying');
    expect(s.view.dots).toBe(0); // le PIN est vidé dès l'envoi
    expect(s.view.keypadEnabled).toBe(false);
    await s.c.submit(); // second appui pendant la vérification : ignoré
    release();
    await done;
    expect(s.calls.submit).toEqual(['4821']);
    expect(s.view.phase).toBe('done');
    // La réussite reste affichée un instant (la page de Synco montre la même), puis la fenêtre se ferme.
    expect(s.view).toMatchObject({ title: 'Déverrouillé', hint: 'Vous pouvez retourner sur Synco.' });
    expect(s.calls.close).toBe(0);
    expect(s.scheduled).toHaveLength(1);
    expect(s.scheduled[0]!.ms).toBe(1400);
    s.scheduled[0]!.fn();
    expect(s.calls.close).toBe(1);
  });

  test('chaque erreur incrémente le compteur qui rejoue la secousse ; le titre suit la vérification', async () => {
    const s = setup({}, { submit: async () => wrong() });
    await s.c.start();
    expect(s.view.errorSeq).toBe(0);
    s.type('4821');
    await s.c.submit();
    expect(s.view.errorSeq).toBe(1);
    s.type('4821');
    await s.c.submit();
    expect(s.view.errorSeq).toBe(2);
    s.advance(1000); // un simple tick ne rejoue rien
    expect(s.view.errorSeq).toBe(2);
  });

  test('mauvais PIN : message, saisie vidée, nouvelle tentative possible', async () => {
    const s = setup({}, { submit: async () => wrong() });
    await s.c.start();
    s.type('1111');
    await s.c.submit();
    expect(s.view).toMatchObject({ phase: 'enter', error: 'Code PIN incorrect.', dots: 0, keypadEnabled: true });
    s.type('2222');
    expect(s.view.error).toBeNull(); // l'erreur disparaît à la saisie suivante
  });

  test('mauvais PIN avec délai : pavé bloqué et compte à rebours, puis déblocage', async () => {
    const s = setup({}, { submit: async () => wrong('wrong-pin', { retryAfterSeconds: 30 }) });
    await s.c.start();
    s.type('1111');
    await s.c.submit();
    expect(s.view.error).toContain('30 s');
    expect(s.view).toMatchObject({ keypadEnabled: false, lockSeconds: 30 });
    s.c.press('1'); // ignoré
    expect(s.view.dots).toBe(0);
    s.advance(29_000);
    expect(s.view.lockSeconds).toBe(1);
    expect(s.view.keypadEnabled).toBe(false);
    s.advance(1_000);
    expect(s.view).toMatchObject({ keypadEnabled: true, lockSeconds: null, error: null });
  });

  test.each([
    ['wiped', 'effacée'],
    ['locked', 'Réessayez'],
    ['unavailable', 'ne peut pas lire'],
    ['cancelled', 'plus valide'],
    ['missing', 'Aucune clé'],
  ])('erreur terminale %s : message en français, plus de saisie, bouton Fermer', async (code, text) => {
    const s = setup({}, { submit: async () => ({ ok: false, error: { code, terminal: true, retryAfterSeconds: code === 'locked' ? 60 : undefined } } as SubmitOutcome) });
    await s.c.start();
    s.type('1111');
    await s.c.submit();
    expect(s.view.phase).toBe('fatal');
    expect(s.view.error).toContain(text);
    expect(s.view.keypadEnabled).toBe(false);
    s.c.press('1');
    expect(s.view.dots).toBe(0);
    expect(s.calls.close).toBe(0); // la fenêtre reste ouverte : l'utilisateur lit le message
  });

  test('worker injoignable pendant l\'envoi : erreur terminale, sans exception', async () => {
    const s = setup({}, { submit: async () => { throw new Error('port fermé'); } });
    await s.c.start();
    s.type('1111');
    await s.c.submit();
    expect(s.view.phase).toBe('fatal');
    expect(s.view.error).not.toContain('port fermé');
  });
});

describe('création (create) : double saisie', () => {
  test('choix puis confirmation identique : un seul envoi', async () => {
    const s = setup({ mode: 'create' });
    await s.c.start();
    expect(s.view).toMatchObject({ title: 'Choisissez un code PIN', submitLabel: 'OK' });
    s.type('4821');
    expect(s.scheduled).toEqual([]); // jamais de validation automatique pour choisir un code : on relit
    await s.c.submit();
    expect(s.view).toMatchObject({ phase: 'confirm', title: 'Confirmez votre code', submitLabel: 'OK', dots: 0 });
    expect(s.calls.submit).toEqual([]); // rien n'est envoyé avant la confirmation
    s.type('4821');
    await s.c.submit();
    expect(s.calls.submit).toEqual(['4821']);
    expect(s.view.phase).toBe('done');
  });

  test('confirmation différente : retour au choix, rien n\'est envoyé', async () => {
    const s = setup({ mode: 'create' });
    await s.c.start();
    s.type('4821');
    await s.c.submit();
    s.type('4822');
    await s.c.submit();
    expect(s.view).toMatchObject({ phase: 'enter', title: 'Choisissez un code PIN', dots: 0 });
    expect(s.view.error).toContain('ne correspondent pas');
    expect(s.calls.submit).toEqual([]);
    // et le premier code n'est pas resté en mémoire : saisir « 4822 » deux fois fonctionne
    s.type('4822'); await s.c.submit(); s.type('4822'); await s.c.submit();
    expect(s.calls.submit).toEqual(['4822']);
  });

  test('enregistrement existant : l\'avertissement de remplacement est exposé', async () => {
    const s = setup({ mode: 'create', replacing: true });
    await s.c.start();
    expect(s.view.replacing).toBe(true);
  });
});

describe('annulation, expiration, signe de vie', () => {
  test('annuler : PIN effacé, worker prévenu, fenêtre fermée', async () => {
    const s = setup();
    await s.c.start();
    s.type('1234');
    await s.c.cancel();
    expect(s.view.dots).toBe(0);
    expect(s.calls).toMatchObject({ cancel: 1, close: 1, submit: [] });
  });

  test('annuler fonctionne même si le worker ne répond plus', async () => {
    const s = setup();
    await s.c.start();
    (s.c as unknown as { deps: { backend: PromptBackend } }).deps.backend.cancel = async () => { throw new Error('mort'); };
    await s.c.cancel();
    expect(s.calls.close).toBe(1);
  });

  test('l\'invite expire à l\'heure du worker : saisie effacée, message, plus de pavé', async () => {
    const s = setup();
    await s.c.start();
    s.type('1234');
    expect(s.view.remainingSeconds).toBe(120);
    s.advance(60_000);
    expect(s.view.remainingSeconds).toBe(60);
    s.advance(60_000);
    expect(s.view).toMatchObject({ phase: 'expired', dots: 0, keypadEnabled: false });
    expect(s.view.error).toContain('plus valide');
    s.c.press('1');
    expect(s.view.dots).toBe(0);
  });

  test('ping toutes les 10 s pour garder le worker éveillé ; pas de ping une fois terminé', async () => {
    const s = setup();
    await s.c.start();
    s.advance(9_000);
    expect(s.calls.ping).toBe(0);
    s.advance(1_000);
    expect(s.calls.ping).toBe(1);
    s.advance(10_000);
    expect(s.calls.ping).toBe(2);
    await s.c.cancel();
    s.advance(30_000);
    expect(s.calls.ping).toBeLessThanOrEqual(3);
  });

  test('le worker dit que la session n\'existe plus : « expirée », saisie effacée', async () => {
    const s = setup({}, { ping: async () => false });
    await s.c.start();
    s.type('1234');
    s.advance(10_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(s.view.phase).toBe('expired');
    expect(s.view.dots).toBe(0);
  });

  test('session inconnue du worker au démarrage : expirée, sans pavé', async () => {
    const s = setup({}, { hello: async () => ({ ok: false }) });
    await s.c.start();
    expect(s.view).toMatchObject({ phase: 'expired', keypadEnabled: false, origin: null });
  });

  test('worker injoignable au démarrage : expirée', async () => {
    const s = setup({}, { hello: async () => { throw new Error('x'); } });
    await s.c.start();
    expect(s.view.phase).toBe('expired');
  });
});

describe('accord sans PIN (cas normal)', () => {
  test('ouverture : bouton « Autoriser », pas de pavé ; un clic envoie un accord sans PIN, puis la fenêtre se ferme', async () => {
    const st = setup({ needsPin: false });
    const { c, calls, scheduled } = st;
    const get = () => st.view;
    await c.start();
    expect(get().phase).toBe('approve');
    expect(get().pinEntry).toBe(false);
    expect(get().title).toBe('Ouvrir Synco ?');
    expect(get().submitLabel).toBe('Autoriser');
    expect(get().canSubmit).toBe(true);
    c.press('1'); // le pavé n'existe pas : rien n'est saisi
    expect(get().dots).toBe(0);
    await c.submit();
    expect(calls.submit).toEqual([null]);
    expect(get().phase).toBe('done');
    scheduled.at(-1)!.fn();
    expect(calls.close).toBe(1);
  });

  test('création : « Protéger cet appareil », un seul clic, aucune double saisie', async () => {
    const st = setup({ needsPin: false, mode: 'create' });
    const { c, calls, scheduled } = st;
    const get = () => st.view;
    await c.start();
    expect(get().title).toBe('Protéger cet appareil');
    await c.submit();
    expect(calls.submit).toEqual([null]);
  });

  test('ancien enregistrement : le pavé est affiché et le texte dit que c\'est la dernière fois', async () => {
    const st = setup();
    const { c, calls, scheduled } = st;
    const get = () => st.view;
    await c.start();
    expect(get().phase).toBe('enter');
    expect(get().pinEntry).toBe(true);
    expect(get().hint).toContain('dernière fois');
  });

  test('erreur terminale après l\'accord : affichée, rien n\'est relancé', async () => {
    const st = setup({ needsPin: false }, { submit: async () => ({ ok: false, error: { code: 'unavailable', terminal: true } }) });
    const { c, calls, scheduled } = st;
    const get = () => st.view;
    await c.start();
    await c.submit();
    expect(get().phase).toBe('fatal');
    expect(calls.submit).toHaveLength(1);
  });
});
