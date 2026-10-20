import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { OPS, MAX_REASON_LENGTH, MAX_REQUEST_BYTES, PROTOCOL_VERSION } from '../src/shared/protocol';
import {
  BACKOFF_STEPS_SECONDS,
  DK_LENGTH,
  FREE_FAILURES,
  IV_LENGTH,
  MAX_FAILURES,
  MAX_ITERATIONS,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  PIN_ITERATIONS,
  SALT_LENGTH,
} from '../src/vault/constants';
import { aadDeviceSecret, aadPin } from '../src/vault/crypto';
import origins from '../config/origins.json';

const DOC_URL = new URL('../doc/16-coffre-extension.md', import.meta.url);
// Espaces et retours à la ligne ramenés à une espace : le test ne dépend pas de la mise en forme.
const doc = readFileSync(DOC_URL, 'utf8').replace(/\s+/g, ' ');

/** 600000 → « 600 000 », comme dans le texte. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const duration = (s: number) => (s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : `${s} s`);

// Tous les codes que le protocole peut renvoyer (union `ErrorCode` de protocol.ts, recopiée par le pont).
const CODES = ['pin-required', 'wrong-pin', 'locked', 'wiped', 'cancelled', 'unavailable', 'missing', 'bad-request', 'unsupported-protocol'];

describe('doc/16-coffre-extension.md concorde avec le code', () => {
  test('chaque opération et chaque code d\'erreur est documenté', () => {
    for (const op of OPS) expect({ op, documented: doc.includes(`| \`${op}\` |`) }).toEqual({ op, documented: true });
    for (const code of CODES) expect({ code, documented: doc.includes(`| \`${code}\` |`) }).toEqual({ code, documented: true });
  });

  test('protocole, plafonds et longueurs', () => {
    expect(doc).toContain(`protocol: ${PROTOCOL_VERSION} }`);
    expect(doc).toContain(`au plus ${MAX_REQUEST_BYTES} octets`);
    expect(doc).toContain(`au plus ${MAX_REASON_LENGTH} caractères`);
    expect(doc).toContain('Rien de ce que la page fournit n\'est affiché');
    expect(doc).toContain(`de ${MIN_PIN_LENGTH} à ${MAX_PIN_LENGTH} chiffres`);
    expect(doc).toContain(`\`ArrayBuffer\` de ${DK_LENGTH} octets`);
  });

  test('cryptographie : itérations, sel, IV, AAD exactes', () => {
    expect(doc).toContain(`| ${grouped(PIN_ITERATIONS)} (PBKDF2-SHA-256)`);
    expect(doc).toContain(`au-delà de ${grouped(MAX_ITERATIONS)}`);
    expect(doc).toContain(`${SALT_LENGTH} octets aléatoires`);
    expect(doc).toContain(`Les IV font ${IV_LENGTH} octets`);
    const dec = new TextDecoder();
    expect(doc).toContain(`AAD = "${dec.decode(aadPin('<origine>', '<deviceId>'))}"`);
    expect(doc).toContain(`AAD = "${dec.decode(aadDeviceSecret('<origine>', '<deviceId>'))}"`);
  });

  test('barème du compteur d\'essais', () => {
    expect(doc).toContain(`| 1 à ${FREE_FAILURES} | aucune attente |`);
    // Le 10ᵉ échec efface : seuls les paliers atteignables avant lui sont documentés.
    const reachable = MAX_FAILURES - FREE_FAILURES - 1;
    for (let i = 0; i < reachable; i++) {
      expect(doc).toContain(`| ${FREE_FAILURES + 1 + i} | ${duration(BACKOFF_STEPS_SECONDS[i]!)} |`);
    }
    expect(doc).toContain(`| ${MAX_FAILURES} | **effacement**`);
  });

  test('document public : origine de production seulement, aucune origine de développement', () => {
    for (const o of origins.production) expect(doc).toContain(o);
    for (const o of origins.development) expect(doc).not.toContain(new URL(o).hostname);
  });

  test('les liens relatifs pointent vers des fichiers existants', () => {
    const links = [...doc.matchAll(/\]\(([^)#:]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(3);
    for (const link of links) expect({ link, exists: existsSync(new URL(link, DOC_URL)) }).toEqual({ link, exists: true });
  });
});
