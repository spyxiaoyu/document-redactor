import { useState, useCallback, useRef, useEffect } from 'react';
import type { ReactElement } from 'react';
import { useFileStore } from '@/stores';
import { FileUploader, FileCard } from '@/components/file';
import { SensitivePanel } from '@/components/sensitive';
import { SearchResultsPanel, type SearchHit } from '@/components/search';
import { Button, Input, Modal, Progress } from '@/components/common';
import { Shield, Download, Lock, RefreshCw, Plus, Search, Check, MousePointer2 } from 'lucide-react';
import type { SensitiveMatch, MappingEntry } from '@/types';
import { CryptoManager } from '@/engines/CryptoManager';
import { generateUUID } from '@/utils';
import { buildHighlightParts } from '@/utils/highlight';
// writeDocxFromEdits / JSZip 都改为动态引入，只在导出 docx 时才下载 ~91KB gzip

const MAX_DESENSITIZE_CHARS = 500_000;

export function UploadPage() {
  // 订阅整个 store，任意字段变化都触发 re-render
  const storeState = useFileStore();
  const { selectedMatches, renderKey } = storeState;
  const {
    currentFile,
    parsedDocument,
    sensitiveMatches,
    desensitizedContent,
    isProcessing,
    error,
    mappingTable: storeMappingTable,
    setFile,
    parseFile,
    toggleMatchSelection,
    selectAllMatches,
    deselectAllMatches,
    desensitize,
    addManualMatch,
    removeMatch,
    reset
  } = storeState;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordModalSource, setPasswordModalSource] = useState<'download' | 'desensitize'>('desensitize');
  const [passwordError, setPasswordError] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  // 两步骤搜索脱敏：第一步查到的命中位置
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'original' | 'docx' | 'txt'>('original');
  const [addBtnPos, setAddBtnPos] = useState<{ x: number; y: number } | null>(null);
  // 本地镜像 selectedMatches，保证 useMemo/useCallback 拿到最新引用
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());

  // 用于 DOCX 内嵌元数据的加密管理器
  const cryptoManagerRef = useRef(new CryptoManager());
  // 保存脱敏密码，用于下载时加密内嵌元数据
  const downloadPasswordRef = useRef<string>('');

  // 提前到顶层：handler 里要用到，必须在 useCallback 之前声明
  const originalTextFull = parsedDocument?.rawText || '';
  const previewText = originalTextFull.length > MAX_DESENSITIZE_CHARS
    ? originalTextFull.slice(0, MAX_DESENSITIZE_CHARS)
    : originalTextFull;

  // selectedMatches 变化时同步到本地
  useEffect(() => {
    setLocalSelected(new Set(selectedMatches));
  }, [selectedMatches, renderKey]);

  // 文件解析后：自动全选所有敏感词
  useEffect(() => {
    if (sensitiveMatches.length > 0 && selectedMatches.size === 0) {
      selectAllMatches();
    }
  }, [sensitiveMatches]);

  // 切文件时清空搜索脱敏状态。
  // Bug：之前 user 上传文件 A 后搜索"abc"得到 3 个 hits，直接拖拽文件 B（不走 reset）
  // → searchHits / searchKeyword 仍残留 A 的数据 → 在新文件渲染搜索结果面板误导用户。
  // 兜底：handleReset + handleFileSelect 也会清，但 useEffect 是 single source of truth。
  useEffect(() => {
    setSearchHits([]);
    setSearchKeyword('');
  }, [parsedDocument]);

  // 同步滚动 refs（分开标记，防止互相触发死循环）
  const originalPanelRef = useRef<HTMLDivElement>(null);
  const maskedPanelRef = useRef<HTMLDivElement>(null);
  const isLeftScrolling = useRef(false);
  const isRightScrolling = useRef(false);

  const handleOriginalScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isLeftScrolling.current) return;
    isRightScrolling.current = true;
    // 立即同步（不用 RAF，避免执行时机错位）
    if (maskedPanelRef.current) {
      maskedPanelRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    // 右侧同步完后放开锁
    isRightScrolling.current = false;
  }, []);

  const handleMaskedScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isRightScrolling.current) return;
    isLeftScrolling.current = true;
    if (originalPanelRef.current) {
      originalPanelRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    isLeftScrolling.current = false;
  }, []);

  // 两步骤搜索脱敏：第一步 = 在原文中找出所有命中位置，列出"含此关键词的条款"
  // 搜索范围限定 previewText（截断后可见的部分）：
  //   - 避免大文件全文本搜索浪费内存
  //   - 避免命中超出预览区时 mark 不渲染、jump 跳转 no-op
  //   - previewText 是 originalTextFull 的前缀切片，所以 hit.start 仍是 originalTextFull 里的有效坐标
  const handleSearchKeyword = useCallback((keyword: string) => {
    setSearchKeyword(keyword);
    if (!keyword || keyword.length < 2 || !previewText) {
      setSearchHits([]);
      return;
    }

    // 大小写不敏感搜索（找位置），但 value 用原文 case（用于后续 addManualMatch）
    const lowerText = previewText.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const hits: SearchHit[] = [];
    let pos = 0;
    let idx = 0;
    while (pos <= lowerText.length) {
      const found = lowerText.indexOf(lowerKeyword, pos);
      if (found === -1) break;
      const start = found;
      const end = found + keyword.length;
      const contextBeforeRaw = previewText.slice(Math.max(0, start - 30), start);
      const contextAfterRaw = previewText.slice(end, Math.min(previewText.length, end + 30));
      hits.push({
        index: idx,
        start,
        end,
        value: previewText.slice(start, end),
        contextBefore: contextBeforeRaw.length === 30 ? '…' + contextBeforeRaw.slice(-29) : contextBeforeRaw,
        contextAfter: contextAfterRaw.length === 30 ? contextAfterRaw.slice(0, 29) + '…' : contextAfterRaw,
      });
      pos = start + 1;
      idx++;
    }
    setSearchHits(hits);
  }, [previewText]);

  // 把 SearchResultsPanel 选中的命中转成 sensitive match
  // 关键：按 hit.value（原文真实 case）分组，对每个 unique value 调一次 addManualMatch。
  // 这样无论用户输入的 keyword case 与原文是否一致，所有命中都被正确脱敏且保留原文大小写。
  const handleAddCheckedSearchHits = useCallback((indices: number[]) => {
    if (indices.length === 0) return;
    const checkedHits = searchHits.filter(h => indices.includes(h.index));
    if (checkedHits.length === 0) return;

    // 按 value 分组（同一 value 的位置一起处理）
    const byValue = new Map<string, number[]>();
    checkedHits.forEach(h => {
      const arr = byValue.get(h.value) || [];
      arr.push(h.start);
      byValue.set(h.value, arr);
    });

    let totalAdded = 0;
    byValue.forEach((positions, value) => {
      addManualMatch(value, positions);
      totalAdded += positions.length;
    });

    setToast(`已添加 ${totalAdded} 处为敏感词`);
    setTimeout(() => setToast(null), 2000);
    setSearchHits([]);
    setSearchKeyword('');
  }, [searchHits, addManualMatch]);

  // 一键全部脱敏：用每个 hit 的 value（原文真实 case），按 value 分组调 addManualMatch
  const handleAddAllSearchHits = useCallback(() => {
    if (searchHits.length === 0) return;

    const byValue = new Map<string, number[]>();
    searchHits.forEach(h => {
      const arr = byValue.get(h.value) || [];
      arr.push(h.start);
      byValue.set(h.value, arr);
    });

    let totalAdded = 0;
    byValue.forEach((positions, value) => {
      addManualMatch(value, positions);
      totalAdded += positions.length;
    });

    setToast(`已添加 ${totalAdded} 处为敏感词`);
    setTimeout(() => setToast(null), 2000);
    setSearchHits([]);
    setSearchKeyword('');
  }, [searchHits, addManualMatch]);

  // 关闭搜索结果面板
  const handleClearSearch = useCallback(() => {
    setSearchHits([]);
    setSearchKeyword('');
  }, []);

  // 跳转到指定 hit 在原文的位置
  // hit 在 DOM 里的 id 格式: search-hit-{index}-s{partIdx}-{hitIdx}（跨 part 时多个 slice）
  // 用 querySelectorAll + first 定位到 hit 起点 slice
  const handleJumpToSearchHit = useCallback((index: number) => {
    setTimeout(() => {
      // 找第一个 data-search-hit={index} 的元素（hit 起点）
      const el = document.querySelector(`[data-search-hit="${index}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
  }, []);

  const handleFileSelect = useCallback(
    (file: File) => {
      // 切文件前同步清掉旧文件的搜索脱敏状态，
      // 避免大文件 parse 期间旧 searchHits 仍然渲染（useEffect cleanup 在 parseFile 完成才触发）。
      setSearchHits([]);
      setSearchKeyword('');
      setFile(file);
      parseFile();
    },
    [setFile, parseFile]
  );

  const handleDesensitize = useCallback(async () => {
    if (password !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      setPasswordError('密码长度至少6位');
      return;
    }
    setPasswordError('');
    downloadPasswordRef.current = password;
    await desensitize(password);
    setShowPasswordModal(false);
    setPassword('');
    setConfirmPassword('');
  }, [password, confirmPassword, desensitize]);

  // 下载时用密码：modal 确认后调用（保存密码后直接下载）
  const handleDownloadWithPassword = useCallback(async () => {
    if (password !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      setPasswordError('密码长度至少6位');
      return;
    }
    setPasswordError('');
    downloadPasswordRef.current = password;
    setShowPasswordModal(false);
    setPassword('');
    setConfirmPassword('');
    // 执行实际下载（复用 handleDownload 的核心逻辑）
    const fullText = parsedDocument!.rawText || '';
    const wasTruncated = fullText.length > MAX_DESENSITIZE_CHARS;
    const src = wasTruncated ? fullText.slice(0, MAX_DESENSITIZE_CHARS) : fullText;
    if (!src) return;
    if (wasTruncated) {
      setToast(`文件过大（${fullText.length} 字符），已截断到前 ${MAX_DESENSITIZE_CHARS} 字符`);
      setTimeout(() => setToast(null), 3000);
    }
    const mappingTable: MappingEntry[] = [];
    const sorted = [...sensitiveMatches].sort((a, b) => a.start - b.start);
    let offset = 0;
    for (const m of sorted) {
      if (!localSelected.has(m.id)) continue;
      const maskedLen = m.end - m.start;
      mappingTable.push({
        id: generateUUID(),
        type: m.type,
        originalValue: m.value,
        maskedToken: '_'.repeat(maskedLen),
        position: { start: m.start + offset, end: m.start + offset + maskedLen }
      });
      offset += maskedLen - m.value.length;
    }
    const text = getDesensitizedText(src, sensitiveMatches, localSelected);
    if (exportFormat === 'txt') {
      const blob = new Blob([text], { type: 'text/plain' });
      triggerDownload(blob, parsedDocument!.ast.metadata.fileName.replace(/\.[^.]+$/, '') + '_脱敏.txt');
    } else {
      const originalArrayBuffer = currentFile ? await currentFile.arrayBuffer() : null;
      await buildDesensitizedDocx(text, mappingTable, parsedDocument!.ast.metadata.fileName, originalArrayBuffer);
    }
  }, [password, confirmPassword, parsedDocument, localSelected, sensitiveMatches, exportFormat, currentFile, storeMappingTable]);

  const handleDownload = useCallback(async () => {
    if (!parsedDocument) return;

    // 如果没有设置密码，先弹窗要求输入（避免用硬编码密码加密导致恢复失败）
    if (!downloadPasswordRef.current) {
      setPasswordModalSource('download');
      setShowPasswordModal(true);
      return;
    }

    const fullText = parsedDocument.rawText || '';
    const wasTruncated = fullText.length > MAX_DESENSITIZE_CHARS;
    const src = wasTruncated ? fullText.slice(0, MAX_DESENSITIZE_CHARS) : fullText;
    if (!src) return;
    if (wasTruncated) {
      setToast(`文件过大（${fullText.length} 字符），已截断到前 ${MAX_DESENSITIZE_CHARS} 字符`);
      setTimeout(() => setToast(null), 3000);
    }

    // 实时生成 mappingTable（与 getDesensitizedText 完全对齐，用 _ 序列作为 token）
    const mappingTable: MappingEntry[] = [];
    const sorted = [...sensitiveMatches].sort((a, b) => a.start - b.start);
    let offset = 0;
    for (const m of sorted) {
      if (!localSelected.has(m.id)) continue;
      const maskedLen = m.end - m.start;
      mappingTable.push({
        id: generateUUID(),
        type: m.type,
        originalValue: m.value,
        maskedToken: '_'.repeat(maskedLen),
        position: { start: m.start + offset, end: m.start + offset + maskedLen }
      });
      offset += maskedLen - m.value.length;
    }

    const text = getDesensitizedText(src, sensitiveMatches, localSelected);
    if (exportFormat === 'txt') {
      const blob = new Blob([text], { type: 'text/plain' });
      triggerDownload(blob, parsedDocument.ast.metadata.fileName.replace(/\.[^.]+$/, '') + '_脱敏.txt');
    } else {
      // docx / original：生成带内嵌元数据的 DOCX
      const originalArrayBuffer = currentFile ? await currentFile.arrayBuffer() : null;
      await buildDesensitizedDocx(text, mappingTable, parsedDocument.ast.metadata.fileName, originalArrayBuffer);
    }
  }, [exportFormat, parsedDocument, localSelected, sensitiveMatches, currentFile, storeMappingTable]);

  // 生成带内嵌元数据的 DOCX（mappingTable 加密存储在 docProps/desensitizer.xml）
  // B 方案主路径：在原 docx 字节上做 token → originalValue 替换，保留原表格/页眉/页脚/字体；
  // 失败兜底：原字节缺失/非 docx 时，fallback 到 docx 库从零重建（保留当前兜底行为）。
  const buildDesensitizedDocx = async (
    text: string,
    mappingTable: MappingEntry[],
    originalFileName: string,
    originalArrayBuffer: ArrayBuffer | null
  ) => {
    const password = downloadPasswordRef.current;
    if (!password) throw new Error('请先设置下载密码');

    // 0. 优先用 store 里的 unique token（视觉下划线 + 隐藏 ZWS marker），fallback 才用 caller 传入的。
    //    maskedToken 格式：'_'.repeat(原值长度) + '\u200B' × (index+1)
    //    视觉上看是空白下划线（Word/WPS 不渲染 ZWS），但全局唯一可配对。
    const effectiveMappingTable: MappingEntry[] =
      storeMappingTable.length > 0 ? storeMappingTable : mappingTable;

    // 1. 把 mappingTable 里 maskedToken → originalValue 反过来作为 edit
    //    (B 方案: 把原 docx 里的原值替换为 maskedToken，得到加密 docx)
    const edits = effectiveMappingTable
      .filter(e => e.originalValue && e.maskedToken)
      .map(e => ({ maskedToken: e.originalValue, originalValue: e.maskedToken }));

    // 2. 加密 mappingTable（优先用 effectiveMappingTable，与加密 docx body 对齐）
    const { encrypted, salt, iv } = await cryptoManagerRef.current.encryptMappingTable(effectiveMappingTable, password);

    // 3. 把元数据加密结果转 base64 + 生成 metaXml
    const toBase64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const saltB64 = toBase64(salt.buffer as ArrayBuffer);
    const ivB64 = toBase64(iv.buffer as ArrayBuffer);
    const dataB64 = toBase64(encrypted);
    const metaXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DesensitizerMeta xmlns="http://desensitizer.app/meta">
  <version>1</version>
  <originalFileName>${originalFileName.replace(/[<>:"/\\|?*]/g, '_')}</originalFileName>
  <salt>${saltB64}</salt>
  <iv>${ivB64}</iv>
  <data>${dataB64}</data>
</DesensitizerMeta>`;

    const injectMetaToZip = async (inputArrayBuffer: ArrayBuffer): Promise<Blob> => {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(inputArrayBuffer);
      const ctOrig = await zip.file('[Content_Types].xml')?.async('string') || '';
      const ctWithMeta = ctOrig.includes('desensitizer.xml')
        ? ctOrig
        : ctOrig.replace('</Types>', '<Override PartName="/docProps/desensitizer.xml" ContentType="application/xml"/></Types>');
      const relsOrig = await zip.file('_rels/.rels')?.async('string') || '';
      const relsWithMeta = relsOrig.includes('desensitizer.xml')
        ? relsOrig
        : relsOrig.replace('</Relationships>', '<Relationship Id="rId_desensitizer" Type="http://desensitizer.app/relationships/metadata" Target="docProps/desensitizer.xml"/></Relationships>');
      zip.file('[Content_Types].xml', ctWithMeta);
      zip.file('_rels/.rels', relsWithMeta);
      zip.file('docProps/desensitizer.xml', metaXml);
      return await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
    };

    // 3. 主路径：B 方案在原 docx 字节上做 token 替换，保留原结构
    if (originalArrayBuffer && originalArrayBuffer.byteLength > 0) {
      try {
        const { writeDocxFromEdits } = await import('@/utils/docxZipWriter');
        const maskedArrayBuffer = await writeDocxFromEdits(originalArrayBuffer, edits);
        const blob = await injectMetaToZip(maskedArrayBuffer);
        triggerDownload(blob, originalFileName.replace(/\.[^.]+$/, '') + '_脱敏.docx');
        return;
      } catch (err) {
        console.warn('[buildDesensitizedDocx] B 方案失败，fallback 到 docx 库重建:', err);
      }
    }

    // 4. 兜底：原字节缺失/非 docx/替换失败 → docx 库从零重建（保留旧行为，丢结构）
    const { Document, Packer, Paragraph, TextRun } = await import('docx');
    const docxChildren = text
      .split('\n\n')
      .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
      .map(line => new Paragraph({ children: [new TextRun(line)] }));
    const doc = new Document({ sections: [{ children: docxChildren }] });
    const docBlob = await Packer.toBlob(doc);
    const blob = await injectMetaToZip(await docBlob.arrayBuffer());
    triggerDownload(blob, originalFileName.replace(/\.[^.]+$/, '') + '_脱敏.docx');
  };

  // 纯函数：计算脱敏文本（供预览和下载共用）
  function getDesensitizedText(src: string, matches: SensitiveMatch[], selected: Set<string>): string {
    const sorted = [...matches].sort((a, b) => a.start - b.start);
    let result = '';
    let lastEnd = 0;
    for (const m of sorted) {
      if (m.start < lastEnd) continue;
      result += src.slice(lastEnd, m.start);
      result += selected.has(m.id) ? '_'.repeat(m.end - m.start) : src.slice(m.start, m.end);
      lastEnd = m.end;
    }
    result += src.slice(lastEnd);
    return result;
  }

  const triggerDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = useCallback(() => {
    reset();
    setPassword('');
    setConfirmPassword('');
    setSelectedText('');
    setShowManualAdd(false);
    setSearchHits([]);
    setSearchKeyword('');
  }, [reset]);

  const handleTextSelection = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && text.length > 0 && text.length < 500) {
      setSelectedText(text);
      setAddBtnPos({ x: e.clientX, y: e.clientY });
    } else {
      setSelectedText('');
      setAddBtnPos(null);
    }
  }, []);

  const handleAddManualMatch = useCallback(() => {
    if (!selectedText) return;
    addManualMatch(selectedText);
    setToast(`"${selectedText.slice(0, 20)}${selectedText.length > 20 ? '...' : ''}" 已添加`);
    setSelectedText('');
    setAddBtnPos(null);
    setTimeout(() => setToast(null), 2000);
  }, [selectedText, addManualMatch]);

  // 渲染高亮 parts 为 JSX（基于 utils/highlight.ts 的 buildHighlightParts 纯函数）
  // - 原文面板：叠加 searchHits，每个 hit 渲染为 <mark id="search-hit-{i}>，可被 scrollIntoView 定位
  // - 脱敏后面板：不渲染 hit（搜索位置只用于预览，不影响脱敏后视觉）
  const renderHighlightParts = useCallback(
    (text: string, matches: SensitiveMatch[], isOriginal: boolean, searchHitsArg?: SearchHit[]) => {
      if (!text) return [];
      const parts = buildHighlightParts(text, matches, localSelected, isOriginal);

      // 把 searchHits 限定在当前 text 范围内（截断预览场景下越界 hit 不渲染）
      const visibleHits = isOriginal && searchHitsArg && searchHitsArg.length > 0
        ? searchHitsArg.filter(h => h.start < text.length && h.end <= text.length)
        : [];

      const renderMatchPart = (part: typeof parts[number] & { kind: 'match' }, idx: number) => {
        const onClick = () => toggleMatchSelection(part.matchId);
        const className = isOriginal
          ? "px-0.5 py-0.5 rounded cursor-pointer bg-yellow-200 dark:bg-yellow-800 dark:text-yellow-200 hover:bg-yellow-300 dark:hover:bg-yellow-700 ring-2 ring-primary"
          : "border-b border-black text-transparent cursor-pointer inline-block min-w-[1ch]";
        const title = isOriginal
          ? `${part.type} - ${Math.round(part.confidence * 100)}%`
          : `已脱敏: ${part.type}`;
        return (
          <span
            key={`match-${part.matchId}-${idx}`}
            className={className}
            title={title}
            onClick={onClick}
          >
            {part.text}
          </span>
        );
      };

      // 走纯文本 + 命中搜索词的快速路径：没有 hit 时直接按 buildHighlightParts 渲染
      if (visibleHits.length === 0) {
        return parts.map((part, idx) => {
          if (part.kind === 'text') {
            return <span key={`text-${idx}`}>{part.text}</span>;
          }
          return renderMatchPart(part, idx);
        });
      }

      // 有 hit 时：把每个 part 再按 hit 边界切碎（text part 和 match part 都要切）。
      // 安全前提：buildHighlightParts 输出的 text part 都是连续的、按顺序覆盖 text 的区间，
      // 因此可以用累积偏移把每个 part 的字符位置映射回 text 的整体坐标。
      //
      // match part 也要切的原因：搜索 hit 可能完全 / 部分落在 auto-detected match 内部，
      // 之前只切 text part → match 内的 hit 既不渲染 mark，scrollIntoView 也找不到 target。
      // 修法：match part 内部也按 hit 切碎，hit 段渲染 <mark id="search-hit-i">，jump 可用。
      const result: ReactElement[] = [];
      let offsetInText = 0;
      parts.forEach((part, partIdx) => {
        const partStart = offsetInText;
        const partEnd = partStart + part.text.length;
        offsetInText = partEnd;

        const hitsInThisPart = visibleHits
          // 用 overlap 判定，不要用 h.start 落在 part 内 —— 否则跨 part 的 hit
          // (前半在 A part、后半在 B part) 在 B part 不会渲染。
          .filter(h => h.start < partEnd && h.end > partStart)
          .sort((a, b) => a.start - b.start);

        if (hitsInThisPart.length === 0) {
          if (part.kind === 'text') {
            result.push(<span key={`text-${partIdx}`}>{part.text}</span>);
          } else {
            result.push(renderMatchPart(part, partIdx));
          }
          return;
        }

        // 有 hit：按 hit 边界切碎。match part 时把整段包在 match span 里，hit 用嵌套 mark。
        let cursor = 0;
        const slices: ReactElement[] = [];
        hitsInThisPart.forEach((hit, hitIdx) => {
          const relStart = hit.start - partStart;
          const relEnd = Math.min(hit.end - partStart, part.text.length);
          if (relStart > cursor) {
            slices.push(<span key={`pre-${partIdx}-${hitIdx}`}>{part.text.slice(cursor, relStart)}</span>);
          }
          // 跨 part 的 hit 会被切到多个 mark，用 {hit.index}-s{partIdx}-{hitIdx} 避免 id 重复
          // handleJumpToSearchHit 用 querySelectorAll + first 来定位到 hit 起点
          slices.push(
            <mark
              key={`hit-${hit.index}-${partIdx}-${hitIdx}`}
              data-search-hit={hit.index}
              id={`search-hit-${hit.index}-s${partIdx}-${hitIdx}`}
              className="bg-blue-200 dark:bg-blue-800 dark:text-blue-100 rounded px-0.5 cursor-pointer underline decoration-2"
              title={`第 ${hit.index + 1} 处命中「${hit.value}」`}
              // mark 嵌套在 match span 里时，mark 的 onClick 触发后会冒泡到 match 的 onClick
              // → match 会被错误地取消选中。stopPropagation 阻断冒泡
              onClick={(e) => {
                e.stopPropagation();
                handleJumpToSearchHit(hit.index);
              }}
            >
              {part.text.slice(Math.max(cursor, relStart), relEnd)}
            </mark>
          );
          cursor = relEnd;
        });
        if (cursor < part.text.length) {
          slices.push(<span key={`post-${partIdx}`}>{part.text.slice(cursor)}</span>);
        }

        if (part.kind === 'text') {
          result.push(...slices);
        } else {
          // match part：把整段包在 match span 里，hit 用嵌套 mark
          const onClick = () => toggleMatchSelection(part.matchId);
          const className = isOriginal
            ? "px-0.5 py-0.5 rounded cursor-pointer bg-yellow-200 dark:bg-yellow-800 dark:text-yellow-200 hover:bg-yellow-300 dark:hover:bg-yellow-700 ring-2 ring-primary"
            : "border-b border-black text-transparent cursor-pointer inline-block min-w-[1ch]";
          const title = isOriginal
            ? `${part.type} - ${Math.round(part.confidence * 100)}%`
            : `已脱敏: ${part.type}`;
          result.push(
            <span
              key={`match-${part.matchId}-${partIdx}`}
              className={className}
              title={title}
              onClick={onClick}
            >
              {slices}
            </span>
          );
        }
        offsetInText += part.text.length;
      });
      return result;
    },
    [toggleMatchSelection, localSelected, renderKey, handleJumpToSearchHit]
  );

  // originalTextFull / previewText 已在前文提前声明（handler 也要用）

  if (!currentFile) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-6">上传文件</h1>
        <FileUploader onFileSelect={handleFileSelect} className="min-h-[400px]" />
      </div>
    );
  }

  return (
    <div className="p-8 relative">
      {/* Toast 提示 */}
      {toast && (
        <div className="fixed top-20 right-8 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in">
          <Check className="h-4 w-4" />
          <span className="text-sm">{toast}</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">文件脱敏</h1>
        <Button variant="outline" onClick={handleReset}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重新上传
        </Button>
      </div>

      {isProcessing && (
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
            正在处理文件...
          </div>
          <Progress value={50} />
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6">
        {/* 文件信息 */}
        <FileCard file={currentFile} />

        {/* 敏感词统计 */}
        {sensitiveMatches.length > 0 && (
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                检测到 <span className="text-primary font-bold">{sensitiveMatches.length}</span> 处敏感信息
              </span>
              <span className="text-sm text-muted-foreground">
                已选择 <span className="font-medium">{selectedMatches.size}</span> 处
              </span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowManualAdd(!showManualAdd)}>
              <MousePointer2 className="mr-1 h-4 w-4" />
              手动标记
            </Button>
          </div>
        )}

        {/* 手动标记区域 */}
        {showManualAdd && (
          <div className="bg-muted/30 rounded-lg p-4 border border-dashed">
            <div className="flex items-center gap-2 mb-3">
              <MousePointer2 className="h-5 w-5 text-primary" />
              <span className="font-medium">手动标记敏感信息</span>
            </div>

            {/* 搜索功能（两步骤：先搜出处，再勾选/全部脱敏） */}
            <div className="flex gap-2 mb-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="输入关键词（≥2 字），先预览再决定脱敏..."
                  value={searchKeyword}
                  // 用户开始打新关键词就清掉旧 hits，避免"label 是新词但 hits 还是旧词"的误导显示。
                  onChange={(e) => {
                    setSearchKeyword(e.target.value);
                    setSearchHits([]);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchKeyword(searchKeyword)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => handleSearchKeyword(searchKeyword)}>
                搜索
              </Button>
            </div>

            {parsedDocument && searchHits.length > 0 && (
              <div className="mb-3">
                <SearchResultsPanel
                  keyword={searchKeyword}
                  hits={searchHits}
                  onJumpTo={handleJumpToSearchHit}
                  onAddOne={(idx) => {
                    const hit = searchHits.find(h => h.index === idx);
                    if (!hit) return;
                    // 用 hit.value（原文真实 case）而非 searchKeyword，避免大小写丢失
                    addManualMatch(hit.value, [hit.start]);
                    setToast(`已添加 1 处「${hit.value}」`);
                    setTimeout(() => setToast(null), 2000);
                  }}
                  onAddChecked={handleAddCheckedSearchHits}
                  onAddAll={handleAddAllSearchHits}
                  onClearSearch={handleClearSearch}
                />
              </div>
            )}

            <p className="text-sm text-muted-foreground mb-3">
              或在下方「原文」面板中划选文字，然后点击「添加」
            </p>
            {selectedText ? (
              <div className="flex items-center gap-3 bg-white rounded-lg p-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1">已选择：</p>
                  <p className="font-mono text-sm bg-yellow-50 px-2 py-1 rounded inline-block max-w-[400px] truncate">
                    {selectedText}
                  </p>
                </div>
                <Button size="sm" onClick={handleAddManualMatch}>
                  <Plus className="mr-1 h-4 w-4" />
                  添加
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                请在下方原文框中划选需要脱敏的文字
              </p>
            )}
          </div>
        )}

        {/* 并排对比视图 */}
        {parsedDocument && (
          <div className="grid grid-cols-2 gap-4">
            {/* 原文面板 */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-4 py-2 font-medium flex items-center gap-2">
                <span>📄</span>
                <span>原文</span>
                {sensitiveMatches.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {sensitiveMatches.length} 处敏感词
                  </span>
                )}
              </div>
              <div
                ref={originalPanelRef}
                className="p-4 max-h-[450px] overflow-y-auto cursor-text select-text"
                onMouseUp={handleTextSelection as React.MouseEventHandler}
                onScroll={handleOriginalScroll}
              >
                <pre className="whitespace-pre-wrap text-sm font-medio leading-relaxed">
                  {renderHighlightParts(previewText, sensitiveMatches, true, searchHits)}
                </pre>
                {addBtnPos && selectedText && (
                  <button
                    className="fixed z-50 bg-primary text-white text-xs px-2 py-1 rounded shadow-lg hover:bg-primary/90 flex items-center gap-1"
                    style={{ left: addBtnPos.x + 8, top: addBtnPos.y - 30 }}
                    onClick={() => {
                      handleAddManualMatch();
                      setAddBtnPos(null);
                    }}
                  >
                    <Plus className="h-3 w-3" /> 添加
                  </button>
                )}
                {originalTextFull.length > MAX_DESENSITIZE_CHARS && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    ... (还有 {originalTextFull.length - MAX_DESENSITIZE_CHARS} 字符未显示)
                  </p>
                )}
              </div>
            </div>

            {/* 脱敏结果面板 */}
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-green-50 px-4 py-2 font-medium flex items-center gap-2">
                <span>🔒</span>
                <span>脱敏后</span>
                {selectedMatches.size > 0 && (
                  <span className="text-xs text-green-600 ml-auto">
                    {selectedMatches.size} 处已脱敏
                  </span>
                )}
              </div>
              <div
                ref={maskedPanelRef}
                className="p-4 max-h-[450px] overflow-y-auto"
                onScroll={handleMaskedScroll}
              >
                {originalTextFull ? (
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                    {renderHighlightParts(previewText, sensitiveMatches, false)}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                    <Lock className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">脱敏后将在这里显示</p>
                    <p className="text-xs mt-1">点击下方「脱敏处理」按钮继续</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 敏感信息面板 */}
        {sensitiveMatches.length > 0 && (
          <SensitivePanel
            matches={sensitiveMatches}
            selectedIds={selectedMatches}
            onToggle={toggleMatchSelection}
            onSelectAll={selectAllMatches}
            onDeselectAll={deselectAllMatches}
            onRemove={removeMatch}
          />
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 items-center">
          {parsedDocument && (
            <select
              value={exportFormat}
              onChange={e => setExportFormat(e.target.value as typeof exportFormat)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="original">原格式</option>
              <option value="docx">DOCX</option>
              <option value="txt">TXT</option>
            </select>
          )}
          {!desensitizedContent ? (
            <Button
              className="flex-1"
              onClick={() => { setPasswordModalSource('desensitize'); setShowPasswordModal(true); }}
              disabled={selectedMatches.size === 0 || isProcessing}
            >
              <Shield className="mr-2 h-4 w-4" />
              脱敏处理 ({selectedMatches.size}处)
            </Button>
          ) : (
            <>
              <Button className="flex-1" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                下载脱敏文件
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RefreshCw className="mr-2 h-4 w-4" />
                继续处理
              </Button>
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={showPasswordModal}
        onClose={() => {
          setShowPasswordModal(false);
          setPassword('');
          setConfirmPassword('');
          setPasswordError('');
        }}
        title="设置脱敏密钥"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            请设置一个密码用于加密敏感信息映射表。恢复时需要此密码。
          </p>
          <div>
            <label className="text-sm font-medium mb-1 block">密码</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码（至少6位）"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">确认密码</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再次输入密码"
            />
          </div>
          {passwordError && (
            <p className="text-sm text-destructive">{passwordError}</p>
          )}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowPasswordModal(false)}>
              取消
            </Button>
            {passwordModalSource === 'download' ? (
              <Button onClick={handleDownloadWithPassword} disabled={isProcessing}>
                <Download className="mr-2 h-4 w-4" />
                下载文件
              </Button>
            ) : (
              <Button onClick={handleDesensitize} disabled={isProcessing}>
                <Lock className="mr-2 h-4 w-4" />
                确认脱敏
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
