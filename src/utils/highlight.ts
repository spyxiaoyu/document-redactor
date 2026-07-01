/**
 * 高亮纯函数（testable，独立于 React lifecycle）。
 *
 * 关键修复（commit `985ae11` follow-up）：
 *   取消高亮的 match 必须把 value 当普通文本推进 lastEnd 并 push 到 parts，
 *   否则后续 match 的 text.slice(lastEnd, match.start) 会重复包含老 match 范围的文本，
 *   导致渲染出现"字段重复 + 部分段消失"。
 *
 * 设计：返回 parts 数组，每个 part 是 {kind: 'text' | 'match', text, ...}
 *   - text 部分：{kind: 'text', text}
 *   - 高亮部分：{kind: 'match', text, matchId, type, confidence}
 *
 * 配合 isOriginal/isSelected 参数决定哪些 match 高亮哪些当作普通文本。
 */
import type { SensitiveMatch } from '@/types';

export type HighlightPart =
  | { kind: 'text'; text: string }
  | { kind: 'match'; text: string; matchId: string; type: string; confidence: number };

export function buildHighlightParts(
  text: string,
  matches: SensitiveMatch[],
  selectedIds: Set<string>,
  isOriginal: boolean,
): HighlightPart[] {
  if (!text) return [];

  const sortedMatches = [...matches].sort((a, b) => a.start - b.start);
  const parts: HighlightPart[] = [];
  let lastEnd = 0;

  for (const match of sortedMatches) {
    // 跳过重叠区间（应由 SensitiveFinder 的 mergeOverlappingValueAware 兜底）
    if (match.start < lastEnd) continue;

    // 中间普通文本
    if (match.start > lastEnd) {
      parts.push({ kind: 'text', text: text.slice(lastEnd, match.start) });
    }

    const isSelected = selectedIds.has(match.id);

    if (isOriginal) {
      // 原文面板：selected 高亮，unselected 当作普通文本（推进 lastEnd）
      if (isSelected) {
        parts.push({
          kind: 'match',
          text: match.value,
          matchId: match.id,
          type: match.type,
          confidence: match.confidence,
        });
      } else {
        parts.push({ kind: 'text', text: match.value });
      }
    } else {
      // 脱敏后面板：selected 显示下划线，unselected 显示原文
      if (isSelected) {
        parts.push({
          kind: 'match',
          text: '\u00a0'.repeat([...match.value].length),  // 不脱敏空格占位
          matchId: match.id,
          type: match.type,
          confidence: match.confidence,
        });
      } else {
        parts.push({ kind: 'text', text: match.value });
      }
    }

    lastEnd = match.end;
  }

  // 收尾：剩余普通文本
  if (lastEnd < text.length) {
    parts.push({ kind: 'text', text: text.slice(lastEnd) });
  }

  return parts;
}