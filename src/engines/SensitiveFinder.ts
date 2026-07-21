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

        // PHONE 切片 FP（第七批真合同 audit — CMBC 合同 P7/P9 反复出现）：
        //   PHONE regex `0\d{2,4}[-.\s]?\d{7,8}` 会在更长的纯数字串中段切出 11-13 位"固话形态"子串
        //     - P7 "大额支付行号：102100009818"（12 位 CNAPS）→ 切前一位"1"后的 "02100009818" 11 位
        //     - P9 "911101053067925068"（18 位 USCC，mammoth 拼丢换行）→ 中段切 "0105306792506" 13 位
        //   判别：真固话/手机号由 label（电话：）或空白分隔 → 紧邻前后不是数字
        //         切片必然紧贴其他数字（前或后是 digit）→ 拒
        //   回归安全：P1 "电话：01000000000"（前"："）/ "08510000000"（前"："）/ 手机号（前"："）均不受影响
        if (rule.type === 'PHONE') {
          const beforeChar = text[start - 1];
          const afterChar = text[start + value.length];
          if ((beforeChar && /\d/.test(beforeChar)) || (afterChar && /\d/.test(afterChar))) continue;
        }

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
          // 17-19 位纯数字 统一社会信用代码 FP（第七批真合同 audit — SAMPLE-CO-D mammoth 拼丢尾部字母）：
          //   USCC 18 位 = 工商代码"9" + 机构类别"1/2/3" + 行政区划码 + 主体码 + 字母校验码
          //   mammoth 拼接常丢尾部字母校验码（真值 91440101567914858A → 17 位 91440101567914858）
          //   即使哺乳到 19 位 / 若 USCC 字母在更后位置 → 也可能被误吃
          //   银行卡 BIN 不以 91/92/93 开头（银联 62 / Visa 4 / MC 5）→ 安全区分
          //   阈值 17-19：USCC 退化形态（17 丢 1 位 / 18 原值丢字母 / 19 字母被替换）
          if (value.length >= 17 && value.length <= 19 && /^9[123]/.test(value) && /^\d+$/.test(value)) continue;
          // P4-1 URL 路径末段 FP（spy 第七批真合同 audit — 金蝶开发运维合同 footer）：
          //   "club.kdcloud.com/article/153835620237019392" — 文末 URL 末段数字被 BANK_CARD 抢匹配
          //   判别：match 前 30 chars 文本片段含 URL 路径特征（`.com/`/`/article/`/`http` 等）
          {
            const before = text.slice(Math.max(0, start - 30), start);
            if (/\.com\/|\.cn\/|\/article\/|\.html|\.asp|\.aspx|https?:|\.org\/|\.net\//.test(before)) continue;
          }
          // P4-2 软件序列号 FP（spy 第七批真合同 audit — 金蝶合同 "金蝶云·星空旗舰版（1423029347329064960）"）：
          //   商品序列号/简注在中文全角括号里，不是银行账号
          //   判别：match 紧贴前 1 char = `（` + 紧贴后 1 char = `）`，且前无"账号"/"账户"/"卡号"等 label
          {
            const preChar = text[start - 1];
            const postChar = text[start + value.length];
            if (preChar === '（' && postChar === '）') {
              const widerBefore = text.slice(Math.max(0, start - 15), start - 1);
              if (!/(?:账号|账户|卡号|开户|账号|帐号|账号|账号信息|账户名|银行账|账号资)/.test(widerBefore)) {
                continue;  // 序列号/简注 FP
              }
            }
          }
          if (value.length === 16) {
            // 16 位 + 0 开头 FP（第七批真合同 audit — CMBC 合同 P8 "票面账号：0137014210000015" 民生 CNAPS 大额行号）：
            //   真银行卡 16 位 BIN 只在 银联62 / Visa4 / MC5 / JCB35 段，绝不以 0 开头
            //   CNAPS 大额支付行号 / 票据行号常以 0 开头（0137 = 民生银行）→ 16 位 0 开头 → 拒
            //   回归安全：真账号 0 开头（工行 0200...）都是 19 位（≠16）；16 位真卡（6228...）以 6 开头
            if (value[0] === '0') continue;
            const nextChar = text[start + value.length];
            if (nextChar && /[\dXx]/.test(nextChar)) continue;
          }
        }

        // NAME label 误识别过滤（spy 第五批 audit — 品牌 [1680-1682][1715-1717] "电话" FP 修复）：
        //   NAME regex `(?<=姓名|名字|客户姓名|联系人)[:：]\s*[\u4e00-\u9fa5]{2,4}`
        //   lookbehind 匹配后，name 本体可能不是真姓名，而是"电话/手机/邮箱/地址"等 label
        //   修法：value 命中常见非姓名 label → continue
        //   真姓名（张三/李四/王五等）2-4 hanChars 不在排除列表 → 保留 ✓
        if (rule.type === 'NAME') {
          // 第六批 audit：扩展多字 label（上一批只挡 2-3 字短 label，漏了 "联系电话" 等 4 字 label）
          //   NAME regex lookbehind "联系人：" 后 \s* 跨过换行，把下一行 label "联系电话" 4 hanChars 当姓名
          if (/^(?:电话|手机|邮箱|地址|邮编|传真|网址|微信|QQ|微信|联系人|姓名|名字|客户姓名|联系电话|手机号码|电子邮箱|联系地址|电子信箱|联系方式|电子邮件|通讯地址|联系人员|移动电话|办公电话)$/.test(value)) continue;
        }

        // AMOUNT_UPPER 中段孤立 】 FP 过滤（spy 第五批 audit — 弱电改造 [907-916]/[977-986]/[1054-1064]/[1103-1112] 4 处 FP）：
        //   原文是 docx 表格残余括号（如 "管理费人民币伍万壹仟玖佰】元整" 中段独立出现 `】`）
        //   真 bracket-wrapped amount 必有 `【...】` 配对（A1 case "【壹拾伍万陆仟肆佰肆拾】元整"）
        //     → match 前 5 chars 文本片段必有 `【`
        //   孤立 `】`（无 `【` 配对）→ docx 表格 cell 残余 → 拒
        //   阈值 5 chars：足够覆盖 `【X`（X 是 match 前 1 个字符）场景
        // AMOUNT 百分比/编号 FP（spy 第七批真合同 audit — "金额30%违约金"/"合计 244"/"费用 0.5%"）：
        //   AMOUNT regex `(?:价格|金额|...)[：:\s]*\b\d+` 看到 label + digit 就匹配
        //   真合同反复出现："支付协议总费用30%的违约金"/"本合同金额 2.1"/"合计 244"（表格统计）
        //   这些不是真金额，是百分比/条款编号/表格统计
        //   修法：value 不含单位（无 元/万/千/¥/$/£/€）且 数字 ≤ 100 → 视为百分比/编号，拒
        //   阈值 100：百分比范围 0-100，条款编号通常 ≤ 10
        //   大金额裸数字（如"金额 100000"）无单位也无 ¥ — 也拒 (需 ¥/$ 或单位，否则视为误识别)
        //   回归保护：真金额都带 ¥ 元 元 或带千分位（如 "127,000.00元"），无单位的裸数字极少是真金额
        if (rule.type === 'AMOUNT') {
          const hasCurrencyUnit = /(?:元|¥|￥|\$|€|£|万|千|亿|美元|欧元|英镑|港币|日圆)/.test(value);
          if (!hasCurrencyUnit) {
            // 提取裸数字（去掉 label + 标点）
            const numMatch = value.match(/(\d+(?:\.\d+)?)/);
            // 表格统计 row label + 无单位 → 拒（"合计 244" / "小计 100" 即使数字 > 100 也是表格）
            // 真金额用"合计"label 必带单位（如 "合计 1,000元"）→ hasCurrencyUnit 已通过则保留
            if (/(?:合计|小计)/.test(value)) continue;
            if (numMatch) {
              const n = parseFloat(numMatch[1]);
              if (!isNaN(n) && n <= 100) continue;  // 百分比/编号/小整数表格统计
            } else {
              continue;  // 完全无数字，拒
            }
          }
        }

        if (rule.type === 'AMOUNT_UPPER') {
          // 单独单位词 FP（第六批 audit — "十万元以下"/"一百万元起"/"百万元" 回溯出 "万元" 2 chars）：
          //   regex 主体 [零壹...]+(?:[万亿][...]*)*】?元 从量词字符起匹配失败（如 "十" 不在 [万亿]，
          //   outer * 0 iter，元 需在 万 位 → fail），engine 跳到 万/亿 位置 match "万元" 2 chars（false short）。
          //   真大写金额的 万/亿 是"数量级单位"，前面必有量词（壹贰...拾佰仟 或 阿拉伯数字）。
          //   value 直接以 万/亿 开头（可选 人民币 前缀）→ 单位无量词 → 拒。
          //   回归安全：真金额 "壹拾伍万元整"(起壹)/"180万元"(起1)/"65.2万元"(起6) 均不以 万/亿 开头。
          if (/^(?:人民币)?[万亿]/.test(value)) continue;
          if (value.includes('】')) {
            const before = text.slice(Math.max(0, start - 5), start);
            if (!before.includes('【')) continue;
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

          // mammoth 双 cell 拼接 trim（第六批 audit — 代销协议 "北京示例示例兄弟影院有限公司公司账号"）：
          //   docx 表格 "X有限公司" | "公司账号：..." 两 cell 被 mammoth 拼接丢空格 → "X有限公司公司账号"
          //   → regex 贪婪吞到第二个 "公司" 作 form → value 以 "公司公司" 结尾（第二个 公司 是下一 cell "公司账号" 的头）
          //   修法：value 以 "公司公司" 结尾 → 去掉末尾 1 个 "公司"（真公司名不以 "公司公司" 结尾）
          //   只从末尾裁剪 → start 不变，invariant text.slice(start, start+len)===value 仍成立
          //   → emit 真公司 "北京示例示例兄弟影院有限公司"（不退回 manual）
          if (value.endsWith('公司公司')) {
            value = value.slice(0, -2);
          }

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
          // v5 cuttablePrefix 扩展（SAMPLE-CO-J Pre-A 增资协议 audit 22 FPs 修复 — case 29/31）：
          //   - 加 "投资方为"：case 31 "投资方为示例乳业集团" 切前缀 → emit "示例乳业集团有限公司" ✅
          //   - 加 "约定以书面形式向"：case 29 "约定以书面形式向上海示例..." 切前缀 → emit "上海示例企业管理咨询有限公司" ✅
          //   - 不加 "约定" 单字（"约定科技有限公司" 这种假想名会误伤）+ 不加 "向" 单字（"向上集团" 误伤风险）
          //   - v6 cuttablePrefix 扩展（有关事项说明 audit — case 47）：
          //     加 "）"/")"/"子公司"：case 47 "）子公司SAMPLE-CO-H（上海）文化科技有限公司"
          //     切右括号(前一实体残留) + "子公司"通用前缀 → emit "SAMPLE-CO-H（上海）文化科技有限公司" ✅
          //     真公司字号不以 "）"/")"/"子公司" 开头 → 不误伤
          //   - v7 cuttablePrefix 扩展（第六批 audit — 方太腾讯 "剧目由北京腾讯文化传媒有限公司"）：
          //     加 "剧目由"：切叙述前缀 "剧目由"（"剧目" + coverb "由"）→ emit "北京腾讯文化传媒有限公司" ✅
          //     单字 "由" 不切（NARRATIVE_BOUNDARY 已覆盖 "由X" 开头场景）；只切完整短语 "剧目由"
          const cuttablePrefix = /^(?:甲方为?|乙方为?|丙方为?|丁方为?|戊方为?|己方为?|庚方为?|辛方为?|壬方为?|癸方为?|方为?|经|因|委托|代理|代表|合作|承办|服务|负责|投资方为|约定以书面形式向|剧目由|本[\u4e00-\u9fa5]{1,6}由|）|\)|子公司)/;
          let lastCutLength = 0;
          while (safeStart < body.length) {
            const m = body.slice(safeStart).match(cuttablePrefix);
            if (!m) break;
            const cutLength = m[0].length;
            lastCutLength = cutLength;
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

          // 括号断裂 FP（第七批真合同 audit — CMBC 合同 P10b "收款单位（公司全称）：..." mammoth 拼接）：
          //   COMPANY body 允许中文/半角括号，遇 "收款单位（公司全称）：北京SAMPLE-CO-E教育科技有限公司"
          //   regex 从 "收款单位（" 吞到第一个 "公司" → "收款单位（公司"（未配对的 "（"）
          //   真公司名括号必配对（"SAMPLE-CO-F（海南）..."/"SAMPLE-CO-H（上海）..."）→ safeBody 括号数量不等即断裂残留 → 拒
          //   注意：在 cuttablePrefix 切完后检查 safeBody（不查原 value），否则被切掉的前导 "）"（case 47）会误判不配对
          {
            const opens = (safeBody.match(/[（(]/g) || []).length;
            const closes = (safeBody.match(/[）)]/g) || []).length;
            if (opens !== closes) continue;
          }
          // v7 严格化分单/多字 cut（spy 第五批 audit — 品牌 [113-117] "围绕公司" FP 修复）：
          //   - 单字 cuttablePrefix（"）/）/经/因"）切完后剩 < 3 hanChars → 拒
          //     例 "（1）围绕公司" → 切"）"剩"围绕"2 hanChars <3 → 拒 ✓
          //     例 "需经物业公司" → 切"经"剩"物业"2 hanChars <3 → 拒 ✓
          //   - 多字 cuttablePrefix（"甲方为"/"方为"/"子公司"）切完后剩 < 2 hanChars → 拒
          //     例 "达人、经纪公司" → 切"经"1字 → 剩"纪"1 <2 → 拒 ✓
          //     例 "甲方为腾讯集团" 切"甲方为"3字 → 剩"腾讯"2 ≥2 → 保留 ✓
          //     例 "）子公司SAMPLE-CO-H（上海）..." 切"）"1字+扫"子公司"3字 → lastCutLength=3 → 剩"SAMPLE-CO-H..." ≥3 → 保留 ✓
          if (safeStart > 0) {
            if (lastCutLength === 1 && hanChars.length < 3) continue;
            if (lastCutLength >= 2 && hanChars.length < 2) continue;
          }

          // 纯 form 检查（有关事项说明 audit — case 51 [140-146]/[750-756] "有限责任公司" FP）：
          //   - value 整体就是 form 词（无字号）→ 不是真公司名，拒
          //   - "有限责任公司"/"股份有限公司" 等出现在 "企业性质：有限责任公司" 这类叙述里
          //   - 真公司名必有字号（地名/品牌）在 form 之前 → value ≠ 纯 form
          if (/^(?:有限责任公司|股份有限公司|集团有限公司|集团股份有限公司|股份公司|有限公司|责任公司|集团公司|分公司|子公司|公司|集团)$/.test(value)) continue;

          // 地址 FP 检查（青山未满 audit — "北京市朝阳区青年路（信托公司" 地址误识别）：
          //   - 原文是地址 "北京市朝阳区青年路（信托公司仓库）5号楼三层A-306"
          //     COMPANY body 允许中文括号，从"北京市朝阳区青年路（信托"吞到第一个"公司" → 假公司名
          //   - 真公司 body 是"地名+品牌+行业词"，不含"行政区划+街道 token"完整地址链
          //     （"北京示例科技" 无 市/区/路；"中国建设银行股份" 无街道链 → 保留 ✅）
          //   - 判定：safeBody 含 (省|市|区|县) + 0-10 字 + (路|街|道|巷|弄) → 地址链 → 拒
          if (/(?:省|市|区|县)[\u4e00-\u9fa5（）()]{1,10}(?:路|街|道|巷|弄)/.test(safeBody)) continue;

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

          // 五次检查：safeBody 含合同动作动词 → 拒（SAMPLE-CO-J Pre-A 增资协议 audit 22 FPs 修复）
          //   - 真公司 body 是静态名词（地点 + 品牌 + 行业词"科技/投资/实业" + 公司形态"发展/控股/管理"）
          //   - FP body 含动态动作词（"应向"/"已经"/"办理"/"经营"/"承诺"/"损害"/"制订" 等合同动作动词）
          //   - 22 个 FP 案例分析：所有 FP body 都含至少 1 个明显动作动词
          //   - 注意：
          //     * 不含 "代理"（case 22 "智能代理有限公司" 误伤风险）
          //     * 不含 "发展"/"管理"/"控股"（行业词，真公司名常用）
          //     * 不含 "对"/"由"（太通用，误伤风险）
          //   - 命中即拒整段（不拆 — 这些动词不在 mid-verb 链中，强行 SPLIT 容易产生虚假子串）
          if (ACTION_VERB_TRIGGERS.test(safeBody)) continue;

          // 六次检查：单字 coverb + 通用名词短语 → 拒（SAMPLE-CO-J audit 剩余 coverb+generic FPs 修复）
          //   - "由正涵投资向公司" / "为集团公司" / "的全资子公司" / "对集团X"
          //   - 这些 body 以单字 coverb（由/为/的/对/向）开头，紧跟通用名词短语（集团/子）
          //   - 真公司 body 通常不以单字 coverb 开头（"由"/"为"/"的"/"对" 出现在真公司名里多为中段，如"华为"中的"为"已被 cuttablePrefix 截掉）
          //   - 例外检查："对面集团" body="对面" 不含 "集团" 不触发；"为群集团" body="为群" 触发 → 误伤
          //     但 "为群集团" 是极少见公司名，可以接受（不阻塞核心场景）
          if (/^(?:由[\u4e00-\u9fa5]{2,8}向|的[\u4e00-\u9fa5]{0,5}子|对[\u4e00-\u9fa5]{0,4}集团|为[\u4e00-\u9fa5]{0,3}集团)/.test(safeBody)) continue;

          // 七次检查 v2（spy 第七批真合同 audit — 生态城管委会合同叙述短语 FP）：
          //   body 含描述短语特征词 → 拒
          //     - "连续多年获得中央电视台十佳广告代理公司" → 含"连续"/"十佳" → 叙述性短语被吞
          //     - "直接投资的控股公司" → 含"直接投资" → 条款描述
          //   真公司 body 极少含这些词（"连续集团"/"十佳电器" 都不存在）
          //   阈值：单个词命中即拒（保守）
          if (/(?:连续|十佳|直接投资|连续多年)/.test(safeBody)) continue;

          // 七次检查：body 边界（首/末）含叙述性单字连词/介词 → 拒（酪神 audit 第三轮）
          //   - "且集团" / "就集团" / "据集团" / "并集团" → start coverb → 拒
          //   - "青山资本向" / "股权制定并经" / "且据集团" → end coverb → 拒
          //   - 真公司 body 边界通常是地点/品牌/行业词（如"上海"/"阿里"/"京"/"科技"），不以叙述连词开头或结尾
          if (NARRATIVE_BOUNDARY_VERB_START.test(safeBody) || NARRATIVE_BOUNDARY_VERB_END.test(safeBody)) continue;

          // 八次检查：value 以 "为" + 通用名词短语开头（酪神 audit 第四轮 — 剩 1 FP "为所有集团"）
          //   - safeBody 不含 form，单独看 safeBody 看不到 "为所有集团"
          //   - 直接看 value（body+form）才能匹配 "为所有集团" 这种 5 字 FP
          //   - 真公司 "华为投资有限公司" value 开头是 "华" 不是 "为" → 不误伤
          //   - 真公司 "为群集团有限公司" value 末尾是 "司" 不是 "集团" → 不误伤（regex 要求 value 末尾是"集团"）
          // v2 扩展（spy 第四批 audit — 演员录制 [7245-7250] "以保险公司" FP）：
          //   - 加 coverb "以"：与 "为" 同类合同叙述短语，"以X保险公司" "以X公司名义"
          //   - 真公司 value 不以 "以" 开头 → 不误伤
          if (/^(?:为|以)[\u4e00-\u9fa5]{0,4}(?:集团|公司)$/.test(value)) continue;

          // 九次检查：safeBody 中段含 "为" + 通用名词 → 拒（酪神 audit 第五轮 — 剩 "集团公司为集团公司"）
          //   - "集团公司为集团" / "公司为公司" 等叙述短语（X为Y模式）
          //   - 真公司 body 几乎不含 "为X集团/公司" 模式
          //   - 不影响 "为群集团"（其 body "为群" 不以 "集团" 结尾，regex 不匹配）
          if (/为[\u4e00-\u9fa5]{0,4}(?:集团|公司)$/.test(safeBody)) continue;

          // 十次检查：value 以 "为" + 长内容 + form 开头（叙述 coverb 模式）
          //   - "为上海SAMPLE-CO-J健康科技发展有限公司" → "为" coverb + 12 字内容 + "有限公司" → 拒
          //   - "为群集团有限公司" → "为" + 1 字 + "集团有限公司" → 1 < 8 → 不拒（保留真简称）
          //   - 阈值 8：真简称 body 通常 < 8 字（"为群"2字 / "为X集团"3-5字）
          //   - 阈值 < 8 会误伤 "为X有限公司" 5字真简称
          if (/^为[\u4e00-\u9fa5]{8,}(?:集团有限公司|股份有限公司|科技有限公司|投资有限公司|实业有限公司|商贸有限公司|有限公司|分公司|公司|集团)/.test(value)) continue;

          // 十一次检查：safeBody 以通用名词 "公司"/"集团"/"子公司" + 叙述内容开头 → 拒
          //   - "公司登记事项以公司" / "公司根据需要修改公司" — body 以 "公司" 开头 + 叙述内容 + form "公司"
          //   - 真公司 body 不以通用 form 词开头（"公司"是 form word）
          //   - 例外检查："公司之家公司" / "公司之家集团" 等假设公司名 body 以"公司"开头 — 极少见
          if (/^(?:公司|集团|子公司)[\u4e00-\u9fa5]{3,}/.test(safeBody) && /(?:登记|事项|需要|根据|修改|应|或者|以|且|并|或者)/.test(safeBody)) continue;

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

/**
 * 合同动作动词 trigger list（SAMPLE-CO-J Pre-A 增资协议 audit 22 FPs 修复）
 *
 * 设计：真公司 body 是静态名词（地点 + 品牌 + 行业词），FP body 含动态动作动词。
 *   - 22 个 FP 案例 body 全部命中至少 1 个 trigger
 *   - 真公司名 body（"上海示例企业管理咨询"/"示例乳业"/"三餐四季网络科技"）都不含 trigger
 *
 * 排除词（避免误伤）：
 *   - "代理"（case 22 "智能代理有限公司"）
 *   - "发展"/"管理"/"控股"（行业词，真公司常用）
 *   - "对"/"由"（太通用，单独 reject 误伤风险 — 通过下方的 coverb+generic 检查联合处理）
 *
 * v2 扩展（酪神 audit 第二轮 — 剩余 12 个 coverb/generic FPs）：
 *   - 新增常见合同动作动词（使得/届时/附件/对外/兹向/持有/持股/偿还/加工/收购/兼并/审议/表决/改变/提前/提取/保证/设立/调整/分红/约定/分配/聘请/审批/减资/增资/利润/弥补/通过/签订/签署/终止/中止/委派/联系/任命/确认/催促/敦促/保持/持续）
 *
 * v3 扩展（酪神 audit 第三轮 — 剩余 23 个 coverb/start-end/generic FPs）：
 *   - 新增叙述性动词（制定/避免/尽力/促使/维护/竞争/提供/唆使/采取/保护/披露/滥用/盗用/包含/核查/针对/可能/有权/合理/努力/创始/处理/重大/作用/主管/尽最大/均应/若/涉及/知情/通知/督促）
 *   - 这些动词几乎不会出现在真公司名 body 中（真公司是静态名词组合）
 *   - 配合下面的 boundary check 联合处理边界 coverb（且/并/或/向/对/由/经/及/而/再/还/但/若/就/据/如 等）
 */
const ACTION_VERB_TRIGGERS = /(应当|必须|未经|未发生|不视为|代为|代持|履行|实施|办理|开展|进行|安排|寻求|诱使|拒绝|禁止|导致|违反|泄密|放弃|应付|应收|维持|经营|纳入|影响|承诺|损害|完成|变更|制订|聘任|解聘|转让|许可|授权|擅自|指定|批准|予以|给予|协助|配合|应促使|应确保|据此|按约|按照|应向|计入|属于|实际为|系为|变更为|并应办理|已经完成|使得|届时|附件|对外|兹向|持有|持股|偿还|加工|收购|兼并|审议|表决|改变|提前|提取|保证|设立|调整|分红|约定|分配|聘请|审批|减资|增资|利润|弥补|通过|签订|签署|终止|中止|委派|联系|任命|确认|催促|敦促|保持|持续|制定|避免|尽力|促使|维护|竞争|提供|唆使|采取|保护|披露|滥用|盗用|包含|核查|针对|可能|有权|合理|努力|创始|处理|重大|作用|主管|尽最大|均应|若|涉及|知情|通知|督促|归|均|尽|执行|取消|法规|监事|发现|可以|请求|人民法院|解散|注销|不得|侵占|借贷|他人|或者|申请|将|资金|财产|借款|增加|减少|确认|登记|事项|需要|根据|修改|对外|有权|制订|本次|对象|本公司|贵公司|邀请|申报|分摊|并购|同意|范围|原股东|补助|双方|加盖|包括|上述)/;

/**
 * 叙述性单字连词/介词/副词边界检查（酪神 audit 第三轮 — 23 个 coverb/start-end FPs 修复）
 *
 * 设计：真公司 body 边界（首/末字符）通常是地点/品牌/行业词（如"上海"/"阿里"/"京"/"科技"），
 *       不以叙述性单字连词/介词开头或结尾。
 *
 *   - body 开头：且/并/或/向/对/由/经/及/而/再/还/但/若/就/据/如/在/至/从/被/给/把/让/使
 *     （不放 "为" — "为" 单字在真公司中段如"华为"）
 *   - v_6thbatch：body 开头加 "的"（第六批 audit — 演员录制 "）的独家经纪公司或代理公司"）
 *     真公司 body 首字是地名/品牌（"美的集团" body 首字"美"），绝不以助词 "的" 开头
 *     → "的独家经纪公司或代理"（"）"被 cuttablePrefix 切后残留的描述性短语）→ ^的 → 拒
 *     注意：仅查首字符（^的），"美的集团" 的 "的" 在中段不受影响
 *   - body 末尾：且/并/或/向/对/由/为/经/及/而/再/还/但/若/就/据/如/在/至/从/被/给/把/让/使
 *     （放 "为" 在末尾 — body 末尾 "为" 后跟 form 是叙述短语如"青山资本为公司"）
 *
 * 23 个 FP 案例全部由 boundary check + 下方 "为X集团" 检查联合覆盖：
 *   - "且集团"/"就集团"/"据集团"/"并集团" → start coverb → 拒
 *   - "青山资本向"/"股权制定并经" → end coverb → 拒
 *   - "为集团"/"为所有集团" → "为X集团" specific → 拒
 */
const NARRATIVE_BOUNDARY_VERB_START = /^[且并或向对由经及而再还但若就据如在至从被给把让使致需的]/;
const NARRATIVE_BOUNDARY_VERB_END = /[且并或向对由为经及而再还但若就据如在至从被给把让使以]$/;

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
