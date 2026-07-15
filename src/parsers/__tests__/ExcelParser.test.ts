/**
 * P2 Excel 解析器测试 — TEST_SPECIFICATION §E2
 *
 *   SPEC-E2-02: Excel 解析（xlsx）
 *
 * xlsx 包在 Node 环境能用（不依赖 DOM），用 XLSX.write 生成 in-memory xlsx。
 */
import { describe, it, expect } from 'vitest';
import { ExcelParser } from '@/parsers/ExcelParser';
import * as XLSX from 'xlsx';

function makeXlsxFile(name: string, sheets: Record<string, unknown[][]>): File {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, data] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new File([arrayBuffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('SPEC-E2-02: ExcelParser', () => {
  const parser = new ExcelParser();

  describe('canParse', () => {
    it('xlsx 文件可解析', () => {
      const f = makeXlsxFile('test.xlsx', { Sheet1: [['a', 'b']] });
      expect(parser.canParse(f)).toBe(true);
    });

    it('txt 文件不能解析', () => {
      const f = new File(['text'], 'test.txt', { type: 'text/plain' });
      expect(parser.canParse(f)).toBe(false);
    });

    it('pdf 文件不能解析', () => {
      const f = new File(['binary'], 'test.pdf', { type: 'application/pdf' });
      expect(parser.canParse(f)).toBe(false);
    });
  });

  describe('parse', () => {
    it('单 sheet：rawText 包含所有单元格内容', async () => {
      const f = makeXlsxFile('test.xlsx', {
        Sheet1: [
          ['name', 'phone', 'email'],
          ['张三', '13800000000', 'a@b.com'],
          ['李四', '13800000000', 'c@d.com'],
        ],
      });
      const result = await parser.parse(f);
      expect(result.rawText).toContain('张三');
      expect(result.rawText).toContain('13800000000');
      expect(result.rawText).toContain('a@b.com');
      expect(result.rawText).toContain('李四');
      expect(result.rawText).toContain('13800000000');
    });

    it('多 sheet：所有 sheet 的内容都在 rawText 里', async () => {
      const f = makeXlsxFile('multi.xlsx', {
        Sheet1: [['甲方：北京示例科技有限公司']],
        Sheet2: [['乙方：SAMPLE-CO-F文化有限公司']],
        Sheet3: [['电话：13800000000']],
      });
      const result = await parser.parse(f);
      expect(result.rawText).toContain('示例');
      expect(result.rawText).toContain('SAMPLE-CO-F');
      expect(result.rawText).toContain('13800000000');
    });

    it('AST metadata：format = xlsx, fileName 正确', async () => {
      const f = makeXlsxFile('contract-2024.xlsx', { Sheet1: [['x']] });
      const result = await parser.parse(f);
      expect(result.ast.metadata.format).toBe('xlsx');
      expect(result.ast.metadata.fileName).toBe('contract-2024.xlsx');
    });

    it('空 sheet：rawText 为空或仅含分隔符（不抛错）', async () => {
      const f = makeXlsxFile('empty.xlsx', { Sheet1: [] });
      const result = await parser.parse(f);
      expect(result.rawText.length).toBeGreaterThanOrEqual(0);
    });

    it('数字单元格：转换为字符串', async () => {
      const f = makeXlsxFile('numbers.xlsx', { Sheet1: [[1, 2, 3.14, 1000]] });
      const result = await parser.parse(f);
      expect(result.rawText).toContain('1');
      expect(result.rawText).toContain('3.14');
      expect(result.rawText).toContain('1000');
    });

    it('含敏感字段：可被后续 SensitiveFinder 检测', async () => {
      const f = makeXlsxFile('sensitive.xlsx', {
        Sheet1: [
          ['公司', '电话', '邮箱'],
          ['北京示例科技有限公司', '13800000000', 'test@example.com'],
        ],
      });
      const result = await parser.parse(f);
      // 直接验证 rawText 含敏感字段（后续 SensitiveFinder 会处理）
      expect(result.rawText).toContain('北京示例科技有限公司');
      expect(result.rawText).toContain('13800000000');
      expect(result.rawText).toContain('test@example.com');
    });
  });
});