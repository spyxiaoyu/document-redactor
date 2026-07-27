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
import { buildHighlightParts, splitByImagePositions } from '../highlight';
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

/**
 * splitByImagePositions：spy 截图 2026-07-27 反馈修法
 *
 * 关键不变量：
 *   - chip 位置精度 = imagePosition 本身（不会漂移到 segment 起点）
 *   - segments 拼回去 === 原文（无重复无丢失）
 *   - 落在 segment 边界内的 match 归属正确
 *   - imagePositions 越界 / 重复 / 无效 输入做防御性清洗
 */
describe('splitByImagePositions（2026-07-27 spy 央视合同 3.11 反馈）', () => {
  it('spy 截图 bug 重现：旧实现把 chip 放在 part 起点，新实现应放在 imagePosition 处', () => {
    // 模拟央视合同真实情形：
    //   text 中有一段长 text-only stretch 包含 imagePosition
    //   旧实现 part-based flush：chip 落在 part 起点（错位）
    //   新实现 segment-based：chip 落在 imagePosition（精确）
    //
    // 关键场景：imagePosition 落在 text part 中间，前面有 match
    const text = '前置内容：[MATCH-A-START]敏感词1[/MATCH-A-END]中间长文本[X]后半部分';
    const matches: SensitiveMatch[] = [
      mkMatch('m1', 'COMPANY', '敏感词1', 7),
    ];
    // imagePosition = 17（"中间长文本"内部，远离 part 边界）
    const segments = splitByImagePositions(text, matches, [17]);

    // 应切成 2 段：[0, 17] + [17, text.length]
    expect(segments.length).toBe(2);
    expect(segments[0]).toEqual({
      start: 0,
      end: 17,
      matches: [expect.objectContaining({ id: 'm1', start: 7, end: 11 })],
    });
    expect(segments[1].start).toBe(17);
    expect(segments[1].end).toBe(text.length);
    expect(segments[1].matches.length).toBe(0);

    // chip 渲染缝隙：segment[0] 文本 + chip + segment[1] 文本
    // 验证拼回去 === 原 text
    const reconstructed = segments.map(s => text.slice(s.start, s.end)).join('');
    expect(reconstructed).toBe(text);
  });

  it('无 imagePosition 时返回单 segment（覆盖全文）', () => {
    const text = 'ABCDEFG';
    const matches = [mkMatch('m1', 'COMPANY', 'CD', 2)];
    const segments = splitByImagePositions(text, matches, undefined);
    expect(segments.length).toBe(1);
    expect(segments[0]).toEqual({
      start: 0,
      end: 7,
      matches: [expect.objectContaining({ id: 'm1' })],
    });
  });

  it('多个 imagePosition 升序切多段', () => {
    // text = 'AAAA\n\nBBBB\n\nCCCC\n\nDDDD' (length=22)
    //   AAAA   = 0-3
    //   \n\n   = 4-5
    //   BBBB   = 6-9
    //   \n\n   = 10-11
    //   CCCC   = 12-15
    //   \n\n   = 16-17
    //   DDDD   = 18-21
    // 模拟两个图片位置：10 (BBBB 后换行起点) + 16 (CCCC 后换行起点)
    //   切割后 [0,10] = "AAAA\n\nBBBB"
    //           [10,16] = "\n\nCCCC"
    //           [16,22] = "\n\nDDDD"
    const text = 'AAAA\n\nBBBB\n\nCCCC\n\nDDDD';
    const segments = splitByImagePositions(text, [], [10, 16]);
    expect(segments.length).toBe(3);
    expect(segments.map(s => [s.start, s.end])).toEqual([
      [0, 10],
      [10, 16],
      [16, text.length],
    ]);
    expect(segments.map(s => text.slice(s.start, s.end))).toEqual([
      'AAAA\n\nBBBB',
      '\n\nCCCC',
      '\n\nDDDD',
    ]);
  });

  it('重复 imagePosition 去重', () => {
    const text = 'AABBCC';
    const segments = splitByImagePositions(text, [], [2, 2, 4, 4]);
    expect(segments.length).toBe(3);
    expect(segments.map(s => [s.start, s.end])).toEqual([[0, 2], [2, 4], [4, 6]]);
  });

  it('越界 imagePosition（> text.length 或 < 0）被过滤', () => {
    const text = 'ABCDE';
    // 输入 [-1, 0, 3, 5, 10]，过滤后剩 [0, 3, 5]
    // 切点：0 / 3 / 5。segment [0,3] + [3,5]
    expect(splitByImagePositions(text, [], [-1]).length).toBe(1);  // 单段
    const segs = splitByImagePositions(text, [], [-1, 0, 3, 5, 10]);
    // 0 和 5 是边界 → 实际切点 = {3}（0 = start, 5 = end）
    expect(segs.length).toBe(2);
    expect(segs.map(s => [s.start, s.end])).toEqual([[0, 3], [3, 5]]);
  });

  it('imagePosition 在 match 内部：match 落在 start 所在 segment', () => {
    const text = 'AAA[敏感词1]BBB[X]CCC';
    const matches = [mkMatch('m1', 'COMPANY', '敏感词1', 3)];
    const segments = splitByImagePositions(text, matches, [7]);
    // [0, 7] segment 包含 match（match.start=3 in [0,7)）
    // [7, 16] segment 不包含
    expect(segments[0].matches.length).toBe(1);
    expect(segments[1].matches.length).toBe(0);
  });

  it('跨 segment 的 match（start 在 A、end 在 B）：归属 start 所在 segment', () => {
    // match.start=2, end=8 → 切点在 5
    // segment [0,5]: 包含 match.start=2 → 归属
    // segment [5,10]: match.start=5 不在 [5,10) 内 → 不归属（避免重复）
    const text = 'AB敏感词1CDXYZW';
    const matches = [mkMatch('m1', 'COMPANY', '感词1CDXY', 2)];  // start=2, end=10
    const segments = splitByImagePositions(text, matches, [5]);
    expect(segments[0].matches.length).toBe(1);
    expect(segments[1].matches.length).toBe(0);
  });

  it('空文本返回空数组', () => {
    expect(splitByImagePositions('', [], [0, 5])).toEqual([]);
  });

  it('imagePosition 非数字（含 NaN/Infinity）被过滤', () => {
    const text = 'ABCDE';
    const segments = splitByImagePositions(text, [], [NaN, Infinity, -Infinity, 2]);
    // NaN/Infinity 被 Number.isFinite 过滤 → 只剩 2
    expect(segments.length).toBe(2);
    expect(segments.map(s => [s.start, s.end])).toEqual([[0, 2], [2, 5]]);
  });

  // ============================================================
  // spy 截图 2026-07-27 反馈修法 — 图片之后的 match 必须 emit
  //   根因：旧实现 segMatches.start 是 text-absolute offset，
  //         传给 buildHighlightParts(segText, segMatches) 时 match.start 远大于 segText.length
  //         → match 被吞掉不渲染 → spy 截图"图片之后没高亮"
  //   修法：segMatches.start/end 平移为 segment-relative offset
  // ============================================================
  it('spy 截图修法：imagePosition 之后的 match 必须 emit（segment-relative 平移）', () => {
    // text = '前置内容：[敏感词1]图片位置[Chip][敏感词2]后半部分'
    // imagePosition = 9 ("图片位置" 起点)
    // segment[0] = [0, 9] = "前置内容：[敏感词1]"  (含 m1)
    // segment[1] = [9, text.length] = "图片位置[Chip][敏感词2]后半部分"  (含 m2)
    //
    // 关键断言：m2 在 segment[1] 内，start/end 必须是 segment-relative（0-based）
    //   旧实现返回 start=absolute（远大于 segText.length）→ match 被吞
    //   新实现返回 start=segment-relative（<= segText.length）→ match 正常 emit
    const text = '前置内容：[敏感词1]图片位置[敏感词2]后半部分';
    const m1Start = text.indexOf('[敏感词1]');
    const m1End = m1Start + '[敏感词1]'.length;
    const imgPos = text.indexOf('图片位置');
    const m2Start = text.indexOf('[敏感词2]');
    const m2End = m2Start + '[敏感词2]'.length;
    const m1 = mkMatch('m1', 'COMPANY', '[敏感词1]', m1Start);
    m1.end = m1End;
    const m2 = mkMatch('m2', 'COMPANY', '[敏感词2]', m2Start);
    m2.end = m2End;
    const segments = splitByImagePositions(text, [m1, m2], [imgPos]);

    expect(segments.length).toBe(2);
    // segment[0] 含 m1 (absolute == relative when segStart=0)
    expect(segments[0].matches.length).toBe(1);
    expect(segments[0].matches[0].id).toBe('m1');
    // 关键：segment[1] 含 m2，且 start 是 segment-relative（0-based）
    expect(segments[1].matches.length).toBe(1);
    expect(segments[1].matches[0].id).toBe('m2');
    // m2.start = imgPos + 4 (跳过 "图片位置"), segStart = imgPos
    // relative start = 4, relative end = 4 + '[敏感词2]'.length
    expect(segments[1].matches[0].start).toBe('图片位置'.length);
    expect(segments[1].matches[0].end).toBe('图片位置'.length + '[敏感词2]'.length);

    // 终极验证：buildHighlightParts 用 segment-relative match 在 segText 上工作
    const seg1Text = text.slice(segments[1].start, segments[1].end);
    const parts = buildHighlightParts(seg1Text, segments[1].matches, new Set(['m2']), true);
    const reconstructed = parts.map(p => p.text).join('');
    expect(reconstructed).toBe(seg1Text);
    // m2 必须 emit 为 match kind（不是被吞）
    const matchParts = parts.filter(p => p.kind === 'match');
    expect(matchParts.length).toBe(1);
    expect(matchParts[0].text).toBe('[敏感词2]');
  });

  it('跨边界 match：end 被截断到 segment 边界内（避免 segText 越界）', () => {
    // match.start 在 segment[0] 内、end 在 segment[1] 内 → 归属 segment[0]，end 截断到 segEnd
    const text = 'AB[敏感词跨越]CDXY';
    const m = mkMatch('m1', 'COMPANY', '[敏感词跨越]CD', 2);  // start=2, end=2+9=11
    const segments = splitByImagePositions(text, [m], [5]);  // 切点在 5

    // match 归属 segment[0] (start=2 in [0,5))
    // end 截断到 segEnd=5 → relative end = min(11, 5) - segStart(0) = 5
    expect(segments[0].matches.length).toBe(1);
    expect(segments[0].matches[0].start).toBe(2);
    expect(segments[0].matches[0].end).toBe(5);
  });
});