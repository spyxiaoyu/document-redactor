export function extractContext(text: string, index: number, radius: number = 20): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  const before = text.slice(start, index);
  const after = text.slice(index, end);
  return `...${before}${after}...`;
}

export function replaceRange(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}

export function replaceAll(text: string, search: string, replacement: string): string {
  return text.split(search).join(replacement);
}

export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mergeOverlapping<T extends { start: number; end: number }>(
  items: T[]
): T[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.start - b.start);
  const result: T[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result[result.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      result.push(current);
    }
  }

  return result;
}

/**
 * 过滤掉与已存在 match 区间重叠的 hit（用于"一键搜索脱敏"等批量场景）。
 *
 * 场景：用户已经选中了 "北京示例科技有限公司"（17 chars）作为 COMPANY match，
 *       又搜索 "示例" 想批量脱敏。如果直接 addManualMatch，addManualMatch 的
 *       "重叠替换" 逻辑（commit `1f9f93d` 修的渲染 bug）会把 17 字 COMPANY 替换成
 *       4 字 CUSTOM，导致脱敏范围变小、用户得手动重新选。
 *
 * 修法：批量脱敏前先过滤，**重叠的 hit 全部跳过**，保留已选中的大范围 match。
 *       （addManualMatch 单调用仍保留"重叠替换"语义不变，因为那是用户主动覆盖意图。）
 *
 * 重叠判定：`hit.start < existing.end && hit.end > existing.start`
 *   - hit 完全在 existing 内部：跳过
 *   - hit 与 existing 部分重叠：跳过
 *   - hit 完全包含 existing：跳过（保守原则，不让批量覆盖已选 match）
 *   - 完全不重叠：保留
 *
 * @returns 未重叠的 hit 子集（保持原顺序）
 */
export function filterHitsByExistingMatches<
  H extends { start: number; end: number },
  M extends { start: number; end: number }
>(hits: H[], existingMatches: M[]): H[] {
  if (hits.length === 0 || existingMatches.length === 0) return hits;

  return hits.filter(hit =>
    !existingMatches.some(m => hit.start < m.end && hit.end > m.start)
  );
}
