import type { UiModule } from './modules';
import { vaultModule } from './modules/vault';

/**
 * Modules affichés, dans l'ordre des onglets. Pour en ajouter un (Synco AI, Tinko…) : créer `src/ui/modules/<nom>.ts`
 * qui exporte un `UiModule`, puis l'ajouter ici. Voir doc/interface-modulaire.md.
 *
 * Le module « Tâches » (modules/tasks.ts) est masqué tant que l'envoi des brouillons à Synco n'est pas branché :
 * il suffira de le remettre ici (et de rendre ses actions au worker, voir background/index.ts).
 */
export const MODULES: readonly UiModule[] = [vaultModule];
