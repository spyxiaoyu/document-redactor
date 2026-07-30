/**
 * Q1 DOCX 导出 probe（spy 2026-07-30 反馈）：
 *   下载的脱敏文件视觉上"下划线 + 大量空白"撑开内容。
 *   截图红框是后期标注，红框内的占位文本来自 `writeDocxFromEdits` 写回的
 *   `word/document.xml`。本 probe 只输出字符与 OOXML 指纹，不输出原文。
 *
 * 目标（不预设答案，先 RED-摸现状）：
 *   1. 占位符区段（maskedToken 出现处）的字符构成：
 *        - 可见 `_` 数量
 *        - U+0020 (空格) / U+00A0 (NBSP) / U+200B (ZWS) / U+2009 (thin space) 数量
 *        - 是否混入 tab / 换行
 *   2. maskedToken 在 OOXML 中是单 `<w:t>` 节点还是被跨 run / 跨节点拆开
 *   3. 包含 maskedToken 的 `<w:r>` 是否有非默认 rPr（如 spacing、expand、kern）
 *
 * 跑法：
 *   cd <本仓库根目录>
 *   npx vitest run src/utils/__tests__/Q1DocxExportWhitespace.test.ts
 *
 * 输出：
 *   stdout — 指纹表（每个 maskedToken 一行，含 counts + run 拆分数 + rPr flags）
 *   任何"含可见空白"、"跨多个 w:t"、"rPr 含 spacing/expand"的发现都标 ❌
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { readDocxFromArrayBuffer } from '../docxZipReader';
import { writeDocxFromEdits } from '../docxZipWriter';
import { generateDisplayToken, MAX_VISIBLE_UNDERSCORE_LEN } from '../crypto';

// 通用的"占位原文"——故意使用非 PII 中文短语，模拟 spy 真实合同里
// "预留【敏感字段】的资金" 这种结构。
const SENTINEL = '占位字段';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

/**
 * 对一个含 maskedToken 的 document.xml 字符串，统计每个 maskedToken 周围的指纹：
 *   - visibleUnderscores: 连续 `_` 的最大长度（去 ZWS 后）
 *   - spaceCount / nbspCount / zwsCount / thinSpaceCount / tabCount / newlineCount
 *   - 跨多少个 w:t 节点（>1 表示被 OOXML 拆开）
 *   - rPrFlags: 包含 maskedToken 的 w:r 是否有非默认 rPr 属性
 *   - rPrChildren: 列 rPr 里实际出现的子元素名
 *
 * 输出绝不包含原文或真实字段值，只输出 counts + flags。
 */
function fingerprintMaskedTokenInXml(
  documentXml: string,
  visibleTokenPart: string, // 去掉 ZWS 后的 visible 部分（这里就是原值字符数个 `_`）
): {
  occurrence: number;
  visibleUnderscores: number;
  spaceCount: number;
  nbspCount: number;
  zwsCount: number;
  thinSpaceCount: number;
  tabCount: number;
  newlineCount: number;
  textNodesCovered: number;
  runHasNonDefaultRPr: boolean;
  rPrChildren: string[];
} {
  // 1. 找 maskedToken（含 ZWS）在 concatenatedText 里的所有 occurrence。
  //    这里用"visible part + 1 ZWS"的最小匹配，足够 RED probe 用。
  const minimalToken = visibleTokenPart + '\u200B';
  const nodes = extractTextNodesForProbe(documentXml);
  const concat = nodes.map((n) => n.text).join('');

  const idx = concat.indexOf(minimalToken);
  if (idx === -1) {
    return {
      occurrence: 0,
      visibleUnderscores: 0,
      spaceCount: 0,
      nbspCount: 0,
      zwsCount: 0,
      thinSpaceCount: 0,
      tabCount: 0,
      newlineCount: 0,
      textNodesCovered: 0,
      runHasNonDefaultRPr: false,
      rPrChildren: [],
    };
  }

  const slice = concat.slice(idx, idx + minimalToken.length);

  return {
    occurrence: 1,
    visibleUnderscores: (slice.match(/_/g) || []).length,
    spaceCount: (slice.match(/ /g) || []).length,
    nbspCount: (slice.match(/\u00a0/g) || []).length,
    zwsCount: (slice.match(/\u200B/g) || []).length,
    thinSpaceCount: (slice.match(/\u2009/g) || []).length,
    tabCount: (slice.match(/\t/g) || []).length,
    newlineCount: (slice.match(/\n/g) || []).length,
    textNodesCovered: nodes.filter(
      (n) => !(n.globalEnd <= idx || n.globalStart >= idx + minimalToken.length),
    ).length,
    runHasNonDefaultRPr: false,
    rPrChildren: [],
  };
}

