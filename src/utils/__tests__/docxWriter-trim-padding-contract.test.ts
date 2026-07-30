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

  it('C2: 空白判定必须覆盖全部 Unicode 空白（含 NBSP/全角/TAB），但排除换行', () => {
    const src = readSource('src/utils/docxWriter.ts');
    // 必须有独立的 isPaddingWhitespace 判定函数
    expect(src, '必须定义 isPaddingWhitespace').toMatch(/function\s+isPaddingWhitespace\s*\(/);

    // 提取 isPaddingWhitespace 函数体
    const marker = 'function isPaddingWhitespace';
    const start = src.indexOf(marker);
    expect(start, 'isPaddingWhitespace 必须存在').toBeGreaterThan(-1);
    const slice = src.slice(start);
    const end = slice.indexOf('\n}\n');
    expect(end, 'isPaddingWhitespace 函数体必须完整').toBeGreaterThan(-1);
    const body = slice.slice(0, end + 3);

    // 必须用 [^\S\n\r]：任意 Unicode 空白（覆盖 U+0020/U+3000/TAB/U+00A0/EM SPACE 等）
    // 但排除 \n / \r（换行是段落结构，吃掉会并段）
    expect(body, '必须用 [^\\S\\n\\r] 覆盖全部 Unicode 空白且排除换行').toMatch(
      /\[\^\\S\\n\\r\]/,
    );

    // expandRangeOverSurroundingWhitespace 必须调它（不能自己写窄的字面判定）
    const helperStart = src.indexOf('function expandRangeOverSurroundingWhitespace');
    const helperSlice = src.slice(helperStart);
    const helperEnd = helperSlice.indexOf('\n}\n');
    const helperBody = helperSlice.slice(0, helperEnd + 3);
    expect(helperBody, 'helper 必须调 isPaddingWhitespace').toMatch(/isPaddingWhitespace\s*\(/);
  });

  it('C2b: 替换必须用 effectiveEnd 收尾，不能用 maskedToken.length（防原值残留）', () => {
    const src = readSource('src/utils/docxWriter.ts');
    // replaceSingleNode 必须接收 globalEnd 并按它切，不能用 maskedToken
    const marker = 'function replaceSingleNode';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const slice = src.slice(start);
    const nextFn = slice.search(/\nfunction\s+/);
    const body = nextFn > 0 ? slice.slice(0, nextFn) : slice;
    expect(body, 'replaceSingleNode 必须按 globalEnd 切').toMatch(/globalEnd/);
    expect(body, 'replaceSingleNode 不能再按 maskedToken.length 切').not.toMatch(
      /maskedToken\.length/,
    );
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
