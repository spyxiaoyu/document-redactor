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
    const { parsedDocument, sensitiveMatches } = get();
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
      const existingIds = new Set(sensitiveMatches.map(m => m.id));
      const uniqueNewMatches = newMatches.filter(m => !existingIds.has(m.value));

      const updatedMatches = [...sensitiveMatches, ...uniqueNewMatches];
      const updatedSelected = new Set(get().selectedMatches);
      uniqueNewMatches.forEach(m => updatedSelected.add(m.id));

      set({
        sensitiveMatches: updatedMatches,
        selectedMatches: updatedSelected,
        renderKey: get().renderKey + 1
      });
    }
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
