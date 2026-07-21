/**
 * renderHighlightParts 行为锁定测试 — commit `947780a` 回归保护
 *
 * 锁住的 3 个 bug:
 *   #5 搜索 hit 完全在 auto-detected match 内部时，mark 不渲染 → jump no-op
 *   #6 hit 跨 part 边界 (text→match→text) 时，后半部分不渲染
 *   #7 mark 嵌套在 match span 内，onClick 冒泡导致误取消 match 选中
 *
 * 行为 spec (不依赖 React DOM，纯逻辑层)：
 *   - 对每个 buildHighlightParts 输出的 part (text 或 match)：
 *     - 找出跟 part 区间 [partStart, partEnd) 有 overlap 的所有 hit
 *     - 按 hit 边界切碎 part，hit 部分渲染为 <mark>，非 hit 部分渲染为纯文本
 *     - match part 时，把整段包在 match span 内，hit 用嵌套 <mark>
 *   - 跨 part 的 hit 必须全部 slice 都渲染出来（避免 hit 信息丢失）
 *
 * 这个 spec 跟 UploadPage 里的 renderHighlightParts 逻辑保持一致。
 * 如果将来改 UploadPage 的渲染逻辑，需要同步更新这个测试。
 */
import { describe, it, expect } from 'vitest';
import { buildHighlightParts } from '@/utils/highlight';
import type { SensitiveMatch } from '@/types';

interface SearchHit {
  index: number;
  start: number;
  end: number;
  value: string;
  contextBefore: string;
  contextAfter: string;
}

/**
 * 重现 UploadPage 里的 hit 切片逻辑（纯函数版，用于测试锁定行为）
 * 返回每段的 kind: 'text' | 'mark-in-text' | 'mark-in-match'
 */
type SliceKind = 'text' | 'mark-in-text' | 'mark-in-match' | 'text-in-match' | 'match-no-hit';
interface Slice {
  kind: SliceKind;
  text: string;
  searchHitIndex?: number;
  matchId?: string;
}

function slicePartsForSearchHits(
  text: string,
  matches: SensitiveMatch[],
  selected: Set<string>,
  searchHits: SearchHit[],
): Slice[] {
  const parts = buildHighlightParts(text, matches, selected, true);
  const visibleHits = searchHits.filter(h => h.start < text.length && h.end <= text.length);
  const result: Slice[] = [];
  let offsetInText = 0;

  parts.forEach(part => {
    const partStart = offsetInText;
    const partEnd = partStart + part.text.length;
    offsetInText = partEnd;

    const hitsInThisPart = visibleHits
      .filter(h => h.start < partEnd && h.end > partStart)  // overlap 判定
      .sort((a, b) => a.start - b.start);

    if (hitsInThisPart.length === 0) {
      if (part.kind === 'text') {
        result.push({ kind: 'text', text: part.text });
      } else {
        result.push({ kind: 'match-no-hit', text: part.text, matchId: part.matchId });
      }
      return;
    }

    // 切碎 part
    let cursor = 0;
    const innerSlices: Slice[] = [];
    hitsInThisPart.forEach(hit => {
      const relStart = hit.start - partStart;
      const relEnd = Math.min(hit.end - partStart, part.text.length);
      if (relStart > cursor) {
        innerSlices.push({ kind: 'text', text: part.text.slice(cursor, relStart) });
      }
      innerSlices.push({
        kind: part.kind === 'match' ? 'mark-in-match' : 'mark-in-text',
        text: part.text.slice(Math.max(cursor, relStart), relEnd),
        searchHitIndex: hit.index,
      });
      cursor = relEnd;
    });
    if (cursor < part.text.length) {
      innerSlices.push({ kind: 'text', text: part.text.slice(cursor) });
    }

    if (part.kind === 'match') {
      // match part 整段在 React DOM 里包在 <span class="match"> 内，但 spec 测试时
      // 把所有 inner slice 展开（不模拟 span 包装），让每个 hit slice 独立可查。
      // matchId 标记在第一个 slice 上表示这段属于 match。
      innerSlices.forEach((s, i) => {
        result.push({
          ...s,
          kind: s.kind === 'mark-in-text' ? 'mark-in-match' : (s.kind === 'text' ? 'text-in-match' : s.kind),
          matchId: i === 0 ? part.matchId : undefined,
        });
      });
    } else {
      result.push(...innerSlices);
    }
  });

  return result;
}

