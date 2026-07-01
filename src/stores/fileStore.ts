import { create } from 'zustand';
import type { ParsedDocument, SensitiveMatch, MappingEntry } from '@/types';
import { documentEngine } from '@/engines';
import { pdfParser } from '@/parsers/PDFParser';
import { wordParser } from '@/parsers/WordParser';
import { excelParser } from '@/parsers/ExcelParser';
import { imageParser } from '@/parsers/ImageParser';
import { textParser } from '@/parsers/TextParser';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { CryptoManager } from '@/engines/CryptoManager';
import { Desensitizer } from '@/engines/Desensitizer';
import { hashFile, generateUUID } from '@/utils';
import { saveRecord, addAuditLog } from '@/db';

documentEngine.registerParser(pdfParser);
documentEngine.registerParser(wordParser);
documentEngine.registerParser(excelParser);
documentEngine.registerParser(imageParser);
documentEngine.registerParser(textParser);

interface FileState {
  currentFile: File | null;
  parsedDocument: ParsedDocument | null;
  sensitiveMatches: SensitiveMatch[];
  selectedMatches: Set<string>;
  renderKey: number; // 每次 selection 变化 +1，强制触发 re-render
  mappingTable: MappingEntry[];
  desensitizedContent: string | null;
  isProcessing: boolean;
  error: string | null;

  setFile: (file: File | null) => void;
  parseFile: () => Promise<void>;
  detectSensitive: () => void;
  toggleMatchSelection: (id: string) => void;
  selectAllMatches: () => void;
  deselectAllMatches: () => void;
  desensitize: (password: string) => Promise<void>;
  addManualMatch: (text: string) => void;
  removeMatch: (id: string) => void;
  reset: () => void;
}

const sensitiveFinder = new SensitiveFinder();
const cryptoManager = new CryptoManager();
const desensitizer = new Desensitizer(cryptoManager);

