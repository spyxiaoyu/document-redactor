/**
 * COMPANY 识别准确率 probe 测试 — spy 截图反馈根因修复
 *
 * 锁定 bug（CLAUDE.md §11 测试先行铁律 Step 1）：spy 工作流截图反馈公司名识别太贪婪，
 * 3 个具体 false positive：
 *   1. "设计公司"（描述性短语，非真公司名）
 *   2. "委托北京SAMPLE-CO-E公司"（左边界贪婪吞"委托"）
 *   3. "设计师及其所属公司"（body 含"及其"介词链）
 *
 * 3 个结构性缺陷（regex 层面）：
 *   - 左边界无负向后顾：[一-龥]+? 可向左无限扩展
 *   - 最小 body = 1 char：+? 允许"X公司"
 *   - 无介词/代词过滤：body 不检查词性
 *
 * 修复方向：3 路 alternative regex（region/industry/loose）+ post-filter（介词+代词）。
 *
 * 关键：用 SensitiveFinder 真实 API（findSensitiveContent）测，post-filter 才生效。
 *       只跑 regex 会跳过 post-filter（甲方/乙方/关联公司、body 合法性检查全失效）。
 *
 * 跑法：npx vitest run src/rules/__tests__/CompanyRecognition.test.ts
 */
import { describe, it, expect } from 'vitest';
import { SensitiveFinder } from '@/engines/SensitiveFinder';

function findCompany(text: string): string[] {
  const finder = new SensitiveFinder();
  const result = finder.findSensitiveContent(text);
  return result.matches.filter(m => m.type === 'COMPANY').map(m => m.value);
}

