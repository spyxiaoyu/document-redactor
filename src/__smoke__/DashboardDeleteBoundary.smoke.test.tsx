/**
 * Dashboard 删除边界文案回归测试
 *
 *   spy 反馈：原"删除"行为误导用户以为一键清空，实际只清 IndexedDB，
 *   用户磁盘上的脱敏 docx 不归工具管。需在首页尾部明确边界。
 *
 *   锁死项：
 *   - "删除"作为独立说明段落出现在 Dashboard 末尾
 *   - 必须含"加密映射表与记录"（精准措辞，不说"文件内容"）
 *   - 必须含"您电脑上的脱敏文件需自行处理"（边界声明）
 *   - 必须跟"如何恢复"段同处一个 text-xs 容器内（视觉对齐）
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { MemoryRouter } from 'react-router-dom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return {
    ...actual,
    listRecords: vi.fn().mockResolvedValue([]),
  };
});

import { Dashboard } from '@/pages/Dashboard';

describe('Dashboard "删除"边界文案', () => {
  it('"删除"段存在', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).toContain('删除');
    expect(html).toMatch(/<strong[^>]*>删除<\/strong>/);
  });

  it('"删除"段含 "加密映射表与记录"（精准措辞，不用"文件内容"）', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).toContain('加密映射表与记录');
  });

  it('"删除"段含边界声明 "您电脑上的脱敏文件需自行处理"', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).toContain('您电脑上的脱敏文件需自行处理');
  });

  it('"删除"段使用 text-xs 样式（小字体）', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).toMatch(
      /<p[^>]*text-xs[^>]*>[\s\S]*<strong[^>]*>删除<\/strong>[\s\S]*您电脑上的脱敏文件需自行处理[\s\S]*<\/p>/,
    );
  });
});