export const useFileStore = create<FileState>((set, get) => ({
  currentFile: null,
  parsedDocument: null,
  sensitiveMatches: [],
  selectedMatches: new Set(),
  renderKey: 0,
  mappingTable: [],
  desensitizedContent: null,
  isProcessing: false,
  error: null,

  setFile: (file) => set({ currentFile: file, error: null }),

  parseFile: async () => {
    const { currentFile } = get();
    if (!currentFile) return;

    set({ isProcessing: true, error: null });

    try {
      const parsedDocument = await documentEngine.parseDocument(currentFile);
      set({ parsedDocument });

      get().detectSensitive();
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ isProcessing: false });
    }
  },

  detectSensitive: () => {
    const { parsedDocument } = get();
    if (!parsedDocument) return;

    const result = sensitiveFinder.findSensitiveContent(parsedDocument.rawText);
    set({ sensitiveMatches: result.matches });
  },

  toggleMatchSelection: (id) => {
    const { selectedMatches } = get();
    const newSelection = new Set(selectedMatches);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    set({ selectedMatches: newSelection, renderKey: get().renderKey + 1 });
  },

  selectAllMatches: () => {
    const { sensitiveMatches } = get();
    set({ selectedMatches: new Set(sensitiveMatches.map(m => m.id)), renderKey: get().renderKey + 1 });
  },

  deselectAllMatches: () => set({ selectedMatches: new Set(), renderKey: get().renderKey + 1 }),

  addManualMatch: (text) => {
    const { parsedDocument } = get();
    if (!parsedDocument || !text) return;

    const rawText = parsedDocument.rawText;
    const newMatches: SensitiveMatch[] = [];
    let startIndex = 0;
    let matchId = 0;

    // Find all occurrences of the text
    while (true) {
      const index = rawText.indexOf(text, startIndex);
      if (index === -1) break;

      const id = `manual-${Date.now()}-${matchId++}`;
      newMatches.push({
        id,
        type: 'CUSTOM',
        value: text,
        start: index,
        end: index + text.length,
        confidence: 1.0,
        context: `手动标记: ${text.slice(0, 20)}${text.length > 20 ? '...' : ''}`
      });

      startIndex = index + 1;
    }

    if (newMatches.length > 0) {
      const { sensitiveMatches: prev, selectedMatches: prevSelected } = get();

      // 删除与新 match 区间重叠的所有老 match。
      // 根因（spy 截图 bug）：用户取消 ADDRESS 高亮后用搜索框 addManualMatch 同段，
      // 新 CUSTOM 与老 ADDRESS 完全重叠（start/end 相同）。
      // buildHighlightParts 排序后遍历：老 match 先 unselected 推进 lastEnd=end，
      // 新 match start<lastEnd 被 SKIP overlap → 永远不渲染、不脱敏。
      // 修法：把重叠区间的所有老 match 清掉，只保留新 CUSTOM。
      const newRanges = newMatches.map(m => ({ start: m.start, end: m.end }));
      const overlaps = (m: SensitiveMatch) =>
        newRanges.some(r => m.start < r.end && m.end > r.start);

      const removedOld = prev.filter(overlaps);
      const filteredOld = prev.filter(m => !overlaps(m));

      const updatedSelected = new Set(prevSelected);
      removedOld.forEach(m => updatedSelected.delete(m.id));
      newMatches.forEach(m => updatedSelected.add(m.id));

      set({
        sensitiveMatches: [...filteredOld, ...newMatches],
        selectedMatches: updatedSelected,
        renderKey: get().renderKey + 1
      });
    }
  },

  /**
   * 从 matches 列表里彻底删除一个 match（自动或手动都可以删）。
   * 场景：自动识别有误（如把"纳税人识别号："整段识别成 TAX_ID），
   * 用户希望从 SensitivePanel 抹掉这个 match，让它既不高亮也不参与脱敏。
   * 不可恢复（除非重新走 detectSensitive 或 addManualMatch）。
   */
  removeMatch: (id) => {
    const { sensitiveMatches, selectedMatches } = get();
    const updatedMatches = sensitiveMatches.filter(m => m.id !== id);
    const updatedSelected = new Set(selectedMatches);
    updatedSelected.delete(id);
    set({
      sensitiveMatches: updatedMatches,
      selectedMatches: updatedSelected,
      renderKey: get().renderKey + 1
    });
  },

  desensitize: async (password) => {
    const { currentFile, parsedDocument, sensitiveMatches, selectedMatches } = get();
    if (!parsedDocument || !currentFile) return;

    set({ isProcessing: true, error: null });

    try {
      const matchesToDesensitize = sensitiveMatches.filter(m => selectedMatches.has(m.id));

      const { desensitizedText, mappingTable } = await desensitizer.desensitize(
        parsedDocument.rawText,
        matchesToDesensitize,
        { mode: 'encrypt', password }
      );

      const fileBuffer = await currentFile.arrayBuffer();
      const fileHash = await hashFile(fileBuffer);

      const { encrypted, salt, iv } = await desensitizer.encryptMappingTable(mappingTable, password);

      await saveRecord({
        id: generateUUID(),
        fileHash,
        fileName: parsedDocument.ast.metadata.fileName,
        fileType: parsedDocument.ast.metadata.format,
        createdAt: new Date(),
        mappingTable: encrypted,
        keySalt: salt,
        iv,
        desensitizedFileHash: await hashFile(new TextEncoder().encode(desensitizedText).buffer as ArrayBuffer),
        status: 'active'
      });

      await addAuditLog({
        id: generateUUID(),
        timestamp: new Date(),
        action: 'desensitize',
        fileId: fileHash,
        fileHash,
        details: { matchCount: mappingTable.length }
      });

      set({ desensitizedContent: desensitizedText, mappingTable });
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ isProcessing: false });
    }
  },

  reset: () => set({
    currentFile: null,
    parsedDocument: null,
    sensitiveMatches: [],
    selectedMatches: new Set(),
    mappingTable: [],
    desensitizedContent: null,
    error: null
  })
}));
