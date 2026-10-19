/**
 * Contrat des actions de page : ce que l'extension sait transmettre à Synco depuis n'importe quel site.
 *
 * Phase actuelle : le brouillon est construit, validé et gardé localement. AUCUN envoi (pas de réseau, pas de jeton).
 * Le branchement réel (onglet Synco ouvert, ou ouverture de l'application avec un brouillon) viendra plus tard ;
 * il devra reprendre `CreateTaskMessage` tel quel. Voir doc/page-actions.md.
 *
 * Tout ce qui vient de la page (texte sélectionné, titre, URL) est une DONNÉE non fiable : nettoyée et plafonnée ici.
 */
export const DRAFT_VERSION = 1;

export const LIMITS = { text: 4000, url: 2048, title: 300 } as const;

export interface TaskDraft {
  v: typeof DRAFT_VERSION;
  /** Texte sélectionné (plusieurs lignes possibles). */
  text: string;
  /** URL de la page (http/https, sans identifiants) ; vide si absente ou inutilisable. */
  url: string;
  /** Titre de la page (une ligne) ; peut être vide. */
  title: string;
  /** Instant de la capture (ms). */
  capturedAt: number;
}

/** Message à transmettre à Synco (futur branchement). */
export interface CreateTaskMessage {
  kind: 'synco-page-action';
  v: typeof DRAFT_VERSION;
  action: 'create-task';
  draft: TaskDraft;
}

export type BuildResult = { ok: true; draft: TaskDraft } | { ok: false; reason: 'no-selection' };

// Contrôles, formatage invisible et marques de direction : remplacés par une espace (les retours à la ligne sont gérés à part).
const INVISIBLE = new RegExp(
  '[' + '\\u0000-\\u0008' + '\\u000b\\u000c' + '\\u000e-\\u001f' + '\\u007f-\\u009f' + '\\u200b-\\u200f' + '\\u2028-\\u202e' + '\\u2066-\\u2069' + '\\ufeff' + ']',
  'g',
);

/** Coupe sans couper un caractère en deux (paires de substitution). */
function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

function cleanText(value: unknown, max: number, multiline: boolean): string {
  if (typeof value !== 'string') return '';
  let s = value.replace(/\r\n?/g, '\n').replace(INVISIBLE, ' ');
  if (!multiline) s = s.replace(/\n/g, ' ');
  s = s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return truncate(s, max);
}

/** http(s) seulement, sans identifiants ; une URL trop longue perd sa requête et son fragment, puis est abandonnée. */
export function cleanUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  url.username = '';
  url.password = '';
  if (url.href.length > LIMITS.url) {
    url.search = '';
    url.hash = '';
  }
  return url.href.length > LIMITS.url ? '' : url.href;
}

/** Construit le brouillon depuis les informations du menu contextuel. Sans texte sélectionné, rien n'est créé. */
export function buildDraft(input: { selectionText?: unknown; pageUrl?: unknown; title?: unknown }, now: number): BuildResult {
  const text = cleanText(input.selectionText, LIMITS.text, true);
  if (text === '') return { ok: false, reason: 'no-selection' };
  return {
    ok: true,
    draft: { v: DRAFT_VERSION, text, url: cleanUrl(input.pageUrl), title: cleanText(input.title, LIMITS.title, false), capturedAt: now },
  };
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);

/** Relit un brouillon (stockage, message) : strict, reconstruit, ou `null`. */
export function parseDraft(raw: unknown): TaskDraft | null {
  if (!isPlain(raw) || !sameKeys(raw, ['v', 'text', 'url', 'title', 'capturedAt']) || raw.v !== DRAFT_VERSION) return null;
  const { text, url, title, capturedAt } = raw;
  if (typeof text !== 'string' || typeof url !== 'string' || typeof title !== 'string') return null;
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) return null;
  const clean = buildDraft({ selectionText: text, pageUrl: url, title }, capturedAt);
  // Un brouillon n'est valide que s'il est déjà sous sa forme nettoyée : rien n'est « réparé » en silence.
  if (!clean.ok || clean.draft.text !== text || clean.draft.url !== url || clean.draft.title !== title) return null;
  return clean.draft;
}

export function parseMessage(raw: unknown): CreateTaskMessage | null {
  if (!isPlain(raw) || !sameKeys(raw, ['kind', 'v', 'action', 'draft'])) return null;
  if (raw.kind !== 'synco-page-action' || raw.v !== DRAFT_VERSION || raw.action !== 'create-task') return null;
  const draft = parseDraft(raw.draft);
  return draft ? { kind: 'synco-page-action', v: DRAFT_VERSION, action: 'create-task', draft } : null;
}

export const toMessage = (draft: TaskDraft): CreateTaskMessage => ({ kind: 'synco-page-action', v: DRAFT_VERSION, action: 'create-task', draft });
