/**
 * Dashboard 说明文字契约测试 — SPEC-UI-2
 *
 *   需求：首页底部（"支持的文件格式"下面）增加对"活跃文件"和"历史记录"
 *   的文字说明（字体小），便于用户理解区别。
 *   - 活跃文件 = 当前在系统中且未恢复的脱敏文档（status: active）
 *   - 历史记录 = 所有处理过的文档（已恢复 + 未恢复 + 已删除）
 *   - 区别：活跃 = 当前存在；历史 = 包括已恢复 / 已删除
 *
 * 锁死项：
 *   - 说明文字必须含 "活跃文件" 和 "历史记录" 关键词
 *   - 文字用 `text-xs` 样式（小字体）
 *   - 位置：在 "支持的文件格式" 区块下面
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../Dashboard';
import { listRecords } from '@/db';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;

// mock listRecords — 返回空数组，Dashboard 渲染 stats = 0
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return {
    ...actual,
    listRecords: vi.fn().mockResolvedValue([]),
  };
});

describe('Dashboard: 首页底部"活跃文件"/"历史记录"说明文字', () => {
  it('渲染包含 "活跃文件" 关键词', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).toContain('活跃文件');
  });

  it('渲染包含 "历史记录" 关键词', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).toContain('历史记录');
  });

  it('说明文字用 text-xs 样式（小字体）', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    // 文档中应有 text-xs 类的说明段落
    expect(html).toMatch(/<p[^>]*text-xs[^>]*>[\s\S]*活跃文件[\s\S]*<\/p>/);
    expect(html).toMatch(/<p[^>]*text-xs[^>]*>[\s\S]*历史记录[\s\S]*<\/p>/);
  });

  it('说明文字在"支持的文件格式"区块下面', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    const supportIdx = html.indexOf('支持的文件格式');
    // 找 "<strong>活跃文件" 模式 — 这是说明文字独有的（StatCard label 不会用 <strong> 包裹）
    const activeFileExplanationIdx = html.indexOf('<strong class="font-medium text-foreground">活跃文件');
    expect(activeFileExplanationIdx).toBeGreaterThan(supportIdx);
  });
});

// 静默未使用 — listRecords mock 占位
void listRecords;
