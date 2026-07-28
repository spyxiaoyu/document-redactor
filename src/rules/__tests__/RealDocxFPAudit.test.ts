/**
 * fixture docx 误识别率审计（test-fixtures/ 内 .gitignore 文件，不进 git）
 *
 * 用法：
 *   1. 在 AUDIT_DOCS 数组中追加新 docx { name, path }
 *   2. 跑：npx vitest run src/rules/__tests__/RealDocxFPAudit.test.ts
 *
 * 设计：
 *   - fixture 文件不入 git，但测试代码本身是 audit harness
 *   - 跑测试时若 fixture 路径不存在 → 跳过（"file not found"）不影响 CI
 *   - 覆盖场景：著作权转让/节目委托/招投标磋商/增资协议/后期制作/政策申请等
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { BUILTIN_RULES } from '@/rules/BuiltinRules';

interface AuditDoc { name: string; path: string }

const AUDIT_DOCS: AuditDoc[] = [
  {
    name: 'fixture-A-著作权转让书',
    path: 'test-fixtures/file/work/fixture-A/著作权转让书.docx',
  },
  {
    name: 'fixture-A-设备采购-2024',
    path: 'test-fixtures/file/work/fixture-A/设备采购合同.docx',
  },
  {
    name: 'fixture-A-节目后期结算',
    path: 'test-fixtures/file/work/fixture-A/节目后期结算补充协议.docx',
  },
  {
    name: 'fixture-A-节目委托',
    path: 'test-fixtures/file/work/fixture-A/节目委托服务协议.docx',
  },
  {
    name: 'fixture-A-招投标磋商',
    path: 'test-fixtures/file/work/fixture-A/招投标磋商邀请文件.docx',
  },
  {
    name: 'fixture-A-供应商承诺书',
    path: 'test-fixtures/file/work/fixture-A/供应商承诺书.docx',
  },
  {
    name: 'fixture-A-增资协议',
    path: 'test-fixtures/file/work/fixture-A/增资协议_Final.docx',
  },
  {
    name: 'fixture-A-公司章程',
    path: 'test-fixtures/file/work/fixture-A/公司章程_Final.docx',
  },
  {
    name: 'fixture-A-节目补充协议',
    path: 'test-fixtures/file/work/fixture-A/节目补充协议.docx',
  },
  {
    name: 'fixture-A-后期制作',
    path: 'test-fixtures/file/work/fixture-A/后期制作合同.docx',
  },
  {
    name: 'fixture-A-政策申请承诺书',
    path: 'test-fixtures/file/work/fixture-A/政策申请承诺书.docx',
  },
  {
    name: 'fixture-A-大型后期',
    path: 'test-fixtures/file/work/fixture-A/大型后期制作合同.docx',
  },
  {
    name: 'fixture-A-前期策划',
    path: 'test-fixtures/file/work/fixture-A/前期策划服务合同.docx',
  },
  {
    name: 'fixture-A-编剧策划',
    path: 'test-fixtures/file/work/fixture-A/编剧策划服务合同.docx',
  },
  {
    name: 'fixture-A-节目类-大型晚会后期',
    path: 'test-fixtures/file/work/fixture-A/大型晚会后期.docx',
  },
  {
    name: 'fixture-A-客户A-元宇宙',
    path: 'test-fixtures/file/work/fixture-A/客户A元宇宙后期.docx',
  },
  {
    name: 'fixture-A-短视频后期',
    path: 'test-fixtures/file/work/fixture-A/短视频后期.docx',
  },
  {
    name: 'fixture-A-客户B-视频制作',
    path: 'test-fixtures/file/work/fixture-A/客户B视频制作.docx',
  },
  {
    name: 'fixture-A-产权持有人承诺函',
    path: 'test-fixtures/file/work/fixture-A/产权持有人承诺函.docx',
  },
  {
    name: 'fixture-A-供应商剪辑-50万',
    path: 'test-fixtures/file/work/fixture-A/供应商剪辑50万.docx',
  },
  {
    name: 'fixture-A-磋商邀请文件',
    path: 'test-fixtures/file/work/fixture-A/磋商邀请文件.docx',
  },
  {
    name: 'fixture-A-有关事项说明',
    path: 'test-fixtures/file/work/fixture-A/有关事项说明.docx',
  },
  {
    name: 'fixture-A-情况说明',
    path: 'test-fixtures/file/work/fixture-A/情况说明.docx',
  },
  {
    name: 'fixture-A-声明模板',
    path: 'test-fixtures/file/work/fixture-A/声明模板.docx',
  },
  {
    name: 'fixture-A-费用明细',
    path: 'test-fixtures/file/work/fixture-A/费用明细.docx',
  },
  {
    name: 'fixture-A-供应商剪辑-85万',
    path: 'test-fixtures/file/work/fixture-A/供应商剪辑85万.docx',
  },
  {
    name: 'fixture-A-摄像委托',
    path: 'test-fixtures/file/work/fixture-A/摄像委托服务协议.docx',
  },
  {
    name: 'fixture-A-非遗委托制作',
    path: 'test-fixtures/file/work/fixture-A/非遗委托制作合同.docx',
  },
  {
    name: 'fixture-A-客户C-直播',
    path: 'test-fixtures/file/work/fixture-A/客户C直播定制.docx',
  },
  {
    name: 'fixture-A-客户D-财经项目',
    path: 'test-fixtures/file/work/fixture-A/客户D财经项目.docx',
  },
  {
    name: 'fixture-A-达人合作',
    path: 'test-fixtures/file/work/fixture-A/达人合作协议.docx',
  },
  {
    name: 'fixture-A-演员录制',
    path: 'test-fixtures/file/work/fixture-A/演员录制合同.docx',
  },
  {
    name: 'fixture-A-终止协议',
    path: 'test-fixtures/file/work/fixture-A/终止协议.docx',
  },
  {
    name: 'fixture-A-客户E-合作协议',
    path: 'test-fixtures/file/work/fixture-A/客户E合作协议.docx',
  },
  {
    name: 'fixture-A-保证合同',
    path: 'test-fixtures/file/work/fixture-A/保证合同-股东会决议.docx',
  },
  {
    name: 'fixture-A-内部借款',
    path: 'test-fixtures/file/work/fixture-A/内部借款协议.docx',
  },
  {
    name: 'fixture-A-品牌咨询',
    path: 'test-fixtures/file/work/fixture-A/品牌咨询服务合同.docx',
  },
  {
    name: 'fixture-A-顾问咨询',
    path: 'test-fixtures/file/work/fixture-A/顾问咨询协议.docx',
  },
  {
    name: 'fixture-A-催款函',
    path: 'test-fixtures/file/work/fixture-A/催款函.docx',
  },
  {
    name: 'fixture-A-股东会决议',
    path: 'test-fixtures/file/work/fixture-A/股东会决议.docx',
  },
  {
    name: 'fixture-A-房屋装修',
    path: 'test-fixtures/file/work/fixture-A/房屋装修合同.docx',
  },
  {
    name: 'fixture-A-弱电施工',
    path: 'test-fixtures/file/work/fixture-A/弱电施工合同.docx',
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

describe.each(AUDIT_DOCS)('fixture docx 误识别率审计: $name', (doc) => {
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
      // AMOUNT FP：纯数字 ≥10 位且无小数点 → 像电话号码格式才判 FP
      //   旧逻辑 /\d{8,}/ 把 ¥2,744,306.00 (9 位) 和 2,645,059.15 (9 位) 这种真大金额
      //   （2.7亿/264万）误判为 FP —— 启发式太宽
      //   新阈值 10 位 + 必须无小数点：电话号码 11 位无小数点 → FP；
      //   真金额必有 .xx 分位（¥X.XX / X.XX 元）→ 不算 FP
      if (m.type === 'AMOUNT') {
        const digits = v.replace(/[^\d]/g, '');
        if (digits.length >= 10 && !/\./.test(v)) fp = true;
      }
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
