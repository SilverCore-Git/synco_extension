import { describe, expect, test } from 'bun:test';
import { describeError, formatClock, formatDate, formatDuration, shortId } from '../src/ui/format';

describe('formats français', () => {
  test.each([
    [0, '0 s'], [1, '1 s'], [30, '30 s'], [59, '59 s'], [60, '1 min'], [130, '2 min 10 s'], [600, '10 min'],
    [3600, '1 h'], [3660, '1 h 1 min'], [86400, '1 j'], [90000, '1 j 1 h'], [-5, '0 s'], [29.2, '30 s'],
  ])('durée %p → %s', (s, out) => {
    expect(formatDuration(s)).toBe(out);
  });

  test('minuterie', () => {
    expect(formatClock(120)).toBe('02:00');
    expect(formatClock(59.1)).toBe('01:00');
    expect(formatClock(5)).toBe('00:05');
    expect(formatClock(-1)).toBe('00:00');
  });

  test('date en français (Paris) et identifiant abrégé', () => {
    expect(formatDate(Date.UTC(2026, 9, 19, 10, 5))).toContain('19 octobre 2026');
    expect(shortId('3f2b8c1e-5a7d-4e90-9b6a-1c2d3e4f5a6b')).toBe('3f2b8c1e…');
  });

  test('messages d\'erreur : tous les codes en français, jamais de code brut ni de détail technique', () => {
    for (const code of ['wrong-pin', 'locked', 'wiped', 'cancelled', 'missing', 'unavailable', 'bad-request', 'pin-required', 'inconnu']) {
      const msg = describeError(code);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toContain(code === 'inconnu' ? 'inconnu' : `${code}:`);
    }
    expect(describeError('locked', 125)).toContain('2 min 5 s');
    expect(describeError('wrong-pin', 30)).toContain('30 s');
    expect(describeError('wrong-pin')).toBe('Code PIN incorrect.');
    expect(describeError('wiped')).toContain('effacée');
    expect(describeError('inconnu')).toBe(describeError('unavailable'));
  });
});
