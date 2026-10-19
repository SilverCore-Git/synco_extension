import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

const read = (dir: string) =>
  readdirSync(new URL(`../src/${dir}/`, import.meta.url)).filter((f) => f.endsWith('.ts')).map((f) => ({
    file: `${dir}/${f}`,
    code: readFileSync(new URL(`../src/${dir}/${f}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

describe.each(['background', 'bridge'])('src/%s : garde-fous statiques', (dir) => {
  const files = read(dir);

  test('le dossier est analysé', () => {
    expect(files.length).toBeGreaterThan(1);
  });

  test.each([
    ['journalisation (console)', /\bconsole\s*\./],
    ['réseau', /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/],
    ['exécution dynamique', /\b(eval|new Function)\b|setTimeout\(\s*['"`]/],
    ['injection dans la page', /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createElement\(\s*['"]script/],
    ['monde MAIN', /world\s*:\s*['"]MAIN/],
    ['stockage web de la page', /\b(localStorage|sessionStorage)\b/],
  ])('aucun usage de : %s', (_name, re) => {
    for (const { file, code } of files) expect({ file, hit: re.test(code) }).toEqual({ file, hit: false });
  });
});

describe('le bridge ne touche ni au stockage ni aux clés', () => {
  test('aucun accès à storage ni à crypto.subtle depuis le content script', () => {
    for (const { file, code } of read('bridge')) {
      expect({ file, hit: /\b(storage|crypto\.subtle|indexedDB)\b/.test(code) }).toEqual({ file, hit: false });
    }
  });
});
