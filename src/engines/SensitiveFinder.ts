import type { Rule, SensitiveMatch, SensitiveDetectionResult, SensitiveType } from '@/types';
import { createRulesFromBuiltin } from '@/rules';
import { extractContext, mergeOverlapping } from '@/utils';
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
        index = text.indexOf(keyword, index + 1);
      }
    }

    const merged = mergeOverlapping(matches);

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
