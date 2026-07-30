/**
 * FilesPage 清理回归测试 — 方案 ①
 *
 *   spy 反馈：FilesPage（"/files"）和 HistoryPage（"/history"）展示内容相同，
 *   "活跃文件 / 我的文件 / 历史记录" 三视图重复，FilesPage 没有独有价值。
 *   决议：删除 FilesPage + 侧边栏 "文件" 项 + /files 路由。
 *
 *   锁死项：
 *   - 侧边栏不再有 "文件" 入口（避免误触回归）
 *   - Dashboard "活跃文件" tile 点击 → /history（而非已删除的 /files）
 *   - Dashboard 活跃文件/历史记录说明文案不再误导用户（"可直接还原"已删除）
 *   - FilesPage.tsx 文件物理删除
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;

// mock listRecords — Dashboard 渲染需要
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return {
    ...actual,
    listRecords: vi.fn().mockResolvedValue([]),
  };
});

import { Sidebar } from '@/components/layout/Sidebar';
import { Dashboard } from '@/pages/Dashboard';

describe('FilesPage 清理回归', () => {
  it('侧边栏不再渲染 "文件" 入口', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    // "文件" 在新侧边栏里不应出现（之前唯一的 "文件" 项被砍了）
    expect(html).not.toContain('>文件<');
    // "历史" 项应保留（侧边栏还有 5 个入口：首页/上传/恢复/历史/设置）
    expect(html).toContain('历史');
  });

  it('Dashboard "活跃文件" tile 不再跳转 /files', async () => {
    const fsContent = fs.readFileSync(
      path.resolve(__dirname, '../pages/Dashboard.tsx'),
      'utf-8',
    );
    // 老跳转：navigate('/files') 必须消失
    expect(fsContent).not.toMatch(/navigate\(['"]\/files['"]\)/);
    // 新跳转：navigate('/history') 必须出现
    expect(fsContent).toMatch(/navigate\(['"]\/history['"]\)/);
  });

  it('App.tsx 不再导入 / 注册 FilesPage', async () => {
    const fsContent = fs.readFileSync(
      path.resolve(__dirname, '../App.tsx'),
      'utf-8',
    );
    expect(fsContent).not.toMatch(/FilesPage/);
    expect(fsContent).not.toMatch(/path=["']\/files["']/);
  });

  it('FilesPage.tsx 文件物理删除', () => {
    const filePath = path.resolve(__dirname, '../pages/FilesPage.tsx');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('Dashboard 说明文案不再误导（去掉 "可直接进入还原页面..."）', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    // 老误导文案必须消失
    expect(html).not.toContain('可直接进入还原页面');
    expect(html).not.toContain('输入密码即可还原为原文');
    // 新说明应提到恢复需要 "上传"（纠正用户心智：docx 文件本身还要用户拿在手里）
    expect(html).toContain('上传');
  });
});