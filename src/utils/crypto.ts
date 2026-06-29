const CRYPTO_CONFIG = {
  kdf: {
    algorithm: 'PBKDF2',
    iterations: 100000,
    hash: 'SHA-256',
    saltLength: 16
  },
  encryption: {
    algorithm: 'AES-GCM',
    keyLength: 256,
    ivLength: 12
  }
} as const;

export async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: CRYPTO_CONFIG.kdf.algorithm,
      salt: salt.buffer as ArrayBuffer,
      iterations: CRYPTO_CONFIG.kdf.iterations,
      hash: CRYPTO_CONFIG.kdf.hash
    },
    keyMaterial,
    { name: CRYPTO_CONFIG.encryption.algorithm, length: CRYPTO_CONFIG.encryption.keyLength },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(
  data: string,
  password: string
): Promise<{ encrypted: ArrayBuffer; salt: Uint8Array; iv: Uint8Array }> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.kdf.saltLength));
  const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.encryption.ivLength));

  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: CRYPTO_CONFIG.encryption.algorithm, iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(data)
  );

  return { encrypted, salt, iv };
}

export async function decrypt(
  encryptedData: ArrayBuffer,
  password: string,
  salt: Uint8Array,
  iv: Uint8Array
): Promise<string> {
  const decoder = new TextDecoder();
  const key = await deriveKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: CRYPTO_CONFIG.encryption.algorithm, iv: iv.buffer as ArrayBuffer },
    key,
    encryptedData
  );

  return decoder.decode(decrypted);
}

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function generateToken(type: string, index: number): string {
  return `[${type}_${index.toString().padStart(4, '0')}]`;
}

export async function secureWipe(buffer: ArrayBuffer): Promise<void> {
  const view = new Uint8Array(buffer);
  crypto.getRandomValues(view);
  view.fill(0);
}

export async function hashFile(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
