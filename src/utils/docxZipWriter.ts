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
 *   4. 双保险：在 word/settings.xml 注入 <w:revisionView w:insDel="0" .../>，
 *      让 Word 默认隐藏 ins/del 显示（不影响 <w:trackChanges/> 记录模式）
 *   5. 把所有 ZIP 条目（含 styles/numbering/headers/footers/theme/media 等）重新打包
 *   6. 输出 ArrayBuffer
 *
 * 修订模式 + 视觉干净双保险设计（spy 工作流需求）：
 *   - 业务要求：保留 <w:ins>/<w:del> 修订数据 + <w:trackChanges/> 记录模式 ON
 *   - 用户痛点：Word 修订模式 ON 时默认显示 ins/del 红波浪线/删除线
 *   - 解决：在 settings.xml 加 <w:revisionView w:insDel="0" .../>，告诉 Word
 *     "默认不显示 ins/del"，但 <w:trackChanges/> 仍 ON，spy 还能继续记录新修订
 *   - 数据安全：ins/del wrapper + w:id + w:author + w:date 全部保留，
 *     spy 切回 "All Markup" 模式可看完整历史
 */

import { applyDocxEdits, type DocxEdit } from './docxWriter';
import { readDocxFromArrayBuffer } from './docxZipReader';

/**
 * <w:revisionView> 元素 —— 所有属性设为 "0" 表示隐藏对应类型修订的显示
 *   w:insDel="0"         隐藏 ins/del 标记（红波浪线 + 删除线）
 *   w:comments="0"       隐藏批注标记
 *   w:formatting="0"     隐藏格式变更标记
 *   w:inkAnnotations="0" 隐藏墨迹注释
 *   w:markup="0"         隐藏所有 markup
 */
const REVISION_VIEW_HIDE_ALL = '<w:revisionView w:insDel="0" w:comments="0" w:formatting="0" w:inkAnnotations="0" w:markup="0"/>';

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

  // 双保险：注入/更新 word/settings.xml 的 <w:revisionView> 让 Word 默认隐藏 ins/del
  const settingsFile = zip.file('word/settings.xml');
  if (settingsFile) {
    const settingsXml = await settingsFile.async('string');
    const updatedSettingsXml = injectRevisionViewHideAll(settingsXml);
    zip.file('word/settings.xml', updatedSettingsXml);
  }

  return await zip.generateAsync({
    type: 'arraybuffer',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

/**
 * 在 word/settings.xml 里注入或更新 <w:revisionView>，属性全设为 "0"。
 *
 * 三种处理：
 *   1. 已有 <w:revisionView .../> → 替换属性
 *   2. 没有 → 在 <w:trackChanges/> 之前插入（OOXML schema 顺序要求）
 *   3. 既没 revisionView 也没 trackChanges → 在 <w:settings> 开标签后插入
 *
 * 注意：<w:trackChanges/> 不动（保留 spy's 修订记录模式）。
 */
function injectRevisionViewHideAll(settingsXml: string): string {
  // 情况 1：已有 <w:revisionView> → 整段替换
  const existingMatch = /<w:revisionView\b[^>]*\/?>/.exec(settingsXml);
  if (existingMatch) {
    return settingsXml.replace(existingMatch[0], REVISION_VIEW_HIDE_ALL);
  }

  // 情况 2：没有 revisionView → 在 <w:trackChanges> 之前插入（schema 顺序：revisionView 在 trackChanges 之前）
  const trackChangesMatch = /<w:trackChanges\b[^>]*\/?>/.exec(settingsXml);
  if (trackChangesMatch) {
    return settingsXml.replace(trackChangesMatch[0], REVISION_VIEW_HIDE_ALL + trackChangesMatch[0]);
  }

  // 情况 3：都没有 → 在 <w:settings ...> 开标签后插入
  const settingsOpenMatch = /<w:settings\b[^>]*>/.exec(settingsXml);
  if (settingsOpenMatch) {
    const insertPos = settingsOpenMatch.index + settingsOpenMatch[0].length;
    return settingsXml.slice(0, insertPos) + REVISION_VIEW_HIDE_ALL + settingsXml.slice(insertPos);
  }

  // 兜底：找不到 <w:settings> 开标签 → 原样返回
  return settingsXml;
}
