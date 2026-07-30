/**
 * P1 Desensitizer 边界测试 — TEST_SPECIFICATION §C 缺失测试
 *
 *   SPEC-C1-04: 重叠 match 跳过（兜底，上游 mergeOverlappingValueAware 兜底）
 *   SPEC-C2-04: position 越界（start < 0 / end > length / start > end）→ 跳过该 entry 兜底
 *   SPEC-C1-05: maskedToken = 下划线 + 零宽空格（不是 [TYPE_NNNN]）— 已覆盖，确认加严
 *   SPEC-C1-06: maskedToken 长度 = 原值字符数（width-detectable，便于按位置还原）
 *   SPEC-C3 系列: createMaskedValue mask 模式行为
 */
import { describe, it, expect } from 'vitest';
import { Desensitizer } from '@/engines/Desensitizer';
import { CryptoManager } from '@/engines/CryptoManager';
import type { SensitiveMatch, MappingEntry, SensitiveType } from '@/types';

function mkMatch(id: string, type: SensitiveMatch['type'], value: string, start: number): SensitiveMatch {
  return {
    id, type, value,
    start,
    end: start + value.length,
    confidence: 1.0,
    context: '',
  };
}

const desensitizer = new Desensitizer(new CryptoManager());

describe('SPEC-C1-04: 重叠 match 跳过兜底', () => {
  /**
   * 上游 SensitiveFinder.mergeOverlappingValueAware 已经合并重叠 match，
   * 但 Desensitizer 仍需兜底：如果传入重叠 match，跳过后续的（避免重复 token / 错位）。
   */
  it('完全重叠：第一个 match 占位，第二个被跳过（不产生 token）', async () => {
    const text = '北京示例科技有限公司';
    const m1 = mkMatch('m1', 'COMPANY', '示例科技', 3);  // 子串 [3, 9)
    const m2 = mkMatch('m2', 'COMPANY', '北京示例科技有限公司', 0);  // 完整 [0, 13)
    // sort 后 m2 先（start=0），m1 后（start=3）→ m2 占位 + cursor=13
    // m1.start=3 < cursor=13 → continue 跳过
    const { mappingTable } = await desensitizer.desensitize(text, [m1, m2], { mode: 'encrypt' });
    expect(mappingTable.length).toBe(1);
    expect(mappingTable[0].originalValue).toBe('北京示例科技有限公司');
  });

  it('部分重叠 + 后续 match 越界：跳过', async () => {
    const text = 'abcdefgh';
    const m1 = mkMatch('m1', 'COMPANY', 'cdef', 2);  // [2, 6)
    const m2 = mkMatch('m2', 'COMPANY', 'efghi', 4);  // [4, 9) — 越界 text.length=8
    const { mappingTable } = await desensitizer.desensitize(text, [m1, m2], { mode: 'encrypt' });
    // sort: m1 [2,6) first, m2 [4,9) second.
    // m2.start=4 < cursor=6 → continue 跳过
    expect(mappingTable.length).toBe(1);
    expect(mappingTable[0].originalValue).toBe('cdef');
  });

  it('非法区间 (end < start)：跳过', async () => {
    const text = 'abcdefgh';
    const m1 = { ...mkMatch('m1', 'COMPANY', 'cd', 0), end: -1 };  // 非法 end
    const m2 = mkMatch('m2', 'COMPANY', 'ef', 4);  // [4, 6)
    const { mappingTable, desensitizedText } = await desensitizer.desensitize(text, [m1 as SensitiveMatch, m2], { mode: 'encrypt' });
    // sort by start: m1 (start=0) first, m1.end=-1 < start=0 → skip
    // m2 (start=4) second, 正常 push
    expect(mappingTable.length).toBe(1);
    expect(mappingTable[0].originalValue).toBe('ef');
    // m1 占位的 "ab" 仍在 desensitizedText 里
    expect(desensitizedText.startsWith('ab')).toBe(true);
  });
});

