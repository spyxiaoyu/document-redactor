/**
 * UI bug fix 契约 — Bug D：spy 2026-07-30 "+ 添加按钮跳位"
 *
 * 根因：
 *   handleTextSelection (onMouseUp) 设了 addBtnPos + selectedText，
 *   但没有"用户在面板里做别的事就清 stale 状态"的机制。
 *   spy 划过选 → 按钮出现 → 去 search 框搜别的 → addBtnPos 残留 →
 *   stale 按钮还浮在旧位置 → spy 看到"按钮跳位"。
 *
 * 修法：
 *   在文字面板 + 脱敏后面板 加 onMouseDown handler：
 *     - mousedown 时如果 selection 为空（用户在空白处点击，不是准备划选），
 *       清 stale addBtnPos + selectedText + pendingMatchRef.current
 *     - 如果 selection 有 text（用户即将划选 / 已划选）→ 不动（保留）
 *
 * 锁 5 条契约：
 *   1. 文字面板必须挂 onMouseDown handler
 *   2. 脱敏后面板必须挂 onMouseDown handler
 *   3. handler 必须调 setAddBtnPos(null)
 *   4. handler 必须调 setSelectedText('')
 *   5. handler 必须清 pendingMatchRef.current
 *   6. 【保护】handler 必须先检查 selection 是否为空（避免误清正在划选的 selection）
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/**
 * 找 handlePanelMouseDown / handlePanelMouseDownAny 函数体。
 * 结束形态：'\n  }, []);'
 */
function findMouseDownHandlerBody(src: string, fnName: string): string {
  const marker = `const ${fnName}`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${fnName}`);
  const slice = src.slice(start);
  const end = slice.search(/\n {2}}, \[\]/);
  if (end < 0) throw new Error(`找不到 ${fnName} 结束`);
  return slice.slice(0, end + 7);
}

describe('UI bug fix 契约 — Bug D：+添加 按钮 stale 残留（mousedown 清理）', () => {
  it('D1: 文字面板必须挂 onMouseDown handler（不是只有 onMouseUp）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // 文字面板（line 943 附近）的 div 必须有 onMouseDown 属性
    expect(src).toMatch(/onMouseDown=\{handlePanelMouseDown\}/);
  });

  it('D2: 脱敏后面板必须挂 onMouseDown handler', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // 脱敏后面板 div（line 985 附近）
    expect(src).toMatch(/onMouseDown=\{handlePanelMouseDown\}/);
  });

  it('D3: handler 必须调 setAddBtnPos(null)（清 stale 位置）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findMouseDownHandlerBody(src, 'handlePanelMouseDown');
    expect(body).toMatch(/setAddBtnPos\s*\(\s*null\s*\)/);
  });

  it('D4: handler 必须调 setSelectedText(\'\')（清 stale 选区）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findMouseDownHandlerBody(src, 'handlePanelMouseDown');
    expect(body).toMatch(/setSelectedText\s*\(\s*['""][^'"]*['"]\s*\)/);
  });

  it('D5: handler 必须清 pendingMatchRef.current', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findMouseDownHandlerBody(src, 'handlePanelMouseDown');
    expect(body).toMatch(/pendingMatchRef\.current\s*=\s*null/);
  });

  it('D6: handler 必须先检查 selection 为空才清（保护正在划选的 selection）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findMouseDownHandlerBody(src, 'handlePanelMouseDown');
    // 必须有 window.getSelection() 检查
    expect(body).toMatch(/window\.getSelection\s*\(\s*\)/);
    // 必须有 toString().trim() 形态（取 selection 文本）
    expect(body).toMatch(/toString\s*\(\s*\)\s*\.\s*trim\s*\(/);
    // 必须有 if 分支：selection 为空才清
    expect(body).toMatch(/if\s*\(\s*!currentSel|if\s*\(\s*!\s*[a-zA-Z_$][\w$]*\.toString|if\s*\(\s*!\s*[a-zA-Z_$][\w$]*\s*\)/);
  });

  it('D7: 行为契约 — handleTextSelection + scroll 清 + mousedown 清 三套机制并存', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // 三个清理入口都还在
    expect(src).toMatch(/onMouseUp=\{handleTextSelection/);
    expect(src).toMatch(/onScroll=\{handleOriginalScroll\}/);
    expect(src).toMatch(/onScroll=\{handleMaskedScroll\}/);
    expect(src).toMatch(/onMouseDown=\{handlePanelMouseDown\}/);
  });
});