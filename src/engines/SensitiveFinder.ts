import type { Rule, SensitiveMatch, SensitiveDetectionResult, SensitiveType } from '@/types';
import { createRulesFromBuiltin } from '@/rules';
import { extractContext } from '@/utils';
import { generateUUID } from '@/utils';

interface FindOptions {
  includeDisabled?: boolean;
  minConfidence?: number;
}

export class SensitiveFinder {
  private rules: Rule[] = [];
  private keywordSet: Set<string> = new Set();

  constructor() {
    this.rules = createRulesFromBuiltin();
  }

  setRules(rules: Rule[]): void {
    this.rules = rules;
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  updateRule(id: string, updates: Partial<Rule>): void {
    const index = this.rules.findIndex(r => r.id === id);
    if (index !== -1) {
      this.rules[index] = { ...this.rules[index], ...updates };
    }
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter(r => r.id !== id);
  }

  enableRule(id: string): void {
    this.updateRule(id, { enabled: true });
  }

  disableRule(id: string): void {
    this.updateRule(id, { enabled: false });
  }

  addKeywords(keywords: string[]): void {
    keywords.forEach(k => this.keywordSet.add(k));
  }

  clearKeywords(): void {
    this.keywordSet.clear();
  }

  
  findSensitiveContent(text: string, options: FindOptions = {}): SensitiveDetectionResult {
    const { includeDisabled = false, minConfidence = 0 } = options;
    const matches: SensitiveMatch[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled && !includeDisabled) continue;
      if (rule.weight < minConfidence) continue;

      // All rule types use standard regex exec
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        if (match[0].length === 0) { pattern.lastIndex = match.index + 1; continue; }
        const hasCaptureGroup = match.length > 1 && match[1] !== undefined;
        const value = hasCaptureGroup ? match[1] : match[0];
        const offset = hasCaptureGroup ? match[0].indexOf(match[1]) : 0;
        const start = match.index + offset;

        // COMPANY 排除词：含"关联公司"、甲方公司、乙方公司
        if (rule.type === 'COMPANY') {
          if (value.includes('关联公司')) continue;
          if (/^(?:甲方|乙方)公司$/.test(value)) continue;
        }

        matches.push({
          id: generateUUID(),
          type: rule.type,
          value,
          start,
          end: start + value.length,
          confidence: rule.weight,
          context: extractContext(text, start, 30),
          blockId: undefined
        });
      }
    }

    for (const keyword of this.keywordSet) {
      let index = text.indexOf(keyword);
      while (index !== -1) {
        matches.push({
          id: generateUUID(),
          type: 'CUSTOM',
          value: keyword,
          start: index,
          end: index + keyword.length,
          confidence: 0.95,
          context: extractContext(text, index, 30),
          blockId: undefined
        });
        index = text.indexOf(keyword, index + keyword.length);
      }
    }

    const merged = mergeOverlappingValueAware(matches);

    const byType: Record<SensitiveType, number> = {} as Record<SensitiveType, number>;
    for (const m of merged) byType[m.type] = (byType[m.type] || 0) + 1;

    return { matches: merged, totalCount: merged.length, byType };
  }

  getRules(): Rule[] { return [...this.rules]; }
  getEnabledRules(): Rule[] { return this.rules.filter(r => r.enabled); }

  static createSimpleAmountUpperPattern(): RegExp {
    return /[零壹贰叁肆伍陆柒捌玖]+(?:[零壹贰叁肆伍陆柒捌玖]*[角分])?(?:[元整])?/g;
  }
}

/**
 * Value-aware overlap merge for SensitiveMatch.
 *
 * The generic utils.mergeOverlapping<T extends { start; end }> extends last.end
 * without touching `value` — so when the FIRST (shorter) match absorbs the SECOND
 * (longer) match's range, you get a match with value.length < end - start.
 * That corrupted match then breaks the integrity invariant that downstream
 * Desensitizer / restore depend on:
 *   text.slice(m.start, m.start + m.value.length) === m.value
 *
 * Resolution: on overlap, keep the LONGER match (more specific detection wins).
 * Same length: keep the first (deterministic, no semantic difference).
 */
function mergeOverlappingValueAware(matches: SensitiveMatch[]): SensitiveMatch[] {
  if (matches.length === 0) return [];
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const merged: SensitiveMatch[] = [];
  for (const m of sorted) {
    const last = merged[merged.length - 1];
    if (last && m.start < last.end) {
      if (m.end - m.start > last.end - last.start) {
        merged[merged.length - 1] = m;
      }
      // else: last is longer or equal, drop m
    } else {
      merged.push(m);
    }
  }
  return merged;
}
