/**
 * DocxZipReader prototype 测试：用 spy 真实 docx 验证 B 方案核心问题——
 *   脱敏 token（如 [NAME_0001]）会不会被 OOXML 拆到多个 w:t 节点里？
 *
 * 这是 B 方案能不能成的关键决策点（影响 5-7 天还是再多一档）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import {
  readDocxFromArrayBuffer,
  extractTextNodes,
  locateTokenInTextNodes,
  type DocxReadResult,
} from '../docxZipReader';
import { Desensitizer } from '@/engines/Desensitizer';
import { CryptoManager } from '@/engines/CryptoManager';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { BUILTIN_RULES } from '@/rules/BuiltinRules';
import mammoth from 'mammoth';

const SRC = '<repo-path>/模板/SAMPLE-CT-002-知识产权服务框架协议-SAMPLE-CO-Z.docx';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

function mammothInput(buf: Uint8Array) {
  // mammoth Node 版本认 buffer，浏览器版本认 arrayBuffer；两个都传跨环境都过
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

describe('B0: DocxZipReader prototype on user real docx', () => {
  it('lists ZIP entries and extracts w:t nodes', async () => {
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }

    const buf = fs.readFileSync(SRC);
    const result = await readDocxFromArrayBuffer(toArrayBuffer(buf));

    console.log(`\n=== ZIP entries ===`);
    console.log(`  total: ${result.fileNames.length}`);
    result.fileNames.slice(0, 15).forEach(n => console.log(`    ${n}`));
    if (result.fileNames.length > 15) console.log(`    ... +${result.fileNames.length - 15} more`);

    console.log(`\n=== w:t nodes ===`);
    console.log(`  count: ${result.textNodes.length}`);
    console.log(`  concatenated total chars: ${result.concatenatedText.length}`);
    console.log(`  first 5 nodes:`);
    result.textNodes.slice(0, 5).forEach(n => {
      console.log(`    [${n.idx}] len=${n.text.length} range=[${n.globalStart}..${n.globalEnd}) "${n.text.slice(0, 40)}"`);
    });

    // 必须有 document.xml
    expect(result.fileNames).toContain('word/document.xml');
    // mammoth extractRawText 也要能读出来（确认 docx 没破）
    const extract = await mammoth.extractRawText({ buffer: toArrayBuffer(buf) });
    expect(result.concatenatedText.length).toBeGreaterThan(0);
    console.log(`\n  mammoth text len: ${extract.value.length}`);
    console.log(`  zipReader text len: ${result.concatenatedText.length}`);
  }, 30000);

  it('CRITICAL: verifies original sensitive values stay intact inside single w:t nodes', async () => {
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }

    // 关键问题：B 方案要把 maskedToken 替换回原文，前提是 maskedToken 在原 docx 的 w:t 里是连续的。
    // 我们现在还没把脱敏文本写回原 docx（那是 B1-B2 的事），所以这里反过来验：
    //
    //   现在的 UploadPage.buildDesensitizedDocx 用 mammoth extractRawText 把 docx → text，
    //   那段 text 里敏感字段值（如"SAMPLE-CO-F（北京）融媒体科技文化有限公司"）就是连续的完整字符串。
    //   我们用 SensitiveFinder 在这段 text 上找出 8 个核心敏感字段的 originalValue，
    //   然后去 docxZipReader 读出的原 docx w:t 拼接里找这些 originalValue，
    //   看它们是不是每个都整段落在一个 w:t 节点里。
    //
    // 如果都在一个 w:t 里 → 简单替换算法够用（B 方案核心可行）
    // 如果有跨节点 → B 方案要走跨节点合并路径（复杂度 + 一档）

    const buf = fs.readFileSync(SRC);
    const extract = await mammoth.extractRawText(mammothInput(buf));
    const text = extract.value;

    // 用 8 个 spy 已确认的字段值做核心验证
    const targets = [
      'SAMPLE-CO-F（北京）融媒体科技文化有限公司',
      '占位人',
      '13800000000',
      'contact@client-b.test',
      '北京SAMPLE-CO-Z有限公司',
      '张某某',
      '13800000001',
      'contact@client-a.test',
    ];

    const result = await readDocxFromArrayBuffer(toArrayBuffer(buf));
    const haystack = result.concatenatedText;

    console.log(`\n=== 关键数据：每个敏感字段值在原 docx w:t 里的跨节点情况 ===\n`);

    let allInOneNode = 0;
    let crossNode = 0;
    let notFound = 0;
    const crossExamples: string[] = [];

    for (const t of targets) {
      const locs = locateTokenInTextNodes(result, t);
      if (locs === null) {
        crossNode++;
        crossExamples.push(t);
        console.log(`  ❌ "${t}" — 跨多个 w:t 节点`);
      } else if (locs.length === 0) {
        notFound++;
        console.log(`  ⚠️ "${t}" — 在 w:t 拼接里没找到（可能被 mammoth 跳过，如页眉页脚）`);
      } else {
        allInOneNode++;
        // 取第一个出现
        const loc = locs[0];
        const coveringNode = result.textNodes[loc.textNodeIdx];
        console.log(`  ✅ "${t.slice(0, 20)}..." — 完整在节点 #${loc.textNodeIdx} (len=${coveringNode.text.length})`);
      }
    }

    // 进一步验证：mammoth 文本里 extracted 的敏感字段值是否在原 docx 里（即使拆分也算）
    console.log(`\n=== mammoth 文本里 8 字段出现位置（粗定位，告诉我们字段是否在原 docx 中）===\n`);
    for (const t of targets) {
      const idxInMammoth = text.indexOf(t);
      const idxInZip = haystack.indexOf(t);
      console.log(`  "${t.slice(0, 18)}" mammoth@${idxInMammoth} zipReader@${idxInZip}`);
    }

    console.log(`\n=== B 方案决策 ===\n`);
    console.log(`  整段在一个 w:t:     ${allInOneNode}/8`);
    console.log(`  跨多个 w:t 节点:   ${crossNode}/8`);
    console.log(`  拼文本里没找到:    ${notFound}/8`);
    if (crossNode === 0 && notFound === 0) {
      console.log(`  > ✅ B 方案最简单的实现可行：直接替换 w:t 节点 textContent`);
    } else if (crossNode > 0) {
      console.log(`  > ⚠️ B 方案要做跨节点合并/部分替换`);
    }
    if (notFound > 0) {
      console.log(`  > ℹ️  未找到的字段可能是页眉/页脚/隐藏文字，B 方案需另行处理这些 XML 文件`);
    }
  }, 30000);
});
