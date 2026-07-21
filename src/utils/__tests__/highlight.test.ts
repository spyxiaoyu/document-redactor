/**
 * buildHighlightParts 单测。
 *
 * Bug 来源（spy 截图，commit `985ae11` follow-up 修复）：
 *   取消高亮 match 时如果 lastEnd 没推进，parts 拼接会重复包含老 match 范围的文本。
 *   表现：字段重复 + 部分段消失（截图里"账号：121907404210302" 变成"账号：120274042102"）。
 *
 * 修法：unselected match 当作 text 推进 lastEnd，selected match 按 kind: 'match' 推进 lastEnd。
 */
import { describe, it, expect } from 'vitest';
import { buildHighlightParts } from '../highlight';
import type { SensitiveMatch } from '@/types';

function mkMatch(id: string, type: SensitiveType, value: string, start: number): SensitiveMatch {
  return {
    id,
    type,
    value,
    start,
    end: start + value.length,
    confidence: 0.9,
    context: '',
  };
}
type SensitiveType = SensitiveMatch['type'];

function joinText(parts: ReturnType<typeof buildHighlightParts>): string {
  return parts.map(p => p.text).join('');
}

describe('buildHighlightParts: 取消高亮不能丢字段', () => {
  it('spy 截图 bug 重现：lastEnd 不推进会让 unselected match 范围内文本重复', () => {
    // 模拟场景（简化版，避开 spy 真实数据的位计算坑）：
    //   text = "甲：辛公司乙：190740421030"
    //   match1 = "辛公司"（已 selected）
    //   match2 = "190740421030"（用户刚点取消高亮 → unselected）
    //
    // 错误行为（bug）：unselected match 不推进 lastEnd，
    //   导致下一个普通文本区间重复包含老 match 范围
    //   → "甲：辛公司乙：190740421030190740421030"（重复）
    //
    // 正确行为：unselected match 当 text 推进 lastEnd，parts 拼接后等于 text
    const text = '甲：辛公司乙：190740421030';
    const matches: SensitiveMatch[] = [
      mkMatch('m1', 'COMPANY', '辛公司', 2),     // end=5
      mkMatch('m2', 'BANK_CARD', '190740421030', 7),  // end=19
    ];
    const selectedIds = new Set(['m1']);  // m2 unselected

    const parts = buildHighlightParts(text, matches, selectedIds, true);

    // 关键断言：拼接 parts 应等于原 text，无重复无丢失
    const reconstructed = joinText(parts);
    console.log('original  :', JSON.stringify(text));
    console.log('rebuilt   :', JSON.stringify(reconstructed));
    console.log('parts     :', parts.map(p => `${p.kind}:${JSON.stringify(p.text)}`).join(' | '));

    expect(reconstructed).toBe(text);
    expect(reconstructed).not.toContain('190740421030190740421030');  // 关键：不重复
  });

  it('多个 unselected match + selected match 混合，拼接仍等于原 text', () => {
    const text = '甲：辛公司乙：测试科技丙：190740421030';
    const matches: SensitiveMatch[] = [
      mkMatch('m1', 'COMPANY', '辛公司', 2),
      mkMatch('m2', 'COMPANY', '测试科技', 7),
      mkMatch('m3', 'BANK_CARD', '190740421030', 13),
    ];
    // 只有 m2 选中
    const selectedIds = new Set(['m2']);

    const parts = buildHighlightParts(text, matches, selectedIds, true);
    const reconstructed = joinText(parts);

    expect(reconstructed).toBe(text);
  });

  it('所有 match 都 selected 时，match 部分被替换为高亮（仍是 match 推进 lastEnd）', () => {
    const text = '甲：辛公司乙：测试科技';
    const matches: SensitiveMatch[] = [
      mkMatch('m1', 'COMPANY', '辛公司', 2),
      mkMatch('m2', 'COMPANY', '测试科技', 7),
    ];
    const selectedIds = new Set(['m1', 'm2']);

    const parts = buildHighlightParts(text, matches, selectedIds, true);
    const reconstructed = joinText(parts);

    expect(reconstructed).toBe(text);
    expect(parts.filter(p => p.kind === 'match').length).toBe(2);
  });

  it('所有 match 都 unselected 时，整段全是 text kind', () => {
    const text = '甲：辛公司乙：测试科技';
    const matches: SensitiveMatch[] = [
      mkMatch('m1', 'COMPANY', '辛公司', 2),
      mkMatch('m2', 'COMPANY', '测试科技', 7),
    ];
    const selectedIds = new Set<string>();  // 都 unselected

    const parts = buildHighlightParts(text, matches, selectedIds, true);
    const reconstructed = joinText(parts);

    expect(reconstructed).toBe(text);
    expect(parts.every(p => p.kind === 'text')).toBe(true);
  });

  it('脱敏后面板（isOriginal=false）：selected 显示下划线占位，unselected 显示原文', () => {
    const text = '甲：辛公司乙：测试科技';
    const matches: SensitiveMatch[] = [
      mkMatch('m1', 'COMPANY', '辛公司', 2),
      mkMatch('m2', 'COMPANY', '测试科技', 7),
    ];
    const selectedIds = new Set(['m1']);

    const parts = buildHighlightParts(text, matches, selectedIds, false);

    // m1 是 match kind（脱敏占位），m2 是 text kind（原文）
    const m1Part = parts.find(p => p.kind === 'match');
    expect(m1Part).toBeDefined();
    expect(m1Part!.text).toBe('\u00a0'.repeat(3));  // "辛公司" 3 chars

    const reconstructed = joinText(parts);
    // 拼接结果：'甲：' + '   ' (3 NBSP) + '乙：' + '测试科技' = '甲：   乙：测试科技'
    expect(reconstructed).toBe('甲：\u00a0\u00a0\u00a0乙：测试科技');
  });

  it('重叠 match（应由 SensitiveFinder merge 兜底）跳过，parts 不重复', () => {
    // match.start < lastEnd 视为重叠，跳过
    const text = '示例文化';
    const matches: SensitiveMatch[] = [
      mkMatch('m1', 'COMPANY', '示例文化', 0),  // 6 chars
      mkMatch('m2', 'COMPANY', '文化', 3),         // 完全在 m1 内
    ];
    const selectedIds = new Set(['m1', 'm2']);

    const parts = buildHighlightParts(text, matches, selectedIds, true);
    const reconstructed = joinText(parts);

    expect(reconstructed).toBe(text);
  });

  it('空文本返回空数组', () => {
    expect(buildHighlightParts('', [], new Set(), true)).toEqual([]);
  });

  it('没有 match 时返回单 text part', () => {
    const text = '普通文本无敏感词';
    const parts = buildHighlightParts(text, [], new Set(), true);
    expect(parts.length).toBe(1);
    expect(parts[0]).toEqual({ kind: 'text', text });
  });
});