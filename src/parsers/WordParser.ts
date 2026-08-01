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
      // 防御：扩展名是 .docx 但实际是旧版 .doc（CFB 二进制）
      // spy 2026-08-01 反馈：仅改后缀名会绕过扩展名检查，JSZip 抛 "Can't find end of central directory"
      // peek 前 4 字节，CFB 魔数 = D0CF11E0
      // 用 readFileAsArrayBuffer（FileReader）而非 file.arrayBuffer() — jsdom 下后者不稳定
      const header = new Uint8Array(await readFileAsArrayBuffer(file));
      if (isCfbHeader(header)) {
        throw new Error(
          '检测到这是旧版 .doc 二进制文件（CFB 容器），不是真 .docx。' +
          '请用 WPS/Word 打开后「文件 → 另存为 → .docx」（仅改后缀名无效）。'
        );
      }
      return this.parseDocx(file);
    } else {
      throw new Error(
        '暂不支持旧版 .doc 格式（Word 97-2003 二进制）。' +
        '请用 WPS/Word 打开后「文件 → 另存为 → .docx」（仅改后缀名无效）。'
      );
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

/**
 * CFB（Compound File Binary）魔数检测 — 旧版 .doc（Word 97-2003）的文件头
 *   spy 2026-08-01 反馈：用户改后缀 .doc→.docx 绕过扩展名检查，工具抛 JSZip 错
 *   修法：peek 前 4 字节，命中 D0CF11E0 → 抛"请另存为 .docx"详细错误
 *
 *   接受 Uint8Array 而非 File — 方便单测直接传字节，不用 mock File 的 arrayBuffer
 *   （jsdom 下 new File() 的 arrayBuffer() 不稳定）
 */
const CFB_MAGIC = [0xD0, 0xCF, 0x11, 0xE0];
export function isCfbHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes[0] === CFB_MAGIC[0] &&
    bytes[1] === CFB_MAGIC[1] &&
    bytes[2] === CFB_MAGIC[2] &&
    bytes[3] === CFB_MAGIC[3]
  );
}
