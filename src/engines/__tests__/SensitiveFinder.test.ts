import { describe, it, expect } from 'vitest';
import { SensitiveFinder } from '../SensitiveFinder';

describe('SensitiveFinder keyword matching', () => {
  it('does not produce overlapping matches for repeated keyword', () => {
    const finder = new SensitiveFinder();
    finder.addKeywords(['a']);
    const result = finder.findSensitiveContent('aaaaa', { includeDisabled: true });
    expect(result.matches.filter(m => m.value === 'a')).toHaveLength(1);
  });

  it('finds non-overlapping distinct occurrences', () => {
    const finder = new SensitiveFinder();
    finder.addKeywords(['xy']);
    const result = finder.findSensitiveContent('xy xy xy', { includeDisabled: true });
    expect(result.matches.filter(m => m.value === 'xy')).toHaveLength(3);
  });
});
