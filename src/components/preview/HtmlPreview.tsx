/**
 * HtmlPreview 组件（方案 1 — 只读 HTML 视图）
 *
 * 用途：渲染 mammoth.convertToHtml 生成的 HTML（含表格 / 图片 / 段落格式）
 * 触发：spy 2026-07-26 截图反馈"word 文档中的表格（图片）打开后不能显现"
 *
 * 关键设计（与 SensitiveFinder / 脱敏输出 完全解耦）：
 *   - 不高亮敏感词（脱敏识别仍走 raw text，无坐标映射风险）
 *   - DOMPurify 清洗 XSS（docx 含 <script> / <iframe> 时防护）
 *   - CSS Modules 隔离样式（不污染右面板 / 敏感词面板）
 *   - mammoth 已生成 htmlResult.value 并存到 ast.content[0].content
 *     → 本组件纯渲染，不重新调 mammoth（性能 0 成本）
 *
 * 已知 trade-off（已复盘给 spy，2026-07-26）：
 *   - mammoth 不输出批注 / 脚注 / 文本框 / 嵌入对象
 *   - 但敏感词识别在 raw text 上跑（右面板列表仍能识别这些位置）
 *   - 用户看不到 ≠ 工具漏识别
 */
import { useMemo } from 'react';
import { sanitizeHtml } from './sanitizeHtml';
import styles from './HtmlPreview.module.css';

interface HtmlPreviewProps {
  /** mammoth.convertToHtml 返回的 HTML 字符串 */
  html: string;
}

export function HtmlPreview({ html }: HtmlPreviewProps) {
  const cleanHtml = useMemo(() => sanitizeHtml(html), [html]);

  if (!cleanHtml) {
    return (
      <div className={styles.htmlpreview}>
        <p className="text-muted-foreground text-sm">暂无 HTML 内容</p>
      </div>
    );
  }

  return (
    <div
      className={styles.htmlpreview}
      dangerouslySetInnerHTML={{ __html: cleanHtml }}
    />
  );
}