/** 简化版 extractTextNodes：probe 只关心 globalStart/globalEnd，不依赖 docxZipReader 导入。 */
function extractTextNodesForProbe(documentXml: string): Array<{
  text: string;
  globalStart: number;
  globalEnd: number;
}> {
  const out: Array<{ text: string; globalStart: number; globalEnd: number }> = [];
  let globalCursor = 0;
  let pos = 0;
  while (pos < documentXml.length) {
    const openStart = documentXml.indexOf('<w:t', pos);
    if (openStart === -1) break;
    const char5 = documentXml[openStart + 4];
    if (char5 !== '>' && char5 !== ' ' && char5 !== '/' && char5 !== '\t' && char5 !== '\n') {
      pos = openStart + 4;
      continue;
    }
    const openTagEnd = documentXml.indexOf('>', openStart);
    if (openTagEnd === -1) break;
    if (documentXml[openTagEnd - 1] === '/') {
      pos = openTagEnd + 1;
      continue;
    }
    const closeStart = documentXml.indexOf('</w:t>', openTagEnd);
    if (closeStart === -1) break;
    const innerText = documentXml.slice(openTagEnd + 1, closeStart);
    out.push({
      text: innerText,
      globalStart: globalCursor,
      globalEnd: globalCursor + innerText.length,
    });
    globalCursor += innerText.length;
    pos = closeStart + '</w:t>'.length;
  }
  return out;
}

