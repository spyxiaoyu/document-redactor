export interface DesensitizationRecord {
  id: string;
  fileHash: string;
  fileName: string;
  fileType: string;
  createdAt: Date;
  mappingTable: ArrayBuffer;
  keySalt: Uint8Array;
  iv: Uint8Array;
  desensitizedFileHash: string;
  status: 'active' | 'restored' | 'deleted';
}

export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  action: 'desensitize' | 'restore' | 'preview' | 'export' | 'delete';
  fileId: string;
  fileHash: string;
  details: Record<string, unknown>;
}

export interface UserSettings {
  customRulesEnabled: boolean;
  autoDetectEnabled: boolean;
  theme: 'light' | 'dark' | 'system';
  language: 'zh-CN' | 'en-US';
}
