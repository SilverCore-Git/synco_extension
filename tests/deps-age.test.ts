import { describe, expect, test } from 'bun:test';
import { checkAges, findUnpinned, isOldEnough, parseBunLock } from '../scripts/lib/depsAge.mjs';

const NOW = Date.parse('2026-10-19T12:00:00Z');

describe('politique de dépendances', () => {
  test.each(['^1.2.3', '~1.2.3', '*', 'latest', '>=1.0.0', '1.x', 'workspace:*', 'github:a/b'])(
    'refuse la déclaration %s',
    (range) => {
      expect(findUnpinned({ devDependencies: { x: range } })).toHaveLength(1);
    },
  );

  test('surcharges (overrides, resolutions, imbriquées) : versions exactes obligatoires', () => {
    expect(findUnpinned({ overrides: { undici: '7.30.0' } })).toEqual([]);
    expect(findUnpinned({ overrides: { undici: '^7.30.0' } })).toHaveLength(1);
    expect(findUnpinned({ overrides: { cheerio: { undici: '>=7' } } })).toEqual([{ section: 'overrides', name: 'cheerio > undici', range: '>=7' }]);
    expect(findUnpinned({ resolutions: { a: 'latest', b: '1.0.0' } })).toHaveLength(1);
    expect(findUnpinned({ overrides: { a: 1 } })).toHaveLength(1);
  });

  test('le package.json réel est entièrement épinglé', () => {
    expect(findUnpinned(require('../package.json'))).toEqual([]);
  });

  test('accepte les versions exactes', () => {
    expect(findUnpinned({ devDependencies: { x: '1.2.3', y: '0.0.1-rc.1' } })).toEqual([]);
  });

  test('une version de moins de 7 jours est refusée, de 7 jours pile acceptée', () => {
    expect(isOldEnough('2026-10-13T12:00:00Z', NOW)).toBe(false);
    expect(isOldEnough('2026-10-12T12:00:00Z', NOW)).toBe(true);
    expect(isOldEnough(undefined, NOW)).toBe(false);
    expect(isOldEnough('pas une date', NOW)).toBe(false);
  });

  test('analyse bun.lock (JSONC avec virgules finales) et noms à portée', () => {
    const lock = `{
      "lockfileVersion": 1,
      "packages": {
        "@types/chrome": ["@types/chrome@0.3.5", "", { "dependencies": { "a": "*", }, }, "sha512-x"],
        "esbuild": ["esbuild@0.28.2", "", {}, "sha512-y"],
      },
    }`;
    expect(parseBunLock(lock)).toEqual([
      { name: '@types/chrome', version: '0.3.5' },
      { name: 'esbuild', version: '0.28.2' },
    ]);
  });

  test('checkAges signale le paquet récent et le paquet inconnu', async () => {
    const times: Record<string, Record<string, string>> = {
      vieux: { '1.0.0': '2026-01-01T00:00:00Z' },
      recent: { '1.0.0': '2026-10-18T00:00:00Z' },
    };
    const problems = await checkAges(
      [
        { name: 'vieux', version: '1.0.0' },
        { name: 'recent', version: '1.0.0' },
        { name: 'vieux', version: '2.0.0' },
      ],
      async (name) => times[name] ?? {},
      NOW,
    );
    expect(problems.map((p: { name: string; version: string }) => `${p.name}@${p.version}`)).toEqual(['recent@1.0.0', 'vieux@2.0.0']);
  });
});
