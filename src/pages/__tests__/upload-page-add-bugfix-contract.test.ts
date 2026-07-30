/**
 * UI bug fix 契约测试 — Bug B：spy 2026-07-29 "+ 添加"按钮位置跳变
 *
 * 【v1 fix】upload-page 用 computeSelectionOffset (TreeWalker) 算 offset —
 *   但 <pre> JSX 编译产物含 "\n  " whitespace text node，TreeWalker 把这些
 *   当字符算进 offset（实测偏 6 chars / 段），导致 addManualMatch(slicedValue, [position])
 *   加 match 到错位置 → 视图滚动到新 match → spy 感觉"文字跳到 3.15.5"。
 *
 * 【v2 fix】renderHighlightParts 给每个 text part / match part 打 data-raw-offset，
 *   handleAddManualMatch 用 getRawOffsetFromSelection(range) 读 rawText offset，
 *   不再依赖 TreeWalker / previewText.slice。
 *
 * 锁 4 条行为契约：
 *   1. UploadPage.tsx 必须 import getRawOffsetFromSelection（v2 fix 主路径）
 *   2. handleAddManualMatch 必须调 getRawOffsetFromSelection(range)
 *   3. 渲染层 renderHighlightParts 必须给 text part 和 match part 都打 data-raw-offset
 *   4. 必须保留 fallback addManualMatch(selectedText)（找不到 data-raw-offset 时）
 *
 * 防止任何人在后续 commit 把 v2 fix 改回 v1（computeSelectionOffset）路径。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

function findHandleAddManualMatchBody(src: string): string {
  const marker = 'const handleAddManualMatch';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('找不到 handleAddManualMatch');
  const slice = src.slice(start);
  const nextCallback = slice.search(/\n {2}}, \[/);
  if (nextCallback < 0) throw new Error('找不到 handleAddManualMatch 结束');
  return slice.slice(0, nextCallback + 6);
}

function findRenderSegmentPartsBody(src: string): string {
  // 提取 renderSegmentParts 函数体（renderHighlightParts 内嵌 helper）
  const marker = 'const renderSegmentParts';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('找不到 renderSegmentParts');
  const slice = src.slice(start);
  // 结束于下一个内嵌箭头返回（result: ... 或 return result）
  const end1 = slice.indexOf('\n      };');
  if (end1 < 0) throw new Error('找不到 renderSegmentParts 结束');
  return slice.slice(0, end1 + 7);
}

describe('UI bug fix 契约 v2 — Bug B：+添加 按钮位置跳变（data-raw-offset 方案）', () => {
  it('v2: UploadPage.tsx 必须 import getRawOffsetFromSelection（v2 fix 主路径）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // 允许和其他 import 项混在同一行（如 computeSelectionOffset 也保留供 fallback/deprecation）
    expect(src).toMatch(/import\s+\{[^}]*\bgetRawOffsetFromSelection\b[^}]*\}\s+from\s+['"]@\/utils\/selectionOffset['"]/);
  });

  it('v2: handleAddManualMatch 必须调 getRawOffsetFromSelection(range)（v2 fix 主入口）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleAddManualMatchBody(src);
    expect(body).toMatch(/getRawOffsetFromSelection\s*\(\s*range\s*\)/);
  });

  it('v2: 禁止回退到 v1 bug — handleAddManualMatch 内不允许把 range 传给 computeSelectionOffset', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleAddManualMatchBody(src);
    // 关键判定：v1 bug 形态是 `computeSelectionOffset(pre, range)` 或 `computeSelectionOffset(..., range)`，
    // 其后返回值赋给 position 再 addManualMatch(slicedValue, [position])。
    // 注释里出现 computeSelectionOffset 字符串是 OK 的，但函数调用形式不允许。
    // 用精确模式：computeSelectionOffset( 后面有逗号 + 任何字符 + range
    expect(body).not.toMatch(/computeSelectionOffset\s*\([^)]*,\s*range/);
    // 也禁止直接接 range 作为第一参数
    expect(body).not.toMatch(/computeSelectionOffset\s*\(\s*range/);
  });

  it('v2: handleAddManualMatch 精确路径必须显式传 positions 数组', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleAddManualMatchBody(src);
    expect(body).toMatch(/addManualMatch\([^,]+,\s*\[[^\]]+\]\s*\)/);
  });

  it('v2: 必须保留 fallback（找不到 data-raw-offset 时仍能加 match）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleAddManualMatchBody(src);
    expect(body).toMatch(/addManualMatch\(selectedText\)/);
  });

  it('v2: 渲染层必须给 text part / match part 打 data-raw-offset 属性', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findRenderSegmentPartsBody(src);
    // 渲染层至少出现 1+ 次 "data-raw-offset=" 属性赋值（每个 part 都要打）
    const occurrences = body.match(/data-raw-offset=/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
    // text part 路径必须打
    expect(body).toMatch(/<span[^>]*data-raw-offset=\{[^}]+\}[^>]*>\s*\{part\.text\}/);
    // match part 路径必须打（通过 renderMatchSpan 的 rawOffset 参数）
    expect(body).toMatch(/renderMatchSpan\([^)]*,\s*[^)]*,\s*[^)]*,\s*(?:undefined|slices)[^,]*,\s*(?:partStartInText|rawOffset)/);
  });

  it('v2: renderMatchSpan 函数签名必须接收 rawOffset 并放到 data-raw-offset 属性', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // renderMatchSpan 应有 rawOffset 参数
    const fnSig = src.match(/const renderMatchSpan\s*=\s*\(\s*part:[\s\S]*?children\?:[^,]+,\s*rawOffset\?:/);
    expect(fnSig, 'renderMatchSpan 必须接 rawOffset 参数').not.toBeNull();
    // data-raw-offset={rawOffset ?? segOffset} 这种 fallback 形式
    expect(src).toMatch(/data-raw-offset=\{rawOffset \?\? segOffset\}/);
  });
});

/**
 * Q2 契约 — spy 2026-07-30 Chrome 随机"点 + 添加无反应"修复
 *
 * 根因：button.mousedown 抢焦点 → Chrome 主动 `document.getSelection().removeAllRanges()`
 * 清空选区（Safari 保留）。mouseup 算好的 rawOffset 在 click handler 读时已丢，
 * 走 fallback addManualMatch(selectedText) → rawText.indexOf → 0 match → 静默 return，
 * 但 toast 仍无条件显示"已添加"，所以 spy 看到的是"按了没用"。
 *
 * 修法：mouseup 时把 (offset, text, rawTextLen) 缓存到 pendingMatchRef，click handler
 * 优先读 ref，ref 不在或校验失败才退回 window.getSelection。ref 用完即清。
 *
 * 契约（防止后续 commit 改回去）：
 *   1. UploadPage.tsx 必须声明 pendingMatchRef
 *   2. handleTextSelection 必须把 (offset, text, rawTextLen) 设进 ref
 *   3. handleAddManualMatch 必须从 ref 读 offset
 *   4. handleAddManualMatch 必须清 ref（用完即清）
 *   5. handleAddManualMatch 仍保留 window.getSelection fallback（ref 不可用时）
 */
