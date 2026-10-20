/**
 * Contrat d'un module de l'interface.
 *
 * L'extension a plusieurs fonctions indépendantes (coffre, actions de page, bientôt Synco AI / Tinko). Chacune est un
 * « module » : un onglet dans le popup et dans la page d'options. Ajouter une fonction = écrire un fichier
 * `src/ui/modules/<nom>.ts` qui exporte un `UiModule`, puis l'ajouter à `registry.ts`. Ni le shell, ni la fenêtre du PIN,
 * ni les autres modules ne changent. Voir doc/interface-modulaire.md.
 */
import type { TaskDraft } from '../page-actions/contract';
import type { IconName } from './kit';
import type { OptionsState } from './options/model';

/** Où le module s'affiche : le popup (étroit) ou la page d'options (large). */
export type Surface = 'popup' | 'options';

/** Tout ce que l'interface sait afficher. Un nouveau module y ajoute sa propre clé. */
export interface UiState {
  options: OptionsState;
  draft: TaskDraft | null;
  /** « Comment ça marche ? » déplié dans le popup. */
  help: boolean;
}

/** Actions déclenchées par l'interface. Les actions facultatives n'existent que sur certaines surfaces. */
export interface UiHandlers {
  grantAccess(): void;
  askRemove(origin: string, deviceId: string): void;
  cancelRemove(): void;
  confirmRemove(): void;
  toggleBroad?(): void;
  dismissDraft?(): void;
  toggleHelp?(): void;
  /** Popup : ouvre la page d'options complète. */
  openFull?(): void;
}

export interface ModuleContext {
  doc: Document;
  surface: Surface;
  now: number;
  state: UiState;
  handlers: UiHandlers;
}

export interface UiModule {
  /** Identifiant stable (adresse `#id` de la page d'options). Lettres minuscules et tirets. */
  id: string;
  title: string;
  icon: IconName;
  /** Contenu du module ; `null` = rien à montrer sur cette surface (le module disparaît des onglets). */
  render(ctx: ModuleContext): HTMLElement | null;
  /** Pastille sur l'onglet : un nombre, ou « ! » pour une action attendue. `null` = aucune. */
  badge?(ctx: ModuleContext): { text: string; tone: 'primary' | 'warn' } | null;
}
