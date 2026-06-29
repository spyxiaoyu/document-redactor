import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun } from 'docx';

describe('DOCX round-trip via mammoth', () => {
  it('builds a DOCX blob whose extracted text matches the input (mammoth joins paragraphs with \\n\\n)', async () => {
    const text = '甲方：示例\n乙方：阿里';
    const paragraphs = text
      .split('\n')
      .map(line => new Paragraph({ children: [new TextRun(line)] }));
    const doc = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: buffer as any });
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
    const result = await mammoth.extractRawText({ buffer: buffer as any });
    for (const line of lines) {
      expect(result.value).toContain(line);
    }
  });
});
