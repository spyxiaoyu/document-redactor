import { deriveKey, generateUUID } from '@/utils';

export interface EncryptedData {
  encrypted: ArrayBuffer;
  salt: Uint8Array;
  iv: Uint8Array;
}

export class CryptoManager {
  private currentKey: CryptoKey | null = null;
  private currentSalt: Uint8Array | null = null;

  async generateKey(password: string): Promise<{ salt: Uint8Array; key: CryptoKey }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    this.currentKey = key;
    this.currentSalt = salt;
    return { salt, key };
  }

  async loadKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const key = await deriveKey(password, salt);
    this.currentKey = key;
    this.currentSalt = salt;
    return key;
  }

  async encryptData(data: string): Promise<EncryptedData> {
    if (!this.currentKey) {
      throw new Error('No key loaded. Call generateKey or loadKey first.');
    }
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.currentKey,
      encoder.encode(data)
    );

    return {
      encrypted,
      salt: this.currentSalt!,
      iv
    };
  }

  async encryptMappingTable(mappingTable: unknown[], password: string): Promise<EncryptedData> {
    const data = JSON.stringify(mappingTable);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      encoder.encode(data)
    );

    return { encrypted, salt, iv };
  }

  async decryptMappingTable(
    encryptedData: ArrayBuffer,
    password: string,
    salt: Uint8Array,
    iv: Uint8Array
  ): Promise<unknown[]> {
    const key = await deriveKey(password, salt);
    const decoder = new TextDecoder();

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      encryptedData
    );

    return JSON.parse(decoder.decode(decrypted));
  }

  clearKey(): void {
    this.currentKey = null;
    this.currentSalt = null;
  }

  hasKey(): boolean {
    return this.currentKey !== null;
  }

  generateSessionId(): string {
    return generateUUID();
  }
}

export const cryptoManager = new CryptoManager();
