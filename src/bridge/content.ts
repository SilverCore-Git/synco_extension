// Content script : injecté uniquement sur les origines Synco (liste blanche générée au build), monde isolé,
// cadre principal seulement. Aucun script n'est injecté dans la page.
import { api } from '../shared/api';
import { startBridge } from './bridge';

/** Défini par scripts/build.mjs : vrai seulement pour `--dev`. Le code de diagnostic disparaît du paquet de production. */
declare const __SYNCO_DEV__: boolean;

/**
 * Diagnostic de développement : inscrit les dernières étapes du handshake dans un attribut de <html>, pour pouvoir
 * constater depuis la console de la page que le content script est injecté. Étiquettes fixes, aucune donnée.
 */
function devDebug(label: string): void {
  try {
    const root = document.documentElement;
    const previous = root.dataset.syncoDebug ? root.dataset.syncoDebug.split(',') : [];
    root.dataset.syncoDebug = [...previous, label].slice(-12).join(',');
  } catch {
    /* document pas encore prêt : sans importance pour un diagnostic */
  }
}

if (__SYNCO_DEV__) devDebug('injecté');

startBridge({
  win: window,
  send: (envelope) => api.runtime.sendMessage(envelope),
  ...(__SYNCO_DEV__ ? { debug: devDebug } : {}),
});
