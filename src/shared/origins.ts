import { isValidOrigin } from './origin';

/** Injecté par scripts/build.mjs depuis config/origins.json (liste blanche du mode de build). */
declare const __SYNCO_ORIGINS__: readonly string[] | undefined;

export const BUILT_IN_ORIGINS: readonly string[] = typeof __SYNCO_ORIGINS__ === 'undefined' ? [] : __SYNCO_ORIGINS__;

/** Correspondance exacte, jamais de joker ni de sous-domaine implicite. */
export function isAllowedOrigin(origin: unknown, allowed: readonly string[]): origin is string {
  return isValidOrigin(origin) && allowed.includes(origin);
}
