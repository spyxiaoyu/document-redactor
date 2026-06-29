import type { DocumentAST, ParsedDocument, FileFormat, ContentBlock } from '@/types';

export interface Parser {
  canParse(file: File): boolean;
  parse(file: File): Promise<ParsedDocument>;
}

export interface Builder {
  canBuild(format: FileFormat): boolean;
  build(ast: DocumentAST, desensitizedContent: string): Promise<Blob>;
}

export class DocumentEngine {
  private parsers: Parser[] = [];
  private builders: Builder[] = [];

  registerParser(parser: Parser): void {
    this.parsers.push(parser);
  }

  registerBuilder(builder: Builder): void {
    this.builders.push(builder);
  }

  getParser(file: File): Parser | null {
    for (const parser of this.parsers) {
      if (parser.canParse(file)) {
        return parser;
      }
    }
    return null;
  }

  getBuilder(format: FileFormat): Builder | null {
    for (const builder of this.builders) {
      if (builder.canBuild(format)) {
        return builder;
      }
    }
    return null;
  }

  async parseDocument(file: File): Promise<ParsedDocument> {
    const parser = this.getParser(file);
    if (!parser) {
      throw new Error(`No parser found for file: ${file.name}`);
    }
    return parser.parse(file);
  }

  async buildDocument(ast: DocumentAST, desensitizedContent: string, format: FileFormat): Promise<Blob> {
    const builder = this.getBuilder(format);
    if (!builder) {
      throw new Error(`No builder found for format: ${format}`);
    }
    return builder.build(ast, desensitizedContent);
  }

  createEmptyAST(fileName: string, format: FileFormat, mimeType: string): DocumentAST {
    return {
      metadata: {
        format,
        fileName,
        mimeType,
        size: 0
      },
      content: [],
      embeddedAssets: []
    };
  }

  extractTextFromAST(ast: DocumentAST): string {
    const texts: string[] = [];

    const extractFromBlock = (block: ContentBlock) => {
      if (block.type === 'text' && typeof block.content === 'string') {
        texts.push(block.content);
      } else if (block.type === 'table' && typeof block.content === 'object' && 'rows' in block.content) {
        for (const row of block.content.rows) {
          for (const cell of row) {
            if (cell.value) {
              texts.push(String(cell.value));
            }
          }
        }
      } else if (block.children) {
        for (const child of block.children) {
          extractFromBlock(child);
        }
      }
    };

    for (const block of ast.content) {
      extractFromBlock(block);
    }

    return texts.join('\n');
  }
}

export const documentEngine = new DocumentEngine();
