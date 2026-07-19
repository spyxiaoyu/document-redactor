/**
 * spy 提供的多份真实 docx 误识别率审计
 *
 * 用法：
 *   1. 在 AUDIT_DOCS 数组中追加新 docx { name, path }
 *   2. 跑：npx vitest run src/rules/__tests__/RealDocxFPAudit.test.ts
 *
 * 当前已审计（commit d155449 后扩展）：
 *   - zcool-iQOO 著作权转让书（commit b2eb27a/05af7ec/8e9c686 修过）
 *   - SAMPLE-CO-F-设备采购-20240126（用户即时提供，验证 SPLIT + AMOUNT_UPPER/BANK_CARD 修复）
 *   - 中国说唱巅峰对决 后期结算补充协议（真实客户合同，含金额）
 *   - 三餐四季 节目委托服务协议（"委托" 模式，验证 mid-verb SPLIT 普适性）
 *   - 京城十二时辰 磋商邀请文件（招投标文档，多方主体）
 *   - 供应商承诺书（短文档，签名场景）
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { BUILTIN_RULES } from '@/rules/BuiltinRules';

interface AuditDoc { name: string; path: string }

const AUDIT_DOCS: AuditDoc[] = [
  {
    name: 'zcool-iQOO 著作权转让书',
    path: '<repo-path>/work/zcool/SAMPLE-CO-E【合同审查2022年度】/2022-8/【著作权转让书】iQOOxSAMPLE-CO-I-NEO虚拟形象及美图-法务修订0819.docx',
  },
  {
    name: 'SAMPLE-CO-F-设备采购-20240126',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2024年-岁月:SAMPLE-CO-H/【OA】费用:其他合同/【OA】设备采购合同 -20240126.docx',
  },
  {
    name: '中国说唱巅峰对决-后期结算补充协议',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《中国说唱巅峰对决2023》/【OA】《中国说唱巅峰对决2023》后期结算补充协议-20231115.docx',
  },
  {
    name: '三餐四季-节目委托服务协议',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《三餐四季》节目委托服务协议-中视&SAMPLE-CO-H-20231219.docx',
  },
  {
    name: '京城十二时辰-磋商邀请文件',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/其他盖章文件/招投标文件/京城十二时辰/《京城十二时辰》第三季后期制作服务磋商邀请文件.docx',
  },
  {
    name: '供应商承诺书',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/其他盖章文件/供应商承诺书.docx',
  },
];

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

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

describe.each(AUDIT_DOCS)('spy 真实 docx 误识别率审计: $name', (doc) => {
  it('PHASE 1: 列出所有 matches + 上下文 + 启发式 TP/FP 判定', async () => {
    if (!fs.existsSync(doc.path)) {
      console.log(`⚠️ ${doc.name}: file not found: ${doc.path}`);
      return;
    }

    const buf = fs.readFileSync(doc.path);
    const extract = await mammoth.extractRawText(mammothInput(buf));
    const text = extract.value;
    console.log(`\n=== ${doc.name} ===`);
    console.log(`原文长度: ${text.length} chars, 行数: ${text.split('\n').length}`);

    const finder = buildFinder();
    const result = finder.findSensitiveContent(text);
    const matches = result.matches;
    console.log(`默认规则匹配总数: ${matches.length}`);
    console.log(`byType: ${JSON.stringify(result.byType)}`);

    // 按类型分组
    const byType: Record<string, typeof matches> = {};
    for (const m of matches) {
      if (!byType[m.type]) byType[m.type] = [];
      byType[m.type].push(m);
    }

    for (const [type, ms] of Object.entries(byType)) {
      console.log(`\n---------- ${type}: ${ms.length} 个 ----------`);
      for (const m of ms) {
        console.log(`  [${m.start}-${m.end}] "${m.value}"`);
        console.log(`    ctx: ...${m.context}...`);
      }
    }

    // 启发式 FP 自动判定
    const likelyFP: typeof matches = [];
    const likelyTP: typeof matches = [];
    for (const m of matches) {
      const v = m.value;
      let fp = false;

      // COMPANY 启发式（与 zcool 测试相同）
      if (m.type === 'COMPANY') {
        if (/^(?:甲方|乙方|丙方|公司)$/.test(v.replace(/^[一-龥]{2,30}/, ''))) fp = true;
        if (/[与和及其了在出于而之则这那每该各自己诸何属]/.test(v.replace(/(有限公司|股份有限公司|科技有限公司|投资有限公司|实业有限公司|商贸有限公司|分公司|公司|集团)$/, ''))) fp = true;
      }
      if (m.type === 'AMOUNT' && /\d{8,}/.test(v.replace(/[^\d]/g, ''))) fp = true;
      if (m.type === 'ADDRESS' && v.length < 8) fp = true;
      if (m.type === 'NAME' && /^[这那每某]/.test(v)) fp = true;
      if (m.type === 'BANK_CARD' && /[A-Za-z]/.test(v)) fp = true;

      if (fp) likelyFP.push(m); else likelyTP.push(m);
    }

    console.log(`\n=== 启发式 FP 统计 ===`);
    console.log(`总: ${matches.length}, likely TP: ${likelyTP.length}, likely FP: ${likelyFP.length}`);
    if (likelyFP.length > 0) {
      console.log(`\n--- likely FP ${likelyFP.length} 个 ---`);
      for (const m of likelyFP) {
        console.log(`  [${m.type}] [${m.start}-${m.end}] "${m.value}" — ${m.context}`);
      }
    }
  }, 60000);
});
