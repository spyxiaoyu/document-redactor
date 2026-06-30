/**
 * 用户报告场景的精确复刻测试
 *
 * spy 在浏览器里：
 *   - 启用默认规则
 *   - 加 keyword "SAMPLE-CO-F"（只有 1 个）
 *   - 设密码
 *   - 加密下载 docx
 *   - 上传加密 docx + 密码 → 恢复
 *   - 看到 "联系电话：占位人占位人占位人占位人占位人_"（应是 13800000000）
 *   - 看到 "联系邮箱：SAMPLE-CO-F（北京）融媒体科技文化有限公司_"
 *
 * 之前 E2ERealRules 用 5 个 keyword 通过了，但用户场景只 1 个。
 * 写这个测试钉死"1 个 keyword"的真实路径，并且明确断言关键字段必须出现。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { CryptoManager } from '../CryptoManager';
import { Desensitizer } from '../Desensitizer';
import { SensitiveFinder } from '../SensitiveFinder';

const SRC = '<repo-path>/模板/SAMPLE-CT-002-知识产权服务框架协议-SAMPLE-CO-Z.docx';
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

describe("User's exact scenario: default rules + 1 keyword 'SAMPLE-CO-F'", () => {
  it('restored text must contain the actual phone number and email', async () => {
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }

    const srcBuffer = fs.readFileSync(SRC);
    const extract = await mammoth.extractRawText(mammothInput(srcBuffer));
    const originalText = extract.value;

    // === 用户的精确场景：默认规则 + 只加 1 个 keyword "SAMPLE-CO-F" ===
    const finder = new SensitiveFinder();
    finder.addKeywords(['SAMPLE-CO-F']);
    const matches = finder.findSensitiveContent(originalText, { includeDisabled: true }).matches;
    console.log(`  matches: ${matches.length}`);
    matches.forEach((m, i) => {
      console.log(`    [${i}] ${m.type} "${m.value.slice(0, 30)}" @${m.start}-${m.end}`);
    });

    // 完整性：每条 match 的 value 必须能从头切出来
    matches.forEach((m, i) => {
      const slice = originalText.slice(m.start, m.start + m.value.length);
      expect(slice, `match[${i}] integrity`).toBe(m.value);
    });

    // 完整 round-trip
    const desensitizer = new Desensitizer(new CryptoManager());
    const { desensitizedText, mappingTable } = await desensitizer.desensitize(
      originalText, matches, { mode: 'encrypt' }
    );

    // mappingTable 完整性（position 现在是脱敏后坐标，验证 maskedToken 落位）
    for (const entry of mappingTable) {
      const slice = desensitizedText.slice(entry.position.start, entry.position.end);
      expect(slice, `mappingTable entry "${entry.originalValue.slice(0, 20)}" should have maskedToken at its position`).toBe(entry.maskedToken);
    }

    // 加密 + 注入
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

    // 重新读取 + 解密 + restore
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

    // === 关键断言：用户报告被破坏的字段必须恢复 ===
    expect(restored).toContain('13800000000');
    expect(restored).toContain('contact@client-b.test');
    expect(restored).toContain('占位人');
    expect(restored).toContain('SAMPLE-CO-F（北京）融媒体科技文化有限公司');
    expect(restored).toContain('北京SAMPLE-CO-Z有限公司');

    // 完全一致（最严格的断言）
    if (restored !== originalText) {
      console.error(`\n  ❌ 恢复文本与原文不一致 (restored=${restored.length}, original=${originalText.length})`);
      // 找前 5 个差异
      let diffs = 0;
      for (let i = 0; i < Math.min(restored.length, originalText.length); i++) {
        if (restored[i] !== originalText[i]) {
          console.error(`\n  差异 @${i}:`);
          console.error(`    原文: "${originalText.slice(Math.max(0, i - 15), i + 35)}"`);
          console.error(`    还原: "${restored.slice(Math.max(0, i - 15), i + 35)}"`);
          diffs++;
          if (diffs >= 5) break;
          i += 35;
        }
      }
    }
    expect(restored).toBe(originalText);
  }, 30000);
});