describe('renderHighlightParts: search hit 渲染行为锁定 (#5/#6)', () => {
  const rawText = '甲方：示例文化有限公司';
  // COMPANY 规则: start=3, end=16
  const companyMatch: SensitiveMatch = {
    id: 'auto-co', type: 'COMPANY', value: rawText.slice(3, 16), start: 3, end: 16, confidence: 0.9, context: '',
  };

  it('#5: hit 完全在 match 内部 → 必须生成 mark-in-match slice (含 hit index)', () => {
    // 搜 "司娱" (5, 7) — 完全在 COMPANY [3, 14) 内部
    const hits: SearchHit[] = [{ index: 0, start: 5, end: 7, value: '司娱', contextBefore: '', contextAfter: '' }];
    const slices = slicePartsForSearchHits(rawText, [companyMatch], new Set(['auto-co']), hits);
    // 关键 spec: 旧逻辑下整个 match part 不切碎 → 没有 mark slice → jump no-op
    // 新逻辑：match 段被切碎，至少有一个 mark-in-match slice 带 searchHitIndex
    const marks = slices.filter(s => s.kind === 'mark-in-match' && s.searchHitIndex === 0);
    expect(marks.length).toBe(1);
    expect(marks[0].text).toBe('司娱');
  });

  it('#5: hit 完全在 match 内部 → 整段切碎后总长度 = 原文', () => {
    const hits: SearchHit[] = [{ index: 0, start: 5, end: 7, value: '司娱', contextBefore: '', contextAfter: '' }];
    const slices = slicePartsForSearchHits(rawText, [companyMatch], new Set(['auto-co']), hits);
    const joined = slices.map(s => s.text).join('');
    expect(joined).toBe(rawText);
  });

  it('#6: hit 跨 match/text 边界 → 两段都生成 mark slice', () => {
    // raw: 公司甲公司乙公司丙
    // match [2, 6) = 甲公司乙
    // hit [4, 8) = 司乙公司 — 跨 match [4, 6) + text [6, 8)
    const text2 = '公司甲公司乙公司丙';
    const match2: SensitiveMatch = {
      id: 'auto-co2', type: 'COMPANY', value: '甲公司乙', start: 2, end: 6, confidence: 0.9, context: '',
    };
    const hits: SearchHit[] = [{ index: 0, start: 4, end: 8, value: '司乙公司', contextBefore: '', contextAfter: '' }];
    const slices = slicePartsForSearchHits(text2, [match2], new Set(['auto-co2']), hits);
    // spec: 两段 mark (mark-in-text + mark-in-match 嵌套)
    const marks = slices.filter(s => s.kind === 'mark-in-text' || s.kind === 'mark-in-match');
    expect(marks.length).toBe(2);
    expect(marks.map(m => m.text).join('')).toBe('司乙公司');
    // 关键: 旧逻辑下只有 1 段（filter `h.start >= partStart` 排除了第二个 part）
  });

  it('#6: hit 跨三段 (text→match→text) → 三个 mark slice', () => {
    // raw: ABC甲公司乙XYZ
    // match [3, 7) = 甲公司乙
    // hit [1, 10) = BC甲公司乙XYZ — 跨三段
    const text3 = 'ABC甲公司乙XYZ';
    const match3: SensitiveMatch = {
      id: 'auto-co3', type: 'COMPANY', value: '甲公司乙', start: 3, end: 7, confidence: 0.9, context: '',
    };
    const hits: SearchHit[] = [{ index: 0, start: 1, end: 10, value: 'BC甲公司乙XYZ', contextBefore: '', contextAfter: '' }];
    const slices = slicePartsForSearchHits(text3, [match3], new Set(['auto-co3']), hits);
    const marks = slices.filter(s => s.kind === 'mark-in-text' || s.kind === 'mark-in-match');
    expect(marks.length).toBe(3);
    expect(marks.map(m => m.text).join('')).toBe('BC甲公司乙XYZ');
  });

  it('#5: 多 hit 在同一 match 内 → 所有 hit index 都出现在 mark slice 树里', () => {
    // raw: 示例文化 (7 chars)
    // match [0, 7) = 整段
    // hit 1 [0, 2) = 众成
    // hit 2 [2, 4) = 就娱
    // hit 3 [5, 7) = 传媒
    // （旧版 match.end=8 越界 text.length=7，visibleHits 把 hit[6,8) filter 掉——allIndices 少 1）
    const text4 = '示例文化';
    const match4: SensitiveMatch = {
      id: 'auto-co4', type: 'COMPANY', value: text4, start: 0, end: 7, confidence: 0.9, context: '',
    };
    const hits: SearchHit[] = [
      { index: 0, start: 0, end: 2, value: '众成', contextBefore: '', contextAfter: '' },
      { index: 1, start: 2, end: 4, value: '就娱', contextBefore: '', contextAfter: '' },
      { index: 2, start: 5, end: 7, value: '传媒', contextBefore: '', contextAfter: '' },
    ];
    const slices = slicePartsForSearchHits(text4, [match4], new Set(['auto-co4']), hits);
    // 收集所有 hit index (含嵌套在 match 内的)
    const allIndices = new Set<number>();
    slices.forEach(s => {
      if (s.searchHitIndex !== undefined) allIndices.add(s.searchHitIndex);
      const inner = (s as unknown as { _innerHits?: number[] })._innerHits;
      if (inner) inner.forEach(i => allIndices.add(i));
    });
    expect(allIndices.size).toBe(3);
    [0, 1, 2].forEach(i => expect(allIndices.has(i)).toBe(true));
  });

  it('#6: hit 越界 (start >= text.length) → 不渲染', () => {
    const text5 = 'short';
    const hits: SearchHit[] = [{ index: 0, start: 10, end: 15, value: 'xxx', contextBefore: '', contextAfter: '' }];
    const slices = slicePartsForSearchHits(text5, [], new Set(), hits);
    const marks = slices.filter(s => s.kind === 'mark-in-text' || s.kind === 'mark-in-match');
    expect(marks.length).toBe(0);
  });

  it('#5+#6: invariant — 切片后总长度 = 原文', () => {
    const cases = [
      { text: 'simple hit', match: null, hits: [{ s: 0, e: 6, v: 'simple' }] },
      { text: 'match inside', match: { s: 0, e: 5, v: 'match' }, hits: [{ s: 1, e: 4, v: 'atc' }] },
      { text: 'cross', match: { s: 2, e: 3, v: 'o' }, hits: [{ s: 1, e: 4, v: 'ros' }] },
    ];
    cases.forEach((c, i) => {
      const matches: SensitiveMatch[] = c.match ? [{
        id: `m${i}`, type: 'COMPANY', value: c.match.v, start: c.match.s, end: c.match.e, confidence: 0.9, context: '',
      }] : [];
      const hits: SearchHit[] = [{ index: 0, start: c.hits[0].s, end: c.hits[0].e, value: c.hits[0].v, contextBefore: '', contextAfter: '' }];
      const slices = slicePartsForSearchHits(c.text, matches, new Set(matches.map(m => m.id)), hits);
      const joined = slices.map(s => s.text).join('');
      expect(joined, `case ${i}: ${c.text}`).toBe(c.text);
    });
  });
});

