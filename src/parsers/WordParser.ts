import type { ParsedDocument, DocumentAST, ContentBlock } from '@/types';
import { getFileFormat, readFileAsArrayBuffer } from '@/utils';
import { Parser } from '@/engines/DocumentEngine';

export class WordParser implements Parser {
  canParse(file: File): boolean {
    const format = getFileFormat(file);
    return format === 'docx' || format === 'doc';
  }

  async parse(file: File): Promise<ParsedDocument> {
    const format = getFileFormat(file);

    if (format === 'docx') {
      return this.parseDocx(file);
    } else {
      throw new Error('DOC format requires additional processing. Please convert to DOCX.');
    }
  }

  private async parseDocx(file: File): Promise<ParsedDocument> {
    const mammoth = await import('mammoth');
    const arrayBuffer = await readFileAsArrayBuffer(file);

    const result = await mammoth.extractRawText({ arrayBuffer });
    const htmlResult = await mammoth.convertToHtml({ arrayBuffer });

    if (result.messages.length > 0) {
      console.warn('Mammoth warnings:', result.messages);
    }

    const contentBlock: ContentBlock = {
      id: 'main_content',
      type: 'text',
      content: htmlResult.value
    };

    const ast: DocumentAST = {
      metadata: {
        format: 'docx',
        fileName: file.name,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: file.size,
        created: file.lastModified ? new Date(file.lastModified) : undefined
      },
      content: [contentBlock],
      embeddedAssets: []
    };

    return { ast, rawText: result.value };
  }
}

export const wordParser = new WordParser();
