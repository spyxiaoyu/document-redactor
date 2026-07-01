/**
 * B 方案 docx 写回：把修改后的 word/document.xml 重新写进 ZIP，保持其他文件不变。
 *
 * 用法：
 *   const newArrayBuffer = await writeDocx(originalArrayBuffer, edits);
 *   - originalArrayBuffer: 原 .docx 文件的 ArrayBuffer
 *   - edits: [{ maskedToken, originalValue }, ...]
 *   - 返回新 .docx 文件的 ArrayBuffer（可下载/上传）
 *
 * 内部：
 *   1. JSZip.loadAsync 打开原 docx ZIP
 *   2. 拿出 word/document.xml 字符串
 *   3. applyDocxEdits 替换 token → originalValue
 *   4. 把所有 ZIP 条目（含 styles/numbering/headers/footers/theme/media 等）重新打包
 *   5. 输出 ArrayBuffer
 */

import { applyDocxEdits, type DocxEdit } from './docxWriter';
import { readDocxFromArrayBuffer } from './docxZipReader';

export async function writeDocxFromEdits(
  originalArrayBuffer: ArrayBuffer,
  edits: DocxEdit[],
): Promise<ArrayBuffer> {
  const result = await readDocxFromArrayBuffer(originalArrayBuffer);
  const newDocumentXml = applyDocxEdits(result.documentXml, edits);

  // 拿原 ZIP 其他文件全部 entries，重新打包
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(originalArrayBuffer);

  // 替换 document.xml（其他条目保持原样）
  zip.file('word/document.xml', newDocumentXml);

  return await zip.generateAsync({
    type: 'arraybuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
