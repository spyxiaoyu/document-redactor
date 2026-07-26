/**
 * sanitizeHtml — 纯函数：清洗 mammoth 输出的 HTML
 *
 * 触发：spy 2026-07-26 反馈"word 文档中的表格（图片）打开后不能显现"
 * 方案 1 的核心：DOMPurify 剥 <script> / <iframe> / on* 事件 / javascript: URL
 *   - 保留 docx 需要的 <table> / <img> / <p> / <strong> / <em> 等
 *   - 保留 base64 图片（mammoth 默认 base64 嵌入）
 *
 * 拆成纯函数：易测试（不依赖 React 渲染），逻辑可复用
 */
import DOMPurify from 'dompurify';

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
  });
}
