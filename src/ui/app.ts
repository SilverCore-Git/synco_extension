import { banner } from './kit';
import type { ModuleContext, Surface, UiHandlers, UiModule, UiState } from './modules';
import { MODULES } from './registry';
import { renderShell, type ShellTab } from './shell';

export interface AppProps {
  doc: Document;
  surface: Surface;
  state: UiState;
  handlers: UiHandlers;
  version: string;
  /** Module demandé (adresse, clic) ; ignoré s'il n'est pas visible. */
  active: string | null;
  onSelect(id: string): void;
  now?: number;
  /** Les modules à afficher (le registre par défaut ; remplaçable pour les tests). */
  modules?: readonly UiModule[];
}

interface Rendered {
  module: UiModule;
  content: HTMLElement;
  badge: ShellTab['badge'];
}

/** Rend chaque module ; un module qui plante ou qui n'a rien à montrer ne dérange pas les autres. */
function renderModules(modules: readonly UiModule[], ctx: ModuleContext): Rendered[] {
  const out: Rendered[] = [];
  for (const module of modules) {
    try {
      const content = module.render(ctx);
      if (content) out.push({ module, content, badge: module.badge?.(ctx) ?? null });
    } catch {
      out.push({ module, content: banner(ctx.doc, 'error', `Le module « ${module.title} » n'a pas pu s'afficher.`), badge: null });
    }
  }
  return out;
}

/**
 * Module à ouvrir : celui demandé s'il est visible, sinon le premier qui attend quelque chose de l'utilisateur
 * (pastille), sinon le premier.
 */
export function pickActive(rendered: readonly { module: { id: string }; badge: unknown }[], requested: string | null): string {
  if (requested && rendered.some((r) => r.module.id === requested)) return requested;
  return (rendered.find((r) => r.badge) ?? rendered[0])?.module.id ?? '';
}

export function renderApp(p: AppProps): HTMLElement {
  const ctx: ModuleContext = { doc: p.doc, surface: p.surface, now: p.now ?? Date.now(), state: p.state, handlers: p.handlers };
  const rendered = renderModules(p.modules ?? MODULES, ctx);
  const o = p.state.options;

  const banners = [
    o.error ? banner(p.doc, 'error', o.error) : null,
    o.notice ? banner(p.doc, 'warn', o.notice) : null,
  ].filter((b): b is HTMLElement => b !== null);

  return renderShell(p.doc, {
    surface: p.surface,
    version: o.version,
    tabs: rendered.map((r) => ({ id: r.module.id, title: r.module.title, icon: r.module.icon, badge: r.badge, content: r.content })),
    active: pickActive(rendered, p.active),
    banners,
    onSelect: p.onSelect,
    openFull: p.handlers.openFull,
  });
}
