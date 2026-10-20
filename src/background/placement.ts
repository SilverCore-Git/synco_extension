/** Rectangle d'une fenêtre du navigateur (pixels d'écran). */
export interface Bounds {
  left?: number | undefined;
  top?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  state?: string | undefined;
}

/** Dimensions de la fenêtre de saisie du PIN : une colonne étroite, assez haute pour le pavé sans défilement. */
export const PROMPT_WINDOW = { width: 400, height: 700 } as const;

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
