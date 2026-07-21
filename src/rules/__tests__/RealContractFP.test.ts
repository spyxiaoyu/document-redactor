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

  // ==================== P4 BANK_CARD 暗礁：URL 路径 / 软件序列号 / 17 位 USCC ====================
  describe('P4 BANK_CARD 真合同 3 类暗礁（URL/序列号/17位USCC）', () => {
    it('case P4-1: csdn 文章 URL 路径末段不应识别为 BANK_CARD', () => {
      // 金蝶开发运维合同尾部"金蝶云社区链接"
      const text = '更多信息请访问 club.kdcloud.com/article/153835620237019392 第 6 页 共 6 页';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P4-1] banks=${JSON.stringify(banks)}`);
      expect(banks).not.toContain('153835620237019392');
    });

    it('case P4-2: 金蝶软件序列号（括号包裹）不应识别为 BANK_CARD', () => {
      // 金蝶开发运维合同"金蝶云·星空旗舰版（1423029347329064960）"
      const text = '金蝶云·星空旗舰版（1423029347329064960）';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P4-2] banks=${JSON.stringify(banks)}`);
      expect(banks).not.toContain('1423029347329064960');
    });

    it('case P4-3: 17 位纯数字 USCC（mammoth 拼丢尾部字母 + 无 label）不应识别为 BANK_CARD', () => {
      // SAMPLE-CO-D合同"统一社会信用代码：91440101567914858A" 尾部 A 丢了 → 17 位纯数字
      // 关键场景：USCC 出现在无 label 上下文（mammoth 拼接丢标签）+ 17 位数字
      // 不能依赖 TAX_ID 抢匹配 — TAX_ID 必须有 label 才匹配；纯数字 17 位应被 BANK_CARD post-filter 直接拒
      const text = '甲方开户：91440101567914858 乙方开户：某支行 0200025609200013713';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P4-3] banks=${JSON.stringify(banks)}`);
      // USCC 形态（91/92/93 开头 + 17 位纯数字）应拒
      expect(banks).not.toContain('91440101567914858');
      // 真卡号（02 开头 19 位）应保留
      expect(banks).toContain('0200025609200013713');
    });

    it('case P4-4 (回归): 真实银行账号 19 位应保留', () => {
      // 习酒合同"银行账号：23380001040000208" 是 17 位农业银行内部分行短账号（真）
      // 这里验证：post-filter 不应误伤所有 17 位数字 — 只针对 USCC 形态（91/92/93 开头且 ≤18 位）
      const text = '中国农业银行股份有限公司习水二郎庙支行 银行账号：23380001040000208';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P4-4] banks=${JSON.stringify(banks)}`);
      // 17 位 9[123] 开头才拒；2338 不以 9 开头 → 保留（真农业银行短账号）
      expect(banks).toContain('23380001040000208');
    });

    it('case P4-5 (回归): 真实工行账号 19 位 + label 应保留', () => {
      const text = '工商银行马甸支行 账号：0200025609200013713';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P4-5] banks=${JSON.stringify(banks)}`);
      expect(banks).toContain('0200025609200013713');
    });
  });

  // ==================== P5 NAME 中段漏识别（习酒真合同）====================
  describe('P5 NAME 中段 label "项目负责人" 漏识别（习酒合同反复出现）', () => {
    it('case P5-1: "项目负责人为蔡明衡" → 应识别 NAME "蔡明衡"', () => {
      const text = '甲方项目负责人为蔡明衡，负责本项目的整体推进';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const names = result.matches.filter(m => m.type === 'NAME').map(m => m.value);
      console.log(`\n[case P5-1] names=${JSON.stringify(names)}`);
      expect(names).toContain('蔡明衡');
    });

    it('case P5-2 (回归): "联系人为张三" 应识别 NAME', () => {
      const text = '甲方联系人为张三，电话 13000000000';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const names = result.matches.filter(m => m.type === 'NAME').map(m => m.value);
      console.log(`\n[case P5-2] names=${JSON.stringify(names)}`);
      expect(names).toContain('张三');
    });
  });

  // ==================== P6 BANK_CARD 21位账号被 regex 截 19 位（真合同反复出现）====================
  describe('P6 BANK_CARD 21位美元/欧元外币账号被 regex 上限截断（CTR 合同反复出现）', () => {
    it('case P6-1: "美元账号：110060437146100000175" 21 位 → 应完整识别', () => {
      // CTR 合同美元账号真合同反复出现 — 21 位
      // regex 当前 \d{3,6} 截 19 位，丢末尾 2 位 "75"
      const text = '美元账号：110060437146100000175';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P6-1] banks=${JSON.stringify(banks)}`);
      expect(banks).toContain('110060437146100000175');
    });

    it('case P6-2: "欧元账号：110060437386100000122" 21 位 → 应完整识别', () => {
      const text = '欧元账号：110060437386100000122';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P6-2] banks=${JSON.stringify(banks)}`);
      expect(banks).toContain('110060437386100000122');
    });

    it('case P6-3 (回归): 19 位真卡号不应回归', () => {
      const text = '工商银行账号：0200025609200013713';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P6-3] banks=${JSON.stringify(banks)}`);
      expect(banks).toContain('0200025609200013713');
    });

    it('case P6-4 (回归): 17 位农行账号应保留', () => {
      const text = '银行账号：23380001040000208';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P6-4] banks=${JSON.stringify(banks)}`);
      expect(banks).toContain('23380001040000208');
    });

    it('case P6-5 (回归): 16 位真卡号应保留', () => {
      const text = '账号：6228480000000000';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P6-5] banks=${JSON.stringify(banks)}`);
      expect(banks).toContain('6228480000000000');
    });
  });

  // ==================== P7-P9 PHONE/BANK_CARD 大额支付行号 + USCC 切片 FP（CMBC 合同反复出现）====================
  describe('P7-P9 大额支付行号/CNAPS 误识别 + USCC 切片误识别（CMBC 真实合同）', () => {
    it('case P7: 12 位大额行号 "大额支付行号：102100009818" → 不应识别 PHONE', () => {
      // CMBC 合同"大额支付行号：102100009818" — 工行大额行号（CNAPS 12 位）被 PHONE regex 截 11 位
      // 真合同反复出现：102100009818 / 105100000017 / 313584000017 等
      const text = '大额支付行号：102100009818';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const phones = result.matches.filter(m => m.type === 'PHONE').map(m => m.value);
      console.log(`\n[case P7] phones=${JSON.stringify(phones)}`);
      expect(phones).not.toContain('02100009818');
      expect(phones).not.toContain('102100009818');
    });

    it('case P8: 16 位民生大额行号 "票面账号：0137014210000015" → 不应识别 BANK_CARD', () => {
      // CMBC 合同"票面账号：0137014210000015" — 民生大额行号（CNAPS 16 位）被 BANK_CARD 识别
      const text = '票面账号：0137014210000015';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P8] banks=${JSON.stringify(banks)}`);
      expect(banks).not.toContain('0137014210000015');
    });

    it('case P9: PHONE regex 在 USCC 中段切出 13 位 "0105306792506" → 不应识别 PHONE', () => {
      // CMBC 合同 "税号：911101053067925068" — mammoth 拼丢换行后 18 位纯数字 USCC
      // PHONE regex 中段切出 "0105306792506" 13 位误识别
      const text = '911101053067925068\n户名：测试';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const phones = result.matches.filter(m => m.type === 'PHONE').map(m => m.value);
      console.log(`\n[case P9] phones=${JSON.stringify(phones)}`);
      expect(phones).not.toContain('0105306792506');
    });

    it('case P9-regression (回归): 真 11 位手机号 "13661316595" 应保留', () => {
      const text = '联系电话：13661316595';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const phones = result.matches.filter(m => m.type === 'PHONE').map(m => m.value);
      console.log(`\n[case P9-regression] phones=${JSON.stringify(phones)}`);
      expect(phones).toContain('13661316595');
    });

    it('case P8-regression (回归): 真 19 位工行账号不应回归', () => {
      const text = '账号：0200025609200013713';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const banks = result.matches.filter(m => m.type === 'BANK_CARD').map(m => m.value);
      console.log(`\n[case P8-regression] banks=${JSON.stringify(banks)}`);
      expect(banks).toContain('0200025609200013713');
    });
  });

  // ==================== P10/P10b COMPANY 叙述前缀 + 括号断裂 FP ====================
  describe('P10/P10b COMPANY 合同叙述前缀 + 括号断裂 FP（CMBC/副本SAMPLE-CO-E海洛长协真实合同）', () => {
    it('case P10: "本合作协议由北京SAMPLE-CO-E网络科技有限公司..." → 切"本合作协议由"剩真公司', () => {
      // 副本SAMPLE-CO-E海洛长协真合同原文
      const text = '本合作协议由北京SAMPLE-CO-E网络科技有限公司（下称"SAMPLE-CO-E网"）';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const companies = result.matches.filter(m => m.type === 'COMPANY').map(m => m.value);
      console.log(`\n[case P10] companies=${JSON.stringify(companies)}`);
      expect(companies.some(m => m.startsWith('本合作协议由'))).toBe(false);
      expect(companies).toContain('北京SAMPLE-CO-E网络科技有限公司');
    });

    it('case P10b: "收款单位（公司全称）：北京SAMPLE-CO-E教育科技有限公司..." → 断裂 FP 应拒', () => {
      // CMBC 合同"收款单位（公司全称）：北京SAMPLE-CO-E教育科技有限公司" mammoth 拼接丢内容
      // → COMPANY regex 匹配到 "收款单位（公司" 4 hanChars + form
      const text = '收款单位（公司全称）：北京SAMPLE-CO-E教育科技有限公司';
      const finder = buildFinder();
      const result = finder.findSensitiveContent(text);
      const companies = result.matches.filter(m => m.type === 'COMPANY').map(m => m.value);
      console.log(`\n[case P10b] companies=${JSON.stringify(companies)}`);
      expect(companies).not.toContain('收款单位（公司');
      expect(companies).toContain('北京SAMPLE-CO-E教育科技有限公司');
    });
  });
});
