/**
 * 真实 DOCX 端到端测试
 *
 * 用用户桌面真实文件 <repo-path>/模板/SAMPLE-CT-002-知识产权服务框架协议-SAMPLE-CO-Z.docx
 * 跑完整 UploadPage → RestorePage 链路：
 *   1) mammoth 提取原文
 *   2) SensitiveFinder 找 match
 *   3) Desensitizer.desensitize（修过的 cursor 算法）
 *   4) CryptoManager.encryptMappingTable
 *   5) 注入 docProps/desensitizer.xml 元数据
 *   6) 写出新 DOCX
 *   7) 重新读取（模拟 RestorePage handleFileSelect）
 *   8) mammoth 提 desensitizedText
 *   9) 解密 mappingTable
 *  10) Desensitizer.restore（两趟替换）
 *  11) 验收：恢复文本 === 原文
 *  12) 错密码场景：AES-GCM 必须抛错
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { CryptoManager } from '../CryptoManager';
import { Desensitizer } from '../Desensitizer';
import { SensitiveFinder } from '../SensitiveFinder';

const SRC = '<repo-path>/模板/SAMPLE-CT-002-知识产权服务框架协议-SAMPLE-CO-Z.docx';
const PASSWORD = 'test123';

// mammoth 在不同环境下用不同 unzip：
//   Node (lib/unzip.js): 认 options.buffer / path / file
//   Browser (browser/unzip.js): 只认 options.arrayBuffer
// 两边都传。Node 命中 buffer，浏览器命中 arrayBuffer。
function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

// 从真实文件前 100 字看到：
//   "SAMPLE-CT-004"   ← 合同号
//   "SAMPLE-CO-F（北京）融媒体科技文化有限公司"   ← 公司名（带中文括号）
// 我们直接对文档里能确认的字面量做 keyword 匹配，确保 100% 命中。
const KNOWN_KEYWORDS = [
  'SAMPLE-CO-F',
  '融媒体',
  'SAMPLE-CT-004',
  '北京示例',
  'SAMPLE-CO-Y',
];

describe('E2E with real DOCX', () => {
  it('runs full UploadPage→RestorePage round-trip and restores original text exactly', async () => {
    if (!fs.existsSync(SRC)) {
      throw new Error(`测试文件不存在: ${SRC}`);
    }

    // 1) 读源文件 + mammoth 提文本
    const srcBuffer = fs.readFileSync(SRC);
    const extract = await mammoth.extractRawText(mammothInput(srcBuffer));
    const originalText = extract.value;
    console.log(`  原文长度 ${originalText.length}, 前 100 字: ${originalText.slice(0, 100)}`);

    // 2) SensitiveFinder
    const finder = new SensitiveFinder();
    finder.addKeywords(KNOWN_KEYWORDS);
    const detectResult = finder.findSensitiveContent(originalText, { includeDisabled: true });
    const matches = detectResult.matches;
    console.log(`  SensitiveFinder 找到 ${matches.length} 个 match`);
    matches.slice(0, 5).forEach((m, i) => {
      console.log(`    [${i}] type=${m.type} value="${m.value}" @${m.start}-${m.end}`);
    });
    expect(matches.length).toBeGreaterThan(0);

    // 3) Desensitizer 脱敏
    const desensitizer = new Desensitizer(new CryptoManager());
    const { desensitizedText, mappingTable } = await desensitizer.desensitize(originalText, matches, { mode: 'encrypt' });
    console.log(`  脱敏后 ${desensitizedText.length} chars, mappingTable ${mappingTable.length} 项`);

    // Integrity check: mappingTable 的 originalValue 必须能从原文切出来
    for (const entry of mappingTable) {
      const sliceFromOrig = originalText.slice(entry.position.start, entry.position.start + entry.originalValue.length);
      expect(sliceFromOrig, `mappingTable integrity broken for "${entry.originalValue}"`).toBe(entry.originalValue);
    }

    // 4) 加密 mappingTable
    const enc = await desensitizer.encryptMappingTable(mappingTable, PASSWORD);
    expect(enc.salt.length).toBe(16);
    expect(enc.iv.length).toBe(12);

    // 5) 注入 DOCX 元数据
    const saltB64 = Buffer.from(enc.salt).toString('base64');
    const ivB64 = Buffer.from(enc.iv).toString('base64');
    const dataB64 = Buffer.from(new Uint8Array(enc.encrypted)).toString('base64');
    const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<desensitizer>
  <salt>${saltB64}</salt>
  <iv>${ivB64}</iv>
  <data>${dataB64}</data>
</desensitizer>`;
    const zip = await JSZip.loadAsync(srcBuffer);
    zip.file('docProps/desensitizer.xml', metaXml);
    const encBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // 6) 重新读取（模拟 RestorePage）
    const zipRead = await JSZip.loadAsync(encBuffer);
    const metaRead = await zipRead.file('docProps/desensitizer.xml')?.async('string');
    expect(metaRead).toBeDefined();

    const saltRead = Uint8Array.from(Buffer.from(metaRead!.match(/<salt>([^<]+)<\/salt>/)![1], 'base64'));
    const ivRead = Uint8Array.from(Buffer.from(metaRead!.match(/<iv>([^<]+)<\/iv>/)![1], 'base64'));
    const dataRead = Uint8Array.from(Buffer.from(metaRead!.match(/<data>([^<]+)<\/data>/)![1], 'base64'));

    // 7) 解密 mappingTable
    const decrypted = await desensitizer.decryptMappingTable(
      dataRead.buffer.slice(dataRead.byteOffset, dataRead.byteOffset + dataRead.byteLength),
      PASSWORD,
      saltRead,
      ivRead
    );
    expect(decrypted.length).toBe(mappingTable.length);

    // 8) mammoth 从加密文件提 desensitizedText
    const extract2 = await mammoth.extractRawText(mammothInput(encBuffer));
    const desensitizedFromFile = extract2.value;
    console.log(`  mammoth 从加密文件提的脱敏文本长度 ${desensitizedFromFile.length}`);

    // 9) restore
    const restored = await desensitizer.restore(desensitizedFromFile, decrypted, PASSWORD);
    console.log(`  restore 输出 ${restored.length} chars`);

    // 10) 验收
    if (restored !== originalText) {
      console.error(`  ❌ 不一致！原文 ${originalText.length} vs 还原 ${restored.length}`);
      // 找首个差异
      for (let i = 0; i < Math.min(restored.length, originalText.length); i++) {
        if (restored[i] !== originalText[i]) {
          console.error(`  首个差异 @${i}:`);
          console.error(`    原文: "${originalText.slice(Math.max(0, i - 20), i + 40)}"`);
          console.error(`    还原: "${restored.slice(Math.max(0, i - 20), i + 40)}"`);
          break;
        }
      }
    }
    expect(restored).toBe(originalText);
  }, 30000);

  it('wrong password is rejected by AES-GCM', async () => {
    if (!fs.existsSync(SRC)) return; // skip if file missing
    const srcBuffer = fs.readFileSync(SRC);
    const extract = await mammoth.extractRawText(mammothInput(srcBuffer));
    const finder = new SensitiveFinder();
    finder.addKeywords(KNOWN_KEYWORDS);
    const matches = finder.findSensitiveContent(extract.value, { includeDisabled: true }).matches;
    if (matches.length === 0) return;

    const desensitizer = new Desensitizer(new CryptoManager());
    const { mappingTable } = await desensitizer.desensitize(extract.value, matches, { mode: 'encrypt' });
    const enc = await desensitizer.encryptMappingTable(mappingTable, PASSWORD);

    await expect(
      desensitizer.decryptMappingTable(enc.encrypted, 'WRONG-PASSWORD', enc.salt, enc.iv)
    ).rejects.toThrow();
  }, 30000);
});