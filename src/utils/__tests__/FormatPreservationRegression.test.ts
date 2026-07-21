/**
 * 格式保留 probe 测试 — 验证 B 方案 writeDocxFromEdits 是否破坏了原 docx 结构
 *
 * 目标（spy 截图 bug）：下载脱敏后的 docx "提行不连贯、影响阅读"
 * 怀疑根因：mergeRunsForCoverage 把 match 跨多 <w:r> 区间内的 <w:proofErr>
 *          等段落级 sibling 元素一并删除，导致 Word/WPS 重新分词/换行
 *
 * 跑法：
 *   npx vitest run src/utils/__tests__/FormatPreservationProbe.test.ts
 *
 * 输出：step-by-step 报告，证明 root cause 假设是否成立
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { writeDocxFromEdits } from '../docxZipWriter';
import { readDocxFromArrayBuffer } from '../docxZipReader';

const SRC = 'test-fixtures/sample-contract-A.docx';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

/**
 * 统计 document.xml 里的元素数量
 */
function countOccurrences(xml: string, pattern: string | RegExp): number {
  if (typeof pattern === 'string') {
    let count = 0;
    let pos = 0;
    while ((pos = xml.indexOf(pattern, pos)) !== -1) {
      count++;
      pos += pattern.length;
    }
    return count;
  } else {
    const matches = xml.match(pattern);
    return matches ? matches.length : 0;
  }
}

/**
 * 找出 xml 中所有 <w:t>...</w:t> 节点的 innerText，按顺序拼接
 * 与 mammoth extractRawText 的语义对齐（不含 <w:proofErr> 等段落级元素）
 */
function extractWTextInnerTexts(xml: string): string {
  const result: string[] = [];
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf('<w:t>', pos);
    if (start === -1) {
      // try with attrs
      const start2 = xml.indexOf('<w:t ', pos);
      if (start2 === -1) break;
      const openEnd = xml.indexOf('>', start2);
      const closeStart = xml.indexOf('</w:t>', openEnd);
      if (closeStart === -1) break;
      result.push(xml.slice(openEnd + 1, closeStart));
      pos = closeStart + '</w:t>'.length;
      continue;
    }
    const openEnd = xml.indexOf('>', start);
    const closeStart = xml.indexOf('</w:t>', openEnd);
    if (closeStart === -1) break;
    result.push(xml.slice(openEnd + 1, closeStart));
    pos = closeStart + '</w:t>'.length;
  }
  return result.join('');
}

