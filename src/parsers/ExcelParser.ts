import type { ParsedDocument, DocumentAST, ContentBlock, TableBlock, TableCell } from '@/types';
import { getFileFormat, readFileAsArrayBuffer } from '@/utils';
import { Parser } from '@/engines/DocumentEngine';

export class ExcelParser implements Parser {
  canParse(file: File): boolean {
    const format = getFileFormat(file);
    return format === 'xlsx' || format === 'xls';
  }

  async parse(file: File): Promise<ParsedDocument> {
    const XLSX = await import('xlsx');
    const arrayBuffer = await readFileAsArrayBuffer(file);

    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheets: ContentBlock[] = [];
    let fullText = '';

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

      const tableRows: TableCell[][] = data.map((row, rowIndex) =>
        row.map((cell, colIndex) => ({
          value: cell as string | number | null,
          column: colIndex,
          row: rowIndex
        }))
      );

      const tableBlock: TableBlock = {
        rows: tableRows,
        columns: tableRows[0]?.length || 0,
        hasHeader: true
      };

      const textContent = data
        .flat()
        .filter(cell => cell != null)
        .map(cell => String(cell))
        .join(' ');
      fullText += textContent + '\n';

      sheets.push({
        id: `sheet_${sheetName}`,
        type: 'table',
        content: tableBlock,
        position: { pageNumber: sheets.length + 1 }
      });
    }

    const format = getFileFormat(file);
    const mimeType =
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.ms-excel';

    const ast: DocumentAST = {
      metadata: {
        format,
        fileName: file.name,
        mimeType,
        size: file.size,
        created: file.lastModified ? new Date(file.lastModified) : undefined,
        sheets: workbook.SheetNames.length
      },
      content: sheets,
      embeddedAssets: []
    };

    return { ast, rawText: fullText.trim() };
  }
}

export const excelParser = new ExcelParser();
