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
    let desensitizedText = text;

    const sortedMatches = [...matches].sort((a, b) => b.start - a.start);

    for (let i = 0; i < sortedMatches.length; i++) {
      const match = sortedMatches[i];
      const token = generateToken(match.type, i + 1);

      desensitizedText =
        desensitizedText.slice(0, match.start) +
        token +
        desensitizedText.slice(match.end);

      mappingTable.push({
        id: generateUUID(),
        type: match.type,
        originalValue: match.value,
        maskedToken: token,
        position: {
          start: match.start,
          end: match.start + token.length
        }
      });
    }

    return { desensitizedText, mappingTable };
  }

  async restore(
    desensitizedText: string,
    mappingTable: MappingEntry[],
    _password: string
  ): Promise<string> {
    let restoredText = desensitizedText;

    const sortedEntries = [...mappingTable].sort((a, b) => b.position.start - a.position.start);

    for (const entry of sortedEntries) {
      restoredText =
        restoredText.slice(0, entry.position.start) +
        entry.originalValue +
        restoredText.slice(entry.position.start + entry.maskedToken.length);
    }

    return restoredText;
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
