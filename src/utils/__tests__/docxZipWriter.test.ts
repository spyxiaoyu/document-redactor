/**
 * B2 集成测试：从原 docx 改写 → 重新打包 → 输出新 docx，
 * 验证：新 docx 能被 JSZip 打开 + 含原 zip 所有文件 + 修改生效。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { writeDocxFromEdits } from '../docxZipWriter';
import { readDocxFromArrayBuffer } from '../docxZipReader';

const SRC = 'test-fixtures/sample-contract-A.docx';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

describe('B2: writeDocxFromEdits round-trip preserves zip structure', () => {
  it('rewrites a real docx with token→value edits, keeps all ZIP entries', async () => {
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }

    const buf = fs.readFileSync(SRC);
    const original = await readDocxFromArrayBuffer(toArrayBuffer(buf));
    console.log(`\n=== 原始 docx ZIP entries: ${original.fileNames.length} ===`);
    console.log(`  document.xml 长度: ${original.documentXml.length}`);
    console.log(`  concatenatedText 长度: ${original.concatenatedText.length}`);

    // 模拟一组"加密"了的字段（用短 token 替换原值）
    const edits = [
      { maskedToken: '[COMPANY_0001]', originalValue: '示例公司（北京）融媒体科技文化有限公司' },
      { maskedToken: '[NAME_0003]', originalValue: '占位人' },
      { maskedToken: '[PHONE_0004]', originalValue: '13800000000' },
      { maskedToken: '[EMAIL_0005]', originalValue: 'contact@client-b.test' },
      { maskedToken: '[COMPANY_0006]', originalValue: '示例公司有限公司' },
    ];

    // Step 1: 先做"加密"——把原值替换为短 token，写新 zip
    const maskedBuf = await writeDocxFromEdits(toArrayBuffer(buf), edits.map(e => ({
      maskedToken: e.originalValue,
      originalValue: e.maskedToken,
    })));

    const maskedResult = await readDocxFromArrayBuffer(maskedBuf);
    console.log(`\n=== 加密 docx ===`);
    console.log(`  ZIP entries: ${maskedResult.fileNames.length}`);
    console.log(`  原始 entries 全保留? ${original.fileNames.every(f => maskedResult.fileNames.includes(f))}`);
    console.log(`  document.xml 长度: ${maskedResult.documentXml.length}`);

    // 期望：加密 docx 含 5 个 short token，原值消失
    for (const e of edits) {
      expect(maskedResult.documentXml).toContain(e.maskedToken);
    }
    // 期望：原值中短字段也被替换
    for (const e of edits.filter(x => x.originalValue.length <= 12)) {
      expect(maskedResult.documentXml).not.toContain(e.originalValue);
    }
    // 期望：原 ZIP 全条目保留（JSZip 自动加 word/ 空目录，忽略）
    const origSet = new Set(original.fileNames.filter(n => !n.endsWith('/')));
    const maskedSet = new Set(maskedResult.fileNames.filter(n => !n.endsWith('/')));
    expect(maskedSet).toEqual(origSet);
    // 期望：原 styles/numbering/headers/footers 等 B 方案最关键的文件都还在
    expect(maskedResult.fileNames).toContain('word/styles.xml');
    expect(maskedResult.fileNames).toContain('word/numbering.xml');
    expect(maskedResult.fileNames).toContain('word/header1.xml');
    expect(maskedResult.fileNames).toContain('word/footer1.xml');

    // Step 2: 从加密 docx 还原（用 mappingTable 反向）
    const restoredBuf = await writeDocxFromEdits(maskedBuf, edits);
    const restoredResult = await readDocxFromArrayBuffer(restoredBuf);

    console.log(`\n=== 还原 docx ===`);
    console.log(`  ZIP entries: ${restoredResult.fileNames.length}`);
    console.log(`  document.xml 长度: ${restoredResult.documentXml.length}`);
    for (const e of edits) {
      const hasToken = restoredResult.documentXml.includes(e.maskedToken);
      const hasValue = restoredResult.documentXml.includes(e.originalValue);
      console.log(`    ${hasToken ? '❌' : '✅'} token@${restoredResult.documentXml.indexOf(e.maskedToken)} | ${hasValue ? '✅' : '❌'} value@${restoredResult.documentXml.indexOf(e.originalValue)} — ${e.maskedToken} → "${e.originalValue.slice(0, 12)}..."`);
    }

    // 期望：token 全部消失，原值全部回来
    for (const e of edits) {
      expect(restoredResult.documentXml).not.toContain(e.maskedToken);
      expect(restoredResult.documentXml).toContain(e.originalValue);
    }
    // 期望：还原 docx 仍然有完整 ZIP 条目（包括 styles/numbering/headers/footers）
    expect(restoredResult.fileNames).toContain('word/styles.xml');
    expect(restoredResult.fileNames).toContain('word/numbering.xml');
    expect(restoredResult.fileNames).toContain('word/header1.xml');
    expect(restoredResult.fileNames).toContain('word/footer1.xml');
    expect(restoredResult.fileNames).toContain('word/theme/theme1.xml');

    // 写文件供 spy 手工测试（output 到项目目录外的 /tmp，避免污染 repo）
    fs.writeFileSync('/tmp/masked_demo.docx', new Uint8Array(maskedBuf));
    fs.writeFileSync('/tmp/restored_demo.docx', new Uint8Array(restoredBuf));
    console.log(`\n  ✅ 输出 /tmp/masked_demo.docx 和 /tmp/restored_demo.docx，可以 Word/WPS 打开看表格保真`);
  }, 30000);
});
