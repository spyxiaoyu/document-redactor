/**
 * AMOUNT_UPPER regex 结构性 bug — 第六批 audit 全目录扫描暴露
 *
 * bug: regex `[class]+(?:[万亿][class]*)*】?元` backtrack 时允许只匹配 `万元` 2 chars（跳过前导中文数字）：
 *   - "十万元以下" → match "万元" 2 chars（真值是"十万元以下"，金额描述）
 *   - "一百万元起" → match "万元" 2 chars
 *   - "十万元以下的罚款" → match "万元" 2 chars
 *   - 根因: regex 从 pos 0 try `[class]+=十` 再 try 走 `(?:[万亿][class]*)*` to match `万`+`元`（共 3 chars 总匹配）
 *     但 `十` 不在 `[万亿]` 类，outer `*` 0 iter，`元` 需在 pos 1 (万) — 失败
 *     → engine 跳到 pos 1 (`万`)，match `万元` 2 chars（false short match）
 *
 * 真业务: 这些都是 「金额描述短语」"十万元以下" "一百万元" 不是真实可执行金额，应整体拒
 *
 * §11 测试先行铁律: 先 red 写 probe，复现 bug
 */
import { describe, it, expect } from 'vitest';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { BUILTIN_RULES } from '@/rules/BuiltinRules';

function buildFinder(): SensitiveFinder {
  const finder = new SensitiveFinder();
  BUILTIN_RULES.forEach(r => finder.addRule({
    id: r.type,
    type: r.type,
    pattern: r.pattern,
    weight: r.weight,
    enabled: true,
  }));
  return finder;
}

function findAmtUpper(text: string): string[] {
  const finder = buildFinder();
  return finder.findSensitiveContent(text).matches
    .filter(m => m.type === 'AMOUNT_UPPER')
    .map(m => m.value);
}

describe('AMOUNT_UPPER regex 结构性 bug — "万元"/"百万元"/"千万元" 单独 match 应拒', () => {
  it('case F1: "十万元以下" → 不应匹配 "万元" 2 chars', () => {
    // 完整 "十万元以下" 是金额描述短语，含千字面描述（"十"是数字"10"）
    // 真执行金额要求至少 2-3 字金额主体 — "万元" alone 是单位不是金额
    const matches = findAmtUpper('由市场监督管理部门责令改正，对广告发布者处十万元以下的罚款');
    console.log(`\n[case F1] 输入含 "十万元以下" → AMT_UPPER matches: ${JSON.stringify(matches)}`);
    expect(matches.some(m => m === '万元')).toBe(false);
  });

  it('case F2: "一百万元起" → 不应匹配 "万元" 2 chars', () => {
    const matches = findAmtUpper('最高不超过一百万元起');
    console.log(`\n[case F2] 输入含 "一百万元起" → AMT_UPPER matches: ${JSON.stringify(matches)}`);
    expect(matches.some(m => m === '万元')).toBe(false);
  });

  it('case F3: "百万元" → 不应匹配 "万元" 2 chars', () => {
    const matches = findAmtUpper('合同总价款为人民币百万元整');
    console.log(`\n[case F3] 输入含 "百万元" → AMT_UPPER matches: ${JSON.stringify(matches)}`);
    expect(matches.some(m => m === '万元')).toBe(false);
  });

  it('case F4 (回归): 真 "壹拾伍万元整" 完整匹配应保留', () => {
    const matches = findAmtUpper('合同总价款为人民币壹拾伍万元整');
    console.log(`\n[case F4] 输入 "壹拾伍万元整" → AMT_UPPER matches: ${JSON.stringify(matches)}`);
    expect(matches.some(m => m.includes('壹拾伍万元'))).toBe(true);
  });

  it('case F5: "65.2万" Arabic 数字前缀 → 应保留', () => {
    // 已有 C1 case 验证
    const matches = findAmtUpper('预算为人民币65.2万元');
    console.log(`\n[case F5] 输入 "65.2万元" → AMT_UPPER matches: ${JSON.stringify(matches)}`);
    expect(matches.some(m => m.includes('65.2万'))).toBe(true);
  });
});
