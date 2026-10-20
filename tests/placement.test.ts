import { describe, expect, test } from 'bun:test';
import { centerOver, PROMPT_WINDOW } from '../src/background/placement';

const W = { width: 400, height: 700 };

describe('placement de la fenêtre du PIN', () => {
  test('centrée sur la fenêtre du navigateur', () => {
    expect(centerOver({ left: 100, top: 50, width: 1400, height: 900 }, W)).toEqual({ left: 600, top: 150 });
  });

  test('taille par défaut : celle de la fenêtre du PIN', () => {
    expect(centerOver({ left: 0, top: 0, width: 1000, height: 800 })).toEqual({ left: (1000 - PROMPT_WINDOW.width) / 2, top: 50 });
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
