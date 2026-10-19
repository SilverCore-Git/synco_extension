import { describe, expect, test } from 'bun:test';
import { inflateRawSync } from 'node:zlib';
import { ENTRIES, STATIC } from '../scripts/lib/entries.mjs';
import { checkPackage, EXPECTED_FILES } from '../scripts/lib/packageChecks.mjs';
import { assertSafeName, createZip, crc32 } from '../scripts/lib/zip.mjs';

/** Lecteur ZIP indépendant (annuaire central) pour vérifier ce que l'écrivain produit. */
function readZip(zip: Buffer) {
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer; method: number; time: number; date: number; flags: number; mode: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const csize = zip.readUInt32LE(p + 20);
    const usize = zip.readUInt32LE(p + 24);
    const nlen = zip.readUInt16LE(p + 28);
    const off = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = zip.readUInt16LE(off + 26);
    const body = zip.subarray(off + 30 + lnlen, off + 30 + lnlen + csize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data, method, time: zip.readUInt16LE(p + 12), date: zip.readUInt16LE(p + 14), flags: zip.readUInt16LE(p + 8), mode: zip.readUInt32LE(p + 38) >>> 16 });
    p += 46 + nlen;
  }
  return out;
}

const file = (name: string, text: string) => ({ name, data: Buffer.from(text) });

describe('archive ZIP déterministe', () => {
  test('aller-retour : noms, contenus et sommes de contrôle', () => {
    const entries = readZip(createZip([file('manifest.json', '{"a":1}'), file('icons/a.png', 'x'.repeat(5000)), file('z.js', '')]));
    expect(entries.map((e) => e.name)).toEqual(['icons/a.png', 'manifest.json', 'z.js']); // triés
    expect(entries.find((e) => e.name === 'icons/a.png')!.data.toString()).toBe('x'.repeat(5000));
    expect(entries.find((e) => e.name === 'manifest.json')!.data.toString()).toBe('{"a":1}');
    expect(entries.find((e) => e.name === 'z.js')!.data.length).toBe(0);
  });

  test('même entrée dans n\'importe quel ordre : mêmes octets (reproductible)', () => {
    const a = [file('b.js', 'bbb'), file('a.js', 'aaa'), file('c/d.html', '<p>')];
    expect(createZip(a).equals(createZip([...a].reverse()))).toBe(true);
  });

  test('date fixe 1980-01-01, permissions 0644, noms en UTF-8', () => {
    for (const e of readZip(createZip([file('é.js', 'x')]))) {
      expect([e.time, e.date]).toEqual([0, 0x21]);
      expect(e.mode).toBe(0o100644);
      expect(e.flags & 0x0800).toBe(0x0800);
    }
  });

  test.each(['', '/abs', '../x', 'a/../b', 'a//b', 'a\\b', 'C:x', './x', 'a/', 'x\0y'])('nom d\'entrée interdit : %j', (name) => {
    expect(() => assertSafeName(name)).toThrow();
    expect(() => createZip([file(name, 'x')])).toThrow();
  });

  test('noms en double refusés', () => {
    expect(() => createZip([file('a', '1'), file('a', '2')])).toThrow();
  });
});

// ---- contrôle d'un paquet ----
const manifest = (over: Record<string, unknown> = {}) => ({
  manifest_version: 3, name: 'Synco Extension', version: '1.2.3',
  background: { service_worker: 'background.js', scripts: ['background.js'] },
  browser_specific_settings: { gecko: { id: 'synco-extension@synco.one' } },
  host_permissions: ['https://app.synco.one/*'],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  ...over,
});

function goodFiles(m: object = manifest()) {
  return [...EXPECTED_FILES].map((name) => file(name, name === 'manifest.json' ? JSON.stringify(m) : 'x'));
}
const problems = (files: ReturnType<typeof goodFiles>, target: 'chrome' | 'firefox' = 'firefox') => checkPackage(files, target, '1.2.3');

