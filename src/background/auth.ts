import { isAllowedOrigin } from '../shared/origins';
import { OPTIONS_PAGE, POPUP_PAGE, PROMPT_PAGE } from '../shared/protocol';

/** Sous-ensemble de `runtime.MessageSender` utilisé ici. Tout vient du navigateur, jamais du message. */
export interface SenderLike {
  id?: string | undefined;
  url?: string | undefined;
  origin?: string | undefined;
  frameId?: number | undefined;
  tab?: { id?: number | undefined } | undefined;
}

export type AuthResult = { ok: true; origin: string; tabId: number } | { ok: false; reason: string };

export interface AuthContext {
  allowedOrigins: readonly string[];
  extensionId: string;
}

/**
 * Authentifie l'appelant d'une opération du coffre à partir de `sender` UNIQUEMENT.
 *
 * Exige : message de cette extension, cadre principal (`frameId === 0`, pas d'iframe), onglet connu, et une origine
 * (`sender.origin`, et `sender.url` si présent, qui doivent concorder) égale à une origine de la liste blanche.
 */
export function authenticateSender(sender: SenderLike | undefined, ctx: AuthContext): AuthResult {
  if (!sender) return { ok: false, reason: 'no-sender' };
  if (!ctx.extensionId || sender.id !== ctx.extensionId) return { ok: false, reason: 'foreign-extension' };
  if (sender.frameId !== 0) return { ok: false, reason: 'not-top-frame' };
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number' || !Number.isInteger(tabId) || tabId < 0) return { ok: false, reason: 'no-tab' };

  let fromUrl: string | undefined;
  if (sender.url !== undefined) {
    try {
      fromUrl = new URL(sender.url).origin;
    } catch {
      return { ok: false, reason: 'bad-url' };
    }
  }
  const origin = sender.origin ?? fromUrl;
  if (origin === undefined) return { ok: false, reason: 'no-origin' };
  if (fromUrl !== undefined && fromUrl !== origin) return { ok: false, reason: 'origin-mismatch' };
  if (!isAllowedOrigin(origin, ctx.allowedOrigins)) return { ok: false, reason: 'origin-not-allowed' };
  return { ok: true, origin, tabId };
}

/** Vrai si `sender` est une page précise de cette extension (prompt.html, options.html, popup.html). */
export function isExtensionPage(
  sender: SenderLike | undefined,
  ctx: { extensionId: string; baseUrl: string },
  page: typeof PROMPT_PAGE | typeof OPTIONS_PAGE | typeof POPUP_PAGE,
): boolean {
  if (!sender || !ctx.extensionId || sender.id !== ctx.extensionId || sender.url === undefined) return false;
  try {
    const url = new URL(sender.url);
    const base = new URL(ctx.baseUrl);
    return url.origin === base.origin && url.pathname === `/${page}`;
  } catch {
    return false;
  }
}
