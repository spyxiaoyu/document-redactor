/**
 * SensitivePanel 折叠行为契约测试 — SPEC-UI-1
 *
 *   需求：上传文件识别后敏感信息面板默认折叠，加展开按钮。
 *   - 默认折叠：仅显示头部（总数 + 已选择 + 展开按钮 + 全选/取消全选）
 *   - 不渲染分组列表（按 type 展示的详细信息）
 *   - 点击展开按钮 → 显示分组列表
 *   - 再次点击 → 折叠
 *
 * 锁死项：
 *   - 展开按钮用 `data-testid="sensitive-panel-toggle"`，方便测试和 a11y
 *   - type 顺序的头部（"PHONE (1)" 等）只应在展开后渲染
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { SensitivePanel } from '../SensitivePanel';
import type { SensitiveMatch } from '@/types';

// jsdom for @testing-library 风格交互（用 URL querySelector 不会触发 server-only）
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;

function mkMatch(id: string, type: SensitiveMatch['type'], value: string): SensitiveMatch {
  return {
    id,
    type,
    value,
    start: 0,
    end: value.length,
    confidence: 1.0,
    context: '',
  };
}

const mockMatches: SensitiveMatch[] = [
  mkMatch('m1', 'PHONE', '示例手机号'),
  mkMatch('m2', 'EMAIL', '示例邮箱'),
];

describe('SensitivePanel: 默认折叠 + 展开按钮', () => {
  it('默认不渲染分组列表（折叠态）', () => {
    const html = renderToStaticMarkup(
      <SensitivePanel
        matches={mockMatches}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    // 头部应存在
    expect(html).toContain('检测到 2 处敏感信息');
    expect(html).toContain('已选择 0 处');
    // 展开按钮应存在
    expect(html).toMatch(/data-testid="sensitive-panel-toggle"/);
    // 全选/取消全选始终可见
    expect(html).toContain('全选');
    expect(html).toContain('取消全选');
    // 分组列表默认不渲染（type label 渲染为中文 "手机号 (1)" / "邮箱 (1)" — 应不出现）
    expect(html).not.toMatch(/手机号 \(1\)/);
    expect(html).not.toMatch(/邮箱 \(1\)/);
  });

  it('展开按钮在头部，靠右', () => {
    const html = renderToStaticMarkup(
      <SensitivePanel
        matches={mockMatches}
        selectedIds={new Set()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onDeselectAll={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    // 展开按钮类型是 button
    expect(html).toMatch(/<button[^>]*data-testid="sensitive-panel-toggle"[^>]*>/);
  });
});