describe('contrôle d\'un paquet avant publication', () => {
  test('la liste attendue correspond à ce que le build produit', () => {
    for (const n of Object.keys(ENTRIES)) expect(EXPECTED_FILES.has(`${n}.js`)).toBe(true);
    for (const n of Object.keys(STATIC)) expect(EXPECTED_FILES.has(n)).toBe(true);
    expect(EXPECTED_FILES.has('manifest.json')).toBe(true);
  });

  test('un paquet de production correct ne soulève aucun problème', () => {
    expect(problems(goodFiles())).toEqual([]);
    expect(problems(goodFiles(), 'chrome')).toEqual([]);
  });

  test.each([
    ['fichier inattendu (clé privée oubliée)', (f: ReturnType<typeof goodFiles>) => [...f, file('key.pem', 'x')], 'fichier inattendu'],
    ['fichier manquant', (f: ReturnType<typeof goodFiles>) => f.filter((x) => x.name !== 'popup.js'), 'fichier manquant'],
    ['origine locale dans un script', (f: ReturnType<typeof goodFiles>) => f.map((x) => (x.name === 'background.js' ? file(x.name, 'const o = "https://localhost:5174";') : x)), 'origine locale'],
    ['diagnostic de développement', (f: ReturnType<typeof goodFiles>) => f.map((x) => (x.name === 'content.js' ? file(x.name, 'dataset.syncoDebug = 1') : x)), 'diagnostic'],
    ['console.* dans un script', (f: ReturnType<typeof goodFiles>) => f.map((x) => (x.name === 'options.js' ? file(x.name, 'console.log(1)') : x)), 'console'],
    ['paquet démesuré', (f: ReturnType<typeof goodFiles>) => [...f.filter((x) => x.name !== 'prompt.js'), { name: 'prompt.js', data: Buffer.alloc(6 * 1024 * 1024) }], 'trop gros'],
  ])('refuse : %s', (_n, mutate, expected) => {
    expect(problems(mutate(goodFiles())).join('|')).toContain(expected);
  });

  test.each([
    ['manifeste de développement (nom)', { name: 'Synco Extension (dev)' }, 'développement'],
    ['version_name présent', { version_name: '1.2.3-dev' }, 'développement'],
    ['version ≠ package.json', { version: '9.9.9' }, 'version du manifeste'],
    ['MV2', { manifest_version: 2 }, 'manifest_version'],
    ['<all_urls> à l\'installation', { host_permissions: ['<all_urls>'] }, 'trop large'],
    ['externally_connectable', { externally_connectable: { matches: ['*://*/*'] } }, 'externally_connectable'],
    ['CSP assouplie', { content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'; object-src 'none'" } }, 'CSP'],
    ['identifiant Firefox de développement', { browser_specific_settings: { gecko: { id: 'synco-extension-dev@synco.one' } } }, 'développement'],
    ['identifiant Firefox absent', { browser_specific_settings: {} }, 'gecko.id'],
    ['origine locale dans le manifeste', { host_permissions: ['https://localhost/*'] }, 'origine locale'],
  ])('refuse : %s', (_n, over, expected) => {
    expect(problems(goodFiles(manifest(over))).join('|')).toContain(expected);
  });

  test('Chrome sans service_worker, Firefox sans scripts de fond : refusés', () => {
    expect(problems(goodFiles(manifest({ background: { scripts: ['background.js'] } })), 'chrome').join('|')).toContain('service_worker');
    expect(problems(goodFiles(manifest({ background: { service_worker: 'background.js' } })), 'firefox').join('|')).toContain('background.scripts');
  });

  test('manifeste absent ou illisible', () => {
    expect(problems(goodFiles().filter((f) => f.name !== 'manifest.json')).join('|')).toContain('fichier manquant : manifest.json');
    expect(problems(goodFiles().map((f) => (f.name === 'manifest.json' ? file(f.name, '{pas du json') : f))).join('|')).toContain('illisible');
  });
});
