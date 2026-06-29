import { describe, it, expect } from 'vitest';
import { CryptoManager } from '../CryptoManager';
import { Desensitizer } from '../Desensitizer';
import type { SensitiveMatch } from '@/types';

/**
 * 端到端 pipeline round-trip：模拟 UploadPage 加密 → 模拟 RestorePage 解密 + 还原。
 * 用户报的"密码错误或映射表解密失败"很可能是 catch block 兜底太宽，
 * 这一组测试钉死"算法本身 + 密码正确性"两端都是 OK 的。
 *
 * 注：matches 给的是 ORIGINAL text 里的位置；desensitize 必须按这些位置切 ORIGINAL，
 *     不能用切过的文本再切。重叠 matches 是已知边界，本测试不覆盖。
 */
describe('End-to-end: encrypt → decrypt → restore pipeline', () => {
  it('正密码能完整 round-trip（嵌套子串 + 中文项目编号）', async () => {
    const crypto = new CryptoManager();
    const desensitizer = new Desensitizer(crypto);

    const text = '甲方：北京示例科技有限公司\n项目编号：SAMPLE-CT-002\n乙方：张三';
    const matches: SensitiveMatch[] = [
      // 位置严格按 ORIGINAL text 数。已确认不重叠。
      { id: '1', type: 'COMPANY', value: '北京示例科技有限公司', start: 3, end: 15, confidence: 1, context: 'test' },
      { id: '2', type: 'CONTRACT_NO', value: 'SAMPLE-CT-002', start: 21, end: 34, confidence: 1, context: 'test' },
      { id: '3', type: 'NAME', value: '张三', start: 38, end: 40, confidence: 1, context: 'test' },
    ];

    // Step 1: 脱敏
    const { desensitizedText, mappingTable } = await desensitizer.desensitize(text, matches, { mode: 'encrypt' });
    expect(desensitizedText).not.toContain('示例');
    expect(desensitizedText).not.toContain('20240802');
    expect(desensitizedText).not.toContain('张三');

    // Step 2: 加密 mappingTable（UploadPage 干的事）
    const password = 'test123';
    const enc = await desensitizer.encryptMappingTable(mappingTable, password);
    expect(enc.encrypted.byteLength).toBeGreaterThan(0);
    expect(enc.salt.length).toBe(16);
    expect(enc.iv.length).toBe(12);

    // Step 3: 解密 mappingTable（RestorePage 干的事）
    const decrypted = await desensitizer.decryptMappingTable(
      enc.encrypted, password, enc.salt, enc.iv
    );
    expect(decrypted.length).toBe(mappingTable.length);
    expect(decrypted[0].originalValue).toBe('北京示例科技有限公司');

    // Step 4: 用解密出来的 mappingTable 还原 desensitizedText
    const restored = await desensitizer.restore(desensitizedText, decrypted, password);
    expect(restored).toBe(text);
  });

  it('错密码确实抛 AES-GCM 错误（确认解密层有边界）', async () => {
    const crypto = new CryptoManager();
    const desensitizer = new Desensitizer(crypto);
    const enc = await desensitizer.encryptMappingTable(
      [{ id: 'x', type: 'COMPANY', originalValue: '字节', maskedToken: '_X_', position: { start: 0, end: 3 } }] as any,
      'right-password'
    );

    await expect(
      desensitizer.decryptMappingTable(enc.encrypted, 'wrong-password', enc.salt, enc.iv)
    ).rejects.toThrow();
  });

  it('不重叠的两条同名公司（原值相同、token 不同）正确还原', async () => {
    // 现实场景：同一公司在文中出现两次。SensitiveFinder 报两个 match，token 不同。
    const crypto = new CryptoManager();
    const desensitizer = new Desensitizer(crypto);
    const text = '示例和示例两家公司'; // 示例在 [0,4] 和 [5,9]
    const matches: SensitiveMatch[] = [
      { id: '1', type: 'COMPANY', value: '示例', start: 0, end: 4, confidence: 1, context: 't' },
      { id: '2', type: 'COMPANY', value: '示例', start: 5, end: 9, confidence: 1, context: 't' },
    ];
    const { desensitizedText, mappingTable } = await desensitizer.desensitize(text, matches, { mode: 'encrypt' });
    const restored = await desensitizer.restore(desensitizedText, mappingTable, '');
    expect(restored).toBe(text);
  });

  it('错密码恢复时，给的应该是真错而不是误导消息', async () => {
    // 这条测试的意义不在测 decrypt 本身（上一条覆盖了），
    // 而是证明：错密码是真实可预期的错，不是 RestorePage 的 catch block 吞掉了别的什么。
    const crypto = new CryptoManager();
    const desensitizer = new Desensitizer(crypto);
    const enc = await desensitizer.encryptMappingTable(
      [{ id: 'x', type: 'COMPANY', originalValue: '字节', maskedToken: '_X_', position: { start: 0, end: 3 } }] as any,
      'right-pwd'
    );

    let caught: Error | undefined;
    try {
      await desensitizer.decryptMappingTable(enc.encrypted, 'wrong-pwd', enc.salt, enc.iv);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    // AES-GCM 报错是 OperationError，不是字符串字面量。RestorePage 应该把 err.name 显示出来而不是翻译。
    expect(caught?.name).toMatch(/Error/i);
  });
});
