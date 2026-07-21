/**
 * B5 真实使用流程验证：用默认 SensitiveFinder 规则 + writeDocxFromEdits 完整链路，
 * 输出 2 个 docx 给 spy 在 Word/WPS 里手工验证。
 *
 * 跑法：
 *   cd <本仓库根目录>
 *   npx vitest run src/utils/__tests__/B5VerifyRealFlow.test.ts
 *
 * 输出：
 *   /tmp/spy-e2e-masked.docx     — 加密 docx（敏感字段已替换为视觉下划线 + 隐藏 ZWS marker）
 *   /tmp/spy-e2e-restored.docx   — 恢复 docx（敏感字段已恢复，应该完全等价于原 docx）
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { writeDocxFromEdits } from '../docxZipWriter';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { Desensitizer } from '@/engines/Desensitizer';
import { CryptoManager } from '@/engines/CryptoManager';
import { readDocxFromArrayBuffer } from '../docxZipReader';

const SRC = 'test-fixtures/sample-contract-A.docx';
const PASSWORD = 'spy-verify-123';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

describe('B5: spy 真实使用流程（默认规则 + writeDocxFromEdits）', () => {
  it('默认 SensitiveFinder 找字段 → 脱敏 → 加密 docx → 恢复 docx', async () => {
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }

    const srcBuf = fs.readFileSync(SRC);
    const srcAb = toArrayBuffer(srcBuf);

    // 1) mammoth 提原文本（这是 UploadPage 内部用的方式）
    const extract = await mammoth.extractRawText(mammothInput(srcBuf));
    const originalText = extract.value;
    console.log(`\n=== 1. 原文 ===`);
    console.log(`  长度: ${originalText.length} chars`);

    // 2) SensitiveFinder 默认规则
    const finder = new SensitiveFinder();
    const detected = finder.findSensitiveContent(originalText);
    console.log(`\n=== 2. 默认规则检测 ===`);
    console.log(`  找到 ${detected.matches.length} 个 match`);
    const typeCount: Record<string, number> = {};
    for (const m of detected.matches) {
      typeCount[m.type] = (typeCount[m.type] || 0) + 1;
    }
    for (const [t, n] of Object.entries(typeCount)) {
      console.log(`    ${t}: ${n}`);
    }

    // 3) Desensitizer 脱敏（生成 maskedToken = '_'.repeat(原值长度) + ZWS × (index+1)）
    //    视觉上纯下划线，Word/WPS 不渲染 ZWS，但保证全局唯一可配对
    const desensitizer = new Desensitizer(new CryptoManager());
    const { mappingTable } = await desensitizer.desensitize(
      originalText,
      detected.matches,
      { mode: 'encrypt' }
    );
    console.log(`\n=== 3. 脱敏 ===`);
    console.log(`  mappingTable ${mappingTable.length} 项`);
    console.log(`  前 5 个:`);
    mappingTable.slice(0, 5).forEach((e, i) => {
      const visible = e.maskedToken.replace(/\u200B/g, '');
      const zwsCount = (e.maskedToken.match(/\u200B/g) || []).length;
      console.log(`    [${i}] ${e.type}: "${e.originalValue}" → "${visible}" + ${zwsCount}×ZWS`);
    });

    // 4) B 方案：writeDocxFromEdits 在原 docx 字节上做 mask（原值 → maskedToken）
    //    maskedToken 直接来自 mappingTable（视觉下划线 + ZWS marker）
    const maskEdits = mappingTable.map(e => ({
      maskedToken: e.originalValue,
      originalValue: e.maskedToken,
    }));
    const maskedAb = await writeDocxFromEdits(srcAb, maskEdits);
    const masked = await readDocxFromArrayBuffer(maskedAb);
    console.log(`\n=== 4. 加密 docx ===`);
    console.log(`  ZIP entries: ${masked.fileNames.length}`);
    console.log(`  含 <w:tbl>? ${masked.documentXml.includes('<w:tbl') ? '✅' : '❌'}`);
    let maskSuccess = 0;
    for (const e of mappingTable) {
      if (masked.documentXml.includes(e.maskedToken)) maskSuccess++;
    }
    console.log(`  maskedToken 注入: ${maskSuccess}/${mappingTable.length}`);

    // 5) B 方案：writeDocxFromEdits 在加密 docx 上做 restore（maskedToken → 原值）
    const restoreEdits = mappingTable.map(e => ({
      maskedToken: e.maskedToken,
      originalValue: e.originalValue,
    }));
    const restoredAb = await writeDocxFromEdits(maskedAb, restoreEdits);
    const restored = await readDocxFromArrayBuffer(restoredAb);
    console.log(`\n=== 5. 恢复 docx ===`);
    console.log(`  ZIP entries: ${restored.fileNames.length}`);
    console.log(`  含 <w:tbl>? ${restored.documentXml.includes('<w:tbl') ? '✅' : '❌'}`);
    let underscoreResidue = 0;
    for (const e of mappingTable) {
      if (restored.documentXml.includes(e.maskedToken)) underscoreResidue++;
    }
    console.log(`  残留 maskedToken 数: ${underscoreResidue} (期望 0)`);
    let missingValues = 0;
    for (const e of mappingTable) {
      if (!restored.documentXml.includes(e.originalValue)) missingValues++;
    }
    console.log(`  缺失原值数: ${missingValues} (期望 0)`);

    // 6) mammoth 文本 round-trip 一致性
    const restoredText = (await mammoth.extractRawText(mammothInput(new Uint8Array(restoredAb)))).value;
    console.log(`\n=== 6. 文本 round-trip ===`);
    console.log(`  baseline ${originalText.length} chars`);
    console.log(`  restored ${restoredText.length} chars`);
    const textOk = restoredText.length === originalText.length;
    console.log(`  ${textOk ? '✅' : '❌'} 字符数一致`);

    // 7) 加密 mappingTable + 注入 docProps/desensitizer.xml（这是 UploadPage 实际做的事）
    const enc = await desensitizer.encryptMappingTable(mappingTable, PASSWORD);
    const toBase64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const saltB64 = toBase64(enc.salt.buffer as ArrayBuffer);
    const ivB64 = toBase64(enc.iv.buffer as ArrayBuffer);
    const dataB64 = toBase64(enc.encrypted);
    const metaXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DesensitizerMeta xmlns="http://desensitizer.app/meta">
  <version>1</version>
  <originalFileName>${SRC.split('/').pop()}</originalFileName>
  <salt>${saltB64}</salt>
  <iv>${ivB64}</iv>
  <data>${dataB64}</data>
</DesensitizerMeta>`;
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(maskedAb);
    const ctOrig = await zip.file('[Content_Types].xml')?.async('string') || '';
    const ctWithMeta = ctOrig.includes('desensitizer.xml')
      ? ctOrig
      : ctOrig.replace('</Types>', '<Override PartName="/docProps/desensitizer.xml" ContentType="application/xml"/></Types>');
    const relsOrig = await zip.file('_rels/.rels')?.async('string') || '';
    const relsWithMeta = relsOrig.includes('desensitizer.xml')
      ? relsOrig
      : relsOrig.replace('</Relationships>', '<Relationship Id="rId_desensitizer" Type="http://desensitizer.app/relationships/metadata" Target="docProps/desensitizer.xml"/></Relationships>');
    zip.file('[Content_Types].xml', ctWithMeta);
    zip.file('_rels/.rels', relsWithMeta);
    zip.file('docProps/desensitizer.xml', metaXml);
    const finalMaskedBuf = await zip.generateAsync({ type: 'arraybuffer' });
    fs.writeFileSync('/tmp/spy-e2e-masked.docx', new Uint8Array(finalMaskedBuf));
    fs.writeFileSync('/tmp/spy-e2e-restored.docx', new Uint8Array(restoredAb));

    console.log(`\n=== 📁 输出文件 ===`);
    console.log(`  /tmp/spy-e2e-masked.docx   (${(finalMaskedBuf.byteLength / 1024).toFixed(1)} KB) — 用 Word/WPS 打开应看到视觉下划线替换了敏感字段`);
    console.log(`  /tmp/spy-e2e-restored.docx (${(restoredAb.byteLength / 1024).toFixed(1)} KB) — 用 Word/WPS 打开应与原 docx 等价（表格/字体/页眉页脚全保留）`);
  }, 30000);
});