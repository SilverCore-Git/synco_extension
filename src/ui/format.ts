/** Durée lisible en français : « 45 s », « 2 min 10 s », « 1 h », « 1 j ». */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m} min ${r} s`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h === 0 ? `${d} j` : `${d} j ${h} h`;
}

/** Minuterie « mm:ss ». */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(timestampMs: number, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(timestampMs));
}

/** Début d'un identifiant d'appareil : suffisant pour s'y retrouver, sans afficher l'identifiant entier. */
export function shortId(uuid: string): string {
  return `${uuid.slice(0, 8)}…`;
}

const ERRORS: Record<string, string> = {
  'wrong-pin': 'Code PIN incorrect.',
  wiped: 'Trop d\'erreurs : la clé de cet appareil a été effacée de l\'extension. Il faudra relier de nouveau cet appareil depuis Synco.',
  cancelled: 'Cette demande n\'est plus valide. Fermez cette fenêtre et recommencez depuis Synco.',
  missing: 'Aucune clé n\'est enregistrée dans l\'extension pour cet appareil.',
  unavailable: 'L\'extension ne peut pas lire cet enregistrement pour le moment. Fermez cette fenêtre et réessayez.',
  'bad-request': 'Demande invalide.',
  'pin-required': 'Saisissez votre code PIN.',
};

/** Message d'erreur en français pour un code de coffre. */
export function describeError(code: string, retryAfterSeconds?: number): string {
  if (code === 'locked') {
    return retryAfterSeconds === undefined
      ? 'Trop d\'essais. Réessayez plus tard.'
      : `Trop d'essais. Réessayez dans ${formatDuration(retryAfterSeconds)}.`;
  }
  const base = ERRORS[code] ?? ERRORS.unavailable!;
  return code === 'wrong-pin' && retryAfterSeconds !== undefined
    ? `${base} Prochain essai possible dans ${formatDuration(retryAfterSeconds)}.`
    : base;
}
