import { renderApp } from './app';
import { mount } from './dom';
import type { UiHandlers, Surface } from './modules';
import type { OptionsModel } from './options/model';
import type { TaskDraft } from '../page-actions/contract';

export interface RunProps {
  root: HTMLElement;
  surface: Surface;
  model: OptionsModel;
  handlers: UiHandlers;
  /** Module demandé au départ (adresse de la page d'options). */
  initialActive: string | null;
  /** Appelé quand l'utilisateur change d'onglet (la page d'options met l'adresse à jour). */
  onActive?(id: string): void;
}

/**
 * Dessine l'application à chaque changement d'état. Le contenu est reconstruit : on rend donc le focus au même
 * élément (onglet, bouton à identifiant) pour ne pas perdre le clavier à chaque rafraîchissement.
 */
export function runApp(p: RunProps): { setDraft(draft: TaskDraft | null): void; setActive(id: string | null): void; redraw(): void } {
  let draft: TaskDraft | null = null;
  let active = p.initialActive;

  const redraw = (): void => {
    const hadFocusId = document.activeElement?.id ?? '';
    const page = renderApp({
      doc: document,
      surface: p.surface,
      state: { options: p.model.current, draft },
      handlers: p.handlers,
      version: p.model.current.version,
      active,
      onSelect: (id) => {
        active = id;
        p.onActive?.(id);
        redraw();
        document.getElementById(`tab-${id}`)?.focus();
      },
    });
    mount(p.root, page);
    const autofocus = page.querySelector<HTMLElement>('[data-autofocus]');
    if (autofocus) autofocus.focus();
    else if (hadFocusId) document.getElementById(hadFocusId)?.focus();
  };

  p.model.subscribe(redraw);
  return {
    setDraft(next) {
      draft = next;
      redraw();
    },
    setActive(id) {
      active = id;
      redraw();
    },
    redraw,
  };
}
