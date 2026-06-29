export type SensitiveType =
  | 'PHONE'
  | 'ID_CARD'
  | 'EMAIL'
  | 'BANK_CARD'
  | 'IP'
  | 'AMOUNT'
  | 'AMOUNT_UPPER'
  | 'ADDRESS'
  | 'CONTRACT_NO'
  | 'PROJECT_NAME'
  | 'COMPANY'
  | 'NAME'
  | 'TAX_ID'
  | 'CUSTOM';

export interface SensitiveMatch {
  id: string;
  type: SensitiveType;
  value: string;
  start: number;
  end: number;
  confidence: number;
  context: string;
  blockId?: string;
}

export interface Rule {
  id: string;
  type: SensitiveType;
  pattern: RegExp;
  weight: number;
  description?: string;
  enabled: boolean;
}

export interface CustomRule extends Rule {
  createdAt: Date;
  updatedAt: Date;
}

export interface MappingEntry {
  id: string;
  type: SensitiveType;
  originalValue: string;
  maskedToken: string;
  position: {
    blockId?: string;
    start: number;
    end: number;
  };
}

export interface EncryptedMapping {
  iv: Uint8Array;
  data: ArrayBuffer;
  salt: Uint8Array;
}

export interface DesensitizedDocument {
  content: string | ArrayBuffer;
  mappingTable: MappingEntry[];
  encryptedMapping: EncryptedMapping;
  metadata: {
    fileName: string;
    format: string;
    desensitizedAt: Date;
  };
}

export interface SensitiveDetectionResult {
  matches: SensitiveMatch[];
  totalCount: number;
  byType: Record<SensitiveType, number>;
}