describe('COMPANY 识别 — spy 截图 false positive 案例', () => {
  describe('spy 3 个明确误识别', () => {
    it('case 1: "设计公司" → 描述性短语，不应整体匹配', () => {
      // "设计公司" 是描述某公司的职能，不是真公司名（如"XX 设计公司"才是）
      // 当前 regex bug：会匹配"设计公司" 4 字
      const text = '合作方为某设计公司';
      const matches = findCompany(text);
      console.log(`\n[case 1] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // 期望：要么不匹配，要么只匹配"某设计公司"（如果能正确左边界）
      // 严格期望：不匹配 "设计公司" 单独作为公司名（描述性短语）
      expect(matches.some(m => m === '设计公司')).toBe(false);
    });

    it('case 2: "委托北京SAMPLE-CO-E公司" → 应该只匹配 "北京SAMPLE-CO-E公司"，不能吞 "委托"', () => {
      const text = '委托北京SAMPLE-CO-E公司代理本案';
      const matches = findCompany(text);
      console.log(`\n[case 2] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // 期望：匹配 "北京SAMPLE-CO-E公司"，不能匹配 "委托北京SAMPLE-CO-E公司"
      expect(matches).not.toContain('委托北京SAMPLE-CO-E公司');
      // 注意：当前 buggy regex 会匹配 "委托北京SAMPLE-CO-E公司"，修复后应该匹配 "北京SAMPLE-CO-E公司"
      // 由于左边界负向后顾，"北京"前是"托"（中文），仍会触发负向后顾拒绝。
      // 这种情况下，应该匹配 "北京SAMPLE-CO-E公司"（这是用户的真实公司名）。
      // 我们期望至少匹配 "北京SAMPLE-CO-E公司" 这部分。
      expect(matches.some(m => m.includes('北京SAMPLE-CO-E公司'))).toBe(true);
    });

    it('case 3: "设计师及其所属公司" → body 含介词 "及其"，应被拒', () => {
      const text = '设计师及其所属公司';
      const matches = findCompany(text);
      console.log(`\n[case 3] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // 期望：body 含"及"、"其"等连词/代词，不应被识别为公司名
      expect(matches.some(m => m === '设计师及其所属公司')).toBe(false);
    });
  });

  describe('真公司名必须能识别（不能误伤）', () => {
    it('case 4: "北京SAMPLE-CO-Z有限公司" — 完整型', () => {
      const text = '甲方为北京SAMPLE-CO-Z有限公司';
      const matches = findCompany(text);
      console.log(`\n[case 4] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches).toContain('北京SAMPLE-CO-Z有限公司');
    });

    it('case 5: "SAMPLE-CO-F（北京）融媒体科技文化有限公司" — 含括号', () => {
      const text = 'SAMPLE-CO-F（北京）融媒体科技文化有限公司';
      const matches = findCompany(text);
      console.log(`\n[case 5] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches).toContain('SAMPLE-CO-F（北京）融媒体科技文化有限公司');
    });

    it('case 6: "阿里巴巴集团" — 简称 + 集团', () => {
      const text = '阿里巴巴集团是行业巨头';
      const matches = findCompany(text);
      console.log(`\n[case 6] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches).toContain('阿里巴巴集团');
    });

    it('case 7: "上海某网络科技公司" — 区+简称+行业+公司', () => {
      const text = '上海某网络科技公司';
      const matches = findCompany(text);
      console.log(`\n[case 7] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches).toContain('上海某网络科技公司');
    });

    it('case 8: "华为投资控股有限公司" — 多段行业', () => {
      const text = '华为投资控股有限公司';
      const matches = findCompany(text);
      console.log(`\n[case 8] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches).toContain('华为投资控股有限公司');
    });
  });

  describe('代词/助词开头的应被拒', () => {
    it('case 9: "这家公司" — 代词开头', () => {
      const text = '这家公司提供咨询服务';
      const matches = findCompany(text);
      console.log(`\n[case 9] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // "这家" 是指示代词开头，不应被识别为公司名
      expect(matches.some(m => m === '这家公司')).toBe(false);
    });

    it('case 10: "该公司" — 代词开头', () => {
      const text = '该公司主营业务为法律咨询';
      const matches = findCompany(text);
      console.log(`\n[case 10] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '该公司')).toBe(false);
    });

    it('case 11: "那个公司" — 代词开头', () => {
      const text = '那个公司已经上市';
      const matches = findCompany(text);
      console.log(`\n[case 11] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '那个公司')).toBe(false);
    });

    it('case 12: "每个公司" — 代词开头', () => {
      const text = '每个公司都有自己的文化';
      const matches = findCompany(text);
      console.log(`\n[case 12] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '每个公司')).toBe(false);
    });
  });

  describe('含连接词的应被拒', () => {
    it('case 13: "A和B公司" — body 含连接词 "和"', () => {
      const text = 'A和B公司共同承办';
      const matches = findCompany(text);
      console.log(`\n[case 13] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // body 含"和"不应整体识别，但可能匹配 "B公司" 单独的子串（看 regex 行为）
      // 我们只确保 "A和B公司" 整体不被识别
      expect(matches.some(m => m === 'A和B公司')).toBe(false);
    });

    it('case 14: "甲乙双方的律师和顾问公司" — body 含 "和"', () => {
      const text = '甲乙双方的律师和顾问公司';
      const matches = findCompany(text);
      console.log(`\n[case 14] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m.includes('和顾问公司'))).toBe(false);
    });
  });

  describe('post-filter（已存在的）— 不应回归', () => {
    it('case 15: "甲方公司" — 应被 post-filter 拒', () => {
      const text = '甲方公司负责交付';
      const matches = findCompany(text);
      console.log(`\n[case 15] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '甲方公司')).toBe(false);
    });

    it('case 16: "乙方公司" — 应被 post-filter 拒', () => {
      const text = '乙方公司负责交付';
      const matches = findCompany(text);
      console.log(`\n[case 16] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '乙方公司')).toBe(false);
    });

    it('case 17: "关联公司" — 应被 post-filter 拒', () => {
      const text = '本公司与关联公司有业务往来';
      const matches = findCompany(text);
      console.log(`\n[case 17] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m.includes('关联公司'))).toBe(false);
    });
  });

  describe('复合场景（多公司 + false positive 共存）', () => {
    it('case 18: 复合文档段落 — split 模式（user 反馈后改）', () => {
      const text = `委托北京SAMPLE-CO-E公司代理SAMPLE-CO-F（北京）融媒体科技文化有限公司
与这家公司和那个公司合作，每个公司都参与。`;
      const matches = findCompany(text);
      console.log(`\n[case 18] 输入: ${text.length} 字 → 匹配 ${matches.length} 个: ${JSON.stringify(matches)}`);
      // SPLIT 后应识别两家真公司（"北京SAMPLE-CO-E公司" 和 "SAMPLE-CO-F（北京）融媒体科技文化有限公司"）
      expect(matches.some(m => m === '北京SAMPLE-CO-E公司')).toBe(true);
      expect(matches.some(m => m.includes('SAMPLE-CO-F'))).toBe(true);
      // merged FP 整体不应出现
      expect(matches.some(m => m.includes('委托北京SAMPLE-CO-E公司代理'))).toBe(false);
      // 下列 false positive 应被拒（既有 post-filter）
      expect(matches.some(m => m === '这家公司')).toBe(false);
      expect(matches.some(m => m === '那个公司')).toBe(false);
      expect(matches.some(m => m === '每个公司')).toBe(false);
    });
  });

  describe('zcool 真实 docx 第二轮 FPs（probe 测试先行）', () => {
    it('case 19: "经" 介词前缀应被切断', () => {
      // zcool docx [102-113] "经维沃移动通信有限公司" FP → 真实公司 [30-40] 已匹配
      const text = '委托其合作公司开展总控工作。经维沃移动通信有限公司同意，';
      const matches = findCompany(text);
      console.log(`\n[case 19] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // 期望：切前缀 "经" 后 match "维沃移动通信有限公司"
      expect(matches.some(m => m === '维沃移动通信有限公司')).toBe(true);
      // 不应保留 "经维沃移动通信有限公司" 整体
      expect(matches.some(m => m === '经维沃移动通信有限公司')).toBe(false);
    });

    it('case 20: "属" 字符在 body 中应被拒', () => {
      // zcool docx [2426-2433] "设计师所属公司" FP
      const text = '设计师、设计师所属公司各自留存壹份';
      const matches = findCompany(text);
      console.log(`\n[case 20] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // "所属" 是连词+代词，不是真公司名，应被拒
      expect(matches.some(m => m === '设计师所属公司')).toBe(false);
    });

    it('case 21: mid-verb (委托) 长 body 应拆成两家公司（不是整体拒）', () => {
      // zcool docx [116-144] "X公司委托Y公司" 28 chars — 用户反馈要 SPLIT 不 REJECT
      const text = '北京新意互动数字技术有限公司委托北京SAMPLE-CO-E网络科技有限公司承办';
      const matches = findCompany(text);
      console.log(`\n[case 21] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // split 期望：识别两家独立公司
      expect(matches.some(m => m === '北京新意互动数字技术有限公司')).toBe(true);
      expect(matches.some(m => m === '北京SAMPLE-CO-E网络科技有限公司')).toBe(true);
      // merged FP 整体不应出现
      expect(matches.some(m => m.includes('北京新意互动数字技术有限公司委托'))).toBe(false);
    });

    it('case 22: 单 company 含 "代理" 但 body 短应保留', () => {
      // body length < 18 防止误伤合法单 company（"智能代理有限公司"）
      const text = '智能代理有限公司提供财务咨询服务';
      const matches = findCompany(text);
      console.log(`\n[case 22] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '智能代理有限公司')).toBe(true);
    });

    it('case 23: "经" 前缀不误伤真公司（"经"后紧跟 brand name）', () => {
      // "经维沃移动通信有限公司" 中"经"切后剩 "维沃移动通信有限公司"，仍 ≥3 han chars → 真实 Vivo 应被识别
      const text = '经维沃移动通信有限公司同意';
      const matches = findCompany(text);
      console.log(`\n[case 23] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '维沃移动通信有限公司')).toBe(true);
    });
  });
});

