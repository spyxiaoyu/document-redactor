/**
 * DocxZipReader: 用 JSZip 读 .docx ZIP → 提取 word/document.xml 的 w:t 文本节点。
 *
 * 不解 OOXML 全树，只关心 <w:t>...</w:t> 节点的文本内容，按出现顺序拼起来，
 * 拿到每个 w:t 节点在"拼好全文"里的起止位置。
 *
 * 用正则而不是 DOMParser：
 *   - DOMParser(text/html) 不认 namespace 前缀，w:t 拿不到
 *   - DOMParser(application/xml) 在 jsdom 行为不一致，浏览器原生则 OK
 *   - 正则只关心 <w:t> 内容 + 上一个 </w:t> 边界，对我们的需求（替换文本节点字符串）够用
 */

const W_T_OPEN = /<w:t(?:\s[^>]*)?>/g;
const W_T_CLOSE = /<\/w:t>/g;

export interface TextNodeInfo {
  /** 在 w:t 节点数组里的下标 */
  idx: number;
  /** 该节点原始文本内容 */
  text: string;
  /** 在 concatenatedText 里的起始位置 */
  globalStart: number;
  /** 在 concatenatedText 里的结束位置（exclusive） */
  globalEnd: number;
}

export interface DocxReadResult {
  /** ZIP 里所有文件名（key list） */
  fileNames: string[];
  /** word/document.xml 的原始字符串 */
  documentXml: string;
  /** 所有 w:t 节点（按 DOM 顺序） */
  textNodes: TextNodeInfo[];
  /** 把所有 w:t 节点的 textContent 按 DOM 顺序拼起来 */
  concatenatedText: string;
}

/**
 * 从 ArrayBuffer 读 docx，提取 document.xml + w:t 节点信息
 */
export async function readDocxFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<DocxReadResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const fileNames = Object.keys(zip.files);

  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('word/document.xml not found in docx ZIP');
  const documentXml = await documentFile.async('string');

  const textNodes = extractTextNodes(documentXml);
  const concatenatedText = textNodes.map(n => n.text).join('');

  return { fileNames, documentXml, textNodes, concatenatedText };
}

/**
 * 从 document.xml 字符串提取所有 <w:t>...</w:t> 节点 + 全局位置。
 * 位置按"该节点 textContent 在所有 w:t 串联后的字符串里"的起止算。
 */
export function extractTextNodes(documentXml: string): TextNodeInfo[] {
  // 收集每个 w:t 节点边界：start (含 <w:t>) 和 end (含 </w:t>)
  // 这里只需要文本，不关心 XML attribute，用一个 pass 扫一次。
  const nodes: TextNodeInfo[] = [];
  let globalCursor = 0;
  let idx = 0;

  // 用一个手写扫描器，避免正则跨节点边界时出错（例如嵌套/转义）
  let pos = 0;
  while (pos < documentXml.length) {
    const openStart = documentXml.indexOf('<w:t', pos);
    if (openStart === -1) break;

    // 跳过 <w:tbl /> 这类 self-closing 的情况（这些不算 w:t 节点，是 w:tbl 表格标签）
    const selfCloseEnd = documentXml.indexOf('/>', openStart);
    const openTagEnd = documentXml.indexOf('>', openStart);
    if (openTagEnd === -1) break;

    const isSelfClosing = documentXml[openTagEnd - 1] === '/';
    if (isSelfClosing) {
      pos = openTagEnd + 1;
      continue;
    }

    // 找匹配的 </w:t>
    const closeStart = documentXml.indexOf('</w:t>', openTagEnd);
    if (closeStart === -1) break;

    const innerText = documentXml.slice(openTagEnd + 1, closeStart);
    nodes.push({
      idx: idx++,
      text: innerText,
      globalStart: globalCursor,
      globalEnd: globalCursor + innerText.length,
    });
    globalCursor += innerText.length;
    pos = closeStart + '</w:t>'.length;
  }

  return nodes;
}

/**
 * 在 docxReadResult.concatenatedText 里找 token 的所有出现位置，
 * 返回对应 w:t 节点的下标（如果该 token 跨多个 w:t 节点，返回 null 让调用方知道）。
 *
 * 这是 B 方案的核心决策点：脱敏 token（[NAME_0001] 等）会不会被 OOXML 跨节点拆开？
 * 如果会，B 方案要做跨 w:t 节点合并 / 部分替换，复杂度 + 一档。
 * 如果不会，简单的"按 token 在拼接文本里的位置 → 反查 w:t 节点 → 替换该节点 textContent"就够。
 */
export function locateTokenInTextNodes(
  result: DocxReadResult,
  token: string,
): Array<{ textNodeIdx: number; offsetInNode: number; globalOffset: number }> | null {
  const haystack = result.concatenatedText;
  const occurrences: Array<{ textNodeIdx: number; offsetInNode: number; globalOffset: number }> = [];
  let searchFrom = 0;
  while (searchFrom < haystack.length) {
    const foundAt = haystack.indexOf(token, searchFrom);
    if (foundAt === -1) break;

    // 反查：在 result.textNodes 里找覆盖 [foundAt, foundAt+token.length) 区间的节点
    const coveringNodes = result.textNodes.filter(
      n => !(n.globalEnd <= foundAt || n.globalStart >= foundAt + token.length),
    );

    if (coveringNodes.length === 0) {
      // token 不在拼接文本里 —— 不可能，说明 token 来源有问题
      throw new Error(`Token ${token} not located in any textNode`);
    }
    if (coveringNodes.length > 1) {
      // token 跨多个 w:t 节点 —— B 方案要处理这个边界
      // 现在返回 null 让调用方分情况处理
      return null;
    }

    const covering = coveringNodes[0];
    occurrences.push({
      textNodeIdx: covering.idx,
      offsetInNode: foundAt - covering.globalStart,
      globalOffset: foundAt,
    });
    searchFrom = foundAt + token.length;
  }

  return occurrences;
}
