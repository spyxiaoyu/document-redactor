/**
 * Dashboard "如何恢复" 措辞精度回归测试
 *
 *   spy 审核发现: "文件名不影响识别" 是过度承诺
 *   主路径 (docx 内嵌 metadata) 不查文件名 ✓
 *   fallback 路径 (Step 2 DB 文件名匹配) 改名会失败 ✗
 *
 *   锁死项:
 *   - 改用 "主路径不依赖文件名"（精准）
 *   - 旧措辞 "文件名不影响识别" 必须消失（避免越界承诺）
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

describe('Dashboard "如何恢复" 措辞精度', () => {
  it('新措辞 "主路径不依赖文件名" 出现', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).toContain('主路径不依赖文件名');
  });

  it('旧措辞 "文件名不影响识别" 消失（避免越界承诺）', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).not.toContain('文件名不影响识别');
  });

  it('docx 内嵌 metadata 描述仍在（事实陈述）', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(html).toContain('docProps/desensitizer.xml');
  });
});
