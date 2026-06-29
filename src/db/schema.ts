import Dexie, { type Table } from 'dexie';
import type { DesensitizationRecord, AuditLogEntry, UserSettings } from '@/types';

export type { DesensitizationRecord, AuditLogEntry, UserSettings };

type SettingValue = boolean | 'light' | 'dark' | 'system' | 'zh-CN' | 'en-US';

export interface UserSettingsRecord {
  key: string;
  value: SettingValue;
}

export class DesensitizerDB extends Dexie {
  records!: Table<DesensitizationRecord>;
  auditLogs!: Table<AuditLogEntry>;
  userSettings!: Table<UserSettingsRecord>;

  constructor() {
    super('DocumentDesensitizer');
    this.version(1).stores({
      records: 'id, fileHash, fileName, createdAt, status',
      auditLogs: 'id, timestamp, action, fileId',
      userSettings: 'key'
    });
  }
}

export const db = new DesensitizerDB();

export async function saveRecord(record: DesensitizationRecord): Promise<void> {
  await db.records.add(record);
}

export async function getRecord(id: string): Promise<DesensitizationRecord | undefined> {
  return db.records.get(id);
}

export async function listRecords(status?: 'active' | 'restored' | 'deleted'): Promise<DesensitizationRecord[]> {
  if (status) {
    return db.records.where('status').equals(status).toArray();
  }
  return db.records.orderBy('createdAt').reverse().toArray();
}

export async function updateRecordStatus(id: string, status: 'active' | 'restored' | 'deleted'): Promise<void> {
  await db.records.update(id, { status });
}

export async function deleteRecord(id: string): Promise<void> {
  await db.records.delete(id);
}

export async function addAuditLog(entry: AuditLogEntry): Promise<void> {
  await db.auditLogs.add(entry);
}

export async function queryAuditLogs(
  fileId?: string,
  action?: string,
  limit: number = 100
): Promise<AuditLogEntry[]> {
  let query = db.auditLogs.orderBy('timestamp').reverse();

  if (fileId) {
    return db.auditLogs.where('fileId').equals(fileId).limit(limit).toArray();
  }

  if (action) {
    return db.auditLogs.where('action').equals(action).limit(limit).toArray();
  }

  return query.limit(limit).toArray();
}

export async function getSetting(key: string): Promise<unknown | null> {
  const record = await db.userSettings.get(key);
  if (!record) return null;
  return record.value;
}

export async function setSetting(
  key: string,
  value: unknown
): Promise<void> {
  await db.userSettings.put({ key, value: value as SettingValue });
}
