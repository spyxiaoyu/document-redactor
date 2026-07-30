/**
 * UI bug fix 契约测试 — spy 2026-07-29 截图 bug 的修复合约。
 *
 * 锁定 4 条 CSS / 调用契约，下次任何人改 source 时跑测试就会 fail：
 *
 *   Bug A（侧栏切换 → 文字变竖排）：
 *     - <aside> 必须有 shrink-0（flex-shrink-0）
 *     - <main> 必须有 min-w-0
 *     - 父 <div className="flex flex-1"> 必须有 min-w-0（否则 sidebar 会缩）
 *
 *   Bug C（"原文"挤"脱敏后"）：
 *     - 并排对比视图 grid 必须用 minmax(0,1fr) 双列，禁止回退到默认 1fr（min-width: auto）
 *
 * 数据驱动：A/B Test，每次跑 vitest 都验证，不依赖 spy 手工验证。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

describe('UI bug fix 契约 — spy 2026-07-29 截图 bug 修复合约', () => {
  describe('Bug A: 侧栏切换文字变竖排 (flex 坍塌)', () => {
    it('Sidebar.tsx <aside> 必须含 shrink-0', () => {
      const src = readSource('src/components/layout/Sidebar.tsx');
      expect(src).toMatch(/<aside[^>]*\bshrink-0\b/);
    });

    it('App.tsx <main> 必须含 min-w-0（允许 main 收缩）', () => {
      const src = readSource('src/App.tsx');
      expect(src).toMatch(/<main[^>]*\bmin-w-0\b/);
    });

    it('App.tsx 父 <div className="flex flex-1"> 必须含 min-w-0（保护子项不被压）', () => {
      const src = readSource('src/App.tsx');
      // 允许 className 里 flex / flex-1 顺序任意，但 min-w-0 必须存在
      expect(src).toMatch(/<div className="flex flex-1[^"]*\bmin-w-0\b/);
    });

    it('Sidebar.tsx 的 aside 不该再回到没 shrink-0 的旧版', () => {
      // 反向锁定：防止有人加了 shrink-0 又在后续 commit 去掉
      const src = readSource('src/components/layout/Sidebar.tsx');
      const asideMatch = src.match(/<aside[^>]*>/);
      expect(asideMatch, 'Sidebar.tsx 必须有 <aside> 元素').not.toBeNull();
      expect(asideMatch![0], '<aside> 必须同时含 w-56 和 shrink-0').toMatch(/\bw-56\b/);
      expect(asideMatch![0], '<aside> 必须同时含 w-56 和 shrink-0').toMatch(/\bshrink-0\b/);
    });
  });

  describe('Bug C: 并排对比视图两列同步变宽（grid min-width: auto 撑大单列）', () => {
    it('UploadPage.tsx 并排对比视图 grid 必须用 minmax(0,1fr) 双列', () => {
      const src = readSource('src/pages/UploadPage.tsx');
      // 锁定 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]
      expect(src).toMatch(/grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
    });

    it('并排对比视图禁止回退到 grid-cols-2（默认 min-width: auto）', () => {
      const src = readSource('src/pages/UploadPage.tsx');
      // React JSX 注释格式: `{/* 并排对比视图 */}`
      const section = src.match(/\{\/\*\s*并排对比视图\s*\*\/\}/);
      expect(section, '"并排对比视图" section 必须存在').not.toBeNull();
      const slice = src.slice(section!.index!);
      expect(slice).not.toMatch(/<div className="grid grid-cols-2 gap-4">/);
    });

    // 【spy 2026-07-30 决定】long-match widening 修了好几轮不理想，
    // 在 Safari + Chrome 都引入了新 regression（图片 chip 后文字点击添加偶发失灵），
    // ROI 太低，停止 chase。删 v3 加的 5 条强约束 test，恢复到 v2 状态。
    // 后续如果有人想重新尝试修 widening，请新开分支单独立项，本测试不锁任何额外 CSS。
  });
});
