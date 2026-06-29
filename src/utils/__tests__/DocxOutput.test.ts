import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';

// mammoth 的 browser 实现只认 arrayBuffer 字段，lib (Node) 实现认 path/buffer/file。
// Vite 打包走 browser 实现；vitest 跑 Node lib。我们两边都传，Node 命中 buffer，
// 浏览器命中 arrayBuffer。
function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

describe('DOCX round-trip via mammoth', () => {
  it('builds a DOCX blob whose extracted text matches the input (mammoth joins paragraphs with \\n\\n)', async () => {
    const text = '甲方：示例\n乙方：阿里';
    const paragraphs = text
      .split('\n')
      .map(line => new Paragraph({ children: [new TextRun(line)] }));
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText(mammothInput(buffer));
    // mammoth separates paragraphs with \n\n
    expect(result.value.trim()).toContain('示例');
    expect(result.value.trim()).toContain('阿里');
    expect(result.value).not.toMatch(/<w:/);  // not raw OOXML leaked
  });

  it('handles long content with multiple paragraphs', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `第 ${i + 1} 行：测试内容`);
    const paragraphs = lines.map(line => new Paragraph({ children: [new TextRun(line)] }));
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText(mammothInput(buffer));
    for (const line of lines) {
      expect(result.value).toContain(line);
    }
  });
});