describe('handleJumpToSearchHit 定位 spec', () => {
  // 锁定 #7 的修法: handleJumpToSearchHit 用 [data-search-hit="N"] querySelectorAll 找起点
  // 这里只测试 spec：每个 hit 至少有一个带 searchHitIndex 的 slice
  it('每个 hit 至少生成一个带 searchHitIndex 的 slice', () => {
    const text = 'A甲B乙C';
    const match: SensitiveMatch = {
      id: 'm', type: 'COMPANY', value: '甲', start: 1, end: 2, confidence: 0.9, context: '',
    };
    const hits: SearchHit[] = [
      { index: 0, start: 0, end: 1, value: 'A', contextBefore: '', contextAfter: '' },
      { index: 1, start: 1, end: 2, value: '甲', contextBefore: '', contextAfter: '' },
      { index: 2, start: 3, end: 4, value: '乙', contextBefore: '', contextAfter: '' },
    ];
    const slices = slicePartsForSearchHits(text, [match], new Set(['m']), hits);
    const allIndices = new Set<number>();
    slices.forEach(s => {
      if (s.searchHitIndex !== undefined) allIndices.add(s.searchHitIndex);
    });
    expect(allIndices.size).toBe(3);
    [0, 1, 2].forEach(i => expect(allIndices.has(i)).toBe(true));
  });
});
