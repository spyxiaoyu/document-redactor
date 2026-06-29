import type { ParsedDocument, DocumentAST, ContentBlock, ImageBlock } from '@/types';
import { Parser } from '@/engines/DocumentEngine';

export class ImageParser implements Parser {
  canParse(file: File): boolean {
    return file.type.startsWith('image/');
  }

  async parse(file: File): Promise<ParsedDocument> {
    let text = '';

    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng+chi');
      const result = await worker.recognize(file);
      text = result.data.text;
      await worker.terminate();
    } catch (err) {
      console.warn('[ImageParser] OCR worker failed, using filename only:', err);
      // Fallback: return filename as text if OCR fails
      text = `[Image: ${file.name}]`;
    }

    const imageBlock: ImageBlock = {
      id: 'main_image',
      src: await this.fileToBase64(file),
      width: 0,
      height: 0,
      ocrText: text
    };

    const contentBlock: ContentBlock = {
      id: 'image_content',
      type: 'image',
      content: imageBlock
    };

    const ast: DocumentAST = {
      metadata: {
        format: 'image',
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        created: file.lastModified ? new Date(file.lastModified) : undefined
      },
      content: [contentBlock],
      embeddedAssets: [imageBlock]
    };

    return { ast, rawText: text };
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

export const imageParser = new ImageParser();
