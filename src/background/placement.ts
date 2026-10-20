/** Rectangle d'une fenêtre du navigateur (pixels d'écran). */
export interface Bounds {
  left?: number | undefined;
  top?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  state?: string | undefined;
}

/** Dimensions de la fenêtre de saisie du PIN : une colonne étroite, assez haute pour le pavé sans défilement. */
export const PROMPT_WINDOW = { width: 400, height: 560 } as const;

/**
 * Disposition « côte à côte » : la carte de Synco (page) et la fenêtre de l'extension forment une paire centrée sur la
 * page, la carte à gauche, la fenêtre à droite. L'application décale sa carte de la même quantité : ces constantes
 * sont la convention commune (synco_app : ExtensionScene.vue). En dessous de `MIN_PAIR_WIDTH`, il n'y a pas la place :
 * la fenêtre se centre et la carte reste au milieu.
 */
export const APP_CARD_WIDTH = 384;
export const PAIR_GAP = 12;
export const MIN_PAIR_WIDTH = 880;

/** Zone visible de la page (onglet) : sert à aligner la fenêtre sur le centre de la page, pas sur celui du cadre du navigateur. */
export interface Viewport {
  width?: number | undefined;
  height?: number | undefined;
}

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Position qui centre la fenêtre du PIN sur la fenêtre du navigateur : elle apparaît « au-dessus » de la page qui l'a
 * demandée, comme une boîte de dialogue, au lieu de surgir n'importe où sur l'écran. `null` quand on ne sait pas
 * (fenêtre minimisée, plein écran, coordonnées absentes) : le navigateur choisit alors lui-même.
 */
export function centerOver(parent: Bounds | undefined, size: { width: number; height: number } = PROMPT_WINDOW): { left: number; top: number } | null {
  if (!parent || parent.state === 'minimized' || parent.state === 'fullscreen') return null;
  if (!ok(parent.left) || !ok(parent.top) || !ok(parent.width) || !ok(parent.height) || parent.width <= 0 || parent.height <= 0) return null;
  // Relatif au navigateur : les coordonnées négatives (second écran à gauche ou au-dessus) sont légitimes. Si le
  // navigateur est plus petit que la fenêtre, on aligne son coin supérieur gauche plutôt que de déborder à gauche.
  return {
    left: Math.round(parent.left + Math.max(0, (parent.width - size.width) / 2)),
    top: Math.round(parent.top + Math.max(0, (parent.height - size.height) / 2)),
  };
}

/**
 * Position « côte à côte » : à droite de la carte de Synco, au même niveau. Le centre vertical est celui de la page
 * (le cadre du navigateur a une barre d'outils au-dessus), le centre horizontal celui de la fenêtre. `null` si la
 * fenêtre ou la page est trop étroite pour la paire : l'appelant se replie sur `centerOver`.
 */
export function besideApp(
  parent: Bounds | undefined,
  viewport: Viewport | undefined,
  size: { width: number; height: number } = PROMPT_WINDOW,
): { left: number; top: number } | null {
  const centered = centerOver(parent, size);
  if (!parent || !centered || !ok(parent.width) || parent.width < MIN_PAIR_WIDTH) return null;
  const left = Math.round(parent.left! + parent.width / 2 + (APP_CARD_WIDTH + PAIR_GAP - size.width) / 2);
  // Zone visible connue : on centre dessus (le haut de la page est sous la barre d'outils). Sinon, centre de la fenêtre.
  const vh = viewport?.height;
  const hasViewport = ok(vh) && vh > 0 && vh <= parent.height!;
  const centerY = hasViewport ? parent.top! + (parent.height! - vh) + vh / 2 : parent.top! + parent.height! / 2;
  return { left, top: Math.round(centerY - size.height / 2) };
}
