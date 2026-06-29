import type { ParsedDocument, DocumentAST, ContentBlock, Position } from '@/types';
import { getFileFormat, readFileAsArrayBuffer } from '@/utils';
import { Parser } from '@/engines/DocumentEngine';

export class PDFParser implements Parser {
  canParse(file: File): boolean {
    return getFileFormat(file) === 'pdf';
  }

  async parse(file: File): Promise<ParsedDocument> {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const arrayBuffer = await readFileAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pages: ContentBlock[] = [];
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1.5 });

      const textBlocks: { text: string; position: Position }[] = [];
      const items = textContent.items as Array<{
        str: string;
        transform: number[];
        width?: number;
        height?: number;
      }>;

      for (const item of items) {
        if (item.str.trim()) {
          const x = item.transform[4];
          const y = viewport.height - item.transform[5];
          textBlocks.push({
            text: item.str,
            position: {
              pageNumber: i,
              x,
              y,
              width: item.width,
              height: item.height
            }
          });
          fullText += item.str + ' ';
        }
      }

      if (textBlocks.length > 0) {
        pages.push({
          id: `page_${i}`,
          type: 'container',
          content: textBlocks.map(b => b.text).join(' '),
          position: { pageNumber: i }
        });
      }
    }

    const ast: DocumentAST = {
      metadata: {
        format: 'pdf',
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        size: file.size,
        created: file.lastModified ? new Date(file.lastModified) : undefined,
        pages: pdf.numPages
      },
      content: pages,
      embeddedAssets: []
    };

    return { ast, rawText: fullText.trim() };
  }
}

export const pdfParser = new PDFParser();
