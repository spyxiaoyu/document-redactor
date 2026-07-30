/**
 * UI bug fix 契约测试 — Bug C：spy 2026-07-30 "+ 添加"按钮卡住不消失
 *
 * 【根因】UploadPage.tsx 的 handleOriginalScroll / handleMaskedScroll 只做
 *   左右 panel scrollTop 联动同步，**没有清 addBtnPos**。按钮用 `fixed`
 *   定位在 mouseup 时的 clientX/clientY（视口坐标），scroll 后容器滚动
 *   但 addBtnPos 不变 → 按钮视觉上"卡在原位"，脱离真实选区。
 *
 * 【修法】scroll handler 末尾清掉三个东西：
 *   - setAddBtnPos(null)              — 按钮消失
 *   - setSelectedText('')             — 选区清掉（强制重新划选）
 *   - pendingMatchRef.current = null  — ref 缓存必清（scroll 后选区无效）
 *
 * 锁 3 条行为契约：
 *   1. handleOriginalScroll 必须调 setAddBtnPos(null)
 *   2. handleOriginalScroll 必须调 setSelectedText('')
 *   3. handleOriginalScroll 必须清 pendingMatchRef.current
 *   4-6. handleMaskedScroll 同上
 *   7. 【UX 契约】"+ 添加" button 在两个 panel 都至少存在一次 source-grep 出现
 *      （防止有人误删整个 addBtnPos 状态机）
 *
 * 防止任何人在后续 commit 把 scroll 修复改回原样。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/**
 * 提取 const handleOriginalScroll / handleMaskedScroll 的函数体。
 * handleOriginalScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => { ... }, []);
 * 结束形态：'\n  }, []);'
 */
function findScrollHandlerBody(src: string, fnName: string): string {
  const marker = `const ${fnName}`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${fnName}`);
  const slice = src.slice(start);
  const end = slice.search(/\n {2}}, \[\]/);
  if (end < 0) throw new Error(`找不到 ${fnName} 结束`);
  return slice.slice(0, end + 7);
}

describe('UI bug fix 契约 — Bug C：+添加 按钮 scroll 后不消失', () => {
  it('C1: handleOriginalScroll 必须调 setAddBtnPos(null)（按钮消失）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findScrollHandlerBody(src, 'handleOriginalScroll');
    expect(body).toMatch(/setAddBtnPos\s*\(\s*null\s*\)/);
  });

  it('C2: handleOriginalScroll 必须调 setSelectedText(\'\')（强制重新划选）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findScrollHandlerBody(src, 'handleOriginalScroll');
    // 允许 setSelectedText('') 或 setSelectedText("") 两种写法
    expect(body).toMatch(/setSelectedText\s*\(\s*['""][^'"]*['"]\s*\)/);
  });

  it('C3: handleOriginalScroll 必须清 pendingMatchRef.current（ref 缓存必清）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findScrollHandlerBody(src, 'handleOriginalScroll');
    expect(body).toMatch(/pendingMatchRef\.current\s*=\s*null/);
  });

  it('C4: handleMaskedScroll 必须调 setAddBtnPos(null)', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findScrollHandlerBody(src, 'handleMaskedScroll');
    expect(body).toMatch(/setAddBtnPos\s*\(\s*null\s*\)/);
  });

  it('C5: handleMaskedScroll 必须调 setSelectedText(\'\')', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findScrollHandlerBody(src, 'handleMaskedScroll');
    expect(body).toMatch(/setSelectedText\s*\(\s*['""][^'"]*['"]\s*\)/);
  });

  it('C6: handleMaskedScroll 必须清 pendingMatchRef.current', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    const body = findScrollHandlerBody(src, 'handleMaskedScroll');
    expect(body).toMatch(/pendingMatchRef\.current\s*=\s*null/);
  });

  it('C7: 行为契约 — +添加 按钮仍在（防止误删整个状态机）', () => {
    const src = readSource('src/pages/UploadPage.tsx');
    // 渲染层 + "添加" 文本应仍存在（修 bug 不是删 feature）
    expect(src).toMatch(/添加/);
    // onScroll 仍在两个 panel 上挂载
    expect(src).toMatch(/onScroll=\{handleOriginalScroll\}/);
    expect(src).toMatch(/onScroll=\{handleMaskedScroll\}/);
  });
});