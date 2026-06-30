import { describe, it, expect } from 'vitest';
import { Desensitizer } from '../Desensitizer';
import { CryptoManager } from '../CryptoManager';
import type { SensitiveMatch } from '@/types/sensitive';

const newD = () => new Desensitizer(new CryptoManager());

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

  it('handles empty mappingTable on restore (no-op)', async () => {
    const d = newD();
    expect(await d.restore('原文', [], '')).toBe('原文');
  });
});

