/**
 * fileStore.addManualMatch 重叠去重逻辑回归测试。
 *
 * Spy 现场 bug（commit `ddcd883` follow-up）：
 *   spy 在方太合同里取消 ADDRESS 高亮后，用搜索框 addManualMatch 同一段
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

// Spy 方太合同 rawText 节选（3020 chars 里的"联系地址"段前后）
const RAW_TEXT = '甲方：SAMPLE-CO-F文化有限公司上海分公司\n\n联系人：占位人\n\n联系地址：上海市黄浦区示例路1号示例大厦 \n\n（注：请勿填写公司注册地址）\n\n联系电话：13800000000';

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
    // 模拟默认检测：ADDRESS rule 命中 start=34 end=62
    const address = mkMatch('auto-addr-1', 'ADDRESS', '上海市黄浦区示例路1号示例大厦', 34);
    const phone = mkMatch('auto-phone-1', 'PHONE', '13800000000', 86);
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
    expect(customs[0].start).toBe(34);
    expect(customs[0].end).toBe(62);
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
    const subOld = mkMatch('auto-sub', 'COMPANY', 'SAMPLE-CO-F文化', 3);  // 0..7 in "甲方：SAMPLE-CO-F..."
    // 实际 start=3, end=10
    seedStore(RAW_TEXT, [subOld]);

    // 手动添加 "SAMPLE-CO-F文化有限公司上海分公司"（包含子串）
    const text = 'SAMPLE-CO-F文化有限公司上海分公司';
    const idx = RAW_TEXT.indexOf(text);
    expect(idx).toBe(3);
    useFileStore.getState().addManualMatch(text);

    const state = useFileStore.getState();
    expect(state.sensitiveMatches.find(m => m.id === 'auto-sub')).toBeUndefined();
    expect(state.sensitiveMatches.some(m => m.type === 'CUSTOM' && m.value === text)).toBe(true);
  });

  it('部分重叠：老 match 部分覆盖新 match，老 match 被删', () => {
    const partial = mkMatch('auto-partial', 'COMPANY', 'SAMPLE-CO-F', 3);  // 0..3
    seedStore(RAW_TEXT, [partial]);

    const text = 'SAMPLE-CO-F文化有限公司';  // 3..12
    useFileStore.getState().addManualMatch(text);

    const state = useFileStore.getState();
    expect(state.sensitiveMatches.find(m => m.id === 'auto-partial')).toBeUndefined();
    expect(state.sensitiveMatches.filter(m => m.type === 'CUSTOM').length).toBe(1);
  });

  it('完全不重叠：新老 match 共存', () => {
    const farOld = mkMatch('auto-far', 'PHONE', '13800000000', 86);
    seedStore(RAW_TEXT, [farOld]);

    // 在文本前面找一个不重叠的位置
    const text = '占位人';  // start=25, end=27 (跟 far 不重叠)
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
    const phone = mkMatch('auto-phone', 'PHONE', '13800000000', 109);
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