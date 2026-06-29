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
