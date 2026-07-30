/**
 * Q1 真因 probe v2（spy 2026-07-30 反馈，已更新路径）：
 *   旧假设（probe v1）：maskedToken 区间内有 U+0020 漏出。
 *     → 实测 fingerprint：spy's 真合同 13【】 brackets，0 ZWS, 83 U+0020
 *       全部分布在【】括号内的"padding"位置（即原值前后多空格填充）。
 *
 *   修正后真因：
 *     - edits = [{ maskedToken: 原值, originalValue: '________' }]
 *     - 原 docx innerText = `【  占位字段  】`（【】 内多空格填充）
 *     - applyDocxEdits 用 indexOf(maskedToken) → 命中 [globalStart, globalStart+4)
 *     - 替换 [globalStart, globalStart+4) = `________` → 结果 `【  ________  】`
 *     - Word 渲染：8 _ + 2 空格 + 2 空格 = "短下划线 + 长段空白"
 *
 *   修法目标：在 applyDocxEdits 替换 maskedToken 时，**trim 紧邻的 U+0020/U+3000/TAB**
 *     （前提：trim 范围不超过阈值，避免破坏段落分隔）。
 *     - 输入：`见【  占位字段  】。`
 *     - 期望输出（spy 视觉目标）：`见【________】。`
 *
 * 跑法：
 *   cd <仓库根>
 *   npx vitest run src/utils/__tests__/Q1DocxMultiSpacePadding.probe.test.ts
 */
import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { readDocxFromArrayBuffer } from '../docxZipReader';
import { writeDocxFromEdits } from '../docxZipWriter';
import { generateDisplayToken } from '../crypto';

const SENTINEL = '占位字段'; // 4 字短字段，触发"等宽压缩到 4 个 _"

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

/**
 * 提取 document.xml 里所有 <w:t> 节点的 innerText 串联，
 * 用来检查"占位符周围是否还有 U+0020/U+3000/TAB"。
 */
function extractAllInnerText(documentXml: string): string {
  const out: string[] = [];
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
    out.push(documentXml.slice(openTagEnd + 1, closeStart));
    pos = closeStart + '</w:t>'.length;
  }
  return out.join('');
}

