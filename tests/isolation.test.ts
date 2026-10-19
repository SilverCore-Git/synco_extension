import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Isolation des actions de page : valables sur tous les sites, elles ne doivent JAMAIS pouvoir toucher au coffre.
 * Le test suit les imports (y compris transitifs) : un import interdit, même indirect, fait échouer le test.
 */
const SRC = resolve(import.meta.dir, '../src');

const listTs = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listTs(p) : p.endsWith('.ts') ? [p] : [];
  });

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Spécificateurs d'import statiques, réexports, imports dynamiques et require. */
export function specifiers(code: string): string[] {
  const out: string[] = [];
  const re = /(?:\bimport\b|\bexport\b)[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of strip(code).matchAll(re)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4])!);
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // paquet externe : il n'y en a aucun à l'exécution
  const base = resolve(dirname(from), spec);
  for (const c of [`${base}.ts`, join(base, 'index.ts'), base]) if (existsSync(c) && statSync(c).isFile()) return c;
  return base;
}

/** Fermeture transitive des fichiers atteints depuis `roots`. */
export function closure(roots: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const deps: string[] = [];
    if (existsSync(file) && file.endsWith('.ts')) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        const r = resolveImport(file, spec);
        if (r) {
          deps.push(r);
          queue.push(r);
        }
      }
    }
    seen.set(file, deps);
  }
  return seen;
}

const inDir = (file: string, dir: string) => file === join(SRC, dir) || file.startsWith(join(SRC, dir) + '/');
const rel = (f: string) => relative(SRC, f);

describe('page-actions n\'atteint jamais le coffre', () => {
  const files = listTs(join(SRC, 'page-actions'));
  const reached = closure(files);

  test('le module est analysé', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(reached.size).toBeGreaterThan(files.length - 1);
  });

  test('aucun fichier atteint (direct ou transitif) ne se trouve dans vault/, background/, bridge/ ni ui/', () => {
    const bad = [...reached.keys()].filter((f) => ['vault', 'background', 'bridge', 'ui'].some((d) => inDir(f, d)));
    expect(bad.map(rel)).toEqual([]);
  });

  test('les seuls dossiers atteints sont page-actions/ et shared/', () => {
    const outside = [...reached.keys()].filter((f) => !inDir(f, 'page-actions') && !inDir(f, 'shared'));
    expect(outside.map(rel)).toEqual([]);
  });

  test('aucune référence au stockage du coffre (storage.local, IndexedDB, clés vault:)', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect({ f: rel(f), hit: /storage\.local|\bindexedDB\b|vault:|\bVault\b|\bDeviceSecret\b|crypto\.subtle/.test(code) }).toEqual({ f: rel(f), hit: false });
    }
  });

  test('aucun réseau, aucune journalisation, aucune API de page dans cette phase', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect({ f: rel(f), hit: /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|\bconsole\s*\.|innerHTML|\beval\b/.test(code) }).toEqual({ f: rel(f), hit: false });
    }
  });
});

describe('le coffre n\'atteint jamais page-actions', () => {
  test('vault/ est pur : il n\'importe que lui-même et shared/', () => {
    const reached = closure(listTs(join(SRC, 'vault')));
    const outside = [...reached.keys()].filter((f) => !inDir(f, 'vault') && !inDir(f, 'shared'));
    expect(outside.map(rel)).toEqual([]);
    expect([...reached.keys()].filter((f) => inDir(f, 'page-actions'))).toEqual([]);
  });

  test('shared/ n\'importe rien d\'autre (ni coffre ni actions de page)', () => {
    const reached = closure(listTs(join(SRC, 'shared')));
    expect([...reached.keys()].filter((f) => !inDir(f, 'shared')).map(rel)).toEqual([]);
  });
});

describe('l\'analyseur d\'imports lui-même (il doit voir tous les cas)', () => {
  test.each([
    ["import { a } from '../vault/vault';", '../vault/vault'],
    ["import type { A } from '../vault/vault';", '../vault/vault'],
    ["import '../vault/side-effect';", '../vault/side-effect'],
    ["export { Vault } from '../vault';", '../vault'],
    ["export * from '../vault/crypto';", '../vault/crypto'],
    ["const m = await import('../vault/vault');", '../vault/vault'],
    ["const m = require('../vault/vault');", '../vault/vault'],
    ["import {\n  a,\n  b,\n} from '../vault/vault';", '../vault/vault'],
  ])('détecte : %s', (code, spec) => {
    expect(specifiers(code)).toEqual([spec]);
  });

  test('ignore les imports en commentaire', () => {
    expect(specifiers("// import x from '../vault'\n/* import y from '../vault' */")).toEqual([]);
  });

  test('un import interdit ajouté à page-actions serait attrapé (preuve par un fichier temporaire)', () => {
    const fake = join(SRC, 'page-actions', '__probe.ts');
    const probeSrc = "import { VaultError } from '../vault/errors';\n";
    const specs = specifiers(probeSrc).map((s) => resolveImport(fake, s)!);
    const reached = [...closure(specs).keys()];
    expect(reached.some((f) => inDir(f, 'vault'))).toBe(true);
  });
});
