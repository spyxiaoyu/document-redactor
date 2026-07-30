/**
 * Bug C2 契约 — spy 2026-07-30 Chrome "点击 + 添加无反应"
 *
 * 根因：
 *   fileStore.addManualMatch 内部 `if (newMatches.length > 0)` 包住 set()，
 *   0 match 时静默 return。
 *   UploadPage.handleAddManualMatch 无条件 setToast('已添加')。
 *   → 用户看到 toast 但无新 match → "按了没用"。
 *
 * 修法：
 *   store.addManualMatch 返回 boolean（true = 加了 ≥1 个，false = 0 match）。
 *   UploadPage 根据返回值 toast 不同消息：
 *     true  → `"xxx" 已添加`（成功）
 *     false → `未在原文找到"xxx"，请重新选择`（失败告知）
 *
 * 锁 6 条契约：
 *   1. addManualMatch 返回 boolean（而非 void）
 *   2. 成功：返回 true
 *   3. fallback 0 match：返回 false
 *   4. positions 全部越界：返回 false
 *   5. UploadPage.handleAddManualMatch 必须按返回值分支 toast（不能无条件 "已添加"）
 *   6. UploadPage 必须保留 addManualMatch(value, positions) 精确路径（不解构）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useFileStore } from '../fileStore';

const RAW_TEXT = 'Party A: SAMPLE-SUBJECT\n\nContact: SAMPLE-PERSON\n\nAddress: SAMPLE-ADDRESS-LINE \n\n(Note: do not enter real registered address)';

function seedStore(rawText: string) {
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
    sensitiveMatches: [],
    selectedMatches: new Set(),
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

describe('fileStore.addManualMatch: 必须返回 boolean（成功/失败）', () => {
  beforeEach(resetStore);

  it('R1: fallback 命中：addManualMatch("SAMPLE-PERSON") → true（加了 ≥1 个）', () => {
    seedStore(RAW_TEXT);
    const result = useFileStore.getState().addManualMatch('SAMPLE-PERSON');
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });

  it('R2: fallback 0 命中：addManualMatch("rawText 里没有的关键词") → false', () => {
    seedStore(RAW_TEXT);
    const result = useFileStore.getState().addManualMatch('这段文本在 rawText 里完全不存在xyz');
    expect(typeof result).toBe('boolean');
    expect(result).toBe(false);
  });

  it('R3: positions 部分越界：至少一个合法 → true', () => {
    seedStore('abcdef');
    const result = useFileStore.getState().addManualMatch('abc', [0, 10]);  // idx=10 越界
    expect(result).toBe(true);
  });

  it('R4: positions 全部越界：0 命中 → false', () => {
    seedStore('abc');
    const result = useFileStore.getState().addManualMatch('abc', [-5, 100]);
    expect(result).toBe(false);
  });

  it('R5: 空 text → false（不调 store 内部循环）', () => {
    seedStore(RAW_TEXT);
    const result = useFileStore.getState().addManualMatch('');
    expect(result).toBe(false);
  });

  it('R6: parsedDocument 为 null → false', () => {
    // 不 seed，parsedDocument = null
    const result = useFileStore.getState().addManualMatch('test');
    expect(result).toBe(false);
  });
});