import type { MappingEntry, SensitiveMatch, SensitiveType } from '@/types';
import { CryptoManager } from './CryptoManager';
import { generateUUID, generateToken } from '@/utils';
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
    // 避免在已替换过的文本上用原 match 位置切分（多 match 时位置会错位）。
    const sortedMatches = [...matches].sort((a, b) => a.start - b.start);

    let result = '';
    let cursor = 0;
    for (let i = 0; i < sortedMatches.length; i++) {
      const match = sortedMatches[i];
      if (match.start < cursor || match.end < match.start) {
        // 重叠或非法区间：跳过（上游 SensitiveFinder 应保证非重叠，做兜底）
        continue;
      }
      const token = generateToken(match.type, i + 1);

      result += text.slice(cursor, match.start) + token;
      cursor = match.end;

      mappingTable.push({
        id: generateUUID(),
        type: match.type,
        originalValue: match.value,
        maskedToken: token,
        position: {
          start: match.start,
          end: match.start + match.value.length // 记录原值长度，便于复用
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
    // 两趟替换：
    // 1) 所有 maskedToken -> 唯一占位符（避免交叉命中，即使是相同长度 token 也安全）
    // 2) 占位符 -> originalValue
    // 占位符用 NUL 字符包围，正文几乎不会出现 NUL，从而彻底消除交叉。
    const PH_PREFIX = '\u0000DSE_';
    const PH_SUFFIX = '\u0000';
    const placeholderMap = new Map<string, string>();
    let stage1 = desensitizedText;

    for (let i = 0; i < mappingTable.length; i++) {
      const entry = mappingTable[i];
      const placeholder = `${PH_PREFIX}${i}_${mappingTable.length}${PH_SUFFIX}`;
      placeholderMap.set(placeholder, entry.originalValue);
      stage1 = stage1.split(entry.maskedToken).join(placeholder);
    }

    let stage2 = stage1;
    for (const [placeholder, originalValue] of placeholderMap) {
      stage2 = stage2.split(placeholder).join(originalValue);
    }
    return stage2;
  }

  createMaskedValue(value: string, type: SensitiveType): string {
    const label = SENSITIVE_TYPE_LABELS[type] || '敏感信息';
    switch (type) {
      case 'PHONE':
        return value.slice(0, 3) + '****' + value.slice(-4);
      case 'EMAIL':
        const [local, domain] = value.split('@');
        return local.slice(0, 2) + '***@' + domain;
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
