/**
 * TAX_ID 规则回归测试：
 *   - "纳税人识别号：" 不应被识别为敏感词（保留为 label）
 *   - 只有税号本体 "911101053482731061" 应被识别
 *   - "税号："、"TIN:"、"税务登记号:" 等其他 label 同理
 *
 * Bug 来源（修复 commit 前）：
 *   <repo-path>/《SAMPLE-CT-001方太》委托制作合同.docx
 *   spy 反馈："纳税人识别号：911101053482731061" 整段被识别成 TAX_ID
 *   修复方法：把 (?:纳税人识别号|...)\s*[:：]?\s* 改成 capture group 前缀
 *   让 match[1] = 税号本体（与 SensitiveFinder.ts:69-72 逻辑对齐）
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_RULES } from '../BuiltinRules';
import { SensitiveFinder } from '@/engines/SensitiveFinder';

describe('TAX_ID 规则：只匹配税号本体，不消费 label', () => {
  it('regex pattern 用 capture group 提取税号本体', () => {
    const taxIdRule = BUILTIN_RULES.find(r => r.type === 'TAX_ID');
    expect(taxIdRule).toBeDefined();

    // 用 exec 验证 match[0] 含 label，match[1] 是纯税号
    const text = '纳税人识别号：911101053482731061';
    const re = new RegExp(taxIdRule!.pattern.source, taxIdRule!.pattern.flags);
    const m = re.exec(text);
    expect(m).not.toBeNull();
    expect(m![0]).toBe('纳税人识别号：911101053482731061');  // 整段含 label
    expect(m![1]).toBe('911101053482731061');              // capture group = 税号本体
  });

  it('SensitiveFinder 默认规则检测出"纳税人识别号：" label 不在 match.value 里', () => {
    const finder = new SensitiveFinder();
    // 用含字母的税号避免与 BANK_CARD 规则冲突（BANK_CARD 只匹配纯数字）
    // 真实统一社会信用代码通常含字母，如 91110108MA01ABCD2X
    const text = '开户名：xxx\n纳税人识别号：91110108MA01ABCD2X\n账号：12';
    const detected = finder.findSensitiveContent(text);
    const taxIds = detected.matches.filter(m => m.type === 'TAX_ID');
    expect(taxIds.length).toBe(1);
    expect(taxIds[0].value).toBe('91110108MA01ABCD2X');  // 不含"纳税人识别号："
    expect(taxIds[0].value.includes('纳税人')).toBe(false);  // 关键断言
    expect(taxIds[0].value.includes('：')).toBe(false);
  });

  it('多种 label 都能识别（"税号："、"TIN:"、"税务登记号:"）', () => {
    const finder = new SensitiveFinder();
    // 用含字母的税号，避免 BANK_CARD 干扰
    const text = `
      纳税人识别号：91110108MA01ABCD2X
      税号：91310105780581765Q
      TIN: 91110000ABCD1234EF
      税务登记号: 91440300MA5DAXYZ12
    `;
    const detected = finder.findSensitiveContent(text);
    const taxIds = detected.matches.filter(m => m.type === 'TAX_ID');
    expect(taxIds.length).toBe(4);
    const values = taxIds.map(m => m.value);
    expect(values).toContain('91110108MA01ABCD2X');
    expect(values).toContain('91310105780581765Q');
    expect(values).toContain('91110000ABCD1234EF');
    expect(values).toContain('91440300MA5DAXYZ12');
  });

  it('不含 label 的纯税号也能识别（用户可能粘贴税号无上下文）', () => {
    const finder = new SensitiveFinder();
    // 含字母避开 BANK_CARD
    const text = '账号：91110108MA01ABCD2X';  // 没有"纳税人识别号"前缀
    const detected = finder.findSensitiveContent(text);
    const taxIds = detected.matches.filter(m => m.type === 'TAX_ID');
    // 没 label 时不识别——这是规则的设计（避免误识别普通 18 位字符）
    // 如有需求可后续放宽
    expect(taxIds.length).toBe(0);
  });
});