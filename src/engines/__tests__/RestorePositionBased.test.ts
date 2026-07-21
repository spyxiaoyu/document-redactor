/**
 * THE BUG: Desensitizer.restore uses split(maskedToken).join(placeholder),
 * which BREAKS when maskedToken is a substring of another maskedToken's
 * run in the desensitized text.
 *
 * Browser (UploadPage) uses '_'.repeat(maskedLen) as maskedToken, so:
 *   - NAME "占位人"  (2 chars)  → maskedToken = "__"        (2 underscores)
 *   - PHONE "13800000000" (11) → maskedToken = "___________" (11 underscores)
 *
 * Restore iteration 1: stage1 = "______________" (13 underscores)
 *   split("__") → ["", "", "", "", "", "", "_"]  (6 empty + 1 lone "_")
 *   .join("占位人") → "占位人占位人占位人占位人占位人占位人_"  (13 chars)
 * → 6x "占位人" + 1 "_" replaces the WHOLE desensitized text
 *
 * This is exactly the user-reported "5x 占位人" pattern.
 *
 * Fix: restore should use position-based replacement (each entry has
 * position.start/end), not string match.
 */
import { describe, it, expect } from 'vitest';
import { Desensitizer } from '../Desensitizer';
import { CryptoManager } from '../CryptoManager';
import type { MappingEntry } from '@/types';

function entry(type: any, originalValue: string, position: { start: number; end: number }): MappingEntry {
  const maskedLen = position.end - position.start;
  return {
    id: 'fake',
    type,
    originalValue,
    maskedToken: '_'.repeat(maskedLen),
    position,
  };
}

describe('Desensitizer.restore — position-based (the second bug)', () => {
  it('handles underscore maskedToken cross-substring: 11-underscore phone restored correctly when NAME with 2-underscore token comes first', async () => {
    const desensitizer = new Desensitizer(new CryptoManager());
    // Simulating UploadPage output: text = "占位人13800000000"
    //   match 1: NAME "占位人" @0-2, maskedToken = "__"
    //   match 2: PHONE "13800000000" @2-13, maskedToken = "___________"
    // Desensitized: "__" + "___________" = "_____________" (13 underscores)
    const desensitizedText = '_____________';  // 13 underscores
    const mappingTable = [
      entry('NAME', '占位人', { start: 0, end: 2 }),
      entry('PHONE', '13800000000', { start: 2, end: 13 }),
    ];

    const restored = await desensitizer.restore(desensitizedText, mappingTable, '');
    expect(restored).toBe('占位人13800000000');
  });

  it('handles email cross-substring bug: 19-underscore email restored when shorter tokens exist', async () => {
    const desensitizer = new Desensitizer(new CryptoManager());
    // "邮箱：contact@client-b.test" = 邮箱: 4 chars + email 19 chars = 23 chars
    // Match: EMAIL "contact@client-b.test" @4-23, maskedToken = 19 underscores
    // Plus a 2-char name match inside that range? No, just simpler test:
    // Simulate the user's exact broken pattern: company name (18) + "_" (1) = 19 chars replacing email (19 chars)
    const desensitizedText = '_'.repeat(19);  // 19 underscores
    const mappingTable = [
      entry('COMPANY', '示例公司（北京）融媒体科技文化有限公司', { start: 0, end: 18 }),
      entry('COMPANY', '____', { start: 18, end: 19 }),  // 1-char leftover
    ];

    const restored = await desensitizer.restore(desensitizedText, mappingTable, '');
    // After position-based replace: company (18) + "____" (4) = 22 chars (not equal to original 19).
    // The 2nd entry's position is wrong in this contrived test, but the point is:
    //   position-based replace shouldn't introduce 5x repetition.
    expect(restored).toContain('辛公司');
  });

  it('full UploadPage-style pipeline: text + matches → desensitized underscores → restore', async () => {
    const desensitizer = new Desensitizer(new CryptoManager());
    const original = '占位人的电话是13800000000';
    // match 1: NAME "占位人" @0-2
    // match 2: PHONE "13800000000" @6-17
    const mappingTable = [
      entry('NAME', '占位人', { start: 0, end: 2 }),
      entry('PHONE', '13800000000', { start: 6, end: 17 }),
    ];
    // What UploadPage would generate as desensitized text:
    // "占位人" → "__", "13800000000" → "___________"
    // → "__的电话是___________"
    const desensitizedText = '__的电话是___________';

    const restored = await desensitizer.restore(desensitizedText, mappingTable, '');
    expect(restored).toBe(original);
  });

  it('multiple matches with overlapping-length underscores (stress test)', async () => {
    const desensitizer = new Desensitizer(new CryptoManager());
    // Real docx style: 5 different phone numbers
    const original = '13800000000 13800000001 13900000000 13800000000 13700000000';
    const mappingTable: MappingEntry[] = [
      entry('PHONE', '13800000000', { start: 0, end: 11 }),
      entry('PHONE', '13800000001', { start: 12, end: 23 }),
      entry('PHONE', '13900000000', { start: 24, end: 35 }),
      entry('PHONE', '13800000000', { start: 36, end: 47 }),
      entry('PHONE', '13700000000', { start: 48, end: 59 }),
    ];
    const desensitizedText = '___________ ___________ ___________ ___________ ___________';

    const restored = await desensitizer.restore(desensitizedText, mappingTable, '');
    expect(restored).toBe(original);
  });
});
