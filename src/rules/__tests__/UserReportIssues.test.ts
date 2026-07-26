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