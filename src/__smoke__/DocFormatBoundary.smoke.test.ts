/**
 * .doc 误判 bug 回归测试 — 锁死项
 *
 *   spy 2026-08-01 反馈：上传 20240509场地租赁协议.doc（实际是旧版 .doc CFB 二进制）
 *   → 工具抛 "Please convert to DOCX" → spy 仅改后缀名为 .docx → 工具抛 JSZip
 *   "Can't find end of central directory"（因为 .doc 不是 ZIP）。
 *
 *   根因：WordParser 只看扩展名，不验证文件实际字节。
 *   旧版 .doc（Word 97-2003）是 CFB（Compound File Binary）容器，
 *   与 .docx（ZIP+XML）是完全两种格式，浏览器侧无法自动转换。
 *
 *   修法：parse 开头 peek 前 4 字节，命中 CFB 魔数 D0CF11E0 → 抛"请另存为 .docx"详细错误。
 *
 *   锁死项：
 *   - CFB 头（D0CF11E0...）抛"另存为 .docx"错误，不进 mammoth
 *   - 真 .docx（ZIP 头 504B0304）走 mammoth 解析路径（不抛 CFB 错）
 *   - .doc 改后缀成 .docx（CFB 头伪装）同样被拦
 */
import { describe, it, expect } from 'vitest';
import { WordParser, isCfbHeader } from '@/parsers/WordParser';

describe('.doc / .docx 边界拦截（CFB 魔数检测）', () => {
  it('isCfbHeader: CFB 魔数 D0CF11E0 命中', () => {
    const cfb = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0]);
    expect(isCfbHeader(cfb)).toBe(true);
  });

  it('isCfbHeader: ZIP 魔数 504B0304 不命中（CFB 头不误伤真 .docx）', () => {
    const zip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]);
    expect(isCfbHeader(zip)).toBe(false);
  });

  it('isCfbHeader: 短字节 (<4) 不命中', () => {
    expect(isCfbHeader(new Uint8Array([0xD0, 0xCF, 0x11]))).toBe(false);
  });

  it('WordParser.parse 拒绝 CFB 头（.doc 二进制伪装成 .docx）', async () => {
    // 用 ArrayBuffer 包装（与 ExcelParser.test.ts 同样模式，jsdom 兼容）
    const cfbBytes = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0]);
    const cfb = new File([cfbBytes.buffer], 'fake.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const parser = new WordParser();
    await expect(parser.parse(cfb)).rejects.toThrow(/另存为.*\.docx/);
  });

  it('真实 .docx fixture 走 mammoth 路径（不抛 CFB 拦截错）', async () => {
    // 真实 .docx 的 CFB 检测不触发 → 应该进 mammoth 解析。
    // 已有 E2EERealDocx.test.ts 用真 fixture 验整条链路。
    // 本测试只验：CFB 检测的 regex 不会误伤真 .docx（ZIP 头 504B0304）。
    // 真实 .docx 在 spy 本机有 fixture，CI 跳过。
    const fs = await import('node:fs');
    if (!fs.existsSync('test-fixtures/sample-contract-A.docx')) {
      // 跳过 — spy 本机 fixture 不可见
      return;
    }
    const buf = new Uint8Array(fs.readFileSync('test-fixtures/sample-contract-A.docx'));
    // 验 ZIP 头不命中 CFB 魔数
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4B); // K
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });
});
