/**
 * NAME 误识别修复 — 第五批 audit（品牌咨询服务合同）
 *
 * 复现：品牌合同 "联系人：        电话：" → NAME regex lookbehind 匹配"联系人："
 *       然后"电话" 2 chars 被识别为 NAME
 *
 * 根因：NAME regex `(?<=姓名\s*[:：]\s*|名字\s*[:：]\s*|客户姓名\s*[:：]\s*|联系人\s*[:：]\s*)[\u4e00-\u9fa5]{2,4}`
 *       lookbehind 不限制 name 本体是不是真姓名
 *
 * 修法：NAME post-filter 排除常见"非姓名"通用词（电话/邮箱/地址/手机 等）
 *       真姓名在 2-4 hanChars 范围内几乎不含这些词
 */
import { describe, it, expect } from 'vitest';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { BUILTIN_RULES } from '@/rules/BuiltinRules';

function buildFinder(): SensitiveFinder {
  const finder = new SensitiveFinder();
  BUILTIN_RULES.forEach(r => finder.addRule({
    id: r.type,
    type: r.type,
    pattern: r.pattern,
    weight: r.weight,
    enabled: true,
  }));
  return finder;
}

describe('NAME 误识别修复 — 通用词 label 不应识别为姓名', () => {
  it('case 64: "联系人：电话：" → 电话不应识别为 NAME', () => {
    const text = '甲方联系地址：\n联系人：        电话：\n邮箱：';
    const finder = buildFinder();
    const result = finder.findSensitiveContent(text);
    const names = result.matches.filter(m => m.type === 'NAME').map(m => m.value);
    console.log(`\n[case 64] 输入: "${text}" → NAME 匹配: ${JSON.stringify(names)}`);
    expect(names).not.toContain('电话');
  });

  it('case 65 (回归): 真姓名"张三"在"联系人：张三" → 应保留', () => {
    const text = '联系人：张三';
    const finder = buildFinder();
    const result = finder.findSensitiveContent(text);
    const names = result.matches.filter(m => m.type === 'NAME').map(m => m.value);
    console.log(`\n[case 65] 输入: "${text}" → NAME 匹配: ${JSON.stringify(names)}`);
    expect(names).toContain('张三');
  });

  it('case 66: "联系人：手机：" → 手机不应识别为 NAME', () => {
    const text = '联系人：手机：';
    const finder = buildFinder();
    const result = finder.findSensitiveContent(text);
    const names = result.matches.filter(m => m.type === 'NAME').map(m => m.value);
    console.log(`\n[case 66] 输入: "${text}" → NAME 匹配: ${JSON.stringify(names)}`);
    expect(names).not.toContain('手机');
  });

  it('case 67: "联系人：邮箱：" → 邮箱不应识别为 NAME', () => {
    const text = '联系人：邮箱：';
    const finder = buildFinder();
    const result = finder.findSensitiveContent(text);
    const names = result.matches.filter(m => m.type === 'NAME').map(m => m.value);
    console.log(`\n[case 67] 输入: "${text}" → NAME 匹配: ${JSON.stringify(names)}`);
    expect(names).not.toContain('邮箱');
  });

  it('case 68: "联系人：地址：" → 地址不应识别为 NAME', () => {
    const text = '联系人：地址：';
    const finder = buildFinder();
    const result = finder.findSensitiveContent(text);
    const names = result.matches.filter(m => m.type === 'NAME').map(m => m.value);
    console.log(`\n[case 68] 输入: "${text}" → NAME 匹配: ${JSON.stringify(names)}`);
    expect(names).not.toContain('地址');
  });
});