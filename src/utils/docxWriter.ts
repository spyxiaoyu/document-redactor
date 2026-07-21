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
 *
 * 关键变更（v5）：按 maskedToken 分组，组内按 edits 输入顺序一对一替换 occurrence。
 * 这样多个不同 originalValue 但相同长度的 maskedToken（纯下划线）能正确恢复，
 * 不再被 applyOneEdit 的 replaceAll 行为覆盖成第一个 edit 的 originalValue。
 *
 * 调用约定：edits 必须按 docx occurrence 顺序排列（即 mappingTable 按 start 升序）。
 * 这是 UploadPage / RestorePage 的现有保证。
 */
export function applyDocxEdits(documentXml: string, edits: DocxEdit[]): string {
  let xml = documentXml;

  // 按 maskedToken 分组，组内保留 edits 输入顺序（=occurrence 顺序）
  const groups: Array<{ token: string; originalValues: string[] }> = [];
  for (const e of edits) {
    if (!e.maskedToken) continue;
    const last = groups[groups.length - 1];
    if (last && last.token === e.maskedToken) {
      last.originalValues.push(e.originalValue);
    } else {
      groups.push({ token: e.maskedToken, originalValues: [e.originalValue] });
    }
  }

  // 按 maskedToken 长度降序处理：长 token 先替换，避免短 token 误匹配到长 token 内部。
  // 例如 `__` 会匹配到 `___________` 内部的 5 个重叠位置，所以 `___________` 必须先替换。
  groups.sort((a, b) => b.token.length - a.token.length);

  // 合并同 token 的 group（按第一次出现顺序保留 originalValues 顺序）
  // 修复：分组时只合并相邻同 token edits，但 sort 后跨距离的同 token group 需要再次合并，
  // 否则会变成多个 1-originalValue group（走 replaceAll 而非 occurrence 配对）。
  const mergedGroups: Array<{ token: string; originalValues: string[] }> = [];
  for (const g of groups) {
    const last = mergedGroups[mergedGroups.length - 1];
    if (last && last.token === g.token) {
      last.originalValues.push(...g.originalValues);
    } else {
      mergedGroups.push({ token: g.token, originalValues: [...g.originalValues] });
    }
  }

  for (const group of mergedGroups) {
    if (group.originalValues.length === 1) {
      // 单 edit：replaceAll 行为（兼容旧测试）
      xml = applyOneEdit(xml, { maskedToken: group.token, originalValue: group.originalValues[0] });
    } else {
      // 多 edit 同 token：按 occurrence 顺序一对一替换
      // 反向处理（从最后一个 occurrence 开始），避免位置偏移
      for (let i = group.originalValues.length - 1; i >= 0; i--) {
        xml = applyNthOccurrenceEdit(xml, group.token, i, group.originalValues[i]);
      }
    }
  }
  return xml;
}

/**
 * 替换 maskedToken 在 documentXml 中的第 N 个（0-indexed）occurrence。
 * 每次调用重新 scanNodes，避免前一次替换改了节点区间导致位置漂移。
 */