/**
 * 配套 fix：AMOUNT_UPPER 大写金额括号截断 + BANK_CARD 前导 0（用户反馈）
 *
 * 两份真实 docx 暴露的相邻 bug：
 *   - AMOUNT_UPPER "【壹拾伍万陆仟肆佰肆拾】元整" 被截成 "壹拾伍万六" 5 chars（括号断 regex）
 *   - BANK_CARD "0413090103000048204" 被截成 "413090103000048204"（前导 0 不接受）
 *
 * 必须用 SensitiveFinder 真实 API 测（post-filter 不影响，但 regex 层面就错）
 */
import { SensitiveFinder as FinderReg } from '@/engines/SensitiveFinder';

function findByType(text: string, type: string): string[] {
  const finder = new FinderReg();
  const result = finder.findSensitiveContent(text);
  return result.matches.filter(m => m.type === type).map(m => m.value);
}

describe('AMOUNT_UPPER + BANK_CARD 大括号/前导 0 bug 修复', () => {
  describe('AMOUNT_UPPER 大写金额应跨括号匹配', () => {
    it('case A1: 【壹拾伍万陆仟肆佰肆拾】元整 应完整匹配', () => {
      // 设备采购 docx [452-457] bug：被截 "壹拾伍万六" 5 chars
      const text = '（大写：人民币【壹拾伍万陆仟肆佰肆拾】元整）';
      const matches = findByType(text, 'AMOUNT_UPPER');
      console.log(`\n[case A1] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // 期望：完整 13 字
      expect(matches.some(m => m === '壹拾伍万陆仟肆佰肆拾元整' || m === '壹拾伍万陆仟肆佰肆拾】元整')).toBe(true);
      // 不应只截 5 chars
      expect(matches.some(m => m === '壹拾伍万陆')).toBe(false);
    });

    it('case A2: 已有全字匹配不应回归', () => {
      // 设备采购 docx [750-759] 已 pass 的 case
      const text = '柒仟捌佰贰拾贰元整';
      const matches = findByType(text, 'AMOUNT_UPPER');
      console.log(`\n[case A2] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '柒仟捌佰贰拾贰元整')).toBe(true);
    });

    it('case A3: 元 + 角 + 分 也应匹配', () => {
      const text = '贰元叁角伍分';
      const matches = findByType(text, 'AMOUNT_UPPER');
      console.log(`\n[case A3] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '贰元叁角伍分')).toBe(true);
    });
  });

  describe('BANK_CARD 应保留前导 0', () => {
    it('case B1: 0413090103000048204 含前导 0 应完整匹配', () => {
      // 设备采购 docx [971-989] bug：被截 "413090103000048204" 18 chars（去前导 0）
      const text = '账  号：【0413090103000048204】';
      const matches = findByType(text, 'BANK_CARD');
      console.log(`\n[case B1] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      // 期望：19 chars（含前导 0）
      expect(matches.some(m => m.replace(/\D/g, '').endsWith('204'))).toBe(true);
      expect(matches.some(m => m === '0413090103000048204')).toBe(true);
    });

    it('case B2: 无前导 0 不应回归', () => {
      // 设备采购 docx [1350-1367] 已 pass: "44057601040010545" 17 chars
      const text = '账户号: 44057601040010545';
      const matches = findByType(text, 'BANK_CARD');
      console.log(`\n[case B2] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
      expect(matches.some(m => m === '44057601040010545')).toBe(true);
    });
  });

  /**
   * 第三轮修复（spy 6 docx audit 暴露 — 2026-07-19）：
   *   - AMOUNT_UPPER 残缺匹配：京城十二时辰 [538-540] "180万元" 只 match "万元" 2 chars
   *     修法：regex 加 Arabic digit 前缀 alternation `\d+(?:,\d{3})*(?:\.\d+)?[万亿]元?`
   *   - BANK_CARD 误匹配畸形 ID：v3 \d{3,6} 让 19 位畸形 ID 卡（如 "4306241990006060034"）也被识别为银行卡
   *     修法：post-filter 排除 ID_CARD 格式（18-19 位 + region + 19/20 年份前缀）
   *
   * probe 测试必须用 SensitiveFinder 真实 API（regex + post-filter 联动）
   */
  describe('AMOUNT_UPPER 阿拉伯数字前缀 + BANK_CARD 排除畸形 ID', () => {
    describe('AMOUNT_UPPER 阿拉伯数字前缀应完整匹配', () => {
      it('case C1: "人民币180万元" → 应匹配 "人民币180万元"（含前缀）', () => {
        // 京城十二时辰 [538-540] bug：之前只 match "万元"
        // v5 修法：Arabic digit alternation + (?:人民币)? prefix 完整捕获
        const text = '预算控制金额为人民币180万元';
        const matches = findByType(text, 'AMOUNT_UPPER');
        console.log(`\n[case C1] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        // 接受 2 种形式：含/不含 人民币 前缀
        expect(matches.some(m => m === '180万元' || m === '人民币180万元')).toBe(true);
        // 不应只残缺匹配 "万元"
        expect(matches.some(m => m === '万元')).toBe(false);
      });

      it('case C2: "180万元整" → 应匹配 "180万元整" 6 chars', () => {
        const text = '总价180万元整';
        const matches = findByType(text, 'AMOUNT_UPPER');
        console.log(`\n[case C2] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '180万元整')).toBe(true);
      });

      it('case C3: "180万"（无"元"）也应匹配', () => {
        const text = '总投资180万';
        const matches = findByType(text, 'AMOUNT_UPPER');
        console.log(`\n[case C3] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '180万')).toBe(true);
      });

      it('case C4: "1.5万元"（小数）也应匹配', () => {
        const text = '预算1.5万元';
        const matches = findByType(text, 'AMOUNT_UPPER');
        console.log(`\n[case C4] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '1.5万元')).toBe(true);
      });

      it('case C5: 现有汉字金额不应回归', () => {
        const text = '总计贰佰柒拾肆万肆仟叁佰零陆元';
        const matches = findByType(text, 'AMOUNT_UPPER');
        console.log(`\n[case C5] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '贰佰柒拾肆万肆仟叁佰零陆元')).toBe(true);
      });
    });

    describe('BANK_CARD 应排除畸形 19 位 ID 卡格式', () => {
      it('case D1: 19 位畸形 ID "4306241990006060034" → 不应被识别为 BANK_CARD', () => {
        // 三餐四季 [11088-11107] bug：v3 \d{3,6} 让 19 位 ID 也被匹配为银行卡
        // 修法：post-filter 排除 ID_CARD 格式（region(6) + 19|20 年份(4) + ...）
        const text = '主力编剧 朱星杰 男 4306241990006060034';
        const matches = findByType(text, 'BANK_CARD');
        console.log(`\n[case D1] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '4306241990006060034')).toBe(false);
      });

      it('case D2: 19 位真银行卡 "1001182619000025616" 不应回归', () => {
        // 三餐四季 [5061-5080] 已 pass: 19 位银联卡
        const text = '开户账号：1001182619000025616';
        const matches = findByType(text, 'BANK_CARD');
        console.log(`\n[case D2] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '1001182619000025616')).toBe(true);
      });

      it('case D3: 19 位前导 0 银行卡 "0413090103000048204" 不应回归', () => {
        // 设备采购 [971-989] 已 pass
        const text = '账户：0413090103000048204';
        const matches = findByType(text, 'BANK_CARD');
        console.log(`\n[case D3] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '0413090103000048204')).toBe(true);
      });

      it('case D4: 18 位 ID_CARD 数字串也不应被误吃', () => {
        // 类似 ID_CARD 格式（region 6 + 19XX 年）的 18 位数字串不应被 BANK_CARD 吃
        const text = '员工编号 110101199003078811';
        const matches = findByType(text, 'BANK_CARD');
        console.log(`\n[case D4] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '110101199003078811')).toBe(false);
      });
    });

    describe('COMPANY alt B 副词前缀应拒 + 真简称应保', () => {
      // 三餐四季 [14085-14091] bug："同时配合集团"被识别成公司名
      // 根因：alt B "[\u4e00-\u9fa5]{2,8}集团" 左边界无负向后顾
      // 修法：alt B 加 (?<![时也又同还样但或仍即复再]) 拒副词前缀

      it('case E1: "同时配合集团" → 叙述短语，不应整体匹配为 COMPANY', () => {
        const text = '对节目的价值观与主题立意进行策划，同时配合集团完成商务方案的润色与加工等工作';
        const matches = findCompany(text);
        console.log(`\n[case E1] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '同时配合集团')).toBe(false);
      });

      it('case E2: "也同样隶属于集团" → 副词链仍拒', () => {
        const text = '该业务也同样隶属于集团统一管理';
        const matches = findCompany(text);
        console.log(`\n[case E2] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '也同样隶属于集团')).toBe(false);
      });

      it('case E3: 真简称 "阿里巴巴集团" 不应回归', () => {
        const text = '合作方为阿里巴巴集团及其关联公司';
        const matches = findCompany(text);
        console.log(`\n[case E3] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches).toContain('阿里巴巴集团');
      });

      it('case E4: 真简称 "腾讯集团" 不应回归', () => {
        const text = '甲方为腾讯集团';
        const matches = findCompany(text);
        console.log(`\n[case E4] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches).toContain('腾讯集团');
      });

      it('case E5: "但还需配合集团" → 多个副词连用仍拒', () => {
        const text = '但还需配合集团核对数据';
        const matches = findCompany(text);
        console.log(`\n[case E5] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m === '但还需配合集团')).toBe(false);
      });
    });

    describe('TAX_ID 中文括号 + 短 label variant', () => {
      // spy 6 docx audit - 三餐四季 [5018-5036] bug：
      //   text: "纳税识别号：【913100007397870325】"
      //   原 regex label alt 是 "纳税人识别号" 6 字版本 → 不匹配 "纳税识别号" 5 字版本
      //   即使 label 改对，regex 的 `[:：]?\s*` 不允许 `【` 作分隔符，BANK_CARD 仍优先认领 18 位纯数字
      //   → 脱敏语义错位（想脱敏"纳税识别号"，结果脱成了"银行卡号"）
      // 修法：
      //   1. label alt 加 "纳税识别号" 5 字版本（文档常用简写）
      //   2. 允许 `【】（）()` 中文括号在 label 与 capture group 之间作分隔符

      it('case F1: "纳税识别号：【XXX】" 应识别 TAX_ID（5字 label + 中文左括号）', () => {
        const finder = new SensitiveFinder();
        const text = '公司名称：【上海中视国际广告有限公司】\n纳税识别号：【913100007397870325】\n开户银行：【工行陆家嘴支行】';
        const result = finder.findSensitiveContent(text);
        const taxIds = result.matches.filter(m => m.type === 'TAX_ID');
        console.log(`\n[case F1] 匹配 TAX_ID: ${JSON.stringify(taxIds.map(m => m.value))}`);
        expect(taxIds.length).toBe(1);
        expect(taxIds[0].value).toBe('913100007397870325');
      });

      it('case F2: "纳税人识别号：【XXX】" 应识别 TAX_ID（6字 label + 中文左括号）', () => {
        const finder = new SensitiveFinder();
        const text = '纳税人识别号：【91110108MA01ABCD2X】';
        const result = finder.findSensitiveContent(text);
        const taxIds = result.matches.filter(m => m.type === 'TAX_ID');
        console.log(`\n[case F2] 匹配 TAX_ID: ${JSON.stringify(taxIds.map(m => m.value))}`);
        expect(taxIds.length).toBe(1);
        expect(taxIds[0].value).toBe('91110108MA01ABCD2X');
      });

      it('case F3: "税号：（XXX）" 应识别 TAX_ID（全角圆括号）', () => {
        const finder = new SensitiveFinder();
        const text = '税号：（911101053482731061）';
        const result = finder.findSensitiveContent(text);
        const taxIds = result.matches.filter(m => m.type === 'TAX_ID');
        console.log(`\n[case F3] 匹配 TAX_ID: ${JSON.stringify(taxIds.map(m => m.value))}`);
        expect(taxIds.length).toBe(1);
        expect(taxIds[0].value).toBe('911101053482731061');
      });

      it('case F4: "税号: XXX" ASCII 标点应不回归', () => {
        const finder = new SensitiveFinder();
        const text = '税号: 91110108MA01ABCD2X';
        const result = finder.findSensitiveContent(text);
        const taxIds = result.matches.filter(m => m.type === 'TAX_ID');
        console.log(`\n[case F4] 匹配 TAX_ID: ${JSON.stringify(taxIds.map(m => m.value))}`);
        expect(taxIds.length).toBe(1);
        expect(taxIds[0].value).toBe('91110108MA01ABCD2X');
      });
    });

    describe('BANK_CARD 应排除 ID_CARD 16 位前缀 + X 片段', () => {
      // spy 6 docx audit - 三餐四季 [12802-12818] bug：
      //   text: "4502019970621042X"（17 字 typo 缺一位身份证 + X 校验位）
      //   现状：BANK_CARD 只匹配前 16 位 "4502019970621042"，原 X 不在 match 范围
      //   已有 post-filter 仅检查 length ≥17 → 16 位不挡 → 误识别为银行卡
      // 修法：post-filter 加 v3 - 16 位 + 后接 [X/x/数字] 视为 ID_CARD 片段排除

      it('case G1: 16 位 + X（"4502019970621042X"）应排除 BANK_CARD', () => {
        const finder = new SensitiveFinder();
        const text = '主力编剧 熊颖倩 女 4502019970621042X 18711076521';
        const result = finder.findSensitiveContent(text);
        const banks = result.matches.filter(m => m.type === 'BANK_CARD');
        console.log(`\n[case G1] BANK_CARD 匹配: ${JSON.stringify(banks.map(m => m.value))}`);
        expect(banks.some(m => m.value === '4502019970621042')).toBe(false);
      });

      it('case G2: 16 位 + 数字（"450201997062104212345678"）也应排除（继续延展为 ID 段）', () => {
        const finder = new SensitiveFinder();
        const text = '身份证 450201997062104212345678';
        const result = finder.findSensitiveContent(text);
        const banks = result.matches.filter(m => m.type === 'BANK_CARD');
        console.log(`\n[case G2] BANK_CARD 匹配: ${JSON.stringify(banks.map(m => m.value))}`);
        // 期望：bank 应排除前 16 位片段；但其他长数字段（如 18+ 位）可能仍被匹配
        expect(banks.some(m => m.value === '4502019970621042')).toBe(false);
      });

      it('case G3: 纯 16 位卡（"1234567812345678"）不被后续字符延伸时，应保留 BANK_CARD', () => {
        const finder = new SensitiveFinder();
        const text = '开户账号：1234567812345678\n开户行：工行';
        const result = finder.findSensitiveContent(text);
        const banks = result.matches.filter(m => m.type === 'BANK_CARD');
        console.log(`\n[case G3] BANK_CARD 匹配: ${JSON.stringify(banks.map(m => m.value))}`);
        expect(banks.some(m => m.value === '1234567812345678')).toBe(true);
      });

      it('case G4: 18 位真银行卡（"4502019900001234567"）应保留', () => {
        const finder = new SensitiveFinder();
        const text = '开户账号：4502019900001234567';
        const result = finder.findSensitiveContent(text);
        const banks = result.matches.filter(m => m.type === 'BANK_CARD');
        console.log(`\n[case G4] BANK_CARD 匹配: ${JSON.stringify(banks.map(m => m.value))}`);
        expect(banks.some(m => m.value === '4502019900001234567')).toBe(true);
      });

      it('case G5: 16 位卡后接中文（"1234567812345678元"）应保留 BANK_CARD', () => {
        const finder = new SensitiveFinder();
        const text = '卡号 1234567812345678元整';
        const result = finder.findSensitiveContent(text);
        const banks = result.matches.filter(m => m.type === 'BANK_CARD');
        console.log(`\n[case G5] BANK_CARD 匹配: ${JSON.stringify(banks.map(m => m.value))}`);
        expect(banks.some(m => m.value === '1234567812345678')).toBe(true);
      });
    });

    /**
     * 第四轮修复（spy SAMPLE-CO-J Pre-A 增资协议 audit — 22 个 COMPANY FP）：
     *   暴露大量叙述性短语被误识别为 COMPANY：
     *     - "青山资本应向公司" / "剩余款项计入公司" / "由正涵投资向公司"
     *     - "维持集团公司" / "影响集团公司" / "保证方承诺集团公司"
     *     - "的股权系为公司" / "酪神星球实际为公司的全资子公司"
     *     - "并应办理股权变更登记以使得酪神星球变更为公司的全资子公司" 28 chars
     *     - "制订或修改集团公司" / "聘任或解聘公司"
     *   根因：COMPANY regex body 字符类 `[\u4e00-\u9fa5（）()]{2,30}` 无动作动词/介词终止符
     *   真公司名 body 是静态名词（地点+品牌+行业词"科技/投资/实业"+公司形态"发展/控股/管理"）
     *   FP body 含动态动作词（"应向"/"办理"/"经营"/"承诺"/"损害"/"制订" 等合同动作动词）
     *   修法：post-filter 加 action verb trigger list，命中即拒
     *   注意：避免误伤静态词（如"代理" — "智能代理有限公司" case 22）
     *   probe 测试 case 24-31（先 red 复现，再 green 验证修法）
     */
    describe('酪神_Pre-A_增资协议 audit FP 修复（合同动作动词 body 拒）', () => {
      it('case 24: "青山资本应向公司" → 合同动作动词触发，应拒', () => {
        const text = '青山资本应向公司支付剩余投资款';
        const matches = findCompany(text);
        console.log(`\n[case 24] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m.includes('青山资本应向公司'))).toBe(false);
      });

      it('case 25: "维持集团公司" → 动作动词 "维持" 触发，应拒', () => {
        const text = '创始股东应当维持集团公司的正常运营';
        const matches = findCompany(text);
        console.log(`\n[case 25] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m.includes('维持集团'))).toBe(false);
      });

      it('case 26: "的股权系为公司" → 系动词 "系为" 触发，应拒', () => {
        const text = '保证方持有的股权系为公司所有';
        const matches = findCompany(text);
        console.log(`\n[case 26] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m.includes('系为'))).toBe(false);
      });

      it('case 27: 长复合动词链 "并应办理股权变更登记以使得酪神星球变更为公司的全资子公司" → 应拒', () => {
        const text = '并应办理股权变更登记以使得酪神星球变更为公司的全资子公司';
        const matches = findCompany(text);
        console.log(`\n[case 27] 输入: "${text.length}字" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m.includes('并应办理'))).toBe(false);
      });

      it('case 28: "投资者已经完成对集团公司" → 复合动词 "已经完成" 触发，应拒', () => {
        const text = '投资者已经完成对集团公司的增资交割';
        const matches = findCompany(text);
        console.log(`\n[case 28] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m.includes('已经完成'))).toBe(false);
      });

      it('case 29: "约定以书面形式向上海示例企业管理咨询有限公司" → cuttablePrefix 切后保留真简称', () => {
        // case 24 的 cuttablePrefix 版：含 "以书面形式向" coverb 链
        // prefix-cut 后剩 "上海示例企业管理咨询有限公司" — 真简称应保留
        const text = '约定以书面形式向上海示例企业管理咨询有限公司';
        const matches = findCompany(text);
        console.log(`\n[case 29] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches).toContain('上海示例企业管理咨询有限公司');
      });

      it('case 30 (regression): "上海SAMPLE-CO-J健康科技发展有限公司" → 真简称应保留', () => {
        const text = '甲方为上海SAMPLE-CO-J健康科技发展有限公司';
        const matches = findCompany(text);
        console.log(`\n[case 30] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches).toContain('上海SAMPLE-CO-J健康科技发展有限公司');
      });

      it('case 31 (regression): "示例乳业集团有限公司" → 真简称应保留', () => {
        const text = '投资方为示例乳业集团有限公司';
        const matches = findCompany(text);
        console.log(`\n[case 31] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches).toContain('示例乳业集团有限公司');
      });
    });

    describe('青山未满 audit — 地址误识别为 COMPANY FP 修复', () => {
      // 根因：原文是地址 "北京市朝阳区青年路（信托公司仓库）5号楼三层A-306"
      //   COMPANY regex body 允许中文括号，从"北京市朝阳区青年路（信托"吞到第一个"公司"
      //   → 假公司名 "北京市朝阳区青年路（信托公司"
      // 修法：body 含 行政区划(省/市/区/县) + 街道 token(路/街/道/巷/弄) → 判地址 FP 拒
      it('case 40: 地址"北京市朝阳区青年路（信托公司仓库）..." → 不应识别为 COMPANY', () => {
        const text = '地址：北京市朝阳区青年路（信托公司仓库）5号楼三层A-306';
        const matches = findCompany(text);
        console.log(`\n[case 40] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m.includes('信托公司'))).toBe(false);
        expect(matches.some(m => m.includes('青年路'))).toBe(false);
      });

      it('case 41 (regression): "北京示例科技有限公司" → 真公司应保留', () => {
        const text = '甲方：北京示例科技有限公司';
        const matches = findCompany(text);
        console.log(`\n[case 41] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches).toContain('北京示例科技有限公司');
      });

      it('case 42 (regression): "中国建设银行股份有限公司" → 真公司应保留', () => {
        const text = '开户行：中国建设银行股份有限公司';
        const matches = findCompany(text);
        console.log(`\n[case 42] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches).toContain('中国建设银行股份有限公司');
      });
    });

    describe('产权承诺函 audit — 连词"因"前缀误吞 FP 修复', () => {
      // 根因：原文 "因SAMPLE-CO-F（海南）融媒体科技有限公司编制财务报告需要..."
      //   "因"是连词（因…需要…），被吞进 COMPANY body 开头 → 假公司名 "因SAMPLE-CO-F（海南）融媒体科技有限公司"
      // 修法：cuttablePrefix 加单字连词 "因"（与现有 "经" 同类），切后 emit 真公司名
      it('case 43: "因SAMPLE-CO-F（海南）融媒体科技有限公司编制..." → 切"因"保留真公司名', () => {
        const text = '因SAMPLE-CO-F（海南）融媒体科技有限公司编制财务报告需要拟对其并购';
        const matches = findCompany(text);
        console.log(`\n[case 43] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches.some(m => m.startsWith('因'))).toBe(false);
        expect(matches).toContain('SAMPLE-CO-F（海南）融媒体科技有限公司');
      });

      it('case 44 (regression): "北京饼干科技有限公司" → 不以因开头的真公司不受影响', () => {
        const text = '甲方：北京饼干科技有限公司';
        const matches = findCompany(text);
        console.log(`\n[case 44] 输入: "${text}" → 匹配: ${JSON.stringify(matches)}`);
        expect(matches).toContain('北京饼干科技有限公司');
      });
    });
  });
});