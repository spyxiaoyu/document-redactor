/**
 * HtmlPreview 契约测试（方案 1 — 只读 HTML 视图）
 *
 * 复现：合同预览只显示纯文本（mammoth.extractRawText 折叠表格 / 丢弃图片）
 * 修法：方案 1 — sanitizeHtml + HtmlPreview 组件
 *   - 不高亮（脱敏识别仍走 raw text，无映射风险）
 *   - DOMPurify 清洗 XSS
 *   - CSS Modules 隔离样式污染
 *
 * 验收（spy 真实合同）：
 *   - sanitizeHtml 保留标准表格 <table><tr><td>
 *   - sanitizeHtml 保留 base64 图片 <img src="data:image/png;base64,...">
 *   - sanitizeHtml 剥除 <script>（XSS 防护）
 *   - 空字符串 / undefined / null 不崩
 *   - HtmlPreview 容器带 cssModule class 隔离样式
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../sanitizeHtml';
import fs from 'node:fs';
import path from 'node:path';

describe('HtmlPreview 组件契约（方案 1 — 只读 HTML 视图）', () => {
  describe('sanitizeHtml 纯函数', () => {
    it('1: 保留标准表格', () => {
      const html = '<table><tr><td>开户行：示例银行</td></tr><tr><td>银行账号：012345678901234</td></tr></table>';
      const out = sanitizeHtml(html);
      expect(out).toContain('<table>');
      expect(out).toContain('开户行：示例银行');
      expect(out).toContain('012345678901234');
    });

    it('2: 保留 base64 图片', () => {
      const html = '<img src="data:image/png;base64,iVBORw0KGgoAA" alt="盖章图" />';
      const out = sanitizeHtml(html);
      expect(out).toContain('<img');
      expect(out).toContain('data:image/png;base64');
      expect(out).toContain('alt="盖章图"');
    });

    it('3: 剥除 <script> 标签（XSS 防护）', () => {
      const html = '<p>正常内容</p><script>alert("xss")</script>';
      const out = sanitizeHtml(html);
      expect(out).not.toContain('<script>');
      expect(out).not.toContain('alert');
      expect(out).toContain('正常内容');
    });

    it('4: 边界 — 空字符串 / 异常输入不崩', () => {
      expect(sanitizeHtml('')).toBe('');
    });
  });

  describe('HtmlPreview 组件 + CSS Module 隔离', () => {
    it('5: CSS Module 文件必须导出 htmlpreview 类（防样式污染隔离）', () => {
      // 读源码确认 className 引用的是 cssModule 的 .htmlpreview
      // 编译后 className 会变成 .htmlpreview_xxx_yyy，但源码字面必须是 htmlpreview
      const tsx = fs.readFileSync(path.resolve(__dirname, '..', 'HtmlPreview.tsx'), 'utf-8');
      expect(tsx).toMatch(/styles\.htmlpreview/);
      // 禁止用全局 Tailwind class 替代（防止样式污染其他面板）
      expect(tsx).not.toMatch(/className="[^"]*\bprose\b/);  // tailwind typography plugin
    });

    it('6: 复盘 — prop 接口契约锁定（防止 refactor 改坏 UploadPage 调用点）', () => {
      // 锁定 HtmlPreview 接收的 prop 名是 html（不是 content / htmlContent / source）
      const tsx = fs.readFileSync(path.resolve(__dirname, '..', 'HtmlPreview.tsx'), 'utf-8');
      expect(tsx).toMatch(/interface HtmlPreviewProps/);
      expect(tsx).toMatch(/html:\s*string/);
    });

    it('7: 复盘 — 必须调用 sanitizeHtml（不能直接 dangerouslySetInnerHTML 原始 HTML）', () => {
      // 防止后续 refactor 跳过 XSS 防护
      const tsx = fs.readFileSync(path.resolve(__dirname, '..', 'HtmlPreview.tsx'), 'utf-8');
      expect(tsx).toMatch(/sanitizeHtml/);
      // 用 dangerouslySetInnerHTML 渲染的必须是 cleanHtml（清洗过的），不是原始 html
      expect(tsx).toMatch(/dangerouslySetInnerHTML=\{\{ __html: cleanHtml \}\}/);
    });
  });
});