function applyNthOccurrenceEdit(
  documentXml: string,
  maskedToken: string,
  occIdx: number,
  originalValue: string,
): string {
  const nodes = scanNodes(documentXml);
  const concatenatedText = nodes.map(n => n.text).join('');

  let currentOccIdx = 0;
  let searchFrom = 0;
  while (searchFrom <= concatenatedText.length) {
    const idx = concatenatedText.indexOf(maskedToken, searchFrom);
    if (idx === -1) break;
    if (currentOccIdx === occIdx) {
      return applyOneOccurrence(documentXml, nodes, idx, idx + maskedToken.length, maskedToken, originalValue);
    }
    currentOccIdx++;
    searchFrom = idx + maskedToken.length;
  }
  console.warn(
    `[applyNthOccurrenceEdit] occurrence #${occIdx} of "${maskedToken}" not found ` +
    `(only ${currentOccIdx} occurrences in docx)`,
  );
  return documentXml;
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
    // 关键：必须精确匹配 <w:t> 或 <w:t ...>（含属性），避免误匹配 <w:tc>、<w:tcPr>、
    // <w:tbl>、<w:tblGrid>、<w:tblPr>、<w:tab/> 等所有以 <w:t 开头的标签。
    // 这些标签的 "inner text" 是表格/XML 结构，被误识别为 w:t 会导致 covering 范围错乱。
    const tStart = findWTextOpen(documentXml, pos);
    // 同时识别下一个 <w:br/>（self-closing）作为 \n 伪节点，与 mammoth 语义对齐：
    // mammoth extractRawText 在 w:br 处输出 \n，所以 scanNodes 的 concatenatedText
    // 也必须在 w:br 处插入 \n，否则 indexOf 永远找不到含 \n 的 maskedToken
    // （例如 spy 真实 docx 里 "费用\n4.1" 这种跨软换行的 AMOUNT 字段）。
    const brStart = findNextSelfClosingWBr(documentXml, pos);

    if (tStart === -1 && brStart === -1) break;

    // 取较近的：t 节点和 br 节点都可能先出现
    const isBr =
      brStart !== -1 && (tStart === -1 || brStart < tStart);

    if (isBr) {
      const brEnd = documentXml.indexOf('>', brStart) + 1;
      result.push({
        idx: idx++,
        text: '\n',
        globalStart: globalCursor,
        globalEnd: globalCursor + 1,
        xmlOpenStart: brStart,
        xmlOpenEnd: brEnd,
        xmlCloseStart: brStart,
        xmlCloseEnd: brEnd,
      });
      globalCursor += 1;
      pos = brEnd;
      continue;
    }

    const openStart = tStart;
    const openTagEnd = documentXml.indexOf('>', openStart);
    if (openTagEnd === -1) break;
    // self-closing w:t? skip
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

/**
 * 找下一个真正的 <w:br/> 或 <w:br .../> self-closing 起始位置。
 * 跳过 <w:break> 之类以 <w:br 开头但不是 br 标签的情况。
 */
function findNextSelfClosingWBr(xml: string, from: number): number {
  let pos = from;
  while (pos < xml.length) {
    const idx = xml.indexOf('<w:br', pos);
    if (idx === -1) return -1;
    // <w:br> 后面那个字符：'>' 或 ' ' 或 '/' 或属性起始
    const c = xml[idx + 5];
    if (c === '>' || c === ' ' || c === '/' || c === '\t' || c === '\n') {
      // 确认 self-closing
      const tagEnd = xml.indexOf('>', idx);
      if (tagEnd === -1) return -1;
      if (xml[tagEnd - 1] !== '/') {
        // <w:br> 单独出现（无 self-close）OOXML 不允许，跳过
        pos = idx + 5;
        continue;
      }
      return idx;
    }
    // 不是 br（可能是 <w:break>、<w:brType> 等），跳过
    pos = idx + 5;
  }
  return -1;
}

/**
 * 找下一个真正的 <w:t> 或 <w:t ...> 起始位置。
 * 跳过 <w:tc>、<w:tbl>、<w:tblPr> 等以 <w:t 开头但不是 <w:t> 的标签。
 */
function findWTextOpen(xml: string, from: number): number {
  let pos = from;
  while (pos < xml.length) {
    const idx = xml.indexOf('<w:t', pos);
    if (idx === -1) return -1;
    const char5 = xml[idx + 4]; // <w:t> 后面那个字符：'>' 或 ' ' 或 其他
    if (char5 === '>' || char5 === ' ' || char5 === '/' || char5 === '\t' || char5 === '\n') {
      // 真正的 w:t 起始
      return idx;
    }
    // 不是 w:t（可能是 <w:tc>、<w:tbl> 等），跳过这个匹配继续找
    pos = idx + 4;
  }
  return -1;
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

  // 关键分支（commit 后续修复）：跨 <w:ins>/<w:del> 边界时禁止 merge。
  // mergeRunsForCoverage 会把 wrapper 内的 inner <w:r> 内容当作"普通 run 块"
  // 跳过，导致 <w:ins></w:ins> 空 wrapper + inner 文本失去 wrapper 包裹。
  // Word 开着修订模式打开时，空 <w:ins> 触发生成"插入修订标记"，
  // 叠加原 <w:del> 红波浪线 → 视觉段落错位（spy 截图 bug 复现）。
  const first = covering[0];
  const last = covering[covering.length - 1];
  const runStart = findRunStart(documentXml, first.xmlOpenStart);
  const runEnd = findRunEnd(documentXml, last.xmlCloseEnd);
  if (runStart >= 0 && runEnd > runStart && hasInsOrDelBoundary(documentXml, runStart, runEnd)) {
    return applyPerNodeReplacement(documentXml, covering, maskedToken, originalValue, globalStart);
  }

  return mergeRunsForCoverage(documentXml, covering, maskedToken, originalValue);
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
 *
 * 重要（spy 截图 bug 修复）：原实现在 [runStart, runEnd) 区间内只重建一个 <w:r>，
 * 会把区间内的所有内容都丢掉，包括 <w:proofErr/>、<w:bookmarkStart/>、<w:bookmarkEnd/>
 * 等段落级 sibling 元素。这些元素**不是 <w:r> 的子元素**，是 <w:p> 的直接子元素
 * （OOXML 规范要求）。
 *
 * spy 真实 docx 50KB 测试科技合同里 "示例公司（北京）融媒体科技文化有限公司" 跨 3 个
 * <w:r>，中间夹 2 个 <w:proofErr/>。mergeRunsForCoverage 把区间内的 proofErr 一起删了，
 * Word/WPS 重新分词时把"run 边界突变 + proofErr 消失"理解为重新换行点 → 截图里的
 * "提行不连贯、影响阅读"。
 *
 * 修法：从 [runStart, runEnd) 区间内提取出所有非 <w:r> 元素（即 sibling），放在新
 * merged run 之前保留。
 */
function mergeRunsForCoverage(
  documentXml: string,
  covering: PositionedTextNode[],
  maskedToken: string,
  originalValue: string,
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

  // 6. 提取 [runStart, runEnd) 区间内的 sibling 元素（<w:proofErr/>, <w:bookmarkStart/> 等）
  //    它们是 <w:p> 的直接子元素，不能放进 <w:r> 里，必须保留在原位置（这里放在 merged run 之前）
  const middleContent = documentXml.slice(runStart, runEnd);
  const preservedSiblings = extractSiblingElementsFromRuns(middleContent);

  // 7. 拼回：保留的 siblings + 新的 merged run
  const newRunXml = `${preservedSiblings}<w:r>${rPrBlock}<w:t xml:space="preserve">${safeText}</w:t></w:r>`;
  return documentXml.slice(0, runStart) + newRunXml + documentXml.slice(runEnd);
}

/**
 * 从一段包含 <w:r>...</w:r> 块的内容里，提取出所有不在 <w:r> 内的 sibling 元素。
 *
 * OOXML 段落级 sibling 包括但不限于：
 *   - <w:proofErr/>（语法错误标记）
 *   - <w:bookmarkStart/> / <w:bookmarkEnd/>（书签）
 *   - <w:commentRangeStart/> / <w:commentRangeEnd/>（批注范围）
 *   - <w:hyperlink>...</w:hyperlink>（超链接，包裹 <w:r>）
 *
 * 这些元素在 <w:p> 里和 <w:r> 是兄弟关系，**不能**被放进 <w:r> 内部（OOXML schema
 * 不允许）。mergeRunsForCoverage 替换 [runStart, runEnd) 时如果一并吞掉它们，
 * 会破坏段落结构（Word/WPS 重新分词换行）。
 *
 * 实现：扫描 content，跳过每个 <w:r>...</w:r> 块，收集中间的 raw XML 字符串。
 */
function extractSiblingElementsFromRuns(content: string): string {
  const result: string[] = [];
  let pos = 0;
  while (pos < content.length) {
    // 找下一个真正的 <w:r> 或 <w:r ...> 起始（不能是 <w:rPr/> 等）
    const rOpenIdx = findRunOpenInString(content, pos);
    if (rOpenIdx === -1) {
      // 没有更多 <w:r>，剩下全是 sibling
      if (pos < content.length) result.push(content.slice(pos));
      break;
    }
    // <w:r> 之前的内容（pos..rOpenIdx）就是 sibling
    if (rOpenIdx > pos) {
      result.push(content.slice(pos, rOpenIdx));
    }
    // 跳过整个 <w:r>...</w:r> 块
    const rCloseIdx = content.indexOf('</w:r>', rOpenIdx);
    if (rCloseIdx === -1) break;
    pos = rCloseIdx + '</w:r>'.length;
  }
  return result.join('');
}

/**
 * 在 content 字符串里找下一个真正的 <w:r> 起始位置（<w:r> 或 <w:r ...>）。
 * 排除 <w:rPr/> / <w:rPr> / <w:rFonts> 等以 <w:r 开头但不是 <w:r> 的标签。
 */
function findRunOpenInString(content: string, from: number): number {
  let pos = from;
  while (pos < content.length) {
    const idx = content.indexOf('<w:r', pos);
    if (idx === -1) return -1;
    const char5 = content[idx + 4];
    if (char5 === '>' || char5 === ' ') {
      return idx;
    }
    // 不是 <w:r>（可能是 <w:rPr>, <w:rFonts> 等），跳过
    pos = idx + 4;
  }
  return -1;
}

/**
 * 检查 [start, end) 区间内是否含 <w:ins> 或 <w:del> 边界标签（开闭标签都算）。
 *
 * 用于检测 maskedToken 区间是否跨过 OOXML 修订追踪 wrapper。如果跨过，
 * mergeRunsForCoverage 会破坏 wrapper 完整性（inner <w:r> 丢失 + 空 wrapper），
 * 必须改走 applyPerNodeReplacement per-node 替换。
 *
 * 字符级精确匹配：用 `<\/?w:(ins|del)\b` 排除 <w:insId> / <w:delText>
 * 等以 ins/del 开头但不是 ins/del 标签的情况。
 */
function hasInsOrDelBoundary(xml: string, start: number, end: number): boolean {
  const content = xml.slice(start, end);
  return /<\/?w:(ins|del)\b/.test(content);
}

/**
 * 跨 <w:ins>/<w:del> 边界的 per-node replacement —— 禁止 mergeRunsForCoverage。
 *
 * 为什么不 merge？
 *   - <w:ins>/<w:del> 是 OOXML 的修订追踪 wrapper，wrapper 完整性必须保留
 *   - mergeRunsForCoverage 会把 wrapper 内的 inner <w:r> 内容吸出来合并，
 *     导致 <w:ins></w:ins> 空 wrapper + inner 文本失去 wrapper 包裹
 *   - Word 开着修订模式打开时，空 <w:ins> 触发生成"插入修订标记"，
 *     叠加原 <w:del> 红波浪线 → 视觉段落错位（spy 截图 bug）
 *
 * 替代方案：每个 covering <w:t> 节点独立替换自己的 maskedToken 切片，
 * 保留所有 <w:ins>/<w:del> wrapper 完整性。
 *
 * 实现：从后往前处理每个节点（避免位置偏移），按 maskedToken 切片位置
 * 切 originalValue，写回对应 <w:t> 的 innerText。
 *
 * maskedToken 和 originalValue 可能不等长（如 restore 时 mask token 比原文长），
 * 按比例切 originalValue。如果 maskedToken.length === originalValue.length
 * （这是本 codebase 的常见情况），切片是 1:1 对应。
 */
function applyPerNodeReplacement(
  documentXml: string,
  covering: PositionedTextNode[],
  maskedToken: string,
  originalValue: string,
  globalStart: number,
): string {
  let result = documentXml;
  const globalEnd = globalStart + maskedToken.length;

  // 从后往前处理（避免位置偏移）
  const sortedCovering = [...covering].sort((a, b) => b.globalStart - a.globalStart);

  for (const node of sortedCovering) {
    // 本节点覆盖 maskedToken 区间的范围
    const nodeStart = Math.max(node.globalStart, globalStart);
    const nodeEnd = Math.min(node.globalEnd, globalEnd);
    if (nodeStart >= nodeEnd) continue;

    // maskedToken 切片
    const maskedSliceOffset = nodeStart - globalStart;
    const maskedSliceLength = nodeEnd - nodeStart;

    // originalValue 对应切片（按比例切，长度可能不等）
    const sliceRatio = originalValue.length / maskedToken.length;
    const origSliceStart = Math.floor(maskedSliceOffset * sliceRatio);
    let origSliceEnd = Math.floor((maskedSliceOffset + maskedSliceLength) * sliceRatio);
    // 防止切片为空（边界情况：originalValue 极短）
    if (origSliceEnd <= origSliceStart && maskedSliceLength > 0) {
      origSliceEnd = origSliceStart + 1;
    }
    const newTextSlice = originalValue.slice(origSliceStart, origSliceEnd);

    // XML 实体转义（与 mergeRunsForCoverage 对齐）
    const safeSlice = newTextSlice
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 替换本节点 innerText 的 [offsetInNode, offsetInNode+maskedSliceLength)
    const offsetInNode = nodeStart - node.globalStart;
    const innerText = result.slice(node.xmlOpenEnd, node.xmlCloseStart);
    const newInnerText =
      innerText.slice(0, offsetInNode) +
      safeSlice +
      innerText.slice(offsetInNode + maskedSliceLength);

    result = result.slice(0, node.xmlOpenEnd) + newInnerText + result.slice(node.xmlCloseStart);
  }

  return result;
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
