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

/**
 * 视觉下划线"等宽但压缩"的长度上限（spy 2026-07-30 反馈）：
 *   spy's 真实合同里，项目名 / 长地址 / 合同号常达 18+ 字。
 *   早期 f7341ae 方案生成 N 个 `_`，中文字体下"看起来像一长条空白 + 间断下划线"，
 *   把上下文隔开、不便浏览。
 *   上限 = 8：覆盖常见姓名 / 公司 / 短 ID 的原字段长度；超过 8 字的字段压缩到 8 个 `_`。
 *
 *   恢复仍走 position-based（Desensitizer.desensitize 记录 token 在脱敏后文本里的 start/end），
 *   不会因为 visible 长度被截而丢字。
 *   maskedToken 唯一性靠 ZWS marker（index+1 个 U+200B），与 visible 长度无关。
 */
export const MAX_VISIBLE_UNDERSCORE_LEN = 8;

/**
 * 生成"视觉下划线 + 隐藏唯一标识"的 maskedToken：
 *   visible part: '_'.repeat(min(原值长度, MAX_VISIBLE_UNDERSCORE_LEN)) → 视觉上就是下划线
 *   hidden part:  '\u200B' × (index+1)  → Word/WPS 不渲染，但保证字符串全局唯一
 *
 * 为什么不用纯下划线（'_'.repeat(len)）？—— 同长度不同原值（如两个 18 字地址）会冲突，
 * applyDocxEdits 第一个 edit 会把所有同长度下划线都替换成第一个 originalValue，后续 edit 找不到 occurrence。
 *
 * 为什么不直接用 [TYPE_NNNN]？—— spy's 法务场景下，"种类划分"在脱敏文件里产生误解
 * （看到 [COMPANY_0001] 会以为这里一定是公司名，但实际可能是误识别或自定义词）。
 *
 * Word/WPS 兼容性：U+200B ZERO WIDTH SPACE 是 Unicode 标准字符，
 *   Word 2016+/WPS 2019+ 渲染为空（不显示、不占宽度），但保留字符用于恢复。
 *   极老版本（Office 2010 之前）可能显示为方框或忽略字符，需测试环境。
 */
export function generateDisplayToken(originalValue: string, index: number): string {
  const fullLen = [...originalValue].length;
  const visible = '_'.repeat(Math.min(fullLen, MAX_VISIBLE_UNDERSCORE_LEN));
  const zwsCount = index + 1;
  return visible + '\u200B'.repeat(zwsCount);
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
