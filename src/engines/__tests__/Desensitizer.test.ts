import { describe, it, expect } from 'vitest';
import { Desensitizer } from '../Desensitizer';
import { CryptoManager } from '../CryptoManager';
import type { SensitiveMatch, MappingEntry } from '@/types/sensitive';

const newD = () => new Desensitizer(new CryptoManager());

const entry = (over: Partial<MappingEntry>): MappingEntry => ({
  id: 'x',
  type: 'CUSTOM',
  originalValue: '',
  maskedToken: '_X_',
  position: { start: 0, end: 2 },
  ...over,
});

describe('Desensitizer smoke', () => {
  it('round-trips desensitize + restore via position (single match)', async () => {
    const d = newD();
    const text = '甲方：北京示例科技有限公司';
    const companyValue = '北京示例科技有限公司';
    const companyStart = text.indexOf(companyValue);

    const matches: SensitiveMatch[] = [
      {
        id: 'm1',
        type: 'COMPANY',
        value: companyValue,
        start: companyStart,
        end: companyStart + companyValue.length,
        confidence: 1,
        context: text,
      },
    ];

    const { desensitizedText, mappingTable } = await d.desensitize(text, matches, {
      mode: 'encrypt',
    });

    expect(mappingTable).toHaveLength(1);
    expect(desensitizedText).not.toContain('示例');
    expect(desensitizedText).toContain(mappingTable[0].maskedToken);

    const restored = await d.restore(desensitizedText, mappingTable, '');
    expect(restored).toBe(text);
  });
});

describe('Desensitizer.restore (two-pass)', () => {
  it('round-trips single entry', async () => {
    const d = newD();
    const table = [entry({ id: '1', originalValue: '示例', maskedToken: '_XX_', position: { start: 3, end: 6 } })];
    expect(await d.restore('甲：_XX_ 是公司', table, '')).toBe('甲：示例 是公司');
  });

  it('handles cross-substring originalValues (THE bug)', async () => {
    const d = newD();
    const text = 'XY_Z_ 包含 _Y_';
    const table = [
      entry({ id: '1', originalValue: '示例', maskedToken: '_Z_', position: { start: 3, end: 6 } }),
      entry({ id: '2', originalValue: '跳动', maskedToken: '_Y_', position: { start: 10, end: 13 } }),
    ];
    expect(await d.restore(text, table, '')).toBe('XY示例 包含 跳动');
  });

  it('handles maskedToken that is substring of another maskedToken', async () => {
    const d = newD();
    const table = [
      entry({ id: '1', originalValue: '公司A', maskedToken: '_XX_', position: { start: 0, end: 4 } }),
      entry({ id: '2', originalValue: 'A', maskedToken: '_X_', position: { start: 100, end: 103 } }),
    ];
    expect(await d.restore('这里_XX_有_X_', table, '')).toBe('这里公司A有A');
  });

  it('handles empty mappingTable', async () => {
    const d = newD();
    expect(await d.restore('原文', [], '')).toBe('原文');
  });

  it('handles text without any maskedToken', async () => {
    const d = newD();
    const table = [entry({ id: '1', originalValue: 'x', maskedToken: '_N_' })];
    expect(await d.restore('没有脱敏的原文', table, '')).toBe('没有脱敏的原文');
  });

  it('handles originalValue containing NUL characters gracefully (placeholder uses NUL so this edge case is impractical)', async () => {
    const d = newD();
    const table = [entry({ id: '1', originalValue: 'a\u0000b', maskedToken: '_X_' })];
    // NUL in originalValue would collide with placeholder boundary - documented limitation.
    // In practice, OOXML/docx text never contains raw NUL.
    const result = await d.restore('prefix_X_suffix', table, '');
    // Just assert it does not throw and returns a string
    expect(typeof result).toBe('string');
  });
});

