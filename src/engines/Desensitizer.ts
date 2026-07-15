import type { MappingEntry, SensitiveMatch, SensitiveType } from '@/types';
import { CryptoManager } from './CryptoManager';
import { generateUUID, generateDisplayToken } from '@/utils';
import { SENSITIVE_TYPE_LABELS } from '@/rules';

interface DesensitizeOptions {
  mode: 'encrypt' | 'mask';
  password?: string;
  preserveType?: boolean;
}

export class Desensitizer {
  private cryptoManager: CryptoManager;

  constructor(cryptoManager: CryptoManager) {
    this.cryptoManager = cryptoManager;
  }

  async desensitize(
    text: string,
    matches: SensitiveMatch[],
    _options: DesensitizeOptions
  ): Promise<{ desensitizedText: string; mappingTable: MappingEntry[] }> {
    const mappingTable: MappingEntry[] = [];

    // 按原始文本位置升序排列。用 cursor 走原始 text 构建新字符串，
    // 同时用 resultCursor 跟踪 result 中的位置，让 mappingTable.position
    // 始终指向脱敏后文本里的坐标（与 UploadPage.getDesensitizedText 保持一致，
    // 这样 restore 用 position-based 替换可以端到端工作）。
    const sortedMatches = [...matches].sort((a, b) => a.start - b.start);

    let result = '';
    let cursor = 0;
    let resultCursor = 0;
    for (let i = 0; i < sortedMatches.length; i++) {
      const match = sortedMatches[i];
      if (match.start < cursor || match.end < match.start) {
        // 重叠或非法区间：跳过（上游 SensitiveFinder 应保证非重叠，做兜底）
        continue;
      }
      const token = generateDisplayToken(match.value, i);

      const prefix = text.slice(cursor, match.start);
      const tokenStartInResult = resultCursor + prefix.length;
      result += prefix + token;
      resultCursor = tokenStartInResult + token.length;
      cursor = match.end;

      mappingTable.push({
        id: generateUUID(),
        type: match.type,
        originalValue: match.value,
        maskedToken: token,
        // 位置是脱敏后文本里的坐标；restore 用 start..end 切片+替换 originalValue。
        position: {
          start: tokenStartInResult,
          end: tokenStartInResult + token.length
        }
      });
    }
    result += text.slice(cursor);

    return { desensitizedText: result, mappingTable };
  }

  async restore(
    desensitizedText: string,
    mappingTable: MappingEntry[],
    _password: string
  ): Promise<string> {
    // 按 start 降序处理：后面的先切片+插入，前面的位置不会因长度变化而漂移。
    // 不依赖 maskedToken 字符串内容，因此 UploadPage 那种 "_".repeat(maskedLen)
    // 同形 token 也不会被错认（之前的 split+join 是错的根因）。
    const sorted = [...mappingTable].sort(
      (a, b) => b.position.start - a.position.start
    );

    let result = desensitizedText;
    for (const entry of sorted) {
      const { start, end } = entry.position;
      // 兜底：position 越界或非法就跳过（不应该发生，但不让一处坏数据毁整段文本）
      if (
        start < 0 ||
        end > result.length ||
        start > end ||
        Number.isNaN(start) ||
        Number.isNaN(end)
      ) {
        continue;
      }
      result = result.slice(0, start) + entry.originalValue + result.slice(end);
    }
    return result;
  }

  createMaskedValue(value: string, type: SensitiveType): string {
    const label = SENSITIVE_TYPE_LABELS[type] || '敏感信息';
    switch (type) {
      case 'PHONE':
        return value.slice(0, 3) + '****' + value.slice(-4);
      case 'EMAIL': {
        const [local, domain] = value.split('@');
        return local.slice(0, 2) + '***@' + domain;
      }
      case 'ID_CARD':
        return value.slice(0, 6) + '********' + value.slice(-4);
      case 'BANK_CARD':
        return value.slice(0, 4) + ' **** **** ' + value.slice(-4);
      case 'IP':
        return value.slice(0, value.lastIndexOf('.')) + '.*.*';
      case 'AMOUNT':
      case 'AMOUNT_UPPER':
        return '¥****';
      case 'ADDRESS':
        return '[地址]';
      case 'COMPANY':
        return '[公司名称]';
      case 'NAME':
        return '[姓名]';
      case 'CONTRACT_NO':
        return '[合同号]';
      case 'PROJECT_NAME':
        return '[项目名称]';
      case 'TAX_ID':
        return '[税号]';
      default:
        return `[${label}]`;
    }
  }

  async encryptMappingTable(
    mappingTable: MappingEntry[],
    password: string
  ): Promise<{ encrypted: ArrayBuffer; salt: Uint8Array; iv: Uint8Array }> {
    return this.cryptoManager.encryptMappingTable(
      mappingTable.map(entry => ({
        ...entry,
        position: entry.position
      })),
      password
    );
  }

  async decryptMappingTable(
    encryptedData: ArrayBuffer,
    password: string,
    salt: Uint8Array,
    iv: Uint8Array
  ): Promise<MappingEntry[]> {
    const result = await this.cryptoManager.decryptMappingTable(
      encryptedData,
      password,
      salt,
      iv
    );
    return result as MappingEntry[];
  }
}
