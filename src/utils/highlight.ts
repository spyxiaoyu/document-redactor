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

/**
 * 按 imagePositions 把 text 切成 segments。chip 渲染在 segment 之间的缝隙，
 * 因此 chip 位置精度 = imagePosition 本身（不会受 match 边界影响）。
 *
 * 设计要点（spy 截图 2026-07-27 反馈）：
 *   - 旧实现是 part-based flush：chip 落在"含 imagePosition 的 part 的开头"，不准确。
 *   - 新实现先按 imagePosition 切文本为 segments，再对每段单独 buildHighlightParts。
 *
 * @returns segments: [{ start, end, matches[] }, ...]，matches 已按 segment-relative offset 平移
 */
export interface TextSegment {
  /** 在原 text 中的起始 offset（imagePosition 切点） */
  start: number;
  /** 在原 text 中的结束 offset（exclusive，下一 segment.start 或 text.length） */
  end: number;
  /** 该 segment 范围内的 matches（offset 已平移为 segment-relative，但 start/end 仍是 text-absolute 以便渲染搜索 hit） */
  matches: SensitiveMatch[];
}

export function splitByImagePositions(
  text: string,
  matches: SensitiveMatch[],
  imagePositions: number[] | undefined,
): TextSegment[] {
  if (!text) return [];

  // 1. 清洗 imagePositions：去重、排序、限定在 [1, text.length]（position=0 视为"文件开头"，仍渲染 chip 但需要 segment 起点为 0）
  const validPositions = (imagePositions || [])
    .filter(p => Number.isFinite(p) && p >= 0 && p <= text.length)
    .map(p => Math.floor(p))
    .sort((a, b) => a - b);
  // 去重（同位置多次只切一次）
  const uniquePositions: number[] = [];
  for (const p of validPositions) {
    if (uniquePositions.length === 0 || uniquePositions[uniquePositions.length - 1] !== p) {
      uniquePositions.push(p);
    }
  }

  // 2. 切点列表：segment.start 集合。始终包含 0；uniquePositions 中为 0 时保留 0；其余原样加入
  //    这样保证 segments 覆盖 [0, text.length]
  const cuts: number[] = [0];
  for (const p of uniquePositions) {
    if (p > 0 && p < text.length) cuts.push(p);
  }
  cuts.push(text.length);

  // 3. 构建 segments
  const segments: TextSegment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const segStart = cuts[i];
    const segEnd = cuts[i + 1];
    // 筛选落在此 segment 内的 matches。match.start >= segStart 且 match.end <= segEnd
    // 注意：match 跨越 segment 边界时（如 start 在 seg A、end 在 seg B），
    //   旧实现是 part-based flush，自然渲染；这里改用 segment-based 后：
    //   - 若 match 完全在某 segment 内 → 归属该 segment
    //   - 若 match 跨越 → 归属 start 所在的 segment（避免完全丢失），但其他 segment 不重复添加
    //     （buildHighlightParts 内部已用 match.start < lastEnd 去重，无需我们再处理）
    const segMatches = matches.filter(m => m.start >= segStart && m.start < segEnd);
    segments.push({
      start: segStart,
      end: segEnd,
      matches: segMatches,
    });
  }

  return segments;
}

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