/**
 * fileStore.addManualMatch 重叠去重逻辑回归测试。
 *
 * Spy 现场 bug（commit `ddcd883` follow-up）：
 *   spy 在甲乙合同里取消 ADDRESS 高亮后，用搜索框 addManualMatch 同一段
 *   "上海市黄浦区示例路1号示例大厦"。
 *
 *   旧逻辑只 push 新 CUSTOM match，老 ADDRESS 仍保留 → 两 match 完全重叠。
 *   buildHighlightParts 排序后遍历：老 ADDRESS 先 unselected 推进 lastEnd=end，
 *   新 CUSTOM start<lastEnd 被 SKIP overlap → 永远不渲染、不脱敏。
 *
 *   修法：addManualMatch 时先删除所有与新 match 区间重叠的老 match。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useFileStore } from '../fileStore';
import type { SensitiveMatch } from '@/types';
import { buildHighlightParts } from '@/utils/highlight';

// Spy 甲乙合同 rawText 节选（3020 chars 里的"联系地址"段前后）
const RAW_TEXT = '甲方：示例文化有限公司上海分公司\n\n联系人：占位人\n\n联系地址：上海市黄浦区示例路1号示例大厦 \n\n（注：请勿填写公司注册地址）\n\n联系电话：13800000000';

function mkMatch(id: string, type: SensitiveMatch['type'], value: string, start: number): SensitiveMatch {
  return {
    id,
    type,
    value,
    start,
    end: start + value.length,
    confidence: type === 'CUSTOM' ? 1.0 : 0.9,
    context: '',
  };
}

function seedStore(rawText: string, matches: SensitiveMatch[]) {
  useFileStore.setState({
    parsedDocument: {
      rawText,
      ast: {
        metadata: {
          format: 'docx',
          fileName: 'test.docx',
          mimeType: '',
          size: rawText.length,
        },
        content: [],
        embeddedAssets: [],
      },
    },
    sensitiveMatches: matches,
    selectedMatches: new Set(matches.map(m => m.id)),  // 默认全选
    renderKey: 0,
  });
}

function resetStore() {
  useFileStore.setState({
    parsedDocument: null,
    sensitiveMatches: [],
    selectedMatches: new Set(),
    renderKey: 0,
  });
}

describe('fileStore.addManualMatch: 重叠老 match 必须删除', () => {
  beforeEach(() => {
    resetStore();
  });

  it('spy 截图回归：完全重叠的老 ADDRESS 替换为新 CUSTOM', () => {
    // 模拟默认检测：ADDRESS rule 命中 start=32 end=47
    const address = mkMatch('auto-addr-1', 'ADDRESS', '上海市黄浦区示例路1号示例大厦', 32);
    const phone = mkMatch('auto-phone-1', 'PHONE', '13800000000', 71);
    seedStore(RAW_TEXT, [address, phone]);

    // spy 取消 ADDRESS 高亮
    useFileStore.getState().toggleMatchSelection(address.id);
    expect(useFileStore.getState().selectedMatches.has(address.id)).toBe(false);

    // spy 用搜索框 addManualMatch 同一段
    const text = '上海市黄浦区示例路1号示例大厦';
    useFileStore.getState().addManualMatch(text);

    const state = useFileStore.getState();

    // 1. 老 ADDRESS 应该被删（不是"和 CUSTOM 共存"）
    expect(state.sensitiveMatches.find(m => m.id === 'auto-addr-1')).toBeUndefined();

    // 2. 新 CUSTOM 存在，且 selected
    const customs = state.sensitiveMatches.filter(m => m.type === 'CUSTOM');
    expect(customs.length).toBe(1);
    expect(customs[0].value).toBe(text);
    expect(customs[0].start).toBe(32);
    expect(customs[0].end).toBe(47);
    expect(state.selectedMatches.has(customs[0].id)).toBe(true);

    // 3. 关键断言：用 buildHighlightParts 渲染，新 CUSTOM 必须出现在 match kind 中
    //    （旧逻辑下 CUSTOM 会被 SKIP overlap，1 个 match kind —— 即只剩 PHONE）
    //    修好后应该有 2 个：PHONE + CUSTOM
    const parts = buildHighlightParts(RAW_TEXT, state.sensitiveMatches, state.selectedMatches, true);
    const matchParts = parts.filter(p => p.kind === 'match');
    expect(matchParts.length).toBe(2);
    expect(matchParts.map(p => p.text)).toContain(text);
    expect(matchParts.map(p => p.text)).toContain('13800000000');

    // 4. 拼接结果 = 原文（invariant）
    expect(parts.map(p => p.text).join('')).toBe(RAW_TEXT);
  });

  it('完全包含：老 match 是新 match 的子串，老 match 被删', () => {
    const subOld = mkMatch('auto-sub', 'COMPANY', '示例文化', 3);  // 3..7 in "甲方：示例文化有限公司上海分公司"
    // 实际 start=3, end=7
    seedStore(RAW_TEXT, [subOld]);

    // 手动添加 "示例文化有限公司上海分公司"（包含子串）
    const text = '示例文化有限公司上海分公司';
    const idx = RAW_TEXT.indexOf(text);
    expect(idx).toBe(3);
    useFileStore.getState().addManualMatch(text);

    const state = useFileStore.getState();
    expect(state.sensitiveMatches.find(m => m.id === 'auto-sub')).toBeUndefined();
    expect(state.sensitiveMatches.some(m => m.type === 'CUSTOM' && m.value === text)).toBe(true);
  });

  it('部分重叠：老 match 部分覆盖新 match，老 match 被删', () => {
    const partial = mkMatch('auto-partial', 'COMPANY', '辛公司', 3);  // 3..6 (占位 "示例" 起点)
    seedStore(RAW_TEXT, [partial]);

    const text = '示例文化有限公司';  // 3..10
    useFileStore.getState().addManualMatch(text);

    const state = useFileStore.getState();
    expect(state.sensitiveMatches.find(m => m.id === 'auto-partial')).toBeUndefined();
    expect(state.sensitiveMatches.filter(m => m.type === 'CUSTOM').length).toBe(1);
  });

  it('完全不重叠：新老 match 共存', () => {
    const farOld = mkMatch('auto-far', 'PHONE', '13800000000', 71);
    seedStore(RAW_TEXT, [farOld]);

    // 在文本前面找一个不重叠的位置
    const text = '占位人';  // start=23, end=26 (跟 far 不重叠)
    useFileStore.getState().addManualMatch(text);

    const state = useFileStore.getState();
    expect(state.sensitiveMatches.find(m => m.id === 'auto-far')).toBeDefined();  // 保留
    expect(state.sensitiveMatches.filter(m => m.type === 'CUSTOM').length).toBe(1);
  });

  it('重复 addManualMatch 同段：老 CUSTOM 被删，新 CUSTOM 替换', async () => {
    const text = '上海市黄浦区示例路1号示例大厦';
    seedStore(RAW_TEXT, []);

    useFileStore.getState().addManualMatch(text);
    const firstId = useFileStore.getState().sensitiveMatches[0]?.id;

    // 隔几毫秒再 add（同段）—— 应该是替换，不是叠加
    await new Promise(r => setTimeout(r, 2));
    useFileStore.getState().addManualMatch(text);

    const state = useFileStore.getState();
    const customs = state.sensitiveMatches.filter(m => m.type === 'CUSTOM');
    expect(customs.length).toBe(1);
    expect(customs[0].id).not.toBe(firstId);  // 新 id
    expect(state.selectedMatches.has(customs[0].id)).toBe(true);
  });

  it('关键词在 rawText 里不存在：no-op（不影响 selectedMatches）', () => {
    const phone = mkMatch('auto-phone', 'PHONE', '13800000000', 71);
    seedStore(RAW_TEXT, [phone]);
    const beforeSelected = useFileStore.getState().selectedMatches.size;

    useFileStore.getState().addManualMatch('这段文本在 rawText 里完全不存在xyz');

    const state = useFileStore.getState();
    expect(state.sensitiveMatches.length).toBe(1);  // 没新增
    expect(state.selectedMatches.size).toBe(beforeSelected);
  });

  it('关键词在 rawText 里出现多次：每个位置都加 match', () => {
    // 构造 rawText 里 "X" 出现 3 次
    const text = 'X';
    const dupText = `前X中X后X`;
    seedStore(dupText, []);

    useFileStore.getState().addManualMatch(text);

    const state = useFileStore.getState();
    const customs = state.sensitiveMatches.filter(m => m.type === 'CUSTOM');
    expect(customs.length).toBe(3);
    customs.forEach(m => {
      expect(state.selectedMatches.has(m.id)).toBe(true);
    });
  });
});

describe('fileStore.addManualMatch: 搜索脱敏 case preservation + positions 边界', () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Spy 截图回归（commit `1f9f93d` 后）：搜索脱敏两步式 UI 的 case sensitivity bug
   *
   * 之前 bug：
   *   - handleSearchKeyword case-insensitive search，hits[].value = 原文真实 case
   *     （即文档里 "abc" 而不是用户输入的 "ABC"）
   *   - 但旧 addManualMatch(positions) 把 SensitiveMatch.value = text（用户输入的 case）
   *   - restore 时把 "abc" 替换成 "ABC"，**大小写错乱**
   *
   * 修法：addManualMatch(positions) 用 rawText.slice(idx, idx+text.length) 当 value
   */
  it('case preservation: positions 模式下 value 必须 = 原文真实 case（不是用户输入 case）', () => {
    // 文档里是 "abc"，用户搜 "ABC"（在 handleAddCheckedSearchHits 里按 hit.value 分组后传进来）
    const raw = 'aaa abc bbb abc ccc';
    seedStore(raw, []);

    // 模拟 UploadPage.handleAddCheckedSearchHits：按 hit.value 分组后传 positions
    // hit.value 是原文真实 case "abc"
    const idx1 = raw.indexOf('abc');      // 4
    const idx2 = raw.indexOf('abc', 5);   // 12
    useFileStore.getState().addManualMatch('abc', [idx1, idx2]);

    const customs = useFileStore.getState().sensitiveMatches.filter(m => m.type === 'CUSTOM');
    expect(customs.length).toBe(2);
    // 关键断言：value 必须是原文真实 case "abc"，不能是用户输入的 "ABC"
    customs.forEach(m => {
      expect(m.value).toBe('abc');
      expect(m.value).not.toBe('ABC');
    });
  });

  it('case preservation: 用户搜原文大小写混合时也要保留', () => {
    // 文档里 "AbCdEf"，用户搜 "abcdef"（小写）
    const raw = '前缀-AbCdEf-中缀-AbCdEf-后缀';
    seedStore(raw, []);

    const idx1 = raw.indexOf('AbCdEf');
    const idx2 = raw.indexOf('AbCdEf', idx1 + 1);
    useFileStore.getState().addManualMatch('abcdef', [idx1, idx2]);

    const customs = useFileStore.getState().sensitiveMatches.filter(m => m.type === 'CUSTOM');
    expect(customs.length).toBe(2);
    customs.forEach(m => {
      expect(m.value).toBe('AbCdEf'); // 保留原大小写
    });
  });

  it('positions 越界（idx + text.length > rawText.length）：跳过该位置', () => {
    const raw = 'abcdef';
    seedStore(raw, []);
    // idx=0 OK, idx=10 越界
    useFileStore.getState().addManualMatch('abc', [0, 10]);

    const customs = useFileStore.getState().sensitiveMatches.filter(m => m.type === 'CUSTOM');
    expect(customs.length).toBe(1);
    expect(customs[0].start).toBe(0);
    expect(customs[0].end).toBe(3);
  });

  it('positions 负数：跳过该位置', () => {
    const raw = 'abcdef';
    seedStore(raw, []);
    // idx=-1 跳过, idx=3 OK
    useFileStore.getState().addManualMatch('abc', [-1, 3]);

    const customs = useFileStore.getState().sensitiveMatches.filter(m => m.type === 'CUSTOM');
    expect(customs.length).toBe(1);
    expect(customs[0].start).toBe(3);
  });

  it('positions 部分越界：只保留合法位置', () => {
    const raw = 'abc';  // 长度 3
    seedStore(raw, []);
    // 全部越界 → 一个 match 都没有
    useFileStore.getState().addManualMatch('abc', [-5, 100]);

    const customs = useFileStore.getState().sensitiveMatches.filter(m => m.type === 'CUSTOM');
    expect(customs.length).toBe(0);
  });

  it('addManualMatch(无 positions) 仍然 case-sensitive 走 indexOf 老路径', () => {
    // 文档里只有 "abc"，用户传 "ABC" → 老路径 indexOf 找不到 → 0 matches
    const raw = 'aaa abc bbb';
    seedStore(raw, []);

    useFileStore.getState().addManualMatch('ABC'); // case mismatch
    expect(useFileStore.getState().sensitiveMatches.length).toBe(0);

    // 同 case → 命中
    useFileStore.getState().addManualMatch('abc'); // case match
    expect(useFileStore.getState().sensitiveMatches.length).toBe(1);
  });
});