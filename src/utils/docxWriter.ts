/**
 * B 方案 docx 写回器 v4：
 *   - 给定 word/document.xml 字符串 + 一组 (maskedToken, originalValue) 编辑
 *   - 在 w:t 节点文本里查找 maskedToken → 替换为 originalValue
 *
 * 关键设计（v4）：
 *   - extractTextNodes 同时给出 w:t 节点在 documentXml 里的精确字符区间 [openStart, closeEnd)
 *     而不是用指纹匹配 innerText（指纹匹配对跨节点 case 无效）
 *   - 替换路径基于 textNodes 区间，covering 多节点时合并相邻 w:r
 */

export interface DocxEdit {
  maskedToken: string;
  originalValue: string;
}

/**
 * 给 document.xml + edits，返回替换后的 document.xml 字符串。
 */
export function applyDocxEdits(documentXml: string, edits: DocxEdit[]): string {
  let xml = documentXml;
  // 重新扫描每个 edit 的 textNodes（因为前一个 edit 可能改了节点区间）
  // 这里我们采用增量更新：每次 edit 后重新扫描
  for (const edit of edits) {
    xml = applyOneEdit(xml, edit);
  }
  return xml;
}

/**
 * Enhanced TextNodeInfo: 包含 documentXml 字符串里的精确位置
 */
interface PositionedTextNode {
  idx: number;
  text: string;
  globalStart: number;     // 在 concatenatedText 里
  globalEnd: number;
  xmlOpenStart: number;    // <w:t 起始位置（含 <）
  xmlOpenEnd: number;      // > 之后一位（inner text 起始）
  xmlCloseStart: number;   // </w:t 的 < 位置
  xmlCloseEnd: number;     // </w:t 之后一位（inner text 结束）
}

function scanNodes(documentXml: string): PositionedTextNode[] {
  const result: PositionedTextNode[] = [];
  let globalCursor = 0;
  let pos = 0;
  let idx = 0;
  while (pos < documentXml.length) {
    const openStart = documentXml.indexOf('<w:t', pos);
    if (openStart === -1) break;
    const openTagEnd = documentXml.indexOf('>', openStart);
    if (openTagEnd === -1) break;
    // self-closing? skip
    if (documentXml[openTagEnd - 1] === '/') {
      pos = openTagEnd + 1;
      continue;
    }
    const closeStart = documentXml.indexOf('</w:t>', openTagEnd);
    if (closeStart === -1) break;
    const innerText = documentXml.slice(openTagEnd + 1, closeStart);
    result.push({
      idx: idx++,
      text: innerText,
      globalStart: globalCursor,
      globalEnd: globalCursor + innerText.length,
      xmlOpenStart: openStart,
      xmlOpenEnd: openTagEnd + 1,
      xmlCloseStart: closeStart,
      xmlCloseEnd: closeStart + '</w:t>'.length,
    });
    globalCursor += innerText.length;
    pos = closeStart + '</w:t>'.length;
  }
  return result;
}

function applyOneEdit(documentXml: string, edit: DocxEdit): string {
  const { maskedToken, originalValue } = edit;
  if (!maskedToken) return documentXml;

  const nodes = scanNodes(documentXml);
  const concatenatedText = nodes.map(n => n.text).join('');

  // 收集所有 occurrence
  type Occ = { globalStart: number; globalEnd: number };
  const occurrences: Occ[] = [];
  let searchFrom = 0;
  while (searchFrom < concatenatedText.length) {
    const idx = concatenatedText.indexOf(maskedToken, searchFrom);
    if (idx === -1) break;
    occurrences.push({ globalStart: idx, globalEnd: idx + maskedToken.length });
    searchFrom = idx + maskedToken.length;
  }

  // 从后往前替换（不影响前面 position）
  const sorted = [...occurrences].sort((a, b) => b.globalStart - a.globalStart);
  let result = documentXml;
  for (const occ of sorted) {
    result = applyOneOccurrence(result, nodes, occ.globalStart, occ.globalEnd, maskedToken, originalValue);
  }
  return result;
}

function applyOneOccurrence(
  documentXml: string,
  nodes: PositionedTextNode[],
  globalStart: number,
  globalEnd: number,
  maskedToken: string,
  originalValue: string,
): string {
  // 找覆盖 [globalStart, globalEnd) 的所有 w:t 节点
  const covering: PositionedTextNode[] = [];
  for (const n of nodes) {
    if (n.globalEnd <= globalStart) continue;
    if (n.globalStart >= globalEnd) break;
    covering.push(n);
  }
  if (covering.length === 0) return documentXml;

  if (covering.length === 1) {
    return replaceSingleNode(documentXml, covering[0], globalStart, maskedToken, originalValue);
  }
  return mergeRunsForCoverage(documentXml, covering, maskedToken, originalValue, globalStart, globalEnd);
}

