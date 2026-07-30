/**
 * Q1 修法契约测试 — spy 2026-07-30「下划线 + 长段空白」trim 修法不被回退
 *
 * 【Bug 真因】applyDocxEdits 替换 maskedToken（原值 → 占位符）时只命中原值范围，
 *   【】括号内的 U+0020 padding 保留 + 长字段压缩到 8 个 `_` = 视觉"短下划线 +
 *   长段空白"。spy's 真合同 fingerprint 验证：13【】brackets, 0 ZWS, 83 U+0020,
 *   全部 padding 在【】内。
 *
 * 【修法】在 applyDocxEdits 找到 maskedToken 命中后，向左/右扩展跳过紧邻
 *   U+0020 / U+3000 / TAB。扩展后的范围整体被 originalValue 替换
 *   （originalValue 不含空白，自然填空）。
 *
 * 锁 5 条契约：
 *   1. docxWriter.ts 必须定义 expandRangeOverSurroundingWhitespace helper
 *   2. helper 必须处理 U+0020 / U+3000 / TAB 三种空白类型
 *   3. applyOneEdit（单 occurrence replaceAll 路径）必须调 helper
 *   4. applyNthOccurrenceEdit（第 N 个 occurrence 路径）必须调 helper
 *   5. searchFrom 推进必须用"原 idx + maskedToken.length"（不能用 effectiveEnd，
 *      否则会跳过下一个 occurrence）
 *
 * 防止任何人在后续 commit 把 Q1 trim 修法改回"只替换原值范围"路径。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

describe('Q1 trim 修法契约 — 不被回退', () => {
  it('C1: docxWriter.ts 必须定义 expandRangeOverSurroundingWhitespace helper', () => {
    const src = readSource('src/utils/docxWriter.ts');
    expect(src).toMatch(/function\s+expandRangeOverSurroundingWhitespace\s*\(/);
  });

  it('C2: helper 必须处理 U+0020 (空格) / U+3000 (全角空格) / TAB 三种空白', () => {
    const src = readSource('src/utils/docxWriter.ts');
    // 提取 helper 函数体
    const marker = 'function expandRangeOverSurroundingWhitespace';
    const start = src.indexOf(marker);
    expect(start, 'helper 函数必须存在').toBeGreaterThan(-1);
    const slice = src.slice(start);
    // 结束于下一个 \n}\n
    const end = slice.indexOf('\n}\n');
    expect(end, 'helper 函数体必须完整').toBeGreaterThan(-1);
    const body = slice.slice(0, end + 3);
    // 必须含 ' ' (U+0020 半角空格)
    expect(body, 'helper 必须处理 U+0020 半角空格').toMatch(/ch\s*!==\s*'\s'/);
    // 必须含 \u3000 转义（全角空格）
    expect(body, 'helper 必须处理 U+3000 全角空格').toMatch(/\\u3000/);
    // 必须含 '\t' (TAB)
    expect(body, 'helper 必须处理 TAB').toMatch(/ch\s*!==\s*'\\t'/);
  });

  it('C3: applyOneEdit（replaceAll 路径）必须调 helper', () => {
    const src = readSource('src/utils/docxWriter.ts');
    // applyOneEdit 函数体内必须含 expandRangeOverSurroundingWhitespace( 调用
    const marker = 'function applyOneEdit';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    // 提取到下一个 function 声明或文件结尾
    const slice = src.slice(start);
    const nextFn = slice.search(/\nfunction\s+/);
    const body = nextFn > 0 ? slice.slice(0, nextFn) : slice;
    expect(body, 'applyOneEdit 必须调 helper').toMatch(/expandRangeOverSurroundingWhitespace\s*\(/);
  });

  it('C4: applyNthOccurrenceEdit（第 N 个 occurrence）必须调 helper', () => {
    const src = readSource('src/utils/docxWriter.ts');
    const marker = 'function applyNthOccurrenceEdit';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const slice = src.slice(start);
    const nextFn = slice.search(/\nfunction\s+/);
    const body = nextFn > 0 ? slice.slice(0, nextFn) : slice;
    expect(body, 'applyNthOccurrenceEdit 必须调 helper').toMatch(/expandRangeOverSurroundingWhitespace\s*\(/);
  });

  it('C5: searchFrom 推进必须用"原 idx + maskedToken.length"，不能用 effectiveEnd', () => {
    const src = readSource('src/utils/docxWriter.ts');
    // searchFrom = idx + maskedToken.length 模式必须存在（不能改成 effectiveEnd）
    expect(src).toMatch(/searchFrom\s*=\s*idx\s*\+\s*maskedToken\.length/);
    // 不能有 searchFrom = effectiveEnd 模式
    expect(src).not.toMatch(/searchFrom\s*=\s*effectiveEnd/);
  });
});
