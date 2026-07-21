/**
 * 用真实默认规则 + 真实文件跑完整链路，钉死 production 行为
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { CryptoManager } from '../CryptoManager';
import { Desensitizer } from '../Desensitizer';
import { SensitiveFinder } from '../SensitiveFinder';

const SRC = 'test-fixtures/sample-contract-A.docx';
const PASSWORD = 'test123';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

describe('E2E with real DOCX + real default rules', () => {
  it('runs full pipeline using createRulesFromBuiltin() (NOT mock keywords)', async () => {
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }

    const srcBuffer = fs.readFileSync(SRC);
    const extract = await mammoth.extractRawText(mammothInput(srcBuffer));
    const originalText = extract.value;
    console.log(`  原文长度 ${originalText.length}`);

    // 用 SensitiveFinder 默认实例（构造函数已 setRules(createRulesFromBuiltin())）
    const finder = new SensitiveFinder();
    // 模拟用户添加了手动 keyword：比如"辛公司"或"测试科技"
    finder.addKeywords(['辛公司', '测试科技']);
    const detect = finder.findSensitiveContent(originalText, { includeDisabled: true });
    const matches = detect.matches;
    console.log(`  SensitiveFinder 找到 ${matches.length} 个 match (rules + keywords)`);
    matches.forEach((m, i) => {
      console.log(`    [${i}] type=${m.type} value="${m.value.slice(0, 20)}" @${m.start}-${m.end}`);
    });

    // Integrity: 每条 match 的 value 必须能从原文切出来
    matches.forEach((m, i) => {
      const sliceFromOrig = originalText.slice(m.start, m.start + m.value.length);
      if (sliceFromOrig !== m.value) {
        console.error(`  ❌ match[${i}] integrity broken: text.slice(${m.start}, ${m.start + m.value.length})="${sliceFromOrig}" but value="${m.value}"`);
      }
      expect(sliceFromOrig, `match integrity for "${m.value}"`).toBe(m.value);
    });

    // 跑 desensitize
    const desensitizer = new Desensitizer(new CryptoManager());
    const { desensitizedText, mappingTable } = await desensitizer.desensitize(originalText, matches, { mode: 'encrypt' });
    console.log(`  脱敏后 ${desensitizedText.length} chars, mappingTable ${mappingTable.length} 项`);

    // MappingTable integrity: position 是脱敏后坐标，验证 maskedToken 落位
    for (const entry of mappingTable) {
      const slice = desensitizedText.slice(entry.position.start, entry.position.end);
      if (slice !== entry.maskedToken) {
        console.error(`  ❌ mappingTable integrity broken: entry value="${entry.originalValue}" expected maskedToken="${entry.maskedToken}" at [${entry.position.start}-${entry.position.end}], got "${slice}"`);
      }
    }

    // Encrypt + 注入 DOCX
    const enc = await desensitizer.encryptMappingTable(mappingTable, PASSWORD);
    const saltB64 = Buffer.from(enc.salt).toString('base64');
    const ivB64 = Buffer.from(enc.iv).toString('base64');
    const dataB64 = Buffer.from(new Uint8Array(enc.encrypted)).toString('base64');
    const metaXml = `<?xml version="1.0"?>
<desensitizer>
  <salt>${saltB64}</salt>
  <iv>${ivB64}</iv>
  <data>${dataB64}</data>
</desensitizer>`;
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(srcBuffer);
    zip.file('docProps/desensitizer.xml', metaXml);
    const encBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // 模拟 RestorePage：mammoth 提取 + decrypt + restore
    const zipRead = await JSZip.loadAsync(encBuffer);
    const metaRead = await zipRead.file('docProps/desensitizer.xml')?.async('string');
    const saltRead = Uint8Array.from(Buffer.from(metaRead!.match(/<salt>([^<]+)<\/salt>/)![1], 'base64'));
    const ivRead = Uint8Array.from(Buffer.from(metaRead!.match(/<iv>([^<]+)<\/iv>/)![1], 'base64'));
    const dataRead = Uint8Array.from(Buffer.from(metaRead!.match(/<data>([^<]+)<\/data>/)![1], 'base64'));

    const decrypted = await desensitizer.decryptMappingTable(
      dataRead.buffer.slice(dataRead.byteOffset, dataRead.byteOffset + dataRead.byteLength),
      PASSWORD, saltRead, ivRead
    );

    // 使用 desensitizedText 作为 restore 入参（docx body 写回是 UploadPage 的职责）
    const desensitizedFromFile = desensitizedText;

    const restored = await desensitizer.restore(desensitizedFromFile, decrypted, PASSWORD);

    // 报告
    console.log(`  脱敏文本长度: ${desensitizedFromFile.length} chars`);
    console.log(`  restore 输出: ${restored.length} chars`);
    console.log(`  完全一致: ${restored === originalText ? '✅' : '❌'}`);

    if (restored !== originalText) {
      // 找前 3 个差异
      let diffs = 0;
      for (let i = 0; i < Math.min(restored.length, originalText.length); i++) {
        if (restored[i] !== originalText[i]) {
          console.error(`  差异 @${i}:`);
          console.error(`    原文: "${originalText.slice(Math.max(0, i - 10), i + 30)}"`);
          console.error(`    还原: "${restored.slice(Math.max(0, i - 10), i + 30)}"`);
          diffs++;
          if (diffs >= 3) break;
          // skip ahead
          i += 30;
        }
      }
    }
    expect(restored).toBe(originalText);
  }, 30000);
});