describe('Q2 契约 — Chrome button click selection race 修复（pendingMatchRef 模式）', () => {
  it('Q2: UploadPage.tsx 必须声明 pendingMatchRef（useRef）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // 关键判定：必须出现 pendingMatchRef 标识符 + useRef 调用形式
    expect(src).toMatch(/pendingMatchRef\s*=\s*useRef</);
  });

  it('Q2: handleTextSelection 必须把 (offset, text, rawTextLen) 设进 ref', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleTextSelectionBody(src);
    // 设进 ref 的形式：pendingMatchRef.current = { offset, text, rawTextLen }
    expect(body).toMatch(/pendingMatchRef\.current\s*=\s*\{/);
    expect(body).toMatch(/offset\s*[:,]/);
    expect(body).toMatch(/text\s*[:,]/);
    expect(body).toMatch(/rawTextLen\s*[:,]/);
    // 必须调 getRawOffsetFromSelection 算 offset
    expect(body).toMatch(/getRawOffsetFromSelection\s*\(/);
  });

  it('Q2: handleAddManualMatch 必须从 ref 读 offset（优先于 window.getSelection）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleAddManualMatchBody(src);
    // 读 ref 形式：pendingMatchRef.current 出现在 handleAddManualMatch 函数体内
    expect(body).toMatch(/pendingMatchRef\.current/);
    // 必须有"ref 校验可用 → 用 ref 的 offset" 的分支
    expect(body).toMatch(/cached\s*[!=]==?\s*null/);
    expect(body).toMatch(/cached!?\.text\s*===\s*selectedText/);
    expect(body).toMatch(/cached!?\.rawTextLen\s*===\s*originalTextFull\.length/);
  });

  it('Q2: handleAddManualMatch 必须清 ref（用完即清，防止下次误用）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleAddManualMatchBody(src);
    // 清空 ref：pendingMatchRef.current = null
    expect(body).toMatch(/pendingMatchRef\.current\s*=\s*null/);
  });

  it('Q2: handleAddManualMatch 必须保留 window.getSelection fallback（ref 校验失败时退回）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleAddManualMatchBody(src);
    // fallback 路径仍存在
    expect(body).toMatch(/window\.getSelection\s*\(\s*\)/);
    // 路径分支：先 ref，再 window.getSelection
    // 不强制要求特定 if-else 形态，但 ref 与 window.getSelection 调用都必须在函数体内
  });
});

function findHandleTextSelectionBody(src: string): string {
  const marker = 'const handleTextSelection';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('找不到 handleTextSelection');
  const slice = src.slice(start);
  // useCallback 结束形态: '\n  }, [' 或 '\n  });'
  const end1 = slice.search(/\n {2}}, \[/);
  if (end1 < 0) throw new Error('找不到 handleTextSelection 结束');
  return slice.slice(0, end1 + 6);
}