describe('SPEC-C2-04: restore position 越界兜底', () => {
  /**
   * 兜底：position 越界 / 非法就跳过该 entry（不应该发生，但不让一处坏数据毁整段文本）
   */
  it('start < 0：跳过该 entry，其他 entry 正常还原', async () => {
    // text = 'X[PHONE]Y' (9 chars): X=0, [PHONE]=1-7, ]=7, Y=8. So [PHONE] 段 [1,8).
    const text = 'X[PHONE]Y';
    const valid: MappingEntry = {
      id: '1', type: 'PHONE',
      originalValue: '13800000000',
      maskedToken: '[PHONE]',
      position: { start: 1, end: 8 },
    };
    const broken: MappingEntry = {
      id: '2', type: 'EMAIL',
      originalValue: 'x@y.com',
      maskedToken: '[EMAIL]',
      position: { start: -1, end: 5 },
    };
    const result = await desensitizer.restore(text, [valid, broken], '');
    expect(result).toBe('X13800000000Y');
  });

  it('end > result.length：跳过该 entry', async () => {
    const text = 'X[PHONE]Y';
    const broken: MappingEntry = {
      id: '1', type: 'PHONE',
      originalValue: 'X',
      maskedToken: '_',
      position: { start: 1, end: 100 },  // end 远超 text.length=9
    };
    const result = await desensitizer.restore(text, [broken], '');
    expect(result).toBe('X[PHONE]Y');  // broken 被跳过
  });

  it('start > end：跳过该 entry', async () => {
    const text = 'X[PHONE]Y';
    const broken: MappingEntry = {
      id: '1', type: 'PHONE',
      originalValue: 'X',
      maskedToken: '_',
      position: { start: 10, end: 5 },  // 非法
    };
    const result = await desensitizer.restore(text, [broken], '');
    expect(result).toBe('X[PHONE]Y');
  });

  it('NaN position：跳过该 entry', async () => {
    const text = 'X[PHONE]Y';
    const broken: MappingEntry = {
      id: '1', type: 'PHONE',
      originalValue: 'X',
      maskedToken: '_',
      position: { start: NaN, end: 8 },
    };
    const result = await desensitizer.restore(text, [broken], '');
    expect(result).toBe('X[PHONE]Y');
  });

  it('混合：2 valid + 2 broken → 2 valid 还原', async () => {
    // text = 'A[B]C[D]E' (9 chars):
    //   index 0=A, 1-3=[B], 4=C, 5-7=[D], 8=E
    const text = 'A[B]C[D]E';
    const e1: MappingEntry = {  // valid → [1,4) → 'b' (替换 [B])
      id: '1', type: 'PHONE', originalValue: 'b',
      maskedToken: '[B]', position: { start: 1, end: 4 },
    };
    const e2: MappingEntry = {  // broken start < 0
      id: '2', type: 'PHONE', originalValue: 'd',
      maskedToken: '_', position: { start: -5, end: 6 },
    };
    const e3: MappingEntry = {  // broken end > length (text.length=9)
      id: '3', type: 'PHONE', originalValue: 'd',
      maskedToken: '_', position: { start: 5, end: 100 },
    };
    const e4: MappingEntry = {  // valid → [5,8) → 'd' (替换 [D])
      id: '4', type: 'PHONE', originalValue: 'd',
      maskedToken: '[D]', position: { start: 5, end: 8 },
    };
    const result = await desensitizer.restore(text, [e1, e2, e3, e4], '');
    // restore 按 start 降序处理: e4 (start=5) → e3 (skip) → e2 (skip) → e1 (start=1)
    // e4: A[B]C[d]E (替换 [D] → d)
    // e1: AbC[d]E (替换 [B] → b)
    expect(result).toBe('AbCdE');
  });
});

describe('SPEC-C1-05/06: maskedToken 格式 + 长度', () => {
  it('maskedToken = 下划线 + 零宽空格（不是 [TYPE_NNNN]）', async () => {
    const text = '电话：13800000000';
    const m = mkMatch('m1', 'PHONE', '13800000000', 3);
    const { desensitizedText } = await desensitizer.desensitize(text, [m], { mode: 'encrypt' });
    // 不含 [PHONE_NNNN] 这种 label
    expect(desensitizedText).not.toContain('[PHONE_');
    // 长字段被 MAX_VISIBLE_UNDERSCORE_LEN (8) 截断：8 个 `_` + 1 ZWS
    expect(desensitizedText).toMatch(/_{8}\u200B/);
  });

  it('maskedToken 可见长度 <= MAX_VISIBLE_UNDERSCORE_LEN（长字段压缩）', async () => {
    const text = 'phone 12345678901 here';
    const m = mkMatch('m1', 'PHONE', '12345678901', 6);
    const { desensitizedText } = await desensitizer.desensitize(text, [m], { mode: 'encrypt' });
    // 11 字原值 → 8 个 `_` + 1 ZWS（spy 选"只压缩明显过长的字段"）
    const underscoreRun = desensitizedText.match(/_{8,}/)?.[0].length ?? 0;
    expect(underscoreRun).toBe(8);
  });

  it('多 match 按 occurrence 顺序一对一替换', async () => {
    // 同一 value 出现两次，各自生成不同 maskedToken（用 occurrence index 区分）
    const text = 'phone: 12345678901, alt: 12345678901';
    const m1 = mkMatch('m1', 'PHONE', '12345678901', 7);
    const m2 = mkMatch('m2', 'PHONE', '12345678901', 27);
    const { mappingTable } = await desensitizer.desensitize(text, [m1, m2], { mode: 'encrypt' });
    expect(mappingTable.length).toBe(2);
    // maskedToken 不应相同（occurrence 区分）
    expect(mappingTable[0].maskedToken).not.toBe(mappingTable[1].maskedToken);
  });
});

describe('SPEC-C3: createMaskedValue 各类型 mask 模式', () => {
  const d = new Desensitizer(new CryptoManager());

  const cases: Array<[SensitiveType, string, string]> = [
    ['PHONE', '13800000000', '138****0000'],
    ['EMAIL', 'a@b.com', 'a***@b.com'],  // source: local.slice(0, 2) + '***'
    ['ID_CARD', '110101199003078811', '110101********8811'],
    ['BANK_CARD', '6222021234567890123', '6222 **** **** 0123'],
    ['IP', '192.168.1.100', '192.168.1.*.*'],  // source: lastIndexOf('.') 保留 3 段
    ['AMOUNT', '¥1000', '¥****'],
    ['AMOUNT_UPPER', '壹佰元整', '¥****'],
    ['ADDRESS', '北京市朝阳区xxx', '[地址]'],
    ['COMPANY', '北京示例', '[公司名称]'],
    ['NAME', '张三', '[姓名]'],
    ['CONTRACT_NO', 'HT20240802001', '[合同号]'],
    ['PROJECT_NAME', '知识产权服务', '[项目名称]'],
    ['TAX_ID', '911101053482731061', '[税号]'],
    ['CUSTOM', 'something', '[自定义]'],
  ];

  cases.forEach(([type, value, expected]) => {
    it(`${type}: "${value}" → "${expected}"`, () => {
      const masked = d.createMaskedValue(value, type);
      expect(masked).toBe(expected);
    });
  });
});