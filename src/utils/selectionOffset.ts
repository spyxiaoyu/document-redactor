/**
 * 选中位置 → 在 rawText 里的字符 offset。
 *
 * 【旧实现 computeSelectionOffset - 已删除】
 *   旧版用 TreeWalker SHOW_TEXT 走容器内 text node 累加得 offset。
 *   **BUG（spy 2026-07-29）**：UploadPage 的 <pre>...</pre> JSX 编译产物含 `\n  `
 *   文本节点（缩进），TreeWalker 把这些 whitespace 当字符算进 offset，但 rawText
 *   没这些 whitespace。结果 addManualMatch(slicedValue, [position]) 用错 position
 *   加 match → 视图滚动到新 match 位置 → spy 感觉"文字跳到别处"。
 *
 *   spy 截图：在 3.11 段选文本按"+ 添加"，match 加到错位置，视图跳到 3.15.5。
 *
 * 【新实现 getRawOffsetFromSelection - 唯一推荐用法】
 *   每个 text part / match part 在 render 时打 data-raw-offset={N} 属性（N 是该段
 *   在 rawText 里的起始 offset）。选中时 closest('[data-raw-offset]') 找到段，加
 *   range.startOffset 即得 rawText offset。完全不依赖 previewText / TreeWalker。
 *
 *   数据契约（UploadPage 渲染层）：
 *     - renderHighlightParts 给每个 text part span 加 data-raw-offset={segOffset + partStartInSeg}
 *     - renderHighlightParts 给每个 match part span 加 data-raw-offset={segOffset + match.start}
 *     - handleAddManualMatch 调本函数拿到 offset，调 addManualMatch(text, [offset])
 *
 * @param range - window.getSelection().getRangeAt(0)
 * @returns 0-based offset；任一元素无 data-raw-offset 时返回 null（fallback 信号）
 */
export function getRawOffsetFromSelection(range: Range): number | null {
  // 起点支持 text node 或 element node（jsdom 在 selection 跨 element 时偶尔会这样）
  let el: Element | null;
  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    el = range.startContainer as Element;
  } else {
    el = range.startContainer.parentElement;
  }
  if (!el) return null;

  // closest 在 jsdom 已支持；找不到 → null
  const wrapped = el.closest('[data-raw-offset]');
  if (!wrapped) return null;

  const base = wrapped.getAttribute('data-raw-offset');
  if (base === null) return null;
  const baseNum = Number(base);
  if (!Number.isFinite(baseNum)) return null;

  // range.startOffset 是 startContainer 内的字符位移
  return baseNum + range.startOffset;
}
