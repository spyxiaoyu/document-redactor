/**
 * UI bug fix 契约 — Bug E：spy 2026-07-30 "+ 添加按钮点击无反应"（puppeteer v6/v7 真根因）
 *
 * 【真根因】（与 Q2 race 不同，Q2 修的是错的方向）
 *   puppeteer 真实鼠标诊断 v6 显示事件序列：
 *     mousedown on BUTTON  → selection = ".5本合同未" ✅
 *     mouseup  on BUTTON  → selection = "" ← Chrome button.mousedown 抢焦点
 *                                    主动 removeAllRanges()，mouseup 时 selection 已被清
 *     click    on BUTTON  → ❌ 没触发 ← Chrome 判定 mousedown→mouseup 间 selection 变了，
 *                                    click 不成立
 *     React onClick       → ❌ 不跑
 *     handleAddManualMatch→ ❌ 不跑
 *     toast / 敏感词数    → ❌ 无变化
 *
 * 【真修法】（puppeteer v7 验证通过）
 *   button onMouseDown 加 e.preventDefault()，阻止 Chrome 默认行为：
 *     - button 抢焦点（focus 切换）→ 阻止
 *     - Chrome 主动清 selection     → 阻止
 *     - mouseup 时 selection 保留   → OK
 *     - Chrome 判定 click 成立      → click 触发
 *     - React onClick 跑           → handleAddManualMatch 跑
 *     - toast 显示                 → 用户看到反馈
 *
 * 锁 5 条契约：
 *   1. + 添加 button 必须挂 onMouseDown handler
 *   2. handler 第一行必须 e.preventDefault()（阻止 Chrome 抢焦点 + 清 selection）
 *   3. handler 不阻止 React onClick（preventDefault 不等于 stopPropagation）
 *   4. Q2 ref caching（pendingMatchRef）保留作为兜底（极端 race 仍保护 handleAddManualMatch 内部读 selection）
 *   5. handleAddManualMatch 仍然在 button onClick 里调
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/**
 * 找 + 添加 button 的 onMouseDown / onClick JSX 块
 */
function findAddButtonJsxBlock(src: string): string {
  // 找 <button ...添加... </button> 块
  const marker = '<Plus className="h-3 w-3" /> 添加';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('找不到 + 添加 button JSX');
  // 往回找最近的 <button
  const buttonStart = src.lastIndexOf('<button', start);
  const buttonEnd = src.indexOf('</button>', start) + '</button>'.length;
  return src.slice(buttonStart, buttonEnd);
}

describe('UI bug fix 契约 — Bug E：+添加 button Chrome click 吞事件', () => {
  it('E1: + 添加 button 必须挂 onMouseDown handler（阻止 Chrome 抢焦点）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const block = findAddButtonJsxBlock(src);
    expect(block).toMatch(/onMouseDown\s*=/);
  });

  it('E2: onMouseDown handler 必须 e.preventDefault()（阻止 Chrome 清 selection）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const block = findAddButtonJsxBlock(src);
    // 必须在 onMouseDown handler 内 preventDefault（不阻止 React onClick）
    const mdMatch = block.match(/onMouseDown=\{([^}]+)\}/);
    expect(mdMatch, 'onMouseDown handler 不存在').not.toBeNull();
    expect(mdMatch![1]).toMatch(/\.preventDefault\s*\(\s*\)/);
  });

  it('E3: preventDefault 不阻止 React onClick（onClick 仍在）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const block = findAddButtonJsxBlock(src);
    expect(block).toMatch(/onClick\s*=/);
    expect(block).toMatch(/handleAddManualMatch/);
  });

  it('E4: Q2 ref caching（pendingMatchRef）保留作为 handleAddManualMatch 内部兜底', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // pendingMatchRef 仍在 UploadPage.tsx 里被读 + 设
    expect(src).toMatch(/pendingMatchRef\.current\s*=/);
    expect(src).toMatch(/pendingMatchRef\.current/);
  });

  it('E5: 行为契约 — button 必须真实存在（防止后续误删整个 +添加 入口）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const block = findAddButtonJsxBlock(src);
    // button 仍是 className 含 fixed z-50
    expect(block).toMatch(/fixed z-50/);
    // button 仍是 style left/top 从 addBtnPos
    expect(block).toMatch(/addBtnPos\.x/);
    expect(block).toMatch(/addBtnPos\.y/);
  });
});