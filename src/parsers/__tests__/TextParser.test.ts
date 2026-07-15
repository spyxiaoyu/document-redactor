/**
 * P2 解析器测试 — TEST_SPECIFICATION §E2
 *
 *   SPEC-E2-03: TXT 解析（直接读）
 */
import { describe, it, expect } from 'vitest';
import { TextParser } from '@/parsers/TextParser';
import { getFileFormat } from '@/utils';

function makeFile(name: string, content: string, mime = 'text/plain'): File {
  return new File([content], name, { type: mime });
}

describe('SPEC-E2-03: TextParser', () => {
  const parser = new TextParser();

  describe('canParse', () => {
    it('txt 文件可解析', () => {
      const f = makeFile('test.txt', 'hello');
      expect(parser.canParse(f)).toBe(true);
    });

    it('csv 文件可解析', () => {
      const f = makeFile('test.csv', 'a,b,c', 'text/csv');
      expect(parser.canParse(f)).toBe(true);
    });

    it('html 文件可解析', () => {
      const f = makeFile('test.html', '<p>hi</p>', 'text/html');
      expect(parser.canParse(f)).toBe(true);
    });

    it('md 文件可解析（getFileFormat 把 md 归类到 txt）', () => {
      const f = makeFile('test.md', '# title');
      expect(getFileFormat(f)).toBe('txt');
      expect(parser.canParse(f)).toBe(true);
    });

    it('docx 文件不能解析', () => {
      const f = makeFile('test.docx', 'binary', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(parser.canParse(f)).toBe(false);
    });

    it('pdf 文件不能解析', () => {
      const f = makeFile('test.pdf', 'binary', 'application/pdf');
      expect(parser.canParse(f)).toBe(false);
    });

    it('xlsx 文件不能解析', () => {
      const f = makeFile('test.xlsx', 'binary', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(parser.canParse(f)).toBe(false);
    });
  });

  describe('parse', () => {
    it('txt 文件：rawText = 文件内容', async () => {
      const content = '甲方：北京示例科技有限公司\n电话：13800000000';
      const f = makeFile('test.txt', content);
      const result = await parser.parse(f);
      expect(result.rawText).toBe(content);
      expect(result.ast.metadata.format).toBe('txt');
      expect(result.ast.metadata.fileName).toBe('test.txt');
    });

    it('csv 文件：保持原始内容（不解析列）', async () => {
      const content = 'name,phone\n张三,13800000000\n李四,13800000000';
      const f = makeFile('test.csv', content, 'text/csv');
      const result = await parser.parse(f);
      // TextParser 对 csv 不做特殊处理（保留 rawText）
      expect(result.rawText).toBe(content);
      expect(result.ast.metadata.format).toBe('csv');
    });

    it('空 txt 文件：rawText = ""', async () => {
      const f = makeFile('empty.txt', '');
      const result = await parser.parse(f);
      expect(result.rawText).toBe('');
    });

    it('含中文 txt 文件：rawText 完整保留', async () => {
      const content = '甲方：北京示例科技有限公司\n乙方：SAMPLE-CO-F文化有限公司\n联系人：占位人';
      const f = makeFile('contract.txt', content);
      const result = await parser.parse(f);
      expect(result.rawText).toBe(content);
      // 字符计数一致（UTF-8 解码正确）
      expect([...result.rawText].length).toBe([...content].length);
    });

    it('html 文件：rawText 是 HTML 原文（不解析 DOM）', async () => {
      const html = '<!DOCTYPE html><html><body><h1>Title</h1><p>Body</p></body></html>';
      const f = makeFile('page.html', html, 'text/html');
      const result = await parser.parse(f);
      expect(result.rawText).toBe(html);
    });
  });
});