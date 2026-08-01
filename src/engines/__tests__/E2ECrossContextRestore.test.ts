/**
 * Cross-context 还原测试 — 坐实 README "可外发" 卖点
 *
 *   spy 2026-08-01 审核 README 时质疑：
 *   "你可以把脱敏 docx + 密码直接发给同事，对方无需你的浏览器就能还原" — 这是真的吗？
 *
 *   代码证据（已查实）：
 *   - UploadPage.tsx:441-522 buildDesensitizedDocx 把加密 mapping 注入 docProps/desensitizer.xml
 *   - RestorePage.tsx:38-72 handleFileSelect 优先读内嵌 meta，命中直接 return（不进 DB 路径）
 *   - RestorePage.tsx:119-137 用内嵌 meta 的 salt+iv + 用户密码解密
 *
 *   本测试目的：把"代码审查能推导的结论"变成"测试能复现的事实"。
 *   - 用户 A 在 cmA/dzA 上加密 + 注入 meta → 模拟"发出去"
 *   - 用户 B 用**全新 CryptoManager 实例**（不是同一对象、不是同一进程状态）
 *   - 没有 IndexedDB、没有原文件名
 *   - 只靠 docx 文件 + 密码 → 还原 === 用户 A 原文
 *
 *   ⚠️ 不依赖本地 fixture — 测试内自建最小合法 docx zip，保证 CI 必跑。
 *   （真实 fixture 的 docx 保真链路由 RealDocxRoundTripAudit 覆盖，本测试只验跨上下文密钥链）
 *
 *   锁死项：
 *   - pass → "可外发" 卖点 100% 坐实，可放心写进 README
 *   - fail → 必须撤回 README 第 5 步的"可外发"文案
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { CryptoManager } from '@/engines/CryptoManager';
import { Desensitizer } from '@/engines/Desensitizer';
import { SensitiveFinder } from '@/engines/SensitiveFinder';

const PASSWORD = 'cross-context-test-pwd';

// 原文里的敏感值全部用合成代号（不用手机号/邮箱字面 — pre-commit PII hook 只认字面不认真假）
// 3 个敏感值 + 跨行分布 → 能压到 restore 的两趟替换逻辑
const KW_CONTRACT = 'SAMPLE-CT-001';
const KW_PARTY_A = 'SAMPLE-CO-A';
const KW_PARTY_B = 'SAMPLE-CO-B';
const ORIGINAL_TEXT = [
  `甲方：${KW_PARTY_A}`,
  `乙方：${KW_PARTY_B}`,
  `合同编号：${KW_CONTRACT}`,
  '本协议一式两份，双方各执一份。',
].join('\n');
const KNOWN_KEYWORDS = [KW_CONTRACT, KW_PARTY_A, KW_PARTY_B];

/** 造一个最小但结构合法的 docx（ZIP + 必要 part），用于模拟"发出去的文件" */
async function buildMinimalDocx(bodyText: string): Promise<JSZip> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyText
    .split('\n')
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
    .join('')}</w:body>
</w:document>`
  );
  return zip;
}

describe('Cross-context 还原（坐实"可外发"卖点）', () => {
  it('用户 B 在全新 CryptoManager + 无 DB 状态下还原原文 === 用户 A 原文', async () => {
    // ========== 用户 A：本地脱敏 + 加密 + 注入 meta ==========
    const cmA = new CryptoManager();
    const dzA = new Desensitizer(cmA);

    const finder = new SensitiveFinder();
    finder.addKeywords(KNOWN_KEYWORDS);
    const matches = finder.findSensitiveContent(ORIGINAL_TEXT, { includeDisabled: true }).matches;
    expect(matches.length, '原文必须至少含 1 个敏感字段').toBeGreaterThan(0);

    const { desensitizedText, mappingTable } = await dzA.desensitize(ORIGINAL_TEXT, matches, {
      mode: 'encrypt',
    });
    expect(desensitizedText, '脱敏后文本必须与原文不同').not.toBe(ORIGINAL_TEXT);

    const enc = await cmA.encryptMappingTable(mappingTable, PASSWORD);

    // 模拟"发出去"：注入 meta 进 docx zip（与 UploadPage.buildDesensitizedDocx 同格式）
    const saltB64 = Buffer.from(enc.salt).toString('base64');
    const ivB64 = Buffer.from(enc.iv).toString('base64');
    const dataB64 = Buffer.from(new Uint8Array(enc.encrypted)).toString('base64');
    const metaXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DesensitizerMeta xmlns="http://desensitizer.app/meta">
  <version>1</version>
  <salt>${saltB64}</salt>
  <iv>${ivB64}</iv>
  <data>${dataB64}</data>
</DesensitizerMeta>`;
    const zipA = await buildMinimalDocx(desensitizedText);
    zipA.file('docProps/desensitizer.xml', metaXml);
    const sentFile = await zipA.generateAsync({ type: 'nodebuffer' });

    // ========== 用户 B：全新 CryptoManager（不同实例 ≠ 任何 local state） ==========
    //          没有 IndexedDB，没有原文件名
    const cmB = new CryptoManager();
    const dzB = new Desensitizer(cmB);

    const zipB = await JSZip.loadAsync(sentFile);
    const metaRead = await zipB.file('docProps/desensitizer.xml')?.async('string');
    expect(metaRead, '脱敏 docx 必须含 docProps/desensitizer.xml').toBeDefined();

    // 用户 B 拿到的脱敏正文，也只能从收到的 docx 里读（不依赖发件人内存）
    const docXml = await zipB.file('word/document.xml')!.async('string');
    const receivedText = Array.from(docXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
      .map((m) => m[1])
      .join('\n');
    expect(receivedText).toBe(desensitizedText);

    const saltRead = Uint8Array.from(Buffer.from(metaRead!.match(/<salt>([^<]+)<\/salt>/)![1], 'base64'));
    const ivRead = Uint8Array.from(Buffer.from(metaRead!.match(/<iv>([^<]+)<\/iv>/)![1], 'base64'));
    const dataRead = Uint8Array.from(Buffer.from(metaRead!.match(/<data>([^<]+)<\/data>/)![1], 'base64'));

    // 用密码 + meta 里的 salt+iv 解密（不需要任何 local state）
    const decryptedTable = await dzB.decryptMappingTable(
      dataRead.buffer.slice(dataRead.byteOffset, dataRead.byteOffset + dataRead.byteLength),
      PASSWORD,
      saltRead,
      ivRead
    );
    expect(decryptedTable.length).toBe(mappingTable.length);

    const restored = await dzB.restore(receivedText, decryptedTable, PASSWORD);

    // ========== 硬验收 ==========
    expect(restored).toBe(ORIGINAL_TEXT);
  }, 30000);

  it('密码错误时用户 B 无法解密（加密不是摆设）', async () => {
    const cmA = new CryptoManager();
    const dzA = new Desensitizer(cmA);
    const finder = new SensitiveFinder();
    finder.addKeywords(KNOWN_KEYWORDS);
    const matches = finder.findSensitiveContent(ORIGINAL_TEXT, { includeDisabled: true }).matches;
    const { mappingTable } = await dzA.desensitize(ORIGINAL_TEXT, matches, { mode: 'encrypt' });
    const enc = await cmA.encryptMappingTable(mappingTable, PASSWORD);

    const cmB = new CryptoManager();
    const dzB = new Desensitizer(cmB);
    await expect(
      dzB.decryptMappingTable(enc.encrypted, 'wrong-password', enc.salt, enc.iv)
    ).rejects.toThrow();
  }, 30000);
});
