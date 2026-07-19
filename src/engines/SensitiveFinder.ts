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
    // 防御性过滤空字符串：否则 findSensitiveContent 里 indexOf('', index) 永远返回 index
    // （lastIndex + keyword.length = lastIndex + 0 = lastIndex）→ 死循环 → OOM。
    // 这正是 SPEC-A2-07 钉死的 invariant。
    keywords.forEach(k => {
      if (k.length > 0) this.keywordSet.add(k);
    });
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
        let value = hasCaptureGroup ? match[1] : match[0];
        const offset = hasCaptureGroup ? match[0].indexOf(match[1]) : 0;
        let start = match.index + offset;

        // BANK_CARD post-filter v2（spy 6 docx audit — 三餐四季 [11088-11107] "4306241990006060034" 19位畸形ID FP）：
        //   BANK_CARD v3 `\d{3,6}` 让 19 位数字串被识别为银行卡，但其中一部分是畸形 ID_CARD 格式
        //   （原文档 typo 多了 1 位，ID_CARD regex 因月份不合法匹配失败，导致 BANK_CARD 抢匹配）
        //   修法：前 10 位匹配 ID_CARD region+year 前缀 → 排除（容忍 typo 位置）
        //     - 4306241990006060034 (19 chars, region 430624 + year 1990) → 排除 ✅
        //     - 1001182619000025616 (19 chars, year 2619 前缀 26 不匹配 18|19|20) → 保留 ✅
        //     - 0413090103000048204 (19 chars, 首字符 0 不匹配 [1-9]) → 保留 ✅
        //     - 44057601040010545 (17 chars, year 6010 前缀 60 不匹配) → 保留 ✅
        //   阈值 17：ID_CARD 至少 17 位 prefix 才检查
        // v3 修复（spy 6 docx audit — 三餐四季 [12802-12818] "4502019970621042X" 17字typo身份证）：
        //   原 16 位纯卡（如 "1234567812345678"）会被 BANK_CARD 识别，但若后接 X（ID 校验码）或
        //   数字（更长 ID 段），实际是 17+ 位身份证 typo，不是银行卡
        //   修法：value.length === 16 时检查下一字符
        //     - 16 位 + X → "4502019970621042X" → 拒 ✅ (三餐四季 FP 修复)
        //     - 16 位 + 数字 → "450201997062104212345678" 前 16 位是 ID 段 → 拒
        //       （实际 BANK_CARD regex 会贪婪匹配到 19 位 "4502019970621042123"，但前 16 位是 ID 段，
        //        后接数字说明是 ID 片段延伸，应整体拒 — 现有 v2 ≥17 位检查一并处理）
        //     - 16 位 + 中文 "元" → 真卡号 → 保留 ✅
        //     - 16 位 + 换行/空格 → 真卡号 → 保留 ✅
        if (rule.type === 'BANK_CARD') {
          if (value.length >= 17 && /^[1-9]\d{5}(?:18|19|20)\d{2}/.test(value)) continue;
          if (value.length === 16) {
            const nextChar = text[start + value.length];
            if (nextChar && /[\dXx]/.test(nextChar)) continue;
          }
        }

        // COMPANY 排除词 + body 合法性检查（regex 负向后顾 + post-filter 兜底）
        //   - regex 已在 BuiltinRules.ts v2 加 (?<![这那每...]) + (?<!委托)(?<!代理)(?<!代表) lookbehind
        //   - 这里兜底：body 起始位置的合同模板前缀（甲方为/委托/代理等）切断；
        //     body 内部不动（避免误切断品牌名如"华为"中的"为"）
        //   - 切断时同步更新 start/end 保持 SensitiveMatch invariant:
        //     text.slice(m.start, m.start + m.value.length) === m.value
        if (rule.type === 'COMPANY') {
          if (value.includes('关联公司')) continue;
          if (/^(?:甲方|乙方)公司$/.test(value)) continue;

          // 提取 body（去掉 form 后缀）—— form 必须是 capture group，否则 formMatch[2] undefined
//   alternation 顺序：JS first-match wins，"有限公司"/"分公司"/"公司"/"集团" 必须排在
//   "集团有限公司" 等 5 字 form 之前，让 non-greedy .+? 能正确停在 "有限公司" 处
const formMatch = value.match(/^(.+?)(有限公司|分公司|公司|集团|集团有限公司|股份有限公司|科技有限公司|投资有限公司|实业有限公司|商贸有限公司)$/);
if (!formMatch) continue;
          const body = formMatch[1];
          const form = formMatch[2];

          // prefix-only 切断合同模板前缀（甲方为/委托/代理/代表/合作/经 等）：
          //   - "甲方为北京SAMPLE-CO-Z" → 切"甲方为" → "北京SAMPLE-CO-Z" ✅
          //   - "委托北京SAMPLE-CO-E公司代理SAMPLE-CO-F..." → 切"委托" → "北京SAMPLE-CO-E公司代理SAMPLE-CO-F..." (mid-verb reject 兜底)
          //   - "经维沃移动通信有限公司" → 切"经" → "维沃移动通信有限公司" ✅ (zcool docx [102-113] FP 修复)
          //   - "华为投资控股" → 不切 → "华为投资控股" ✅ ("华为"是品牌特例)
          //   - "设计师及其所属" → 不切（"及其"不在 prefix 列表）→ "设计师及其所属" hanChars < 3 → 拒
          // v4 修复（spy 6 docx audit - 案例 E3/E4 真简称回归）：
          //   - "甲方为腾讯集团" 切 "甲方为" 后剩 "腾讯" 2 hanChars
          //     旧逻辑：<3 break → 整段拒（丢真简称） ❌
          //     v4：放宽切，让 cuttablePrefix 命中已知模板词时即使剩余 <3 也切
          //     → emit "腾讯集团" 4 chars（带 集团 form）✅
          // 切完后还允许再切一轮（处理 "委托...代理..." 连续 verb 前缀）：
          let safeStart = 0;
          // v4 cuttablePrefix 扩展 "方为?"（spy 6 docx audit - E3 "合作方为阿里巴巴集团"）：
          //   - "方为" 是合同 coverb 短语（"X方为..." = "X party as..."）
          //   - 加进可切列表后 "合作方为" 连续切 2 次（先 "合作" 后 "方为"）→ "阿里巴巴"
          //   - 单字 "方" 不切（"方正集团" 这种真简称保留）
          const cuttablePrefix = /^(?:甲方为?|乙方为?|丙方为?|丁方为?|戊方为?|己方为?|庚方为?|辛方为?|壬方为?|癸方为?|方为?|经|委托|代理|代表|合作|承办|服务|负责)/;
          while (safeStart < body.length) {
            const m = body.slice(safeStart).match(cuttablePrefix);
            if (!m) break;
            const cutLength = m[0].length;
            // v4 放宽切断：cuttablePrefix 命中的是已知合同模板词，直接切不论剩余长度
            // （剩余长度兜底在外层 hanChars < 3 检查）
            // 切断后允许跳过 1-4 个字符（公司名/标点）再切下一轮 verb 前缀
            // 例 "委托" + "北京SAMPLE-CO-E" + "代理" → safeStart 累加到 "代理" 后
            const skipRegion = body.slice(safeStart + cutLength, safeStart + cutLength + 4);
            safeStart += cutLength;
            // 检查 skipRegion 后面是否紧跟 verb 前缀
            if (skipRegion.length > 0) {
              const nextM = body.slice(safeStart).match(cuttablePrefix);
              if (nextM) continue;  // 继续切
            }
            break;
          }

          // 检查 safeBody 至少 3 字汉字
          // v4 例外（spy 6 docx audit - 三餐四季 [27-39] "甲方为腾讯集团" 等真简称保留）：
          //   - 若已被 cuttablePrefix 切（即 safeStart > 0），剩余 body 可放宽到 ≥1 han char
          //     例 "甲方为腾讯集团" 切 "甲方为" 后剩 "腾讯" 2 char，应接受（再发 "腾讯集团"）
          //   - 不安全：纯短 body（如 "华为公司" 2 hanChars body）仍会 hanChars<3 + safeStart=0 拒
          const safeBody = body.slice(safeStart);
          const hanChars = safeBody.match(/[\u4e00-\u9fa5]/g) || [];
          if (hanChars.length < 1) continue;  // safety net
          if (hanChars.length < 3 && safeStart === 0) continue;

          // 二次检查：safeBody 内部仍含连词/介词/代词 → 拒
          //   - 处理 case 3 "设计师及其所属"（"及其"是连词+代词链）
          //   - 处理 case 14 "甲乙双方的律师和顾问"（"和"是连词，"的"是助词）
          //   - 处理 case 20 "设计师所属公司"（zcool docx [2426-2433] FP；"属"是代词+连词链）
          //   - 注意：去掉了 "为""的""了""的"等可能在真公司名中出现的字符
          //     （如 "华为" 的 "为"、"美的集团" 的 "的"），避免误杀
          if (/[与和及其了在出于而之则这那每该各自己诸何属]/.test(safeBody)) continue;

          // 三次检查（顺位延续）：副词前缀拒（v3 spy 6 docx audit — 三餐四季 [14085-14091] FP 修复）
          //   - "同时配合集团" / "也同样隶属于集团" / "但还需配合集团" 等叙述短语被 alt B 误识
          //   - 单字副词（时/同/也/又/还/但/或/仍/即）常出现在真公司名（如"时代集团"/"同方集团"/"如新集团"）
          //     → 必须 2+ 字符副词链匹配才拒绝，避免误杀"X时集团"/"Y同集团"等真简称
          //   - 列出的 2-3 字符副词链（覆盖 spy 测试用例 + 常见中文叙述副词链）
          //     同时 / 但还 / 但是 / 但又 / 但仍 / 但须 / 但必 / 但需 / 但得
          //     也同 / 也得 / 也须 / 也必 / 也需 / 也仍 / 也是
          //     仍旧 / 仍然 / 仍须 / 仍必 / 仍需 / 仍得
          //     还是 / 仍是 / 即便 / 即是
          //     或是 / 同样 / 又同 / 又还 / 又须 / 又得
          //     还需 / 还能
          //   - 注意：保留单字 "时/同/也/又" 在合法公司名里的可能性
          if (/^(?:同时|但还|但是|但又|但仍|但须|但必|但需|但得|也同|也得|也须|也必|也需|也仍|也是|仍旧|仍然|仍须|仍必|仍需|仍得|还是|仍是|即便|即是|或是|同样|又同|又还|又须|又得|还需|还能)/.test(safeBody)) continue;

          // 三次检查：mid-verb 防御（zcool docx [116-144] FP 修复）
          //   - "X公司委托Y公司" / "X公司代理Y公司" / "X公司代表Y公司"
          //     regex greedy 把两家公司合成一个超长 body+form → 28 chars 错配
          //   - 保守策略：safeBody 含 "委托"/"代理"/"代表" 且长度 > 18 → 拒绝整个匹配
          //     用户可手动高亮两家公司
          //   - 阈值 18：单合法公司 body 通常 < 18 char（"SAMPLE-CO-F（北京）融媒体科技文化有限" = 14 char）
          //     例外测试 case 22 "智能代理有限公司" body 6 < 18，应保留
          // 三次检查：mid-verb SPLIT 防御（zcool docx [116-144] FP 修复）
          //   - "X公司委托Y公司" / "X公司代理Y公司" / "X公司代表Y公司"
          //     regex greedy 把两家公司合成一个超长 body+form → 错配
          //   - **用户反馈：自动拆开**（不要退回 manual），分别 emit 两家
          //   - 队列递归：每段含 verb → 沿 verb 切；左边有 form → emit；右边进队列继续
          //   - 阈值 18：body > 18 才进 SPLIT（避免短字符串误切）
          //   - fallback：split 全失败 → 退到普通 hanChars / reject / emit 原 merge match
          if (/(委托|代理|代表)/.test(safeBody) && safeBody.length > 18) {
            const emitted = splitAndEmitBody(safeBody, form, start + safeStart, text, rule, matches);
            if (emitted > 0) continue;
          }

          // 如果 body 被缩短，重新计算 value / start，保持 invariant
          if (safeStart > 0) {
            const newValue = safeBody + form;
            const newStart = start + safeStart;
            const newEnd = newStart + newValue.length;
            // invariant check: text.slice(newStart, newEnd) === newValue
            if (text.slice(newStart, newEnd) !== newValue) {
              console.warn(`[SensitiveFinder COMPANY] invariant break: "${text.slice(newStart, newEnd)}" !== "${newValue}"`);
              continue;
            }
            value = newValue;
            start = newStart;
          }
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
 * mid-verb SPLIT 助手（"X公司委托Y公司" → emit 两家）
 *
 * 设计：队列递归处理（处理"委托X代理Y"多重 verb 链）
 *   - 入参 safeBody 含 verb 链（"委托" + "代理" + "代表" 任意组合）
 *   - 每段 chunk：
 *     - 找到 verb → 沿 verb 切；左有 form emit；右进队列
 *     - 无 verb → 当作最后一段，用原 form emit
 *   - 验证策略：
 *     - leftStr：必须以 form 结尾 + 去掉 form 后 ≥3 han chars + 无 reject chars
 *     - rightBody：≥3 han chars + 无 reject chars + 加原 form 拼成完整公司名
 *     - invariant 检查：text.slice(start, end) === value（防越界）
 *
 * Returns: emit 成功的 match 数（0 → 调用者 fallthrough 到普通 reject/emit 逻辑）
 *
 * @param safeBody prefix-cut 后的 body（含动词链）
 * @param form 原 regex 匹配的 form（"有限公司" 等）— 用于 fallback 拼接
 * @param leftStartInText safeBody 在 text 中的起始绝对位置
 * @param text 完整文本
 * @param rule 当前 rule（用于 weight / type）
 * @param matches 已累积的 matches 数组（直接 push 新 match）
 */
function splitAndEmitBody(
  safeBody: string,
  form: string,
  leftStartInText: number,
  text: string,
  rule: Rule,
  matches: SensitiveMatch[],
): number {
  const FORM_RE = /(集团有限公司|股份有限公司|科技有限公司|投资有限公司|实业有限公司|商贸有限公司|有限公司|分公司|公司|集团)$/;
  const VERB_RE = /(委托|代理|代表)/;
  const REJECT_CHARS = /[与和及其了在出于而之则这那每该各自己诸何属]/;

  let emitted = 0;
  // 队列：每项是一个待处理的 body 片段 + 在 text 中相对 leftStartInText 的偏移
  const queue: { body: string; offset: number }[] = [{ body: safeBody, offset: 0 }];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const verbMatch = cur.body.match(VERB_RE);

    if (!verbMatch) {
      // 无 verb → 当作最终段落。用原 form 拼接 + 验证 + emit
      const rightValue = cur.body + form;
      const rightHan = cur.body.match(/[\u4e00-\u9fa5]/g) || [];
      if (rightHan.length >= 3 && !REJECT_CHARS.test(cur.body)) {
        const rs = leftStartInText + cur.offset;
        const re = rs + rightValue.length;
        if (text.slice(rs, re) === rightValue) {
          matches.push({
            id: generateUUID(),
            type: rule.type,
            value: rightValue,
            start: rs,
            end: re,
            confidence: rule.weight,
            context: extractContext(text, rs, 30),
            blockId: undefined
          });
          emitted++;
        }
      }
      continue;
    }

    const verbPos = verbMatch.index!;
    const verbLen = verbMatch[0].length;
    const leftStr = cur.body.slice(0, verbPos);
    const rightBody = cur.body.slice(verbPos + verbLen);

    // LEFT：必须以 form 结尾（否则不是独立公司） + 验证 body 合法
    if (leftStr.length >= 3) {
      const leftFormMatch = leftStr.match(FORM_RE);
      if (leftFormMatch) {
        const leftBody = leftStr.slice(0, leftStr.length - leftFormMatch[1].length);
        const leftHan = leftBody.match(/[\u4e00-\u9fa5]/g) || [];
        if (leftHan.length >= 3 && !REJECT_CHARS.test(leftBody)) {
          const ls = leftStartInText + cur.offset;
          const le = ls + leftStr.length;
          if (text.slice(ls, le) === leftStr) {
            matches.push({
              id: generateUUID(),
              type: rule.type,
              value: leftStr,
              start: ls,
              end: le,
              confidence: rule.weight,
              context: extractContext(text, ls, 30),
              blockId: undefined
            });
            emitted++;
          }
        }
      }
    }

    // RIGHT：进队列递归处理（可能含更多 verb）
    if (rightBody.length >= 3) {
      queue.push({
        body: rightBody,
        offset: cur.offset + verbPos + verbLen
      });
    }
  }

  return emitted;
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
