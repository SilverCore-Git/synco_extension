// Content script : injecté uniquement sur les origines Synco (liste blanche générée au build), monde isolé,
// cadre principal seulement. Aucun script n'est injecté dans la page.
import { api } from '../shared/api';
import { startBridge } from './bridge';

startBridge({
  win: window,
  send: (envelope) => api.runtime.sendMessage(envelope),
});
