/**
 * 钉死这个不变量：UploadPage 写 docx → mammoth 读回 → 字节级一致。
 *
 * 之前 UploadPage 用 text.split('\n') 当段，mammoth 读回时把每段间补成 '\n\n'，
 * 整个文档每段都多出 1 个 \n → 5678 chars 变 6142 chars → 所有跨段 match 的
 * position 错位 → restore 把 originalValue 插入错位置。
 *
 * 修法：text.split('\n\n') 当段（mammoth 段间就是用 '\n\n' 拼），且 strip 末尾空段
 *       避免 mammoth 多产生 2 个 trailing \n。
 *
 * 这是 round-trip 的根基，错了 position-based restore 一定挂。
 */
import { describe, it, expect } from 'vitest';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

/** 跟 UploadPage.buildDesensitizedDocx / RestorePage.handleDownload 写法对齐 */
async function writeTextAsDocx(text: string): Promise<Uint8Array> {
  const docxChildren = text
    .split('\n\n')
    .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
    .map(line => new Paragraph({ children: [new TextRun(line)] }));
  const doc = new Document({ sections: [{ children: docxChildren }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe('DOCX write→mammoth read round-trip equality', () => {
  // mammoth 总会在输出末尾追加段落终止符（'\n\n'），所以末尾比对用 trimEnd。
  // 关键是 body 内字节级一致 —— position 才能对齐。
  const trimEnd = (s: string) => s.replace(/\n+$/, '');

  it('simple text with multiple paragraphs round-trips byte-for-byte (modulo trailing \n)', async () => {
    const text = '甲方（一）\n\n乙方（二）\n\n丙方（三）';
    const buf = await writeTextAsDocx(text);
    const r = await mammoth.extractRawText(mammothInput(buf));
    expect(trimEnd(r.value)).toBe(trimEnd(text));
  });

  it('does NOT add spurious newlines inside the document body', async () => {
    const text = '甲方（一）\n\n乙方（二）\n\n丙方（三）';
    const buf = await writeTextAsDocx(text);
    const r = await mammoth.extractRawText(mammothInput(buf));
    // mammoth 段间是用 \n\n 拼，源也得是 \n\n 才 round-trip
    const body = trimEnd(r.value);
    expect(body).not.toContain('\n\n\n');
  });

  it('regression: split("\\n") would BREAK round-trip (proves why the bug exists)', async () => {
    // 同样的 text 用错误的 split('\n')
    const text = '甲方（一）\n\n乙方（二）\n\n丙方（三）';
    const wrong = text.split('\n').map(line => new Paragraph({ children: [new TextRun(line)] }));
    const doc = new Document({ sections: [{ children: wrong }] });
    const buf = new Uint8Array(await Packer.toBuffer(doc));
    const r = await mammoth.extractRawText(mammothInput(buf));
    // 错误写法：段间多出 \n
    expect(r.value).not.toBe(text);
    expect(r.value).toContain('\n\n\n');
  });

  it('real DOCX source round-trip: positions preserved within body', async () => {
    // 模拟用户的真实场景：5678 chars、~230 段
    const fs = await import('fs');
    const SRC = 'test-fixtures/sample-contract-A.docx';
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }
    const srcBuffer = new Uint8Array(fs.readFileSync(SRC));
    const extract = await mammoth.extractRawText(mammothInput(srcBuffer));
    const originalText = extract.value;
    console.log(`  原文长度 ${originalText.length}, \\n 数 ${(originalText.match(/\n/g) || []).length}`);

    const buf = await writeTextAsDocx(originalText);
    const r = await mammoth.extractRawText(mammothInput(buf));
    const reText = r.value;
    console.log(`  写后读回长度 ${reText.length}, \\n 数 ${(reText.match(/\n/g) || []).length}`);

    // 比对：除了 trailing whitespace，全文应该 byte-for-byte 一致
    expect(trimEnd(reText)).toBe(trimEnd(originalText));
  });
});
