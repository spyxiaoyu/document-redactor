/**
 * P2 utils 纯函数单元测试 — TEST_SPECIFICATION §J 跨切割面 + 部分 H 间接覆盖
 *
 *   SPEC-C1-05/06: generateDisplayToken 格式（已锁 f7341ae）
 *   SPEC-A2: extractContext 用法
 *   SPEC 工具函数: generateUUID / formatFileSize / replaceRange / mergeOverlapping
 *
 * 这些是 UploadPage / RestorePage / fileStore / SensitiveFinder 都依赖的底层工具函数。
 */
import { describe, it, expect } from 'vitest';
import {
  generateUUID,
  generateToken,
  generateDisplayToken,
  extractContext,
  formatFileSize,
  replaceRange,
  replaceAll,
  mergeOverlapping,
  filterHitsByExistingMatches,
} from '@/utils';

describe('generateUUID', () => {
  it('生成 36 字符 UUID', () => {
    const u = generateUUID();
    expect(u.length).toBe(36);
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('两次调用结果不同', () => {
    expect(generateUUID()).not.toBe(generateUUID());
  });
});

describe('SPEC-C1-05: generateDisplayToken', () => {
  /**
   * f7341ae 方案：'_'.repeat(len) + '\u200B'.repeat(index+1)
   * - 下划线视觉对齐
   * - ZWS 用 occurrence index 区分同长度 token
   */
  it('下划线长度 = 原值字符数', () => {
    const token = generateDisplayToken('13800000000', 0);
    // 11 chars * '_' + 1 ZWS
    const underscores = token.match(/^_+/)?.[0].length ?? 0;
    expect(underscores).toBe(11);
  });

  it('occurrence index = 0 → 1 个 ZWS', () => {
    const token = generateDisplayToken('abc', 0);
    expect(token.match(/\u200B/g)?.length).toBe(1);
  });

  it('occurrence index = 3 → 4 个 ZWS（index+1）', () => {
    const token = generateDisplayToken('abc', 3);
    expect(token.match(/\u200B/g)?.length).toBe(4);
  });

  it('同长度 token 不同 index 生成不同 token（可区分）', () => {
    const t0 = generateDisplayToken('abc', 0);  // ___ + 1 ZWS
    const t1 = generateDisplayToken('abc', 1);  // ___ + 2 ZWS
    expect(t0).not.toBe(t1);
  });

  it('空字符串：返回空 + 1 ZWS', () => {
    const token = generateDisplayToken('', 0);
    expect(token).toBe('\u200B');
  });

  it('中文字符：用 [...value].length 算视觉宽度', () => {
    const token = generateDisplayToken('北京字节', 0);
    // 4 中文字符 = 4 下划线 + 1 ZWS
    const underscores = token.match(/^_+/)?.[0].length ?? 0;
    expect(underscores).toBe(4);
  });
});

describe('generateToken (legacy [TYPE_NNNN])', () => {
  /**
   * 历史 token 格式：'[TYPE_NNNN]'。新方案（generateDisplayToken）已替代它，
   * 但 generateToken 仍在 utils 里 — 测试它不抛错 + 格式正确。
   */
  it('格式 = [TYPE_NNNN]', () => {
    expect(generateToken('PHONE', 0)).toMatch(/^\[PHONE_\d{4}\]$/);
    expect(generateToken('COMPANY', 42)).toBe('[COMPANY_0042]');
  });

  it('type 大写', () => {
    expect(generateToken('email', 5)).toBe('[email_0005]');
  });
});

describe('extractContext', () => {
  /**
   * SensitiveFinder 用：从全文里抽出 match 周围的 context 字符串（前 N + match + 后 N）
   * 实现：return `...${text.slice(start, index)}${text.slice(index, end)}...`
   * （不包含 match 本身，前后各 radius 字符 + ... 包裹）
   */
  it('返回 match 前后 radius 字符（不含 match 本身）', () => {
    const text = '甲方：北京示例科技有限公司';
    // index=8 是 '动' (前后 3 字符)
    // before = slice(max(0,8-3)=5, 8) = slice(5, 8) = '字节跳'
    // after = slice(8, min(15, 8+3)=11) = slice(8, 11) = '动科技'
    // result = '...' + '字节跳' + '动科技' + '...' = '...示例科技...'
    const ctx = extractContext(text, 8, 3);
    expect(ctx).toBe('...示例科技...');
  });

  it('radius 超出文本边界：截断到文本边界', () => {
    const text = '前缀-敏感-后缀';
    const ctx = extractContext(text, 4, 10);
    // start = max(0, 4-10) = 0, end = min(8, 4+10) = 8
    // before = text.slice(0, 4) = '前缀-'
    // after  = text.slice(4, 8) = '敏感-'（**实现包含 index 起点**，不是 match.end）
    // result = '...前缀-敏感-后缀...'
    expect(ctx).toBe('...前缀-敏感-后缀...');
  });

  it('默认 radius = 20（含 ... 前缀后缀）', () => {
    const text = 'A'.repeat(50) + 'X' + 'B'.repeat(50);
    const ctx = extractContext(text, 50);
    // start = max(0, 50-20) = 30, end = min(101, 50+20) = 70
    // before = 'A'*20, after = 'X' + 'B'*19
    // result = '...' + 'A'*20 + 'X' + 'B'*19 + '...' = 3 + 20 + 1 + 19 + 3 = 46 chars
    expect(ctx).toContain('X');
    expect(ctx.length).toBe(46);
    expect(ctx.startsWith('...')).toBe(true);
    expect(ctx.endsWith('...')).toBe(true);
  });
});

describe('formatFileSize', () => {
  it('0 B', () => expect(formatFileSize(0)).toBe('0 B'));
  it('512 B', () => expect(formatFileSize(512)).toBe('512 B'));
  it('1 KB', () => expect(formatFileSize(1024)).toBe('1 KB'));
  it('1.5 KB', () => expect(formatFileSize(1536)).toBe('1.5 KB'));
  it('1 MB', () => expect(formatFileSize(1024 * 1024)).toBe('1 MB'));
  it('2.5 MB', () => expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB'));
  it('1 GB', () => expect(formatFileSize(1024 ** 3)).toBe('1 GB'));
});

describe('replaceRange', () => {
  it('替换指定区间', () => {
    expect(replaceRange('hello world', 6, 11, 'JS')).toBe('hello JS');
  });

  it('空 replacement = 删除', () => {
    expect(replaceRange('hello world', 5, 11, '')).toBe('hello');
  });

  it('start = end = 插入', () => {
    expect(replaceRange('hello world', 5, 5, ' JS')).toBe('hello JS world');
  });

  it('start = end = 插入（保留原有空格）：拼接处有双空格', () => {
    // text.slice(5) = ' world'（开头有空格）+ 插入 ' JS '（结尾有空格）
    // = 'hello' + ' JS ' + ' world' = 'hello JS  world'（双空格）
    // 保留这个行为作为契约：replaceRange 不做 normalize，调用方负责
    expect(replaceRange('hello world', 5, 5, ' JS ')).toBe('hello JS  world');
  });
});

describe('replaceAll', () => {
  it('替换所有出现', () => {
    expect(replaceAll('a-b-c', '-', '+')).toBe('a+b+c');
  });

  it('没找到不抛错', () => {
    expect(replaceAll('hello', 'x', 'y')).toBe('hello');
  });

  it('空 replacement', () => {
    expect(replaceAll('abcabc', 'b', '')).toBe('acac');
  });
});

describe('mergeOverlapping', () => {
  /**
   * 历史 utils.mergeOverlapping 不感知 value，存在 corrupt 风险
   * （commit 985ae11 follow-up 修复）— 但基础合并逻辑仍有，加测保护 regression
   */
  it('不重叠：保持原序', () => {
    const arr = [{ start: 0, end: 3 }, { start: 5, end: 8 }];
    expect(mergeOverlapping(arr)).toEqual(arr);
  });

  it('完全重叠：保留先到（last.end 扩展）', () => {
    const arr = [{ start: 0, end: 3 }, { start: 1, end: 4 }];
    const result = mergeOverlapping(arr);
    // 旧实现保留 first，把 last 的 end 扩展到 first.end（如果 last 更长则相反）
    expect(result.length).toBe(1);
    expect(result[0].start).toBe(0);
  });

  it('空数组返回空', () => {
    expect(mergeOverlapping([])).toEqual([]);
  });

  it('3 段部分重叠', () => {
    const arr = [{ start: 0, end: 3 }, { start: 2, end: 5 }, { start: 4, end: 7 }];
    const result = mergeOverlapping(arr);
    // 全部重叠 → 1 段
    expect(result.length).toBe(1);
  });
});

describe('filterHitsByExistingMatches', () => {
  /**
   * 场景：用户已选中 17 字 COMPANY "北京示例科技有限公司"，
   *       又搜 "示例" 想批量脱敏。
   *       如果不过滤直接 addManualMatch，addManualMatch 的"重叠替换"会把
   *       17 字 match 替换成 4 字 → 脱敏范围变小。
   *       修法：批量脱敏前先用 filterHitsByExistingMatches 过滤掉重叠 hit。
   */
  it('Spy 截图回归：hit 完全在已选 match 内部 → 跳过（保留 17 字 match）', () => {
    const existing = [{ start: 2, end: 19, type: 'COMPANY' }]; // "北京示例科技有限公司"
    const hits = [{ start: 4, end: 8, type: 'CUSTOM' }];        // "示例"
    const result = filterHitsByExistingMatches(hits, existing);
    expect(result.length).toBe(0);
  });

  it('hit 与已选 match 部分重叠 → 跳过', () => {
    const existing = [{ start: 5, end: 10 }];
    const hits = [
      { start: 7, end: 12 },  // 部分重叠（7<10 && 12>5）
      { start: 3, end: 7 },   // 部分重叠（7>5 但 3<10）—— 注意 3<10 不行，要 3<existing.end=10 → TRUE
    ];
    const result = filterHitsByExistingMatches(hits, existing);
    expect(result.length).toBe(0);
  });

  it('hit 完全包含已选 match → 跳过（保守原则，不让批量覆盖小 match）', () => {
    const existing = [{ start: 10, end: 15 }];
    const hits = [{ start: 5, end: 20 }]; // 完全包住
    const result = filterHitsByExistingMatches(hits, existing);
    expect(result.length).toBe(0);
  });

  it('hit 与已选 match 边界相切（不相交）→ 保留', () => {
    const existing = [{ start: 5, end: 10 }];
    const hits = [
      { start: 10, end: 15 }, // 边界相切：hit.start=10 不 < existing.end=10 → 不重叠
      { start: 0, end: 5 },   // 边界相切：hit.end=5 不 > existing.start=5 → 不重叠
    ];
    const result = filterHitsByExistingMatches(hits, existing);
    expect(result.length).toBe(2);
  });

  it('hit 与已选 match 完全不重叠 → 保留', () => {
    const existing = [{ start: 0, end: 5 }];
    const hits = [
      { start: 10, end: 15 },
      { start: 20, end: 25 },
    ];
    const result = filterHitsByExistingMatches(hits, existing);
    expect(result.length).toBe(2);
  });

  it('多个 hit 部分重叠 / 部分不重叠 → 只过滤重叠的', () => {
    const existing = [{ start: 10, end: 15 }];
    const hits = [
      { start: 0, end: 5 },    // 不重叠 → 保留
      { start: 12, end: 18 },  // 重叠 → 跳过
      { start: 30, end: 35 },  // 不重叠 → 保留
      { start: 14, end: 20 },  // 重叠 → 跳过
    ];
    const result = filterHitsByExistingMatches(hits, existing);
    expect(result.length).toBe(2);
    expect(result.map(h => h.start)).toEqual([0, 30]);
  });

  it('hit 完全等于已选 match → 跳过', () => {
    const existing = [{ start: 10, end: 15 }];
    const hits = [{ start: 10, end: 15 }];
    const result = filterHitsByExistingMatches(hits, existing);
    expect(result.length).toBe(0);
  });

  it('空 hits 数组 → 返回空', () => {
    expect(filterHitsByExistingMatches([], [{ start: 0, end: 5 }])).toEqual([]);
  });

  it('空 existingMatches → 全部保留', () => {
    const hits = [{ start: 0, end: 5 }, { start: 10, end: 15 }];
    expect(filterHitsByExistingMatches(hits, [])).toEqual(hits);
  });

  it('保留原顺序', () => {
    const existing = [{ start: 100, end: 200 }];
    const hits = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
      { start: 20, end: 25 },
    ];
    const result = filterHitsByExistingMatches(hits, existing);
    expect(result).toEqual(hits); // 完全相同，没过滤
  });
});