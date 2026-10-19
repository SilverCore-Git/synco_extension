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
const pending: string[] = [];
const written: string[] = [];

function flushDebug(): void {
  const root = document.documentElement;
  if (!root) return; // Firefox : à `document_start`, <html> peut ne pas exister encore
  written.push(...pending.splice(0));
  root.dataset.syncoDebug = written.slice(-12).join(',');
}

function devDebug(label: string): void {
  pending.push(label);
  try {
    flushDebug();
  } catch {
    /* sans importance pour un diagnostic */
  }
}

if (__SYNCO_DEV__) document.addEventListener('DOMContentLoaded', () => devDebug('page-prête'));

if (__SYNCO_DEV__) devDebug('injecté');

startBridge({
  win: window,
  send: (envelope) => api.runtime.sendMessage(envelope),
  ...(__SYNCO_DEV__ ? { debug: devDebug } : {}),
});
