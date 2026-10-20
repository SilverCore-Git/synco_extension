import { describe, expect, test } from 'bun:test';
import { APP_CARD_WIDTH, besideApp, centerOver, MIN_PAIR_WIDTH, PAIR_GAP, PROMPT_WINDOW } from '../src/background/placement';

const W = { width: 400, height: 700 };

describe('placement de la fenêtre du PIN', () => {
  test('centrée sur la fenêtre du navigateur', () => {
    expect(centerOver({ left: 100, top: 50, width: 1400, height: 900 }, W)).toEqual({ left: 600, top: 150 });
  });

  test('taille par défaut : celle de la fenêtre du PIN', () => {
    expect(centerOver({ left: 0, top: 0, width: 1000, height: 800 })).toEqual({ left: (1000 - PROMPT_WINDOW.width) / 2, top: (800 - PROMPT_WINDOW.height) / 2 });
  });

  test('navigateur plus petit que la fenêtre : alignée sur son coin supérieur gauche, jamais décalée vers la gauche', () => {
    expect(centerOver({ left: 0, top: 0, width: 300, height: 500 }, W)).toEqual({ left: 0, top: 0 });
    expect(centerOver({ left: 10, top: 40, width: 420, height: 720 }, W)).toEqual({ left: 20, top: 50 });
  });

  test('second écran à gauche ou au-dessus (coordonnées négatives) : la fenêtre suit le navigateur, pas l\'écran principal', () => {
    expect(centerOver({ left: -1920, top: 0, width: 1920, height: 1080 }, W)).toEqual({ left: -1160, top: 190 });
    expect(centerOver({ left: 0, top: -1080, width: 1920, height: 1080 }, W)).toEqual({ left: 760, top: -890 });
  });

  test.each([
    ['absente', undefined],
    ['minimisée', { left: 0, top: 0, width: 1000, height: 800, state: 'minimized' }],
    ['plein écran', { left: 0, top: 0, width: 1000, height: 800, state: 'fullscreen' }],
    ['sans coordonnées', { width: 1000, height: 800 }],
    ['taille nulle', { left: 0, top: 0, width: 0, height: 0 }],
    ['valeurs invalides', { left: NaN, top: 0, width: 1000, height: 800 }],
  ])('position inconnue (%s) : le navigateur choisit', (_n, parent) => {
    expect(centerOver(parent, W)).toBeNull();
  });
});

describe('placement côte à côte avec la carte de Synco', () => {
  const W = { width: 400, height: 560 };
  const parent = { left: 100, top: 50, width: 1400, height: 900 };

  test('à droite de la carte : la paire (carte + écart + fenêtre) est centrée sur le navigateur', () => {
    const pos = besideApp(parent, undefined, W)!;
    const pairWidth = APP_CARD_WIDTH + PAIR_GAP + W.width;
    const pairLeft = parent.left + (parent.width - pairWidth) / 2;
    expect(pos.left).toBe(Math.round(pairLeft + APP_CARD_WIDTH + PAIR_GAP)); // juste après la carte
    expect(pos.left).toBeGreaterThan(parent.left + parent.width / 2 - W.width); // bien à droite du centre
  });

  test('verticalement : centrée sur la page visible (sous la barre d\'outils), pas sur le cadre du navigateur', () => {
    const framed = besideApp(parent, undefined, W)!;
    expect(framed.top).toBe(50 + 450 - 280); // sans zone visible connue : centre du cadre
    const viewport = besideApp(parent, { width: 1400, height: 800 }, W)!;
    expect(viewport.top).toBe(50 + 100 + 400 - 280); // 100 px de barre d'outils au-dessus de la page
    expect(viewport.top).toBeGreaterThan(framed.top);
  });

  test('zone visible absurde (plus haute que le cadre, nulle) : ignorée', () => {
    const base = besideApp(parent, undefined, W)!;
    for (const vp of [{ height: 5000 }, { height: 0 }, { height: NaN }, {}]) expect(besideApp(parent, vp, W)).toEqual(base);
  });

  test('navigateur trop étroit pour la paire : null (l\'appelant se replie sur le centrage)', () => {
    expect(besideApp({ ...parent, width: MIN_PAIR_WIDTH - 1 }, undefined, W)).toBeNull();
    expect(besideApp({ ...parent, width: MIN_PAIR_WIDTH }, undefined, W)).not.toBeNull();
  });

  test.each([
    ['absente', undefined],
    ['minimisée', { ...parent, state: 'minimized' }],
    ['plein écran', { ...parent, state: 'fullscreen' }],
    ['sans coordonnées', { width: 1400, height: 900 }],
  ])('fenêtre %s : null', (_n, p) => {
    expect(besideApp(p, undefined, W)).toBeNull();
  });

  test('second écran à gauche : la paire suit le navigateur', () => {
    const pos = besideApp({ left: -1920, top: 0, width: 1920, height: 1080 }, undefined, W)!;
    expect(pos.left).toBeLessThan(0);
  });

  test('la fenêtre du PIN est basse : 560 px', () => {
    expect(PROMPT_WINDOW.height).toBe(560);
  });
});
