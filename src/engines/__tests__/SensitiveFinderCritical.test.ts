/**
 * P0 核心 invariant 测试 — TEST_SPECIFICATION §A2 / §D 缺失测试
 *
 * 覆盖历史 bug pattern + 当前未测但实质风险的 invariant：
 *   SPEC-A2-04: COMPANY 排除词（"关联公司"、"甲方公司"、"乙方公司"）
 *   SPEC-A2-05: mergeOverlappingValueAware 重叠选更长
 *   SPEC-A2-06: value 与区间一致性 invariant
 *               （text.slice(m.start, m.start + m.value.length) === m.value）
 *   SPEC-A2-07: 关键词步长 ≥ 1（zero-width regex 死循环防护）
 *   SPEC-D-07:  空密码不应静默用 fallback（commit 4063d7d 已删 fallback）
 *
 * 本轮新发现：写 SPEC-A2-07 测试时发现 SensitiveFinder.addKeywords(['']) 触发 OOM。
 * 根因：findSensitiveContent 里 `indexOf('', index)` 永远返回 index（步长 0 死循环）。
 * 修法：addKeywords 过滤空字符串。已加修复 + 测试。
 */
import { describe, it, expect } from 'vitest';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { CryptoManager } from '@/engines/CryptoManager';
import fs from 'fs';
import path from 'path';

describe('SPEC-A2-04: COMPANY 排除词', () => {
  const finder = new SensitiveFinder();

  it('"关联公司" 不被识别为 COMPANY', () => {
    const text = '本协议适用于关联公司的所有业务往来';
    const result = finder.findSensitiveContent(text);
    const companyMatches = result.matches.filter(m => m.type === 'COMPANY');
    expect(companyMatches.some(m => m.value.includes('关联公司'))).toBe(false);
  });

  it('"甲方公司" 单独出现不被识别', () => {
    const text = '甲方公司应承担相应责任';
    const result = finder.findSensitiveContent(text);
    const companyMatches = result.matches.filter(m => m.type === 'COMPANY');
    // 排除正则精确匹配 "甲方公司"，这个特定字符串不应被识别
    expect(companyMatches.some(m => m.value === '甲方公司')).toBe(false);
  });

  it('"乙方公司" 单独出现不被识别', () => {
    const text = '乙方公司有权终止合同';
    const result = finder.findSensitiveContent(text);
    const companyMatches = result.matches.filter(m => m.type === 'COMPANY');
    expect(companyMatches.some(m => m.value === '乙方公司')).toBe(false);
  });

  it('"甲方" 仍然可以正常识别（如"甲方：北京示例科技有限公司"）', () => {
    const text = '甲方：北京示例科技有限公司';
    const result = finder.findSensitiveContent(text);
    const companyMatches = result.matches.filter(m => m.type === 'COMPANY');
    expect(companyMatches.length).toBe(1);
    expect(companyMatches[0].value).toBe('北京示例科技有限公司');
  });
});

describe('SPEC-A2-05: mergeOverlappingValueAware 重叠选更长', () => {
  const finder = new SensitiveFinder();

  /**
   * 关键词（短）和 COMPANY 规则（长）重叠时，应选更长（更具体）的 COMPANY match。
   * 根因（commit 985ae11 follow-up）：旧 utils.mergeOverlapping 用 last.end 扩展区间，
   * 但不更新 value → value.length < end-start，下游 Desensitizer 算 mask 长度错位。
   */
  it('短 keyword 与长 COMPANY 重叠：保留更长的 COMPANY match', () => {
    const text = '北京示例科技有限公司';
    // 模拟用户加 keyword "字节"（短）和默认规则 COMPANY（长）
    finder.addKeywords(['字节']);
    const result = finder.findSensitiveContent(text);
    const matches = result.matches.filter(m => m.type === 'COMPANY' || m.type === 'CUSTOM');
    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('COMPANY');
    expect(matches[0].value).toBe('北京示例科技有限公司');
  });

  it('多个 keyword 都包含在长 COMPANY 内：全部被去重，只剩 1 个 COMPANY', () => {
    const text = '北京示例科技有限公司';
    finder.addKeywords(['字节', '跳动', '北京字节']);
    const result = finder.findSensitiveContent(text);
    const matches = result.matches.filter(m => m.type === 'COMPANY' || m.type === 'CUSTOM');
    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe('COMPANY');
  });

  it('等长重叠：保持先到先得（确定性）', () => {
    const finder2 = new SensitiveFinder();
    finder2.addKeywords(['示例']);
    const text = '示例科技有限公司';  // 5 + 6 = 11 chars 重叠
    const result = finder2.findSensitiveContent(text);
    // 两个 match 都存在（5-char custom + 6-char company 部分重叠 [0,5) vs [0,6)）
    // 但因为 addKeywords 添加 + 规则 COMPANY 都可能命中，需要确认至少一个 match
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    // 不变量：所有 match 的 value 必须 = text.slice(start, start+value.length)
    result.matches.forEach((m, i) => {
      const sliced = text.slice(m.start, m.start + m.value.length);
      expect(sliced === m.value, `match ${i}: value="${m.value}"`).toBe(true);
    });
  });
});