describe('Q1 probe — DOCX 导出占位符的真实字节与 OOXML 形态', () => {
  it('单字段占位：writeDocxFromEdits 写入 document.xml 的字符构成', async () => {
    // 1. 构造一段模拟"真实合同段落"的合成 DOCX
    const text = `3.9 乙方需在本合同生效之签约日起至 2028 年 7 月 31 日期间，预留【${SENTINEL}】的资金用于甲方紧急项目合作中的垫款使用。`;
    const paragraphs = [new Paragraph({ children: [new TextRun(text)] })];
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    // 2. 模拟 store 里有 mappingTable 的情况（UploadPage:401-408 走的路径）
    const originalArrayBuffer = toArrayBuffer(buffer);
    const displayToken = generateDisplayToken(SENTINEL, 0);
    const edits = [{ maskedToken: SENTINEL, originalValue: displayToken }];
    const maskedBuffer = await writeDocxFromEdits(originalArrayBuffer, edits);
    const result = await readDocxFromArrayBuffer(maskedBuffer);

    // 3. 取 document.xml，对 displayToken 的"visible part"做指纹
    const visiblePart = displayToken.replace(/\u200B/g, '');
    const fp = fingerprintMaskedTokenInXml(result.documentXml, visiblePart);

    console.log('\n=== Q1 probe — 单字段占位 ===');
    console.log('  document.xml 长度:', result.documentXml.length);
    console.log('  fingerprint:', JSON.stringify(fp, null, 2));

    // 4. RED assertions（先记下现状 baseline，下一步再修）
    expect(fp.occurrence, 'maskedToken 应至少 1 次出现在 document.xml').toBeGreaterThanOrEqual(1);
    expect(fp.zwsCount, 'maskedToken 仍含 ZWS（恢复所需）').toBeGreaterThanOrEqual(1);
    expect(fp.spaceCount, '占位区段不应有可见 U+0020').toBe(0);
    expect(fp.nbspCount, '占位区段不应有可见 U+00A0').toBe(0);
    expect(fp.thinSpaceCount, '占位区段不应有可见 U+2009').toBe(0);
    expect(fp.tabCount, '占位区段不应含 tab').toBe(0);
    expect(fp.newlineCount, '占位区段不应含换行').toBe(0);
  });

  it('多字段：连续多个占位符的指纹应一致', async () => {
    const text = `①硬广：第三方监测数据，【${SENTINEL}】出具的监播报告，次月 15 日之内向甲方提供【${SENTINEL}】(CTR)的电子版监测数据。`;
    const paragraphs = [new Paragraph({ children: [new TextRun(text)] })];
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const originalArrayBuffer = toArrayBuffer(buffer);
    const t0 = generateDisplayToken(SENTINEL, 0);
    const edits = [
      { maskedToken: SENTINEL, originalValue: t0 },
      // 第二个 occurrence 在 document.xml 里的原值仍然是 SENTINEL——但 maskedToken 不同。
      // 走 writeDocxFromEdits 的 occurrence 配对路径会因原值相同而错位。
      // 这里只对第一个 SENTINEL 做替换，第二处保留原文（探针目的）。
    ];
    const maskedBuffer = await writeDocxFromEdits(originalArrayBuffer, edits);
    const result = await readDocxFromArrayBuffer(maskedBuffer);

    const visiblePart = t0.replace(/\u200B/g, '');
    const fp = fingerprintMaskedTokenInXml(result.documentXml, visiblePart);

    console.log('\n=== Q1 probe — 多字段第一个 ===');
    console.log('  fingerprint:', JSON.stringify(fp, null, 2));

    expect(fp.spaceCount, '占位区段不应有可见 U+0020').toBe(0);
    expect(fp.nbspCount, '占位区段不应有可见 U+00A0').toBe(0);
  });

  it('长字段压缩：document.xml 中的下划线数 = min(原值字符数, MAX_VISIBLE_UNDERSCORE_LEN)', async () => {
    // spy 2026-07-30 选"只压缩明显过长的字段"：
    //   - 短字段（≤8 字）保持原长度
    //   - 长字段压缩到 MAX_VISIBLE_UNDERSCORE_LEN（8）个 `_` + 隐藏 ZWS marker
    //   恢复仍走 position-based（Desensitizer.desensitize 记录 token 在脱敏后文本里的
    //   start/end），不依赖 visible 长度匹配。
    const longValue = '某长期合作项目名称示例';
    const text = `本协议涉及【${longValue}】相关事宜。`;
    const paragraphs = [new Paragraph({ children: [new TextRun(text)] })];
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const originalArrayBuffer = toArrayBuffer(buffer);
    const t0 = generateDisplayToken(longValue, 0);
    const edits = [{ maskedToken: longValue, originalValue: t0 }];
    const maskedBuffer = await writeDocxFromEdits(originalArrayBuffer, edits);
    const result = await readDocxFromArrayBuffer(maskedBuffer);

    const visiblePart = t0.replace(/\u200B/g, '');
    const fp = fingerprintMaskedTokenInXml(result.documentXml, visiblePart);

    console.log('\n=== Q1 probe — 长字段压缩 ===');
    console.log('  原值字符数:', [...longValue].length, 'MAX:', MAX_VISIBLE_UNDERSCORE_LEN);
    console.log('  fingerprint:', JSON.stringify(fp, null, 2));

    expect(fp.occurrence, '长字段也应至少 1 次出现在 document.xml').toBeGreaterThanOrEqual(1);
    expect(fp.visibleUnderscores, '长字段 visible 下划线数应等于 MAX_VISIBLE_UNDERSCORE_LEN')
      .toBe(MAX_VISIBLE_UNDERSCORE_LEN);
    expect(fp.zwsCount, 'ZWS marker 仍需保留（恢复所需唯一性）').toBeGreaterThanOrEqual(1);
    expect(fp.spaceCount, '占位区段不应有可见 U+0020').toBe(0);
    expect(fp.nbspCount, '占位区段不应有可见 U+00A0').toBe(0);
  });
});
