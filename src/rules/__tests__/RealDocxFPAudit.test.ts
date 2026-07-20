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
  {
    // spy 2026-07-19 提供：投融资类（增资协议）— 验证股份/估值/投资金额/股东/章程引用场景
    name: 'SAMPLE-CO-J_Pre-A_增资协议_Final',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-F-合同:文件/5、SAMPLE-CO-F-投融资/投资-SAMPLE-CO-J/2023年/【OA】酪神_Pre-A轮交易文件及交割文件_Final/交易文件/1. SAMPLE-CO-J_增资协议_Final.docx',
  },
  {
    // spy 2026-07-19 提供：投融资类（公司章程）— 验证股东信息/股权结构/出资额场景
    name: 'SAMPLE-CO-J_公司章程_Final',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-F-合同:文件/5、SAMPLE-CO-F-投融资/投资-SAMPLE-CO-J/2023年/【OA】酪神_Pre-A轮交易文件及交割文件_Final/交易文件/3. SAMPLE-CO-J_公司章程_Final.docx',
  },
  {
    // 2026-07-20 spy 扩展：补充协议类（"开播！情景喜剧"）
    name: '开播情景喜剧-第二季后期补充协议二',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《开播！情景喜剧》第二季后期补充协议（二）20231124.docx',
  },
  {
    // 2026-07-20 spy 扩展：标准后期制作合同（"青山未满"）
    name: '青山未满-后期制作合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《青山未满》后期制作合同.docx',
  },
  {
    // 2026-07-20 spy 扩展：政府公文类（朝阳区产业政策承诺书）
    name: '朝阳区产业政策申请承诺书',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/其他盖章文件/【OA】朝阳区产业政策补贴申请材料/附件5 朝阳区产业政策申请承诺书（2023）.docx',
  },
  {
    // 2026-07-20 spy 扩展：大型后期制作合同（"2022示例尖叫之夜"）
    name: '2022示例尖叫之夜-后期制作合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《2022示例尖叫之夜》后期制作合同-千秋岁.docx',
  },
  {
    // 2026-07-20 spy 第二批扩展：前期策划服务合同（大写金额 150万）
    name: '宗师列传唐宋八大家-前期策划服务合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《宗师列传之唐宋八大家》前期策划服务合同150万元-花里慧智&SAMPLE-CO-H-20231227.docx',
  },
  {
    // 2026-07-20 spy 第二批：影视化编剧策划服务合同（大金额 464.98万，未签署）
    name: '宗师列传唐宋八大家-影视化编剧策划服务合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《宗师列传·唐宋八大家》影视化编剧策划服务合同464.98万元-花里慧智&SAMPLE-CO-H【未签署】.docx',
  },
  {
    // 2026-07-20 spy 第二批：网络春晚后期制作合同
    name: '23年网络春晚-节目后期制作合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《23年网络春晚》节目后期制作合同.docx',
  },
  {
    // 2026-07-20 spy 第二批：百度客户（元宇宙之夜）
    name: '百度沸点元宇宙之夜-后期制作合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《百度沸点元宇宙之夜》后期制作合同（V1.0）.docx',
  },
  {
    // 2026-07-20 spy 第二批：抖音短视频（车澈）
    name: '短视频后期制作服务合同-车澈抖音',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】短视频后期制作服务合同-车澈抖音/【230906】短视频后期制作服务合同-SAMPLE-CO-H（V3.0）.docx',
  },
  {
    // 2026-07-20 spy 第二批：蚂蚁客户（燃烧吧天才程序员）
    name: '蚂蚁燃烧吧天才程序员-视频制作及宣传推广服务合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】蚂蚁《燃烧吧天才程序员》后期制作/视频制作及宣传推广服务合同-对战赛后期制作.docx',
  },
  {
    // 2026-07-20 spy 第二批：承诺函类（产权持有人承诺函）
    name: '产权持有人承诺函-SAMPLE-CO-K',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/其他盖章文件/岁月资产评估资料/SAMPLE-CO-K-打印资料2/0附件资料/附件3产权持有人承诺函-SAMPLE-CO-K（公章、法人签章、空着日期）.docx',
  },
  {
    // 2026-07-20 spy 第二批：供应商剪辑合同（唐宋八大家 50万 青年王国）
    name: '唐宋八大家-50万剪辑合同-青年王国',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/供应商合同/【OA】《唐宋八大家》50万剪辑合同 -青年王国.docx',
  },
  {
    // 2026-07-20 spy 第三批：招投标磋商邀请文件（多主体，最美中轴线第三季）
    name: '最美中轴线第三季-磋商邀请文件',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/其他盖章文件/招投标文件/最美中轴线第三季/《最美中轴线》第三季后期制作服务磋商邀请文件.docx',
  },
  {
    // 2026-07-20 spy 第三批：资产评估说明类（有关事项说明）
    name: '有关事项说明6.1V2',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/其他盖章文件/岁月资产评估资料/SAMPLE-CO-K-打印资料2/0附件资料/3有关事项说明6.1V2.docx',
  },
  {
    // 2026-07-20 spy 第三批：情况说明类（文创证明）
    name: '情况说明-文创证明',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/其他盖章文件/配合海淀科技提供资料清单/1. 情况说明（文创证明并提供合同、发票等证明材料）.docx',
  },
  {
    // 2026-07-20 spy 第三批：声明模板类（不涉及前置审批声明）
    name: '不涉及前置审批的声明模板',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/其他盖章文件/【OA】朝阳区产业政策补贴申请材料/附件4 不涉及前置审批的声明模板（2023）.docx',
  },
  {
    // 2026-07-20 spy 第三批：纯费用明细附件（中国中医药大会）
    name: '中国中医药大会-费用明细后期包装',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】《中国中医药大会》/【OA】附件一：费用明细-后期、包装.docx',
  },
  {
    // 2026-07-20 spy 第三批：供应商剪辑合同（全力以赴 85万）
    name: '全力以赴行动派第二季-85万剪辑合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/供应商合同/【OA】《全力以赴行动派第二季 》85万剪辑合同.docx',
  },
  {
    // 2026-07-20 spy 第三批：供应商摄像委托（星光大道 27.3万）
    name: '星光大道-摄像委托服务协议',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/供应商合同/【OA】《星光大道》摄像委托服务协议-27.3万.docx',
  },
  {
    // 2026-07-20 spy 第三批：委托制作合同（非遗贵州篇）
    name: '非遗贵州篇-委托制作合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-K-合同:文件/2023年-岁月:SAMPLE-CO-H/【OA】节目制作/客户合同/【OA】非遗贵州篇—委托制作合同—SAMPLE-CO-K20231204.docx',
  },
  {
    // 2026-07-20 spy 第四批：方太客户-2023 央视直播定制合同（厨电+央视，验证新客户类型）
    name: '方太2023-央视新闻直播定制合同',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-F-合同:文件/1、客户合同/其他客户合同/方太/2023年-方太/2023方太-央视直播/审核稿/方太-2023年央视新闻直播定制合同-3r-FW20230213.docx',
  },
  {
    // 2026-07-20 spy 第四批：五粮液-SAMPLE-CO-M项目合同（酒类客户，验证新行业）
    name: '五粮液-SAMPLE-CO-M项目合同',
    path: '<repo-path>/work/SAMPLE-CO-F/暂不交接/SAMPLE-CO-F【历史合同】/客户合同/五粮液/五粮液SAMPLE-CO-M项目合同（客户版）.docx',
  },
  {
    // 2026-07-20 spy 第四批：一汀&SAMPLE-CO-F达人合作协议（茅台品牌推广目录，验证自然人达人合作）
    name: '一汀-SAMPLE-CO-F达人合作协议',
    path: '<repo-path>/模板/茅台品牌推广、公关、公众号运营/（定稿）20250515一汀&SAMPLE-CO-F达人合作协议-财务修订版.docx',
  },
  {
    // 2026-07-20 spy 第四批：演员录制合同-个人模板（自然人主导合同，验证 NAME/ADDRESS 边界）
    name: '演员录制合同-个人模板',
    path: '<repo-path>/模板/艺人合同/演员录制合同-个人.docx',
  },
  {
    // 2026-07-20 spy 第四批：终止协议-方太 2025（终止类合同，验证甲方/乙方交替叙述）
    name: '终止协议-方太2025',
    path: '<repo-path>/work/SAMPLE-CO-F/交接文件/SAMPLE-CO-F-合同:文件/1、客户合同/其他客户合同/方太/2025年-方太/方太腾讯剧植项目遗留问题/终止协议-方太-20250624.docx',
  },
  {
    // 2026-07-20 spy 第四批：中国旅游报社合作协议（央媒事业单位，验证新型主体）
    name: '中国旅游报社-合作协议',
    path: '<repo-path>/模板/茅台品牌推广、公关、公众号运营/（定稿）中国旅游报社合作协议 (1).docx',
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