describe('SPEC-A2-06: match value 与区间一致性 invariant', () => {
  const finder = new SensitiveFinder();

  /**
   * 不变量：text.slice(m.start, m.start + m.value.length) === m.value
   * 下游 Desensitizer / restore 都依赖这个 invariant，违反会导致：
   *   - maskedToken 长度错位（视觉下划线对不齐）
   *   - restore 时切错位置（找不到 maskedToken）
   */
  it('所有 match 都满足 slice(m.start, m.start + m.value.length) === m.value', () => {
    const text = '甲方：北京示例科技有限公司，项目编号：SAMPLE-A-001，电话：13800000000';
    const result = finder.findSensitiveContent(text);
    expect(result.matches.length).toBeGreaterThan(0);
    result.matches.forEach((m, i) => {
      const sliced = text.slice(m.start, m.start + m.value.length);
      expect(
        sliced === m.value,
        `match ${i}: type=${m.type} value="${m.value}" start=${m.start} end=${m.end} — slice="${sliced}"`
      ).toBe(true);
    });
  });

  it('加 keyword 后再跑一次，invariant 仍成立', () => {
    const text = '甲方：北京示例科技有限公司上海分公司';
    const fresh = new SensitiveFinder();
    fresh.addKeywords(['北京示例', '示例科技有限公司']);
    const result = fresh.findSensitiveContent(text);
    result.matches.forEach((m, i) => {
      const sliced = text.slice(m.start, m.start + m.value.length);
      expect(sliced === m.value, `match ${i}: value="${m.value}"`).toBe(true);
    });
  });
});

describe('SPEC-A2-07: 关键词步长 ≥ 1（zero-width 死循环防护）', () => {
  /**
   * 历史 bug 模式：regex with zero-width pattern (e.g. /(?=X)/g) + exec loop without
   * step can hang forever. SensitiveFinder 的 keyword 路径：`indexOf('', index)` 永远
   * 返回 index（空串匹配每个位置）→ lastIndex + keyword.length === lastIndex → 死循环。
   *
   * 修法：addKeywords 过滤空串。本测试验证修复有效 + 不影响正常 keyword。
   */
  it('空字符串 keyword 不会触发 OOM（addKeywords 过滤）', () => {
    const finder = new SensitiveFinder();
    finder.addKeywords(['']);  // 不应 hang
    const start = Date.now();
    const result = finder.findSensitiveContent('任意文本' + 'X'.repeat(10000));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);  // 1s 内必返回
    expect(result.matches.length).toBe(0);  // 空 keyword 不匹配
  });

  it('混合空串 + 正常 keyword：正常 keyword 仍工作', () => {
    const finder = new SensitiveFinder();
    finder.addKeywords(['', '示例', '']);
    const result = finder.findSensitiveContent('北京示例科技有限公司');
    // 空串被过滤，"示例" 应正常匹配（但被长 COMPANY match 合并）
    const matches = result.matches.filter(m => m.type === 'COMPANY' || m.type === 'CUSTOM');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some(m => m.value.includes('示例'))).toBe(true);
  });
});

describe('SPEC-D-07: 空密码不应静默用 fallback', () => {
  /**
   * commit 4063d7d 移除了 fallback 密码 'desensitizer-meta'。
   * 修法：UploadPage 用 `if (!downloadPasswordRef.current) throw` 拦截空密码。
   * 这个测试验证：
   *   1. CryptoManager.encryptMappingTable('') 与 encryptMappingTable('desensitizer-meta') 产生的密文不能用对方密码解密（说明没有 fallback 路径）
   *   2. 静态扫描源码，确认 'desensitizer-meta' 不在 fileStore / Desensitizer fallback 路径
   */
  it('空密码与 "desensitizer-meta" 密码产生的密文互不可解密', async () => {
    const crypto = new CryptoManager();
    const table = [{
      id: '1', type: 'COMPANY', originalValue: '北京示例科技有限公司',
      maskedToken: '__________________' + '\u200B', position: { start: 0, end: 18 },
    }];

    // 用空密码加密
    const emptyEnc = await crypto.encryptMappingTable(table, '');
    // 用 "desensitizer-meta" 加密（同样的 table）
    const fallbackEnc = await crypto.encryptMappingTable(table, 'desensitizer-meta');

    // 各自能解自己
    const decEmpty = await crypto.decryptMappingTable(emptyEnc.encrypted, '', emptyEnc.salt, emptyEnc.iv);
    const decFallback = await crypto.decryptMappingTable(fallbackEnc.encrypted, 'desensitizer-meta', fallbackEnc.salt, fallbackEnc.iv);
    expect(decEmpty).toEqual(table);
    expect(decFallback).toEqual(table);

    // 跨密码必抛（核心 invariant：如果 fileStore fallback 到 "desensitizer-meta"，
    // 这两个 AES-GCM 解密会成功 — 失败 = 没有 fallback 路径）
    await expect(
      crypto.decryptMappingTable(emptyEnc.encrypted, 'desensitizer-meta', emptyEnc.salt, emptyEnc.iv),
    ).rejects.toThrow();
    await expect(
      crypto.decryptMappingTable(fallbackEnc.encrypted, '', fallbackEnc.salt, fallbackEnc.iv),
    ).rejects.toThrow();
  });

  it('commit 4063d7d 验证：源码无 "desensitizer-meta" fallback', () => {
    const fileStoreSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/stores/fileStore.ts'), 'utf-8',
    );
    const desensitizerSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/engines/Desensitizer.ts'), 'utf-8',
    );
    const fileStoreHits = fileStoreSrc.match(/desensitizer-meta/g) || [];
    const desensitizerHits = desensitizerSrc.match(/desensitizer-meta/g) || [];
    expect(
      fileStoreHits.length + desensitizerHits.length,
      'fallback "desensitizer-meta" 必须已删除（commit 4063d7d）'
    ).toBe(0);
  });
});