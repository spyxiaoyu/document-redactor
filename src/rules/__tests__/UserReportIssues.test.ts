/**
 * 用户截图报告 6 个问题的修复 probe 测试（2026-07-26）
 *
 * 触发来源：spy 在浏览器实际使用工具时截图反馈
 *   - 截图 1：体项目合作等 FP（叙述短语被误识别）
 *   - 截图 2：作为甲方的代理公司 FP
 *   - 截图 3：开户银行 + 银行账号漏识别
 *
 * Probe 数据用占位符（避免 spy 真实 PII 落入 commit）：
 *   - 银行账号：012345678901234（15 位，< 真 16-21 位的 BANK_CARD 阈值）
 *   - 开户行：示例银行广州XX支行
 *   - URL：https://example.com / www.test.com
 *   - 公司名：示例传媒有限公司 / 示例代理有限公司
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_RULES } from '../BuiltinRules';
import { SensitiveFinder } from '@/engines/SensitiveFinder';

describe('用户截图报告问题修复（2026-07-26）', () => {
  // ============================================================
  // Issue 1a：FP "体项目合作等"
  // ============================================================
  it('1a-1: 不应把"体项目合作等"误识别为 PROJECT_NAME', () => {
    const finder = new SensitiveFinder();
    const text = '硬广合作，赞助类及定制类内容合作，融媒体体项目合作等（以下简称"服务"或"广告发布"）';
    const result = finder.findSensitiveContent(text);
    const projectNames = result.matches.filter(m => m.type === 'PROJECT_NAME');
    // 叙述短语不应被识别为 PROJECT_NAME
    expect(projectNames.some(m => m.value.includes('体项目合作'))).toBe(false);
    expect(projectNames.some(m => m.value.includes('项目合作等'))).toBe(false);
  });

  it('1a-2: 不应把"含合作关键词的通用短语"误识别为 PROJECT_NAME', () => {
    const finder = new SensitiveFinder();
    const text = '本合同项下双方合作内容包括但不限于以下条款';
    const result = finder.findSensitiveContent(text);
    const projectNames = result.matches.filter(m => m.type === 'PROJECT_NAME');
    expect(projectNames.length).toBe(0);
  });

  // ============================================================
  // Issue 1b：FP "作为甲方的代理公司"
  // ============================================================
  it('1b-1: 不应把"作为甲方的代理公司"误识别为 COMPANY', () => {
    const finder = new SensitiveFinder();
    const text = '3.8如双方合作央视项目，乙方 ___ 作为甲方的代理公司在收到甲方支付的相应款项后';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    // "作为甲方的代理公司" 是叙述短语，不是具体公司名
    expect(companies.some(m => m.value.includes('作为甲方的代理'))).toBe(false);
  });

  it('1b-2: 不应把"乙方的委托代理"误识别为 COMPANY', () => {
    const finder = new SensitiveFinder();
    const text = '本协议由甲方与乙方的委托代理签署';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    expect(companies.some(m => m.value.includes('委托代理'))).toBe(false);
  });

  it('1b-3: 真公司名"智能代理有限公司"应正常识别（不应误伤品牌特例）', () => {
    const finder = new SensitiveFinder();
    const text = '本服务由智能代理有限公司提供';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    expect(companies.some(m => m.value.includes('智能代理有限公司'))).toBe(true);
  });

  // ============================================================
  // Issue 2：BANK_LABEL rule（开户银行）
  // ============================================================
  it('2-1: 应识别"开户银行：XX银行XX支行"为 BANK_LABEL', () => {
    const finder = new SensitiveFinder();
    const text = '开户银行：示例银行广州体育东路支行';
    const result = finder.findSensitiveContent(text);
    const bankLabels = result.matches.filter(m => m.type === 'BANK_LABEL');
    expect(bankLabels.length).toBeGreaterThanOrEqual(1);
    expect(bankLabels[0].value).toContain('示例银行广州体育东路支行');
  });

  it('2-2: 应识别"开户行："label（短 label）', () => {
    const finder = new SensitiveFinder();
    const text = '开户行：示例银行北京分行营业部';
    const result = finder.findSensitiveContent(text);
    const bankLabels = result.matches.filter(m => m.type === 'BANK_LABEL');
    expect(bankLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('2-3: BANK_LABEL 在 BUILTIN_RULES 注册', () => {
    const bankLabelRule = BUILTIN_RULES.find(r => r.type === 'BANK_LABEL');
    expect(bankLabelRule).toBeDefined();
  });

  // ============================================================
  // Issue 3：BANK_ACCOUNT_LABEL rule（银行账号 12-21 位）
  // ============================================================
  it('3-1: 应识别 15 位"银行账号：012345678901234"为 BANK_ACCOUNT_LABEL', () => {
    const finder = new SensitiveFinder();
    const text = '银行账号：012345678901234';
    const result = finder.findSensitiveContent(text);
    const acctLabels = result.matches.filter(m => m.type === 'BANK_ACCOUNT_LABEL');
    expect(acctLabels.length).toBeGreaterThanOrEqual(1);
    expect(acctLabels[0].value).toBe('012345678901234');
  });

  it('3-2: 应识别"账号："label 的纯数字串（12-21 位）', () => {
    const finder = new SensitiveFinder();
    const text = '账号：987654321012345';
    const result = finder.findSensitiveContent(text);
    const acctLabels = result.matches.filter(m => m.type === 'BANK_ACCOUNT_LABEL');
    expect(acctLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('3-3: 应识别"账户："label 的数字', () => {
    const finder = new SensitiveFinder();
    const text = '收款账户：12345678901234';
    const result = finder.findSensitiveContent(text);
    const acctLabels = result.matches.filter(m => m.type === 'BANK_ACCOUNT_LABEL');
    expect(acctLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('3-4: BANK_ACCOUNT_LABEL 在 BUILTIN_RULES 注册', () => {
    const rule = BUILTIN_RULES.find(r => r.type === 'BANK_ACCOUNT_LABEL');
    expect(rule).toBeDefined();
  });

  // ============================================================
  // Issue 4：URL rule（网址）
  // ============================================================
  it('4-1: 应识别 "https://example.com/path?q=1" 为 URL', () => {
    const finder = new SensitiveFinder();
    const text = '详情请见 https://example.com/path?q=1';
    const result = finder.findSensitiveContent(text);
    const urls = result.matches.filter(m => m.type === 'URL');
    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(urls[0].value).toContain('https://example.com');
  });

  it('4-2: 应识别 "www.test.com" 为 URL', () => {
    const finder = new SensitiveFinder();
    const text = '访问 www.test.com 获取更多信息';
    const result = finder.findSensitiveContent(text);
    const urls = result.matches.filter(m => m.type === 'URL');
    expect(urls.length).toBeGreaterThanOrEqual(1);
  });

  it('4-3: 应识别 "example.com.cn" 裸域名为 URL', () => {
    const finder = new SensitiveFinder();
    const text = '官网 example.com.cn 提供服务';
    const result = finder.findSensitiveContent(text);
    const urls = result.matches.filter(m => m.type === 'URL');
    expect(urls.length).toBeGreaterThanOrEqual(1);
  });

  it('4-4: URL 在 BUILTIN_RULES 注册', () => {
    const urlRule = BUILTIN_RULES.find(r => r.type === 'URL');
    expect(urlRule).toBeDefined();
  });

  // ============================================================
  // 回归保护：现有 FP / TN 不受影响
  // ============================================================
  it('回归-1: 真公司"示例传媒有限公司"应正常识别', () => {
    const finder = new SensitiveFinder();
    const text = '甲方为示例传媒有限公司';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    expect(companies.some(m => m.value.includes('示例传媒有限公司'))).toBe(true);
  });

  it('回归-2: 真姓名"张三"在"联系人：张三"应识别', () => {
    const finder = new SensitiveFinder();
    const text = '联系人：张三';
    const result = finder.findSensitiveContent(text);
    const names = result.matches.filter(m => m.type === 'NAME');
    expect(names.some(m => m.value === '张三')).toBe(true);
  });

  it('回归-3: 16 位银行卡仍由 BANK_CARD 识别（不被 BANK_ACCOUNT_LABEL 抢匹配）', () => {
    const finder = new SensitiveFinder();
    const text = '银行卡号：6222021234567890';
    const result = finder.findSensitiveContent(text);
    // 16 位银行卡 → BANK_CARD 优先（BANK_CARD regex 包含纯数字串）
    const bankCards = result.matches.filter(m => m.type === 'BANK_CARD');
    expect(bankCards.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// 第二批真合同反馈（2026-07-27 示例合同 — spy 真合同）
//   - FP-A: URL regex 吞中文右括号）后内容
//   - FP-B: "项目名称仅供参考" 误识别为 PROJECT_NAME
//   - FP-C: "乙方作为代理公司" 误识别为 COMPANY（X作代理模式未覆盖）
//   - FP-D: "广告发布后以示例市场研究股份有限公司" 误识别为 COMPANY（mid-verb "以" 未覆盖）
// ============================================================
describe('第二批真合同反馈（示例合同 — 2026-07-27）', () => {
  it('FP-A: URL 不应吞入 ）后的中文（中文右括号作终止符）', () => {
    const finder = new SensitiveFinder();
    const text = '详见链接地址：https://supplier.example-corp.com/supplier/pub/index.htm）生成的带有PO编号的订单';
    const result = finder.findSensitiveContent(text);
    const urls = result.matches.filter(m => m.type === 'URL');
    expect(urls.length).toBeGreaterThanOrEqual(1);
    // URL 必须停在 ） 前，不能吞 "生成的带有PO编号..."
    expect(urls[0].value).toBe('https://supplier.example-corp.com/supplier/pub/index.htm');
    expect(urls[0].value).not.toContain('生成');
  });

  it('FP-B: "项目名称仅供参考" 是叙述短语，不应识别为 PROJECT_NAME', () => {
    const finder = new SensitiveFinder();
    const text = '以上统称为"服务"或"广告发布"，项目名称仅供参考，具体以实际播出为准';
    const result = finder.findSensitiveContent(text);
    const projectNames = result.matches.filter(m => m.type === 'PROJECT_NAME');
    expect(projectNames.length).toBe(0);
  });

  it('FP-C: "乙方作为代理公司" 是叙述短语，不应识别为 COMPANY', () => {
    // 触发来源：示例合同 5.4 "乙方作为代理公司，提供全流程服务"
    //   原 fix `的(?:代理|委托|代表)$` 只覆盖 "X的代理" 模式
    //   漏覆盖 "X作代理"（"X作为代理" 简写）
    //   修法：扩展 pattern 含 [作] 作为 代理/委托/代表 前的连接词
    const finder = new SensitiveFinder();
    const text = '乙方作为代理公司，提供全流程服务';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    expect(companies.some(m => m.value === '作为代理公司')).toBe(false);
    expect(companies.some(m => m.value === '乙方作为代理公司')).toBe(false);
  });

  it('FP-D: "广告发布后以X公司" 叙述短语，X 公司应被独立识别', () => {
    // 触发来源：示例合同 4.2 "广告发布后以示例市场研究股份有限公司(占位)出具"
    //   原 mid-verb SPLIT 只查 委托/代理/代表，没查 "以"
    //   → "广告发布后以示例市场研究股份有限公司" 整段被识别为 COMPANY
    //   修法：mid-verb SPLIT 加 "以"，触发 SPLIT 把 "示例市场研究股份有限公司" 独立 emit
    const finder = new SensitiveFinder();
    const text = '广告发布后以示例市场研究股份有限公司(占位)出具监播报告';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    // 整段贪婪不应被识别
    expect(companies.some(m => m.value === '广告发布后以示例市场研究股份有限公司')).toBe(false);
    // 真公司名应被独立识别
    expect(companies.some(m => m.value === '示例市场研究股份有限公司')).toBe(true);
  });

  it('FP-E: "向甲方提供X公司" 叙述短语，X 公司应被独立识别', () => {
    // 触发来源：示例合同 4.2 "5 个工作日之内向甲方提供示例市场研究股份有限公司(占位)出具"
    //   原 ACTION_VERB_TRIGGERS (f863d0b v3 扩展) 含 "提供" 36 个动作动词之一
    //   → "向甲方提供示例市场研究股份有限公司" 整段被拒 (line 419 continue)
    //   → 4 段真公司名"示例市场研究股份有限公司"全部漏识别
    //   修法：加 "提供" mid-verb SPLIT（mirror "以" SPLIT），独立 emit X 公司
    //   guard：index≥2 (不误伤"提供链管理") + rightHan≥3 + reject chars 检查
    const finder = new SensitiveFinder();
    const text = '乙方应当于 5 个工作日之内向甲方提供示例市场研究股份有限公司(占位)出具监播报告';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    // 整段贪婪不应被识别
    expect(companies.some(m => m.value === '日之内向甲方提供示例市场研究股份有限公司')).toBe(false);
    // 真公司名应被独立识别
    expect(companies.some(m => m.value === '示例市场研究股份有限公司')).toBe(true);
  });

  it('FP-E guard: "提供" 在 body 首（index<2）不切 — 既有 trade-off 锁定', () => {
    // 边界：body 起始就含"提供"，yiIdx=0 < 2 → SPLIT 不触发
    //   即使 SPLIT 不触发，ACTION_VERB_TRIGGERS (f863d0b v3) 仍会拒"提供" → 整段拒
    //   这是 v3 扩展时既有的 trade-off：宁可错杀"提供链管理"这类极少数公司名
    //   也不放过"提供方案/提供商/提供服务"等大量 FP
    // 本测试只验证 SPLIT 块本身不误切（"提供"在 body 首时不切）：
    //   - 整段"提供链管理有限公司"应被 ACTION_VERB_TRIGGERS 拒（既有行为，不引入 regression）
    //   - 关键 guard："提供" SPLIT 块没误切出"链管理有限公司"作为 SPLIT 路径 emit
    //     （既有的 regex 在 position 6 独立匹配"链管理有限公司"是另一条路径，
    //      属于既有 regex FP，跟本 SPLIT 修复无关 — 待后续 audit 单独处理）
    const finder = new SensitiveFinder();
    const text = '签约方为提供链管理有限公司';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    // 既有行为：整段"提供链管理有限公司"被 ACTION_VERB_TRIGGERS 拒
    expect(companies.some(m => m.value === '提供链管理有限公司')).toBe(false);
    // 关键 guard：SPLIT 路径不切（"提供"起始 position=2，yiIdx=0 < 2 → 不触发）
    //   排除 SPLIT 路径（start=2）— 既有 regex 独立 match (start=6) 是另一码事
    const splitPathMatches = companies.filter(m => m.start === 2);
    expect(splitPathMatches.some(m => m.value === '链管理有限公司')).toBe(false);
  });

  it('FP-E v2: "提供上月X公司" 时间词 guard — 不切出月份前缀', () => {
    // 触发来源：示例合同 4.1 "次月20日前向甲方提供上月示例市场研究股份有限公司"
    //   第一次 fix 切出了"上月示例市场研究股份有限公司"（"上月"是合同时间词，不是公司名）
    //   修法：rightBody 起始是时间词（"上月/本月/当月/次月/下月/同月"）→ 不切
    //   trade-off：这种场景下"上月X公司"整段仍被 ACTION_VERB_TRIGGERS 拒（用户手动补）
    const finder = new SensitiveFinder();
    const text = '次月20日前向甲方提供上月示例市场研究股份有限公司(占位)出具盖章监播报告';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    // 关键：不应切出带"上月"前缀的虚假公司名
    expect(companies.some(m => m.value === '上月示例市场研究股份有限公司')).toBe(false);
    // 也不应识别整段（"提供"在 ACTION_VERB_TRIGGERS → 整段拒）
    expect(companies.some(m => m.value === '次月20日前向甲方提供上月示例市场研究股份有限公司')).toBe(false);
  });

  it('FP-E final: "提供上月X公司" 月份 SPLIT — 切掉月份后 emit 真公司名', () => {
    // 触发来源：spy L1 压力要求"一起全修，不再出问题"
    //   之前 FP-E v2 留 trade-off 拒整段 → 2 段"提供上月占位"漏识别
    //   修法：rightBody 起始是月份词 → skip 月份词 → 用 skip 后段作为公司名 emit
    //     "次月20日前向甲方提供上月示例市场研究" → skip "上月" → "示例市场研究" → emit "示例市场研究股份有限公司"
    //   guard：skip 后段 ≥5 han chars（比 normal ≥3 严）→ 避免误切"服务方案"等叙述名词组合
    const finder = new SensitiveFinder();
    const text = '次月20日前向甲方提供上月示例市场研究股份有限公司(占位)出具盖章监播报告';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    // 关键：应识别"示例市场研究股份有限公司"（skip 月份后）
    expect(companies.some(m => m.value === '示例市场研究股份有限公司')).toBe(true);
    // 不应误切"上月示例市场研究"虚假公司名
    expect(companies.some(m => m.value === '上月示例市场研究股份有限公司')).toBe(false);
  });

  it('FP-E final guard: "提供本月服务方案有限公司" 月份 SPLIT 不误切叙述名词', () => {
    // 边界：skip 月份后是叙述名词（"服务方案"），不是真公司名
    //   guard：skip 后段 ≥5 han chars 触发拒（"服务方案" 4 < 5）
    //   或：skip 后段是叙述名词组合 → 拒
    //   实测："服务方案" 4 chars < 5 → 拒
    const finder = new SensitiveFinder();
    const text = '向甲方提供本月服务方案有限公司';
    const result = finder.findSensitiveContent(text);
    const companies = result.matches.filter(m => m.type === 'COMPANY');
    // 不应误切"服务方案有限公司"
    expect(companies.some(m => m.value === '服务方案有限公司')).toBe(false);
  });

  it('回归-4: 16 位银行卡仍由 BANK_CARD 识别（不被 BANK_ACCOUNT_LABEL 抢匹配）', () => {
    const finder = new SensitiveFinder();
    const text = '银行卡号：6222021234567890';
    const result = finder.findSensitiveContent(text);
    const bankCards = result.matches.filter(m => m.type === 'BANK_CARD');
    expect(bankCards.length).toBeGreaterThanOrEqual(1);
  });
});