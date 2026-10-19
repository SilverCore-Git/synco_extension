import type { UiModule } from './modules';
import { tasksModule } from './modules/tasks';
import { vaultModule } from './modules/vault';

/**
 * Modules affichés, dans l'ordre des onglets. Pour en ajouter un (Synco AI, Tinko…) : créer `src/ui/modules/<nom>.ts`
 * qui exporte un `UiModule`, puis l'ajouter ici. Voir doc/interface-modulaire.md.
 */
export const MODULES: readonly UiModule[] = [vaultModule, tasksModule];
