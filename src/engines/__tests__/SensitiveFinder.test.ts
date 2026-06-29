import { describe, it, expect } from 'vitest';
import { SensitiveFinder } from '../SensitiveFinder';
import { Desensitizer } from '../Desensitizer';
import { CryptoManager } from '../CryptoManager';

function buildBareFinder() {
  const finder = new SensitiveFinder();
  finder.getRules().forEach(r => finder.disableRule(r.id));
  return finder;
}

describe('SensitiveFinder keyword matching', () => {
  it('does not produce overlapping matches for repeated keyword (each occurrence distinct)', () => {
    const finder = new SensitiveFinder();
    finder.addKeywords(['a']);
    const result = finder.findSensitiveContent('aaaaa', { includeDisabled: true });
    // 5 distinct non-overlapping matches — adjacent 'a's are NOT merged.
    // (The old < merge extended adjacent ranges and corrupted match.value.)
    const aMatches = result.matches.filter(m => m.value === 'a');
    expect(aMatches).toHaveLength(5);
    for (let i = 0; i + 1 < aMatches.length; i++) {
      expect(aMatches[i + 1].start).toBeGreaterThanOrEqual(aMatches[i].end);
    }
  });

  it('finds non-overlapping distinct occurrences', () => {
    const finder = new SensitiveFinder();
    finder.addKeywords(['xy']);
    const result = finder.findSensitiveContent('xy xy xy', { includeDisabled: true });
    expect(result.matches.filter(m => m.value === 'xy')).toHaveLength(3);
  });
});

/**
 * mergeOverlapping is generic over {start, end} and doesn't know about `value`.
 * When two matches overlap and the FIRST (by start) is SHORTER than the second,
 * the original implementation extends last.end but leaves value untouched —
 * producing a match with `value.length < end - start`. That corrupted match
 * breaks the integrity invariant:
 *   text.slice(m.start, m.start + m.value.length) === m.value
 * which downstream Desensitizer + restore rely on.
 */
describe('SensitiveFinder overlap integrity (THE BUG)', () => {
  it('preserves match integrity when a short keyword overlaps with a longer regex match', () => {
    // Keyword "ABC" @ [0,3], rule "BCD" @ [1,4].
    // After sort by start: keyword first. After current mergeOverlapping:
    //   last = keyword [0,3], current = rule [1,4]
    //   current.start(1) <= last.end(3) → merge → last.end = max(3,4) = 4
    //   → last has range [0,4] (4 chars) but value "ABC" (3 chars) ← CORRUPTED
    const finder = buildBareFinder();
    finder.addRule({
      id: 'rule-bcd', type: 'COMPANY', pattern: /BCD/g, weight: 1, enabled: true
    });
    finder.addKeywords(['ABC']);

    const text = 'ABCDE';
    const result = finder.findSensitiveContent(text, { includeDisabled: true });

    for (const m of result.matches) {
      const slice = text.slice(m.start, m.start + m.value.length);
      expect(
        slice,
        `match integrity broken: value="${m.value}" @${m.start}-${m.end} but text.slice(start, start+value.length)="${slice}"`
      ).toBe(m.value);
    }
  });

  it('round-trips text when a short keyword overlaps with a longer regex match', async () => {
    // Same setup as above, but full pipeline: find → desensitize → restore must
    // return original text byte-for-byte. The current bug LOSES chars because
    // the corrupted match has wrong range, so desensitize eats context and
    // restore can't recover it.
    const finder = buildBareFinder();
    finder.addRule({
      id: 'rule-bcd', type: 'COMPANY', pattern: /BCD/g, weight: 1, enabled: true
    });
    finder.addKeywords(['ABC']);

    const text = 'XYZABCDEFGH';
    const matches = finder.findSensitiveContent(text, { includeDisabled: true }).matches;
    expect(matches.length).toBeGreaterThan(0);

    const desensitizer = new Desensitizer(new CryptoManager());
    const { desensitizedText, mappingTable } = await desensitizer.desensitize(
      text, matches, { mode: 'encrypt' }
    );

    // Every mappingTable entry must satisfy: text.slice(pos.start, pos.start + originalValue.length) === originalValue
    for (const entry of mappingTable) {
      const slice = text.slice(entry.position.start, entry.position.start + entry.originalValue.length);
      expect(slice, `mappingTable integrity for "${entry.originalValue}" @${entry.position.start}`).toBe(entry.originalValue);
    }

    const restored = await desensitizer.restore(desensitizedText, mappingTable, '');
    expect(restored).toBe(text);
  });

  it('round-trips with multiple overlapping matches (mimics user\'s "5x 占位人" scenario)', async () => {
    // Simulate the user-reported bug: multiple short keyword matches that each
    // overlap with different longer regex matches. Each corrupted merge would
    // replace a long range with a short value, producing visible data loss.
    const finder = buildBareFinder();
    finder.addRule({
      id: 'rule-bcd', type: 'COMPANY', pattern: /BCD/g, weight: 1, enabled: true
    });
    finder.addKeywords(['ABC']);

    const text = 'ABCDE ABCDE ABCDE ABCDE ABCDE'; // 5 occurrences
    const matches = finder.findSensitiveContent(text, { includeDisabled: true }).matches;

    const desensitizer = new Desensitizer(new CryptoManager());
    const { desensitizedText, mappingTable } = await desensitizer.desensitize(
      text, matches, { mode: 'encrypt' }
    );
    const restored = await desensitizer.restore(desensitizedText, mappingTable, '');

    expect(restored).toBe(text);
  });
});