/**
 * 单节点替换：直接替换 w:t 节点的 innerText 中 [offsetInNode, offsetInNode+tokenLen) 段。
 */
function replaceSingleNode(
  documentXml: string,
  node: PositionedTextNode,
  globalStart: number,
  maskedToken: string,
  originalValue: string,
): string {
  const offsetInNode = globalStart - node.globalStart;
  const innerText = documentXml.slice(node.xmlOpenEnd, node.xmlCloseStart);
  const newInnerText =
    innerText.slice(0, offsetInNode) +
    originalValue +
    innerText.slice(offsetInNode + maskedToken.length);

  return (
    documentXml.slice(0, node.xmlOpenEnd) +
    newInnerText +
    documentXml.slice(node.xmlCloseStart)
  );
}

/**
 * 跨节点替换：合并 covering 区间内的 w:r。
 * 简化：保留第一个 covering 节点所在的 w:r 的 rPr，删除中间所有 w:r（含 w:proofErr / w:r），
 *       替换为单个 w:r <w:r>...newCombinedText...</w:r>。
 *
 * 实现：从第一个 covering 节点的 <w:t 之前找最近的 <w:r 起点（不含在 <w:rPr/> 里），
 *       到最后一个 covering 节点的 </w:t> 之后找最近的 </w:r> 终点。
 */
function mergeRunsForCoverage(
  documentXml: string,
  covering: PositionedTextNode[],
  maskedToken: string,
  originalValue: string,
  globalStart: number,
  globalEnd: number,
): string {
  const first = covering[0];
  const last = covering[covering.length - 1];

  // 1. 找第一个 <w:r 起点（从 first.xmlOpenStart 向前搜索）
  const runStart = findRunStart(documentXml, first.xmlOpenStart);

  // 2. 找最后一个 </w:r> 终点（从 last.xmlCloseEnd 向后搜索）
  const runEnd = findRunEnd(documentXml, last.xmlCloseEnd);

  if (runStart === -1 || runEnd === -1 || runStart >= runEnd) {
    console.warn('[applyDocxEdits] failed to find run boundaries, skipping cross-node replace');
    return documentXml;
  }

  // 3. 拿第一个 w:r 的 rPr
  const rPrStart = documentXml.indexOf('<w:rPr>', runStart);
  let rPrBlock = '';
  if (rPrStart >= 0 && rPrStart < runEnd) {
    const rPrEnd = documentXml.indexOf('</w:rPr>', rPrStart);
    if (rPrEnd > rPrStart) {
      rPrBlock = documentXml.slice(rPrStart, rPrEnd + '</w:rPr>'.length);
    }
  }

  // 4. 拼接 covering 节点文本 + 替换 maskedToken
  let combinedText = '';
  for (const n of covering) {
    combinedText += n.text;
  }
  const newCombinedText = combinedText.split(maskedToken).join(originalValue);

  // 5. XML 实体转义
  const safeText = newCombinedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 6. 拼回
  const newRunXml = `<w:r>${rPrBlock}<w:t xml:space="preserve">${safeText}</w:t></w:r>`;
  return documentXml.slice(0, runStart) + newRunXml + documentXml.slice(runEnd);
}

/**
 * 在 documentXml 里从 position 向前找最近的 <w:r 起点（包括 <w:r> 和 <w:r ...>）。
 * 排除 <w:rPr/> / <w:rPr> 之类（不是 <w:r>）。
 */
function findRunStart(documentXml: string, position: number): number {
  for (let i = position - 1; i >= 0; i--) {
    if (documentXml.slice(i, i + 4) === '<w:r' &&
        (documentXml[i + 4] === '>' || documentXml[i + 4] === ' ')) {
      return i;
    }
    if (documentXml.slice(i, i + 5) === '</w:r>') {
      // 已经遇到上一个 w:r 的 end tag，说明当前位置在 w:r 之外
      return -1;
    }
  }
  return -1;
}

function findRunEnd(documentXml: string, position: number): number {
  const idx = documentXml.indexOf('</w:r>', position);
  if (idx === -1) return -1;
  return idx + '</w:r>'.length;
}
