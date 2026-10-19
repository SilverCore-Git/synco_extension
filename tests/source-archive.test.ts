import { describe, expect, test } from 'bun:test';
import { parseLsFilesStage, scanSourceFiles } from '../scripts/lib/sourceArchive.mjs';

const rec = (mode: string, path: string) => `${mode} 0123456789abcdef0123456789abcdef01234567 0\t${path}`;
const out = (...records: string[]) => records.join('\0') + '\0';

describe('archive source : sélection des fichiers', () => {
  test('fichiers ordinaires (et exécutables) admis, chemins avec espaces conservés', () => {
    expect(parseLsFilesStage(out(rec('100644', 'src/a.ts'), rec('100755', '.githooks/pre-commit'), rec('100644', 'doc/un fichier.md')))).toEqual({
      files: ['src/a.ts', '.githooks/pre-commit', 'doc/un fichier.md'],
      rejected: [],
    });
  });

  test('lien symbolique et sous-module refusés (jamais suivis ni ignorés en silence)', () => {
    const r = parseLsFilesStage(out(rec('100644', 'ok.ts'), rec('120000', 'lien-vers-home'), rec('160000', 'vendor/sub')));
    expect(r.files).toEqual(['ok.ts']);
    expect(r.rejected).toEqual([{ path: 'lien-vers-home', mode: '120000' }, { path: 'vendor/sub', mode: '160000' }]);
  });

  test('ligne illisible refusée', () => {
    expect(parseLsFilesStage('n importe quoi\0').rejected).toHaveLength(1);
  });

  test('sortie vide : aucun fichier', () => {
    expect(parseLsFilesStage('')).toEqual({ files: [], rejected: [] });
  });
});

describe('archive source : contrôle de secrets', () => {
  const f = (name: string, text: string) => ({ name, data: Buffer.from(text) });

  test('un dépôt propre passe', () => {
    expect(scanSourceFiles([f('src/a.ts', 'export const x = 1;'), f('README.md', '# Synco')])).toEqual([]);
  });

  test('clé privée ou fichier interdit : signalés', () => {
    const pem = '-----BEGIN ' + 'PRIVATE ' + 'KEY-----';
    expect(scanSourceFiles([f('notes.txt', pem)]).map((x) => x.rule)).toContain('bloc-cle-privee');
    expect(scanSourceFiles([f('signing.pem', 'x')]).map((x) => x.rule)).toContain('cle-ou-certificat');
    expect(scanSourceFiles([f('.env.production', 'A=1')]).map((x) => x.rule)).toContain('fichier-env');
  });

  test('binaire : seul le nom est contrôlé', () => {
    expect(scanSourceFiles([{ name: 'icon.png', data: new Uint8Array([137, 80, 0, 1]) }])).toEqual([]);
  });
});
