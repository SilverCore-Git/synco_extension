import { describe, expect, test } from 'bun:test';
import { MAX_REASON_DISPLAY, MAX_REQUEST_BYTES, parseRequest, sanitizeReason } from '../src/shared/protocol';
import { DEVICE } from './helpers/vaultFixtures';

const ok = (data: unknown) => {
  const r = parseRequest(data);
  if (!r.ok) throw new Error(`refusée : ${r.message}`);
  return r.request;
};
const refused = (data: unknown) => {
  const r = parseRequest(data);
  expect(r.ok).toBe(false);
  return r as { ok: false; id: number | null; message: string };
};

describe('requêtes de la page : validation stricte', () => {
  test('requêtes valides pour chaque opération', () => {
    expect(ok({ id: 1, op: 'status', args: {} })).toEqual({ id: 1, op: 'status', args: {} });
    expect(ok({ id: 2, op: 'has', args: { deviceId: DEVICE } }).op).toBe('has');
    expect(ok({ id: 3, op: 'remove', args: { deviceId: DEVICE } }).op).toBe('remove');
    expect(ok({ id: 4, op: 'load', args: { deviceId: DEVICE } })).toEqual({ id: 4, op: 'load', args: { deviceId: DEVICE } });
    expect(ok({ id: 5, op: 'create', args: { deviceId: DEVICE, reason: 'Relier cet appareil' } }).args).toEqual({
      deviceId: DEVICE,
      reason: 'Relier cet appareil',
    });
  });

  test('opération inconnue refusée, avec l\'identifiant pour pouvoir répondre', () => {
    const r = refused({ id: 9, op: 'exportAll', args: {} });
    expect(r.id).toBe(9);
    for (const op of ['__proto__', 'constructor', 'toString', '', 42, null, undefined]) {
      refused({ id: 1, op, args: {} });
    }
  });

  test.each([
    ['sans identifiant', { op: 'status', args: {} }],
    ['identifiant négatif', { id: -1, op: 'status', args: {} }],
    ['identifiant non entier', { id: 1.5, op: 'status', args: {} }],
    ['identifiant en chaîne', { id: '1', op: 'status', args: {} }],
    ['identifiant démesuré', { id: 2 ** 40, op: 'status', args: {} }],
    ['champ supplémentaire', { id: 1, op: 'status', args: {}, origin: 'https://app.synco.one' }],
    ['arguments manquants', { id: 1, op: 'has' }],
    ['arguments en tableau', { id: 1, op: 'has', args: [DEVICE] }],
    ['status avec argument', { id: 1, op: 'status', args: { x: 1 } }],
    ['deviceId absent', { id: 1, op: 'load', args: {} }],
    ['deviceId non UUID', { id: 1, op: 'load', args: { deviceId: 'abc' } }],
    ['deviceId avec chemin', { id: 1, op: 'load', args: { deviceId: `../${DEVICE}` } }],
    ['deviceId de type nombre', { id: 1, op: 'load', args: { deviceId: 42 } }],
    ['argument inconnu', { id: 1, op: 'load', args: { deviceId: DEVICE, pin: '1234' } }],
    ['raison non textuelle', { id: 1, op: 'load', args: { deviceId: DEVICE, reason: 42 } }],
    ['raison trop longue', { id: 1, op: 'load', args: { deviceId: DEVICE, reason: 'a'.repeat(201) } }],
    ['has avec raison', { id: 1, op: 'has', args: { deviceId: DEVICE, reason: 'x' } }],
  ])('refuse : %s', (_name, data) => {
    refused(data);
  });

  test.each([[null], [undefined], ['texte'], [42], [true], [[]], [[1, 2]]])('refuse une valeur qui n\'est pas un objet : %p', (data) => {
    expect(refused(data).id).toBeNull();
  });

  test('refuse un message surdimensionné (même bien formé)', () => {
    const big = { id: 1, op: 'load', args: { deviceId: DEVICE, reason: 'a'.repeat(200) } };
    expect(JSON.stringify(big).length).toBeLessThan(MAX_REQUEST_BYTES); // la limite protège d'abord le reste :
    const stuffed = { id: 1, op: 'status', args: {}, padding: 'x'.repeat(MAX_REQUEST_BYTES) };
    expect(refused(stuffed).message).toContain('volumineuse');
  });

  test('refuse ce que JSON ne sait pas sérialiser (cycle, BigInt)', () => {
    const cyc: Record<string, unknown> = { id: 1, op: 'status', args: {} };
    cyc.self = cyc;
    refused(cyc);
    refused({ id: 1, op: 'status', args: {}, n: 10n });
  });

  test('objet à prototype modifié (instance de classe) refusé', () => {
    class Evil {
      id = 1;
      op = 'status';
      args = {};
    }
    refused(new Evil());
  });

  test('la requête retournée est reconstruite : rien d\'imprévu ne la traverse', () => {
    const input = { id: 1, op: 'load', args: { deviceId: DEVICE, reason: 'x' } };
    const out = ok(input);
    expect(out).not.toBe(input);
    expect(out.args).not.toBe(input.args);
  });
});

describe('raison affichée', () => {
  test('texte brut : contrôles, retours à la ligne et marques bidi neutralisés', () => {
    expect(sanitizeReason('a\nb\tc')).toBe('a b c');
    expect(sanitizeReason('x‮y')).toBe('x y');
    expect(sanitizeReason('<b>gras</b>')).toBe('<b>gras</b>'); // conservé tel quel : l'interface utilise textContent
    expect(sanitizeReason('   ')).toBeNull();
    expect(sanitizeReason(undefined)).toBeNull();
  });

  test('plafonnée', () => {
    const out = sanitizeReason('a'.repeat(200))!;
    expect(out.length).toBe(MAX_REASON_DISPLAY);
    expect(out.endsWith('…')).toBe(true);
  });
});
