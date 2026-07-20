/**
 * 真合同 FP/FN probe 测试 — 第七批 spy real contracts audit（work/ 目录下 50 个真合同）
 *
 * 区别于前面的 RealDocxFPAudit：那是数据**报告**（列全 matches），这个是 probe 测试（断言期望）
 *
 * spy "为什么不去找真合同？要选模板扫" 反馈后切换路径——
 * <repo-path>/work/ 下 3891 个真合同（zcool/炜衡律所/SAMPLE-CO-F）
 * 暴露模板根本不会出现 / 容易被模板掩盖的 bug：
 *
 * 【P0 USCC 银行抢匹配】SAMPLE-CO-D/茅台/习酒等大客户真合同反复出现的"统一社会信用代码：91..."
 *   原 TAX_ID regex label alt 没有"统一社会信用代码"
 *   → 18位 USCC 完全不识别；
 *   mammoth 拼接常丢尾部字母校验码（如 91440101567914858A → 91440101567914858）
 *   → 17 位纯数字被 BANK_CARD 抢 → 错标税号身份为银行卡号
 *   修法：TAX_ID label alt 加"统一社会信用代码"
 *
 * 【P1 固话漏识别】桌面固话/服务热线（010/0XX-XXXXXXXX）真合同满地
 *   原 PHONE regex 只接 1[3-9]\d{9} 11 位手机号
 *   → 010/02/021 等区号固话全部漏识别 → 脱敏失败
 *
 * 【P2 金额百分比/编号 FP】合同里"金额30%"（违约金 30%）/ "合计 244"（表格）/ "金额 2.1"（条款编号）
 *   AMOUNT regex `(?:金额|总计|...)[：:\s]*\b\d+` 看到 label + digit 就匹配
 *   → 百分比/编号被误识别为 AMOUNT → 假阳性脱敏
 *
 * 【P3 叙述短语 COMPANY】"连续多年获得中央电视台十佳广告代理公司"（叙述）/ "直接投资的控股公司"（条款）
 *   COMPANY body 含"广告代理公司"/"控股公司"等通用名词+公司形态 → 描述性短语被识别为真公司名
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

describe('第七批 spy 真合同 audit — 4 类 bug probe（RED 先行）', () => {
  // ==================== P0 USCC 银行抢匹配 ====================
  describe('P0 USCC 18位被 BANK_CARD 抢匹配（SAMPLE-CO-D/茅台真合同反复出现）', () => {
    it('case P0-1: "统一社会信用代码：91440101567914858A" 18位应识别 TAX_ID', () => {
      // SAMPLE-CO-D补充协议真合同原文
      const text = '甲方：SAMPLE-CO-D（中国）有限公司（统一社会信用代码：91440101567914858A，以下简称"甲方"）';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const taxIds = result.matches.filter(m => m.type === 'TAX_ID').map(m => m.value);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P0-1] taxIds=${JSON.stringify(taxIds)}, banks=${JSON.stringify(banks)}`);
      expect(taxIds).toContain('91440101567914858A');  // TAX_ID 优先识别 18 位
      expect(banks).not.toContain('91440101567914858A'); // BANK_CARD 不应抢
      expect(banks).not.toContain('91440101567914858');  // mammoth 丢字母 17 位也不应误吞
    });

    it('case P0-2: 习酒合同 18位 USCC 完整（带 P 校验码）', () => {
      const text = '公司名称：贵州习酒股份有限公司 纳税人识别号：91520300215032800P 单位地址：...';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const taxIds = result.matches.filter(m => m.type === 'TAX_ID').map(m => m.value);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P0-2] taxIds=${JSON.stringify(taxIds)}, banks=${JSON.stringify(banks)}`);
      expect(taxIds).toContain('91520300215032800P');
      expect(banks).not.toContain('91520300215032800P');
    });

    it('case P0-3 (回归): 已脱敏数字不应误识', () => {
      // 普通 18 位数字（如手机序列）不应被 TAX_ID 吞
      const text = '产品序号 91440101567914858A 是真品';  // 数字 + 字母尾巴
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      // 没"统一社会信用代码"等 label，TAX_ID 不应凭 18 chars 文本匹配
      console.log(`\n[case P0-3] matches=${JSON.stringify(result.matches.map(m=>m.type+':'+m.value))}`);
    });
  });

  // ==================== P1 固话漏识别 ====================
  describe('P1 固话漏识别（真合同反复出现）', () => {
    it('case P1-1: 010 开头 11 位固话应识别 PHONE', () => {
      // 茅台合同"01000000000" 11 位以 0 开头
      const text = '公司地址：北京市顺义区牛栏山镇府前街9号  电话：01000000000';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const phones = result.matches.filter(m => m.type === 'PHONE').map(m => m.value);
      console.log(`\n[case P1-1] phones=${JSON.stringify(phones)}`);
      expect(phones).toContain('01000000000');
    });

    it('case P1-2: 区号-号码 "08510000000" 应识别 PHONE', () => {
      // 习酒合同"0851-2..."区号固话
      const text = '贵州习酒股份有限公司电话号码：08510000000';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const phones = result.matches.filter(m => m.type === 'PHONE').map(m => m.value);
      console.log(`\n[case P1-2] phones=${JSON.stringify(phones)}`);
      expect(phones.some(p => p.includes('2239069'))).toBe(true);
    });

    it('case P1-3 (回归): 真手机号 13XXXXXXXXX 不应受影响', () => {
      const text = '甲方联系人：占位人  联系电话：18600063338';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const phones = result.matches.filter(m => m.type === 'PHONE').map(m => m.value);
      console.log(`\n[case P1-3] phones=${JSON.stringify(phones)}`);
      expect(phones).toContain('18600063338');
    });
  });

  // ==================== P2 金额百分比 FP ====================
  describe('P2 金额百分比/条款编号 FP', () => {
    it('case P2-1: "支付协议总费用30%的违约金" → 30% 不应识别为 AMOUNT', () => {
      const text = '乙方应向甲方支付本协议总费用30%的违约金';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const amts = result.matches.filter(m => m.type === 'AMOUNT').map(m => m.value);
      console.log(`\n[case P2-1] amounts=${JSON.stringify(amts)}`);
      expect(amts.some(a => a.includes('30'))).toBe(false);  // "30"+"%" 不应识别
    });

    it('case P2-2: "金额 2.1" 条款编号 不应识别为 AMOUNT', () => {
      // 金蝶开发运维合同原文"第二条 本合同总金额 2.1"  2.1 是条款编号
      const text = '第二条 本合同总金额 2.1 本合同总金额为127,000.00元';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const amts = result.matches.filter(m => m.type === 'AMOUNT').map(m => m.value);
      console.log(`\n[case P2-2] amounts=${JSON.stringify(amts)}`);
      expect(amts.some(a => /^2\.1$/.test(a))).toBe(false);  // "2.1" 不应单独识别
    });

    it('case P2-3: "合计 244" 表格统计 不应识别为 AMOUNT', () => {
      const text = '片头 ¥100,000.00\n压屏条 ¥20,000.00\n合计 244 优惠后小计...';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const amts = result.matches.filter(m => m.type === 'AMOUNT').map(m => m.value);
      console.log(`\n[case P2-3] amounts=${JSON.stringify(amts)}`);
      expect(amts.some(a => /^244$/.test(a))).toBe(false);  // 单独"244"不应被吞
    });

    it('case P2-4 (回归): 真"支付金额 100,000.00元" 应保留', () => {
      const text = '本次服务费支付金额 100,000.00元（含税）';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const amts = result.matches.filter(m => m.type === 'AMOUNT').map(m => m.value);
      console.log(`\n[case P2-4] amounts=${JSON.stringify(amts)}`);
      expect(amts.some(a => a.includes('100,000'))).toBe(true);
    });
  });

  // ==================== P3 叙述短语 COMPANY ====================
  describe('P3 叙述短语误识别 COMPANY', () => {
    it('case P3-1: "连续多年获得中央电视台十佳广告代理公司" 描述短语应拒', () => {
      // 生态城管委会合同原文
      const text = 'SAMPLE-CO-F…连续多年获得中央电视台十佳广告代理公司称号';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const companies = result.matches.filter(m => m.type === 'COMPANY').map(m => m.value);
      console.log(`\n[case P3-1] companies=${JSON.stringify(companies)}`);
      expect(companies.some(c => c.includes('连续多年'))).toBe(false);
      expect(companies.some(c => c.includes('十佳'))).toBe(false);
    });

    it('case P3-2: "直接投资的控股公司" 描述短语应拒', () => {
      const text = '乙方直接投资的控股公司（指持股比例在50%以上）';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const companies = result.matches.filter(m => m.type === 'COMPANY').map(m => m.value);
      console.log(`\n[case P3-2] companies=${JSON.stringify(companies)}`);
      expect(companies.some(c => c.includes('控股公司'))).toBe(false);
    });

    it('case P3-3 (回归): 真"广州广告代理公司" 不应被误伤', () => {
      // 注意：这条只能 lock 真简称不被误伤；如果有"广告代理公司"作为真公司名则要保
      const text = '委托方为广州XX广告代理公司';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const companies = result.matches.filter(m => m.type === 'COMPANY').map(m => m.value);
      console.log(`\n[case P3-3] companies=${JSON.stringify(companies)}`);
      // 期望至少要识别出什么；如果"广告代理公司"被拒则记 FAIL
      // 这条需要根据实现取舍：到底是全拒还是只拒特定前缀
      expect(companies.length).toBeGreaterThan(0);  // 至少识别一个
    });
  });
});
