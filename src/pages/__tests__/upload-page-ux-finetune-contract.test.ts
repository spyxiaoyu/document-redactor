/**
 * UI bug fix 契约 — Bug F + Bug G + Bug 2nd-add：spy 2026-07-30 UX 反馈
 *
 * 【Bug F】+ 添加按钮位置离勾选字段较远
 *   根因：handleTextSelection 用 `e.clientX, e.clientY`（mouseup 鼠标位置）
 *   设 addBtnPos。用户划选完可能拖鼠标到远处才释放 → 按钮跳到远处。
 *   修法：用 `selection.getRangeAt(0).getBoundingClientRect()` 取选区终点
 *   右下角 (right, bottom) 作为 addBtnPos，按钮跟随选区。
 *
 * 【Bug G】左右 panel scroll 同步有"滞后"感
 *   根因：handleOriginalScroll / handleMaskedScroll "立即同步 scrollTop"
 *   （commit 时写的"不用 RAF，避免执行时机错位"是错的）。React 异步
 *   渲染 + 右 panel reflow 比左 panel 慢，立即 scrollTop 会被覆盖回旧值 → 滞后。
 *   修法：用 requestAnimationFrame 推迟一帧，等 reflow 完成再同步。
 *
 * 【Bug 2nd-add】使用"手动标记"+"一键全部脱敏"后再划选 + 添加按钮跳位
 *   根因："手动标记"section 高度在"提示态 (174px) → 已选择 + 添加按钮态 (232px)"
 *   间因 selectedText 变非空而 +58px，把下方 panel + match span 一起压下 58px。
 *   handler 算 endRect 在 setSelectedText 之前（OLD DOM 坐标 y=457.5），
 *   写进 setAddBtnPos({y: 427.5})，React commit 后 match 已下移 58px 到
 *   y=497.5，但按钮 fixed 定位不变 → "按钮跳到 match 上方 70px"。
 *   修法：setSelectedText 后立即 flushSync(() => {}) 强制 React 同步 commit
 *   （DOM reflow 同步完成），再读 selection range.getBoundingClientRect()
 *   拿 viewport NEW 坐标 → button 跟 match 同步移动。
 *
 * 锁 9 条契约：
 *   F1. handleTextSelection 必须从 selection range 读 getBoundingClientRect
 *   F2. addBtnPos.y 用 endRect.bottom（不是 mouseup clientY）
 *   F3. addBtnPos.x 用 endRect.right（不是 mouseup clientX）
 *   G1. handleOriginalScroll 必须用 requestAnimationFrame 推迟 scroll 同步
 *   G2. handleMaskedScroll 必须用 requestAnimationFrame 推迟 scroll 同步
 *   G3. 不能继续"立即同步"（spy 已反馈滞后）
 *   2nd-add #1. 必须 import flushSync from react-dom
 *   2nd-add #2. 顺序必须 setSelectedText → flushSync → setAddBtnPos（不能在
 *              setSelectedText 之前算 endRect 写入 setAddBtnPos）
 *   2nd-add #3. setAddBtnPos 之前必须有 flushSync 强制 React 同步 commit
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

function findHandleTextSelectionBody(src: string): string {
  const marker = 'const handleTextSelection';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('找不到 handleTextSelection');
  // 用下一个 `const ` 函数声明作为 body 结束的标记（更稳，不依赖缩进）
  const slice = src.slice(start);
  const endMarker = 'const handleAddManualMatch';
  const end = slice.indexOf(endMarker);
  if (end < 0) throw new Error('找不到 handleTextSelection 结束');
  return slice.slice(0, end);
}

function findScrollHandlerBody(src: string, fnName: string): string {
  const marker = `const ${fnName}`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${fnName}`);
  const slice = src.slice(start);
  const end = slice.search(/\n {2}}, \[\]/);
  if (end < 0) throw new Error(`找不到 ${fnName} 结束`);
  return slice.slice(0, end + 7);
}

describe('UI bug fix 契约 — Bug F：+添加 按钮位置跟随选区终点（不是鼠标）', () => {
  it('F1: handleTextSelection 必须读 selection range.getBoundingClientRect()', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleTextSelectionBody(src);
    expect(body).toMatch(/getBoundingClientRect\s*\(\s*\)/);
  });

  it('F2: setAddBtnPos 用 endRect.right/.bottom（不是 mouseup clientX/Y）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleTextSelectionBody(src);
    // 必须有 endRect 局部变量（任意 Range 变量 .getBoundingClientRect() 赋值）
    expect(body).toMatch(/endRect\s*=\s*\w+\.getBoundingClientRect/);
    // 必须有 endRect.right 赋给 addBtnPos.x
    expect(body).toMatch(/endRect\.right/);
    // 必须有 endRect.bottom 赋给 addBtnPos.y
    expect(body).toMatch(/endRect\.bottom/);
    // 不能继续用 e.clientY（mouseup 鼠标位置）作 y
    expect(body).not.toMatch(/setAddBtnPos\s*\(\s*\{\s*x\s*:\s*e\.clientX\s*,\s*y\s*:\s*e\.clientY\s*\}/);
  });
});

describe('UI bug fix 契约 — Bug G：左右 panel scroll 同步用 RAF 推迟一帧', () => {
  it('G1: handleOriginalScroll 必须用 requestAnimationFrame', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findScrollHandlerBody(src, 'handleOriginalScroll');
    expect(body).toMatch(/requestAnimationFrame/);
  });

  it('G2: handleMaskedScroll 必须用 requestAnimationFrame', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findScrollHandlerBody(src, 'handleMaskedScroll');
    expect(body).toMatch(/requestAnimationFrame/);
  });

  it('G3: 不能再"立即同步 scrollTop"（spy 反馈滞后）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // 不能继续有"立即同步"注释（commit 时写的错误最佳实践）
    expect(src).not.toMatch(/\/\/ 立即同步/);
    // 不能继续"不用 RAF"的注释
    expect(src).not.toMatch(/\/\/ \(不用 RAF/);
  });

  it('G4: RAF 回调里必须做 scrollTop 同步', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // RAF(...) 内含 scrollTop = ...currentTarget.scrollTop
    const rafPattern = /requestAnimationFrame\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*scrollTop\s*=/;
    expect(src).toMatch(rafPattern);
  });
});

describe('UI bug fix 契约 — Bug 2nd-add：flushSync 强制 React 同步 commit', () => {
  it('2nd-add #1: 必须 import flushSync from react-dom', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    expect(src).toMatch(/import\s*\{\s*flushSync\s*\}\s*from\s*['"]react-dom['"]/);
  });

  it('2nd-add #2: handleTextSelection 必须调 flushSync（强制 React 同步 commit，等 DOM reflow 完成）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleTextSelectionBody(src);
    expect(body).toMatch(/flushSync\s*\(/);
  });

  it('2nd-add #3: 顺序必须 setSelectedText → flushSync → setAddBtnPos（不能在 setSelectedText 之前算 endRect 写入定位）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findHandleTextSelectionBody(src);
    // 找各关键调用在 body 里的位置
    const setSelectedIdx = body.search(/setSelectedText\s*\(/);
    const flushSyncIdx = body.search(/flushSync\s*\(/);
    const setAddBtnPosIdx = body.search(/setAddBtnPos\s*\(\s*\{[^}]*\}/);
    expect(setSelectedIdx).toBeGreaterThan(-1);
    expect(flushSyncIdx).toBeGreaterThan(-1);
    expect(setAddBtnPosIdx).toBeGreaterThan(-1);
    // flushSync 必须在 setSelectedText 之后（否则不能强迫 React 同步 commit）
    expect(flushSyncIdx).toBeGreaterThan(setSelectedIdx);
    // setAddBtnPos(带坐标) 必须在 flushSync 之后（必须读 reflow 后的新坐标）
    expect(setAddBtnPosIdx).toBeGreaterThan(flushSyncIdx);
  });
});