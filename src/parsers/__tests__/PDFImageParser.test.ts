/**
 * P2 PDF + Image 解析器测试 — TEST_SPECIFICATION §E2
 *
 *   SPEC-E2-01: PDF 解析（pdfjs-dist）
 *   SPEC-E2-04: 图片 OCR 解析（tesseract.js，离线化）
 *
 * PDF/Image 的 parse() 需要真实 worker + wasm，本测试只覆盖 canParse（核心 invariant）。
 * parse() 的 e2e 验证留给浏览器手测 + BuiltinRulesCoverage test pattern。
 */
import { describe, it, expect } from 'vitest';
import { PDFParser } from '@/parsers/PDFParser';
import { ImageParser } from '@/parsers/ImageParser';

function makeFile(name: string, mime: string): File {
  return new File(['binary'], name, { type: mime });
}

describe('SPEC-E2-01: PDFParser', () => {
  const parser = new PDFParser();

  describe('canParse', () => {
    it('application/pdf mime：可解析', () => {
      const f = makeFile('test.pdf', 'application/pdf');
      expect(parser.canParse(f)).toBe(true);
    });

    it('.pdf 扩展名（无 mime）：可解析', () => {
      const f = makeFile('test.pdf', '');
      expect(parser.canParse(f)).toBe(true);
    });

    it('txt 文件：不可解析', () => {
      const f = makeFile('test.txt', 'text/plain');
      expect(parser.canParse(f)).toBe(false);
    });

    it('docx 文件：不可解析', () => {
      const f = makeFile('test.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(parser.canParse(f)).toBe(false);
    });

    it('xlsx 文件：不可解析', () => {
      const f = makeFile('test.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(parser.canParse(f)).toBe(false);
    });

    it('图片文件：不可解析', () => {
      const f = makeFile('test.png', 'image/png');
      expect(parser.canParse(f)).toBe(false);
    });
  });

  // parse() 需要 pdfjs worker + 真实 PDF binary，Node 环境无法跑。
  // 由 E2ERealDocx 系列 + 浏览器手测覆盖。
});

describe('SPEC-E2-04: ImageParser', () => {
  const parser = new ImageParser();

  describe('canParse', () => {
    it('image/jpeg：可解析', () => {
      const f = makeFile('test.jpg', 'image/jpeg');
      expect(parser.canParse(f)).toBe(true);
    });

    it('image/png：可解析', () => {
      const f = makeFile('test.png', 'image/png');
      expect(parser.canParse(f)).toBe(true);
    });

    it('image/webp：可解析', () => {
      const f = makeFile('test.webp', 'image/webp');
      expect(parser.canParse(f)).toBe(true);
    });

    it('image/gif：可解析', () => {
      const f = makeFile('test.gif', 'image/gif');
      expect(parser.canParse(f)).toBe(true);
    });

    it('image/bmp：可解析', () => {
      const f = makeFile('test.bmp', 'image/bmp');
      expect(parser.canParse(f)).toBe(true);
    });

    it('.png 扩展名（无 mime）：不可解析（ImageParser 只查 mime 不查扩展名）', () => {
      const f = makeFile('test.png', '');
      // 当前实现只用 file.type.startsWith('image/')，无 mime 就 false
      // 这是已知 quirk：用户在 input[type=file] 选文件通常浏览器会自动填 mime
      expect(parser.canParse(f)).toBe(false);
    });

    it('txt 文件：不可解析', () => {
      const f = makeFile('test.txt', 'text/plain');
      expect(parser.canParse(f)).toBe(false);
    });

    it('pdf 文件：不可解析', () => {
      const f = makeFile('test.pdf', 'application/pdf');
      expect(parser.canParse(f)).toBe(false);
    });

    it('docx 文件：不可解析', () => {
      const f = makeFile('test.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(parser.canParse(f)).toBe(false);
    });
  });

  // parse() 需要 tesseract.js + wasm + 离线 tessdata + window.location，
  // Node 环境无法跑（ImageParser.parse() 用了 window.location.origin）。
  // 由浏览器手测覆盖。
});

describe('SPEC 关键 invariant：parser 互斥', () => {
  /**
   * 每个文件格式只能被一个 parser 接收（DocumentEngine.registerParser 调度）。
   * 这保证 WordParser/PDFParser/ExcelParser/ImageParser/TextParser 互不冲突。
   */
  const allParsers = [
    new PDFParser(),
    new ImageParser(),
  ];
  // TextParser/ExcelParser/WordParser 也属于此 invariant，但已在各自测试文件覆盖

  const cases = [
    { name: 'test.pdf', mime: 'application/pdf', canParse: [true, false] },
    { name: 'test.png', mime: 'image/png', canParse: [false, true] },
    { name: 'test.jpg', mime: 'image/jpeg', canParse: [false, true] },
    { name: 'test.txt', mime: 'text/plain', canParse: [false, false] },
    { name: 'test.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', canParse: [false, false] },
  ];

  cases.forEach(({ name, mime, canParse }) => {
    it(`${name} → [PDFParser=${canParse[0]}, ImageParser=${canParse[1]}]`, () => {
      const f = makeFile(name, mime);
      expect(allParsers[0].canParse(f)).toBe(canParse[0]);
      expect(allParsers[1].canParse(f)).toBe(canParse[1]);
    });
  });
});