describe('Q1 真因 probe v2 — 多空格 padding 场景', () => {
  it('【】 内 2 空格填充：替换后 innerText 不应有"短下划线 + 长段空白"', async () => {
    // 1. 合成 docx：原 innerText = `见【  占位字段  】。`（【 内左右各 2 U+0020）
    const text = `见【  ${SENTINEL}  】。`;
    const paragraphs = [new Paragraph({ children: [new TextRun(text)] })];
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    // 2. 模拟 UploadPage handleDownload 的 edits：
    //    maskedToken = 原值（4 字），originalValue = 4 个 `_` + ZWS marker
    const originalArrayBuffer = toArrayBuffer(buffer);
    const displayToken = generateDisplayToken(SENTINEL, 0); // 4 _ + 1 ZWS（index=0）
    const edits = [{ maskedToken: SENTINEL, originalValue: displayToken }];

    // 3. 走 writeDocxFromEdits（B 方案主路径：applyDocxEdits 替换原值 → 占位符）
    const maskedBuffer = await writeDocxFromEdits(originalArrayBuffer, edits);
    const result = await readDocxFromArrayBuffer(maskedBuffer);

    // 4. 提取 document.xml 所有 innerText，检查占位符周围是否还有 U+0020
    const allInnerText = extractAllInnerText(result.documentXml);
    console.log('\n=== Q1 probe v2 — 多空格填充 RED ===');
    console.log('  原 innerText (期望):', `见【________】。`);  // 不输出真实值
    console.log('  实际 innerText 长度:', allInnerText.length);

    // 找到占位符（4 个 `_`）的位置
    const placeholderStart = allInnerText.indexOf('____');
    expect(placeholderStart, '占位符应在 innerText 里').toBeGreaterThanOrEqual(0);

    // 关键断言：占位符紧邻字符不应是 U+0020 / U+3000 / TAB
    const charBefore = placeholderStart > 0 ? allInnerText[placeholderStart - 1] : '';
    const charAfter =
      placeholderStart + 4 < allInnerText.length ? allInnerText[placeholderStart + 4] : '';
    const cpBefore = (charBefore.codePointAt(0) ?? 0).toString(16).padStart(4, '0');
    const cpAfter = (charAfter.codePointAt(0) ?? 0).toString(16).padStart(4, '0');
    console.log('  占位符前字符 codepoint:', charBefore ? `U+${cpBefore}` : 'N/A');
    console.log('  占位符后字符 codepoint:', charAfter ? `U+${cpAfter}` : 'N/A');

    expect(
      charBefore,
      `占位符前不应有 U+0020 / U+3000 / TAB（spy's "长段空白"真因）。实际: ${charBefore ? `U+${cpBefore}` : 'NONE'}`,
    ).not.toMatch(/[\u0020\u3000\t]/);
    expect(
      charAfter,
      `占位符后不应有 U+0020 / U+3000 / TAB。实际: ${charAfter ? `U+${cpAfter}` : 'NONE'}`,
    ).not.toMatch(/[\u0020\u3000\t]/);
  });

  it('长字段压缩：18 字 → 8 _，padding 空格应被 trim', async () => {
    const longValue = '某长期合作项目名称示例'; // 11 字（4 字 + 4 字 + 3 字 = 11）
    const text = `本协议涉及【  ${longValue}  】相关事宜。`;
    const paragraphs = [new Paragraph({ children: [new TextRun(text)] })];
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const originalArrayBuffer = toArrayBuffer(buffer);
    const displayToken = generateDisplayToken(longValue, 0); // 8 _ + ZWS（压缩）
    const edits = [{ maskedToken: longValue, originalValue: displayToken }];

    const maskedBuffer = await writeDocxFromEdits(originalArrayBuffer, edits);
    const result = await readDocxFromArrayBuffer(maskedBuffer);

    const allInnerText = extractAllInnerText(result.documentXml);
    console.log('\n=== Q1 probe v2 — 长字段压缩 + 多空格 ===');
    console.log('  原 innerText (期望): `本协议涉及【________】相关事宜。`');

    const placeholderStart = allInnerText.indexOf('________');
    expect(placeholderStart, '长字段占位符（8 个 _）应在 innerText 里').toBeGreaterThanOrEqual(0);

    const charBefore = placeholderStart > 0 ? allInnerText[placeholderStart - 1] : '';
    const charAfter =
      placeholderStart + 8 < allInnerText.length ? allInnerText[placeholderStart + 8] : '';
    const cpBefore = (charBefore.codePointAt(0) ?? 0).toString(16).padStart(4, '0');
    const cpAfter = (charAfter.codePointAt(0) ?? 0).toString(16).padStart(4, '0');
    console.log('  占位符前字符 codepoint:', charBefore ? `U+${cpBefore}` : 'N/A');
    console.log('  占位符后字符 codepoint:', charAfter ? `U+${cpAfter}` : 'N/A');

    expect(charBefore, '长字段占位符前不应有空白').not.toMatch(/[\u0020\u3000\t]/);
    expect(charAfter, '长字段占位符后不应有空白').not.toMatch(/[\u0020\u3000\t]/);
  });

  it('多 occurrence 同 token：每个 occurrence 各自 trim 自己的 padding', async () => {
    // 同一 docx 里两个【  占位字段  】，各自独立 trim
    const text = `第一段：【  ${SENTINEL}  】。第二段：【  ${SENTINEL}  】。`;
    const paragraphs = [new Paragraph({ children: [new TextRun(text)] })];
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const originalArrayBuffer = toArrayBuffer(buffer);
    const t0 = generateDisplayToken(SENTINEL, 0);
    const t1 = generateDisplayToken(SENTINEL, 1);
    const edits = [
      { maskedToken: SENTINEL, originalValue: t0 },
      { maskedToken: SENTINEL, originalValue: t1 },
    ];

    const maskedBuffer = await writeDocxFromEdits(originalArrayBuffer, edits);
    const result = await readDocxFromArrayBuffer(maskedBuffer);

    const allInnerText = extractAllInnerText(result.documentXml);
    console.log('\n=== Q1 probe v2 — 多 occurrence ===');
    console.log('  原 innerText (期望): 两处 `【________】` 各占位符前后无空白');

    // 找两个 ____
    const firstIdx = allInnerText.indexOf('____');
    const secondIdx = allInnerText.indexOf('____', firstIdx + 4);
    expect(firstIdx, '第一个占位符').toBeGreaterThanOrEqual(0);
    expect(secondIdx, '第二个占位符').toBeGreaterThan(firstIdx);

    const firstBefore = allInnerText[firstIdx - 1] ?? '';
    const firstAfter = allInnerText[firstIdx + 4] ?? '';
    const secondBefore = allInnerText[secondIdx - 1] ?? '';
    const secondAfter = allInnerText[secondIdx + 4] ?? '';
    const cp = (s: string) => (s.codePointAt(0) ?? 0).toString(16).padStart(4, '0');
    console.log('  第1个占位符 前后:', cp(firstBefore), cp(firstAfter));
    console.log('  第2个占位符 前后:', cp(secondBefore), cp(secondAfter));

    expect(firstBefore, '第1个占位符前不应有空白').not.toMatch(/[\u0020\u3000\t]/);
    expect(firstAfter, '第1个占位符后不应有空白').not.toMatch(/[\u0020\u3000\t]/);
    expect(secondBefore, '第2个占位符前不应有空白').not.toMatch(/[\u0020\u3000\t]/);
    expect(secondAfter, '第2个占位符后不应有空白').not.toMatch(/[\u0020\u3000\t]/);
  });
});
