import type { ParsedDocument, DocumentAST, ContentBlock } from '@/types';
import { getFileFormat, readFileAsText } from '@/utils';
import { Parser } from '@/engines/DocumentEngine';

export class TextParser implements Parser {
  canParse(file: File): boolean {
    const format = getFileFormat(file);
    return format === 'txt' || format === 'csv' || format === 'html';
  }

  async parse(file: File): Promise<ParsedDocument> {
    const format = getFileFormat(file);
    const text = await readFileAsText(file);

    let content = text;
    let mimeType = 'text/plain';

    if (format === 'csv') {
      content = this.parseCSV(text);
      mimeType = 'text/csv';
    } else if (format === 'html') {
      mimeType = 'text/html';
    }

    const contentBlock: ContentBlock = {
      id: 'main_content',
      type: 'text',
      content
    };

    const ast: DocumentAST = {
      metadata: {
        format,
        fileName: file.name,
        mimeType,
        size: file.size,
        created: file.lastModified ? new Date(file.lastModified) : undefined
      },
      content: [contentBlock],
      embeddedAssets: []
    };

    return { ast, rawText: text };
  }

  private parseCSV(text: string): string {
    const lines = text.split('\n');
    return lines.map(line => line.split(',').join(' | ')).join('\n');
  }
}

export const textParser = new TextParser();
