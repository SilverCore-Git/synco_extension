import { describe, expect, test } from 'bun:test';
import { ALLOW_MARKER, looksBinary, scanPath, scanText } from '../scripts/lib/secrets.mjs';

// Les faux secrets sont assemblés à l'exécution pour que ce fichier ne soit pas lui-même signalé.
const fake = {
  privateKey: '-----BEGIN ' + 'PRIVATE ' + 'KEY-----',
  githubToken: 'gh' + 'p_' + 'a'.repeat(36),
  npmToken: 'npm_' + 'b'.repeat(36),
  awsKey: 'AK' + 'IA' + 'C'.repeat(16),
  amoIssuer: 'user:' + '1234567' + ':89',
  assignment: 'const apiSecret = "' + 'd'.repeat(20) + '";',
  privateIp: 'http://192.168.' + '1.20/api',
  internalHost: 'https://git.' + 'acme.corp/x', // check-secrets:allow (faux hôte de test)
};

describe('check-secrets : fichiers interdits', () => {
  test.each(['key.pem', 'sub/store.crx', 'a/b.xpi', '.env', '.env.local', 'x/.npmrc', 'dist/background.js', 'synco.zip'])(
    'refuse %s',
    (path) => {
      expect(scanPath(path).length).toBeGreaterThan(0);
    },
  );

  test.each(['src/vault/crypto.ts', 'manifests/base.json', 'README.md', 'scripts/build.mjs'])('accepte %s', (path) => {
    expect(scanPath(path)).toEqual([]);
  });
});

describe('check-secrets : contenu', () => {
  test.each(Object.entries(fake))('détecte %s', (_name, value) => {
    expect(scanText('x.ts', `ligne\n${value}\n`).length).toBeGreaterThan(0);
  });

  test('indique le numéro de ligne mais jamais la valeur', () => {
    const [f] = scanText('x.ts', `a\nb\n${fake.githubToken}`);
    expect(f).toEqual({ file: 'x.ts', line: 3, rule: 'jeton-github' });
    expect(JSON.stringify(f)).not.toContain(fake.githubToken);
  });

  test('le marqueur d\'autorisation ignore la ligne', () => {
    expect(scanText('x.ts', `${fake.privateIp} // ${ALLOW_MARKER}`)).toEqual([]);
  });

  test('origines publiques et code ordinaire ne sont pas signalés', () => {
    const ok = [
      "const API = 'https://api.synco.one';",
      "const dev = 'https://localhost:5174';",
      'const token = readToken();',
      'const salt = crypto.getRandomValues(new Uint8Array(16));',
    ].join('\n');
    expect(scanText('x.ts', ok)).toEqual([]);
  });

  test('détecte un binaire', () => {
    expect(looksBinary(new Uint8Array([1, 2, 0, 3]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode('texte'))).toBe(false);
  });
});
