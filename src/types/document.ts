export type FileFormat = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'pptx' | 'txt' | 'csv' | 'html' | 'image';

export interface DocumentMetadata {
  format: FileFormat;
  fileName: string;
  mimeType: string;
  size: number;
  created?: Date;
  modified?: Date;
  pages?: number;
  sheets?: number;
  /** 内嵌图片数（mammoth 抽出来的 <img> 数量，docx 可信） */
  imageCount?: number;
  /**
   * 图片在 rawText 中的 offset 位置（升序）。
   * 检测策略：rawText 里 3+ 连续换行 = 原本有图片段（mammoth 把图片 cell 抽成空段）。
   * 每个位置是空行序列的【起点】。
   */
  imagePositions?: number[];
}

export interface Position {
  pageNumber?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface TextBlock {
  text: string;
  position: Position;
}

export interface TableCell {
  value: string | number | null;
  column: number;
  row: number;
  formula?: string;
}

export interface TableBlock {
  rows: TableCell[][];
  columns: number;
  hasHeader: boolean;
}

export interface ImageBlock {
  id: string;
  src: string;
  width: number;
  height: number;
  ocrText?: string;
  position?: Position;
}

export interface ContentBlock {
  id: string;
  type: 'text' | 'table' | 'image' | 'shape' | 'container';
  content: string | TableBlock | ImageBlock;
  position?: Position;
  children?: ContentBlock[];
}

export interface DocumentAST {
  metadata: DocumentMetadata;
  content: ContentBlock[];
  embeddedAssets: ImageBlock[];
}

export interface ParsedDocument {
  ast: DocumentAST;
  rawText: string;
}