describe('Format Preservation Probe — 验证 B 方案是否破坏原 docx 结构', () => {
  it('真实 spy docx 跑一次 writeDocxFromEdits，对比结构变化', async () => {
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }

    console.log('\n========== FORMAT PRESERVATION PROBE ==========');

    const srcBuf = fs.readFileSync(SRC);
    const srcAb = toArrayBuffer(srcBuf);

    const original = await readDocxFromArrayBuffer(srcAb);
    const originalXml = original.documentXml;

    console.log(`\n=== 1. 原始 docx 结构 ===`);
    const origProofErr = countOccurrences(originalXml, '<w:proofErr');
    const origWBr = countOccurrences(originalXml, '<w:br/>');
    const origWCR = countOccurrences(originalXml, '<w:cr');  // 回车
    const origRuns = countOccurrences(originalXml, '<w:r>') + countOccurrences(originalXml, '<w:r ');
    const origParagraphs = countOccurrences(originalXml, '<w:p>') + countOccurrences(originalXml, '<w:p ');
    const origText = extractWTextInnerTexts(originalXml);

    console.log(`  <w:proofErr>:  ${origProofErr}`);
    console.log(`  <w:br/>:        ${origWBr}`);
    console.log(`  <w:cr>:         ${origWCR}`);
    console.log(`  <w:r>:          ${origRuns}`);
    console.log(`  <w:p>:          ${origParagraphs}`);
    console.log(`  inner text len: ${origText.length}`);

    // mammoth baseline
    const origMammoth = (await mammoth.extractRawText(mammothInput(srcBuf))).value;
    console.log(`  mammoth text:   ${origMammoth.length} chars`);

    // 找一个真实 match：示例公司（北京）融媒体科技文化有限公司
    const matchStr = '示例公司（北京）融媒体科技文化有限公司';
    const maskedToken = '__________________' + '\u200B';  // 18 下划线 + 1 ZWS
    const edits = [{
      maskedToken: matchStr,    // 找原值
      originalValue: maskedToken,  // 替换为 mask
    }];

    console.log(`\n=== 2. 应用 1 个 edit：替换 "${matchStr}" → "${'_'.repeat(18)}" + ZWS ===`);
    const maskedAb = await writeDocxFromEdits(srcAb, edits);
    const masked = await readDocxFromArrayBuffer(maskedAb);
    const maskedXml = masked.documentXml;

    const maskedProofErr = countOccurrences(maskedXml, '<w:proofErr');
    const maskedWBr = countOccurrences(maskedXml, '<w:br/>');
    const maskedWCR = countOccurrences(maskedXml, '<w:cr');
    const maskedRuns = countOccurrences(maskedXml, '<w:r>') + countOccurrences(maskedXml, '<w:r ');
    const maskedParagraphs = countOccurrences(maskedXml, '<w:p>') + countOccurrences(maskedXml, '<w:p ');
    const maskedText = extractWTextInnerTexts(maskedXml);

    console.log(`  <w:proofErr>:  ${maskedProofErr}  (Δ ${maskedProofErr - origProofErr})`);
    console.log(`  <w:br/>:        ${maskedWBr}  (Δ ${maskedWBr - origWBr})`);
    console.log(`  <w:cr>:         ${maskedWCR}  (Δ ${maskedWCR - origWCR})`);
    console.log(`  <w:r>:          ${maskedRuns}  (Δ ${maskedRuns - origRuns})`);
    console.log(`  <w:p>:          ${maskedParagraphs}  (Δ ${maskedParagraphs - origParagraphs})`);
    console.log(`  inner text len: ${maskedText.length}  (Δ ${maskedText.length - origText.length})`);

    // mammoth 对比
    const maskedMammoth = (await mammoth.extractRawText(mammothInput(new Uint8Array(maskedAb)))).value;
    console.log(`  mammoth text:   ${maskedMammoth.length} chars  (Δ ${maskedMammoth.length - origMammoth.length})`);

    // 对比 mammoth 输出字符 diff
    let charDiff = 0;
    const minLen = Math.min(origMammoth.length, maskedMammoth.length);
    for (let i = 0; i < minLen; i++) {
      if (origMammoth[i] !== maskedMammoth[i]) charDiff++;
    }
    charDiff += Math.abs(origMammoth.length - maskedMammoth.length);
    console.log(`  mammoth chars diff: ${charDiff}`);

    // 显示 mammoth 输出差异区域
    if (charDiff > 0) {
      console.log(`\n=== 3. mammoth 输出差异分析 ===`);
      // 找第一个差异位置
      let firstDiff = -1;
      const min2 = Math.min(origMammoth.length, maskedMammoth.length);
      for (let i = 0; i < min2; i++) {
        if (origMammoth[i] !== maskedMammoth[i]) { firstDiff = i; break; }
      }
      if (firstDiff === -1 && origMammoth.length !== maskedMammoth.length) {
        firstDiff = min2;
      }
      console.log(`  first diff at: ${firstDiff}`);
      const showAround = 100;
      const oStart = Math.max(0, firstDiff - showAround);
      const oEnd = Math.min(origMammoth.length, firstDiff + showAround);
      const mStart = Math.max(0, firstDiff - showAround);
      const mEnd = Math.min(maskedMammoth.length, firstDiff + showAround);
      console.log(`  ORIGINAL [${oStart}-${oEnd}]:`);
      console.log(`    "${origMammoth.slice(oStart, oEnd)}"`);
      console.log(`  MASKED   [${mStart}-${mEnd}]:`);
      console.log(`    "${maskedMammoth.slice(mStart, mEnd)}"`);
    }

    // 关键断言：<w:proofErr> 应该完全保留（除非它本来就在 match 区间内）
    console.log(`\n=== 4. 关键断言 ===`);
    if (maskedProofErr < origProofErr) {
      console.log(`  ❌ <w:proofErr> 丢失了 ${origProofErr - maskedProofErr} 个！`);
      console.log(`     这是 line-break 错乱的根因候选（mergeRunsForCoverage 把 match 区间内 sibling 元素一起吞）`);
    } else {
      console.log(`  ✅ <w:proofErr> 全部保留`);
    }

    if (maskedRuns !== origRuns) {
      console.log(`  ⚠️  <w:r> 数量变化：${origRuns} → ${maskedRuns}（Δ ${maskedRuns - origRuns}）`);
      console.log(`     这是预期的（合并跨节点 run 会减少 run 数量），但需要确认合并后没破坏字体/rPr`);
    }

    // 检查 mask 后的 docx 是否还能 extract 出 mammoth 文本（结构没彻底坏）
    if (maskedMammoth.length === 0) {
      console.log(`  ❌ mammoth 提取失败！masked docx 结构破坏`);
    } else {
      console.log(`  ✅ mammoth 还能正常提取（${maskedMammoth.length} chars）`);
    }

    console.log('\n=================================================\n');

    // ====== Step 3: 把 probe 转为正式断言 ======
    // spy 截图回归：脱敏后下载文件"提行不连贯"——根因是 mergeRunsForCoverage
    // 把 match 区间内的 <w:proofErr/> 等段落级 sibling 元素一并删除。
    // Word/WPS 重新分词时把 run 边界突变 + proofErr 消失理解为重新换行点。
    //
    // 修法（待实施）：mergeRunsForCoverage 在合并 run 时，把 [runStart, runEnd) 区间内的
    // 非 <w:r> 元素（即 sibling: <w:proofErr/>, <w:bookmarkStart/>, <w:bookmarkEnd/> 等）
    // 提取出来保留，不要被新的 merged run 替换掉。

    // 断言 1：<w:proofErr> 必须 0 丢失（line break 错乱的真凶）
    expect(maskedProofErr).toBe(origProofErr);

    // 调试：找出 mammoth 输出差异区域，看 masked 是否丢了 text
    let firstDiffIdx = -1;
    const cmpLen = Math.min(origMammoth.length, maskedMammoth.length);
    for (let i = 0; i < cmpLen; i++) {
      if (origMammoth[i] !== maskedMammoth[i]) { firstDiffIdx = i; break; }
    }
    if (firstDiffIdx === -1 && origMammoth.length !== maskedMammoth.length) {
      firstDiffIdx = cmpLen;
    }
    if (firstDiffIdx >= 0) {
      console.log(`\n[DEBUG] first mammoth diff at ${firstDiffIdx}`);
      const showAround = 80;
      console.log(`  ORIGINAL [${Math.max(0, firstDiffIdx - showAround)}..${Math.min(origMammoth.length, firstDiffIdx + showAround)}]:`);
      console.log(`    "${origMammoth.slice(Math.max(0, firstDiffIdx - showAround), Math.min(origMammoth.length, firstDiffIdx + showAround))}"`);
      console.log(`  MASKED   [${Math.max(0, firstDiffIdx - showAround)}..${Math.min(maskedMammoth.length, firstDiffIdx + showAround)}]:`);
      console.log(`    "${maskedMammoth.slice(Math.max(0, firstDiffIdx - showAround), Math.min(maskedMammoth.length, firstDiffIdx + showAround))}"`);
    }

    // 断言 2：mammoth 文本 round-trip：
    //   - matchStr 18 chars 被替换为 maskedToken 19 chars (18 下划线 + 1 ZWS)，每处替换 +1 char
    //   - 总 delta = 出现次数 × 1（不能用 mammoth indexOf 找 matchStr，因为合同里 matchStr 出现次数
    //     可能 ≥ 1 — 直接从原 mammoth 里数）
    let occCount = 0;
    let sPos = 0;
    while ((sPos = origMammoth.indexOf(matchStr, sPos)) !== -1) {
      occCount++;
      sPos += matchStr.length;
    }
    console.log(`\n  matchStr 在原文出现 ${occCount} 次，理论 delta = +${occCount}`);
    const expectedMammothDelta = occCount * (maskedToken.length - matchStr.length);
    expect(maskedMammoth.length - origMammoth.length).toBe(expectedMammothDelta);

    // 断言 3：masked docx 还能被 mammoth 正常解析（结构没彻底坏）
    expect(maskedMammoth.length).toBeGreaterThan(0);
  }, 30000);
});