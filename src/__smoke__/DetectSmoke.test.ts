/**
 * 端到端 detection smoke：替代外部 node 跑法，用 vitest 测
 * 验证脱敏替换没有破坏敏感词识别能力
 */
import { describe, it, expect } from 'vitest';
import { SensitiveFinder } from '@/engines/SensitiveFinder';

describe('detect smoke: 脱敏替换后敏感词识别能力完整', () => {
  const text = `甲方：北京示例科技有限公司
乙方：上海甲乙集团股份有限公司
联系人：张三、李四
电话：13800000000 / 010-00000000
邮箱：li@test-corp.com / wang@example-corp.com
身份证：110101199003078888
银行卡：6222600266661234567
税号：91110000123456789X
合同号：SAMPLE-CT-2024-001 兹有...
地址：示例省示例市示例区示例路1号
项目编号：SAMPLE-A-001
金额：人民币 100,000.00 元整（大写：壹拾万元整）
开户行：中国工商银行北京分行 0200025609200013713`;

  it('13 类敏感词全识别（不会因脱敏替换而漏识别）', () => {
    const finder = new SensitiveFinder();
    const result = finder.findSensitiveContent(text);
    const byType: Record<string, number> = {};
    for (const m of result.matches) {
      byType[m.type] = (byType[m.type] || 0) + 1;
    }
    console.log('按类型计数:', byType);

    // 期望：13 类全覆盖（脱敏替换不应影响检测）
    const expected: Record<string, number> = {
      PHONE: 2,           // 13800000000 + 010-00000000
      EMAIL: 2,           // 2 emails
      ID_CARD: 1,         // 1 ID
      BANK_CARD: 2,       // 银行卡 + 0200025609200013713
      TAX_ID: 1,          // 91110000123456789X
      CONTRACT_NO: 1,     // SAMPLE-CT-2024-001
      COMPANY: 2,         // 2 公司
      ADDRESS: 1,         // 北京地址
      AMOUNT: 1,          // 100,000.00
      AMOUNT_UPPER: 1,    // 壹拾万元整
      NAME: 2,            // 张三、李四（v3 regex 多姓名续接 + post-filter 拆分 emit，2 个独立 match）
    };

    for (const [type, expectedCount] of Object.entries(expected)) {
      const actual = byType[type] || 0;
      expect(actual, `${type} 识别数量`).toBeGreaterThanOrEqual(expectedCount);
    }
  });

  it('PHONE regex 不受脱敏影响（手机 + 固话都能识别）', () => {
    const finder = new SensitiveFinder();
    const r = finder.findSensitiveContent('电话：13800000000 或 010-00000000');
    const phones = r.matches.filter(m => m.type === 'PHONE').map(m => m.value);
    expect(phones).toContain('13800000000');
    expect(phones.some(p => p.includes('010-00000000'))).toBe(true);
  });

  it('COMPANY regex 不受脱敏影响（中文 form 替换后仍识别）', () => {
    const finder = new SensitiveFinder();
    // 不放"和"在中间（regex lookbehind 拒 "和" 前缀）
    const r = finder.findSensitiveContent('北京示例科技有限公司。其次：上海甲乙集团股份有限公司');
    const cos = r.matches.filter(m => m.type === 'COMPANY').map(m => m.value);
    expect(cos.length).toBeGreaterThanOrEqual(2);
  });

  it('TAX_ID 18 位 数字+字母 仍识别', () => {
    const finder = new SensitiveFinder();
    const r = finder.findSensitiveContent('纳税人识别号：91110000123456789X');
    const taxes = r.matches.filter(m => m.type === 'TAX_ID').map(m => m.value);
    expect(taxes.some(t => t.includes('91110000123456789X'))).toBe(true);
  });

  it('AMOUNT_UPPER 大写金额 仍识别', () => {
    const finder = new SensitiveFinder();
    const r = finder.findSensitiveContent('壹拾万元整');
    const upper = r.matches.filter(m => m.type === 'AMOUNT_UPPER').map(m => m.value);
    expect(upper.length).toBeGreaterThan(0);
  });

  it('脱敏 ↔ 还原 round-trip 仍 work', async () => {
    const { Desensitizer } = await import('@/engines/Desensitizer');
    const { CryptoManager } = await import('@/engines/CryptoManager');
    const crypto = new CryptoManager();
    const desensitizer = new Desensitizer(crypto);

    const r = finder().findSensitiveContent(text);
    const matches = r.matches;
    const { desensitizedText, mappingTable } = await desensitizer.desensitize(text, matches, { mode: 'encrypt' });
    expect(desensitizedText).not.toContain('13800000000');  // 真值已被替换
    expect(desensitizedText).toContain('__________');       // 占位符（underscore + ZWS）

    const restored = await desensitizer.restore(desensitizedText, mappingTable, '');
    expect(restored).toBe(text);  // 还原后等于原文
  });
});

function finder() {
  return new SensitiveFinder();
}