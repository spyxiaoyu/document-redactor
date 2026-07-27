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
        created: file.lastModified ? new Date(file.lastModified) : undefined,
        // 2026-07-27 spy 反馈：docx 含图片时纯文本视图无法显示，原文面板加一行小字提示
        //   "此处原有 x 张图片，暂无法显示，脱敏下载后可查看"
        // 数 mammoth HTML 里 <img> 数 = docx 实际嵌入图片数（mammoth 全量抽出）
        imageCount: (htmlResult.value.match(/<img\b/gi) || []).length,
        // 图片段在 rawText 中的位置（精确）。
        // 检测策略：mammoth HTML 里每张 <img> 都包在 <p> 里，
        //   取【上一段】文本（strip inner tags 后），到 rawText 里 lastIndexOf，
        //   chip 插在那一段文本末尾。
        // 比"3+ 连续 \n"更精确——后者会把段落编号空行误判成图片段。
        imagePositions: findImagePositions(result.value, htmlResult.value),
      },
      content: [contentBlock],
      embeddedAssets: []
    };

    return { ast, rawText: result.value };
  }
}

/**
 * 从 mammoth HTML 找每张 <img>，回溯到上一个 <p> 文本，在 rawText 里 lastIndexOf 它。
 * 返回每个 chip 应该插入的 offset（即上一段文本末尾 + 1）。
 *
 * 例：HTML `<p>清单如下：</p><p><img /></p>`
 *   → 取 "清单如下：" → 在 rawText 里找到对应位置 → 返回末尾 offset
 */
export function findImagePositions(rawText: string, mammothHtml: string): number[] {
  const positions: number[] = [];
  const imgTagRe = /<img\b[^>]*>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgTagRe.exec(mammothHtml)) !== null) {
    const imgIdx = imgMatch.index;
    // 找 <img> 之前最近的 </p> 结束位置
    const prevPEnd = mammothHtml.lastIndexOf('</p>', imgIdx);
    if (prevPEnd === -1) continue;
    // 该 <p> 起点（找 <p 后的 >，从那里开始）
    const pTagEnd = mammothHtml.indexOf('>', mammothHtml.lastIndexOf('<p', prevPEnd)) + 1;
    if (pTagEnd <= 0 || pTagEnd >= prevPEnd) continue;
    // 提取 <p>...</p> 内的纯文本（strip 内部标签）
    const prevText = mammothHtml
      .slice(pTagEnd, prevPEnd)
      .replace(/<[^>]+>/g, '')
      .trim();
    if (prevText.length === 0) continue;
    // 在 rawText 里找末次出现（避免与前面重复段落错配）
    const matchIdx = rawText.lastIndexOf(prevText);
    if (matchIdx !== -1) {
      positions.push(matchIdx + prevText.length);
    }
  }
  return positions;
}

export const wordParser = new WordParser();
