/**
 * spy 提供的 zcool 法务修订 docx 真实误识别率测试
 *
 * 输入 docx: test-fixtures/work/sample-A/2022-8/【著作权转让书】品牌甲乙x占位作-NEO虚拟形象及品牌丙-法务修订0819.docx
 *
 * 任务：
 *   1. mammoth 提取纯文本（去除 <w:ins>/<w:del> 修订标记干扰）
 *   2. SensitiveFinder 跑默认规则（不带 keyword）
 *   3. 每个 match 列出来 + 上下文，让 spy 看 true/false positive
 *   4. 算误识别率（基于可信度判断）
 *
 * PUA 字节味：数据驱动，列数字 + 输出证据
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { BUILTIN_RULES } from '@/rules/BuiltinRules';
import { applyDocxEdits } from '@/utils/docxWriter';
import { readDocxFromArrayBuffer } from '@/utils/docxZipReader';

const SRC = 'test-fixtures/work/sample-A/2022-8/【著作权转让书】品牌甲乙x占位作-NEO虚拟形象及品牌丙-法务修订0819.docx';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

describe('spy 真实 zcool 法务 docx 误识别率审计', () => {
  it('PHASE 1: 提取文本 + 列所有 matches + 上下文', async () => {
    if (!fs.existsSync(SRC)) {
      console.log('⚠️ file not found:', SRC);
      return;
    }

    const buf = fs.readFileSync(SRC);
    const extract = await mammoth.extractRawText(mammothInput(buf));
    const text = extract.value;
    console.log(`\n=== 文本统计 ===`);
    console.log(`原文长度: ${text.length} chars`);
    console.log(`行数: ${text.split('\n').length}`);

    const finder = new SensitiveFinder();
    BUILTIN_RULES.forEach(r => finder.addRule({
      id: r.type,
      type: r.type,
      pattern: r.pattern,
      weight: r.weight,
      enabled: true,
    }));
    const result = finder.findSensitiveContent(text, { includeDisabled: true });
    const matches = result.matches;
    console.log(`\n=== 默认规则匹配总数: ${matches.length} ===`);
    console.log(`byType: ${JSON.stringify(result.byType)}`);

    // 按 type 分组列
    const byType: Record<string, typeof matches> = {};
    for (const m of matches) {
      if (!byType[m.type]) byType[m.type] = [];
      byType[m.type].push(m);
    }

    for (const [type, ms] of Object.entries(byType)) {
      console.log(`\n========== ${type}: ${ms.length} ==========`);
      for (const m of ms.slice(0, 30)) {  // 每类最多列 30 个，看完整的就好
        console.log(`  [${m.start}-${m.end}] "${m.value}"`);
        console.log(`    ctx: ...${m.context}...`);
      }
      if (ms.length > 30) console.log(`  ... 共 ${ms.length} 个，截断`);
    }
  }, 60000);

  it('PHASE 2: 应用 mask 后对比文本差异 + 误识别率分析', async () => {
    if (!fs.existsSync(SRC)) return;

    const buf = fs.readFileSync(SRC);
    const extract = await mammoth.extractRawText(mammothInput(buf));
    const text = extract.value;

    const finder = new SensitiveFinder();
    BUILTIN_RULES.forEach(r => finder.addRule({
      id: r.type,
      type: r.type,
      pattern: r.pattern,
      weight: r.weight,
      enabled: true,
    }));
    const result = finder.findSensitiveContent(text);
    const matches = result.matches;

    // 真实可疑为 false positive 的正则特征：
    //   PHONE: /^1[3-9]\d{9}$/ + 上下文不含 "电话""手机""联系" 等 → false positive 概率低
    //   ID_CARD: 标准 18 位 → 大概率 true
    //   EMAIL: 标准 @ → 大概率 true
    //   BANK_CARD: 19 位数字 → true
    //   IP: 标准 IP → 上下文含"IP""地址""服务器"等关键词 → true
    //   COMPANY: 含 "甲方""乙方""丙方"前缀或 "及其""和" 等 → false positive 概率较高
    //   ADDRESS: 含 "北京市""上海市" + 路街道号 → 大概率 true
    //   AMOUNT: 含 "¥""元""人民币" 或 "XXX万" → true
    //   AMOUNT_UPPER: 大写数字 → true
    //   NAME: 含常见姓氏 + 2-4 字 → true
    //   TAX_ID: 15-20 位字母数字 → true
    //   PROJECT_NAME: 含"项目" + 名称 → 上下文判断

    // 基于规则的 false positive 自动判定启发式
    const likelyFP: typeof matches = [];
    const likelyTP: typeof matches = [];

    for (const m of matches) {
      const v = m.value;
      let fp = false;

      // 启发式 1: COMPANY 包含 "甲方""乙方""丙方""XX方" 前缀 → FP
      // （如 "甲方公司""乙方律师"）— 但 "甲方为北京X公司" 中公司名是真
      if (m.type === 'COMPANY') {
        if (/^(?:甲方|乙方|丙方|丁方|戊方|己方|庚方|辛方|壬方|癸方)[\u4e00-\u9fa5]{0,4}(?:公司|集团|律师|事务所|代表|代理人)/.test(v)) {
          // 但 "甲方为XX公司" 形式 → 真，但 "甲方公司" "乙方律师" → FP
          if (/^(?:甲方|乙方|丙方|丁方).{0,3}$/.test(v) || /(?:律师|事务所|代理人)$/.test(v)) {
            fp = true;
          }
        }
        // COMPANY 含 "及其""和""与"等 → FP（但 post-filter 已处理，应该没剩）
        if (/[与和及其的了在为于而之则]/.test(v.replace(/(有限公司|股份有限公司|科技有限公司|投资有限公司|实业有限公司|商贸有限公司|分公司|公司|集团)$/, ''))) {
          fp = true;
        }
        // 含 "联系" "邮箱" "电话" + 公司名 → FP（不是真公司，是描述）
        if (/[联系邮箱电话].{0,5}(公司|集团)$/.test(v)) {
          fp = true;
        }
      }

      // 启发式 2: AMOUNT 数字超 8 位 → FP（如 "2022""15888888888" 数字串）
      if (m.type === 'AMOUNT' && /\d{8,}/.test(v.replace(/[^\d]/g, ''))) {
        fp = true;
      }

      // 启发式 3: ADDRESS 长度过短 → FP（少于 6 字可能不是地址）
      if (m.type === 'ADDRESS' && v.length < 8) {
        fp = true;
      }

      // 启发式 4: NAME 含 "某" 开头 → FP（如"某人""某某"）
      if (m.type === 'NAME' && /^[这那每某]/.test(v)) {
        fp = true;
      }

      // 启发式 5: PROJECT_NAME 含 "项目" → 真公司项目
      // 启发式 6: BANK_CARD 含字母 → FP
      if (m.type === 'BANK_CARD' && /[A-Za-z]/.test(v)) {
        fp = true;
      }

      if (fp) likelyFP.push(m);
      else likelyTP.push(m);
    }

    console.log(`\n=== 误识别率分析 ===`);
    console.log(`总 matches: ${matches.length}`);
    console.log(`likely TP: ${likelyTP.length}`);
    console.log(`likely FP: ${likelyFP.length}`);
    console.log(`误识别率（启发式）: ${(likelyFP.length / matches.length * 100).toFixed(1)}%`);

    if (likelyFP.length > 0) {
      console.log(`\n=== likely FP 列表（${likelyFP.length}） ===`);
      for (const m of likelyFP.slice(0, 30)) {
        console.log(`  [${m.type}] [${m.start}-${m.end}] "${m.value}" — ${m.context}`);
      }
    }

    // PHASE 3: 跑 applyDocxEdits 看替换前后文本，统计 mask 覆盖率
    console.log(`\n=== PHASE 3: applyDocxEdits 应用 mask ===`);
    const zipResult = await readDocxFromArrayBuffer(toArrayBuffer(buf));
    const documentXml = zipResult.documentXml;
    const edits = matches.map(m => ({
      maskedToken: m.value,
      originalValue: m.value,  // 这里只是占位 — 实际 mask 用 [TYPE_NNNN] token
    }));
    const newXml = applyDocxEdits(documentXml, edits);
    const docXmlLength = documentXml.length;
    const newXmlLength = newXml.length;
    console.log(`document.xml 长度: ${docXmlLength} chars`);
    console.log(`masked document.xml 长度: ${newXmlLength} chars`);
    console.log(`Δ: ${newXmlLength - docXmlLength} chars（masked token vs original 通常 original 长，所以 masked 短，预期 Δ < 0）`);
  }, 60000);
});
