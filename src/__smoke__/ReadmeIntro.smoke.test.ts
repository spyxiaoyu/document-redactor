/**
 * README 工具介绍 + 亮点速览 — 锁死项
 *
 *   spy 决策：扩 README.md 让 GitHub 用户 30 秒内看明白
 *   - 谁该用 / 解决什么痛点（vs 传统方案）
 *   - 亮点速览（独特价值钩子）
 *
 *   锁死项（防止后续 PR 改回平淡开篇）：
 *   - 含 `## 适合谁` 段（4 类典型用户）
 *   - 含 `## 解决什么痛点` 对照表（vs 传统方案）
 *   - 含 `## 亮点速览` 块（7 条钩子）
 *   - 含关键钩子词：零上传 / 可逆 / 真保真 / OCR / 零依赖 / 离线
 *   - 老开篇 `## 它解决什么问题` 段保留（向后兼容，不破坏指向）
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');

function readReadme(): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, 'README.md'), 'utf-8');
}

describe('README 开篇结构', () => {
  it('含 `## 适合谁` 段（4 类典型用户）', () => {
    const content = readReadme();
    expect(content).toMatch(/^##\s+适合谁/m);
    expect(content).toContain('法务');
    expect(content).toContain('HR');
    expect(content).toContain('销售');
    expect(content).toContain('数据团队');
  });

  it('含 `## 解决什么痛点` 对照表（含 vs 传统方案列）', () => {
    const content = readReadme();
    expect(content).toMatch(/^##\s+解决什么痛点/m);
    // 对照表应含 "传统方案" 和 "本工具" 列
    expect(content).toContain('传统方案');
    expect(content).toContain('本工具');
    // 至少含 5 行痛点对比
    const painRows = content.match(/\|\s*[^|]+\s*\|\s*[^|]+\s*\|\s*[^|]+\s*\|/g) ?? [];
    expect(painRows.length).toBeGreaterThanOrEqual(5);
  });

  it('含 `## 亮点速览` 块', () => {
    const content = readReadme();
    expect(content).toMatch(/^##\s+亮点速览/m);
  });

  it('亮点速览含 7 条钩子', () => {
    const content = readReadme();
    // 切出"亮点速览"段（到下一个 ## heading 或文件末尾）
    const highlightsMatch = content.match(/##\s+亮点速览[\s\S]*?(?=\n##\s|$)/);
    expect(highlightsMatch).not.toBeNull();
    const highlightsSection = highlightsMatch![0];
    // 7 条 `- ` 列表项
    const bulletCount = (highlightsSection.match(/^[-*]\s+/gm) ?? []).length;
    expect(bulletCount).toBeGreaterThanOrEqual(7);
  });
});

describe('README 关键钩子词', () => {
  const hookWords = ['零上传', '可逆', '真保真', 'OCR', '零依赖', '离线'];

  hookWords.forEach((word) => {
    it(`含钩子词 "${word}"`, () => {
      expect(readReadme()).toContain(word);
    });
  });
});

describe('README 向后兼容', () => {
  it('老 `## 核心特性` 段保留（详细功能表，与亮点速览互补）', () => {
    const content = readReadme();
    expect(content).toMatch(/^##\s+核心特性/m);
  });
});