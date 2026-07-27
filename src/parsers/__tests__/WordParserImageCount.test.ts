/**
 * imageCount + imagePositions（2026-07-27 spy 央视合同 3.11 反馈）
 *
 * WordParser 用 `mammoth.convertToHtml({ arrayBuffer }).value` 数 <img> 得到 imageCount；
 * 用同一个 HTML + rawText 找 imagePositions（每个 <img> 回溯到上一个 <p> 文本）。
 * 这个测试只验证**两个计数函数**对的，不验 WordParser 整体管线（那个要走 Node Buffer 双传形态，
 * 属于另一个测试范围）。
 *
 * 验收：
 *   - 0 张图 → 0 / positions 空数组
 *   - 多图（含 PNG/EMF/JPEG 混合）→ 精确数字
 *   - <img...> 各种属性形态都能匹配（regex 必须用 word boundary 防 <image> 误吃）
 *   - findImagePositions: HTML 里每张 <img> 都包在 <p>，回溯前段文本 lastIndexOf 到 rawText
 */
import { describe, it, expect } from 'vitest';
import { findImagePositions } from '@/parsers/WordParser';

describe('imageCount 计数正则（2026-07-27）', () => {
  it('1: 0 张图 → 计数 0', () => {
    const html = '<p>第一段</p><p>第二段</p>';
    expect((html.match(/<img\b/gi) || []).length).toBe(0);
  });

  it('2: 多图（PNG/EMF/JPEG 混合）→ 精确计数', () => {
    const html = `<p>纯文本</p>
<img src="data:image/png;base64,AAA" />
<img src="data:image/x-emf;base64,BBB" />
<img src="data:image/jpeg;base64,CCC" />`;
    expect((html.match(/<img\b/gi) || []).length).toBe(3);
  });

  it('3: word boundary 防止 <image> / <img> 误匹配', () => {
    const html = '<image>文本</image><img />';
    expect((html.match(/<img\b/gi) || []).length).toBe(1);
  });
});

describe('findImagePositions（2026-07-27）', () => {
  it('4: 无图 → 空数组', () => {
    const html = '<p>A</p><p>B</p>';
    expect(findImagePositions('A\n\nB', html)).toEqual([]);
  });

  it('5: 1 张图：回溯到上一段文本末尾 offset', () => {
    const rawText = '前置文本\n\n清单如下：\n\n\n后置文本';
    const html = '<p>前置文本</p><p>清单如下：</p><p><img src="data:image/x-emf;base64,A" /></p><p>后置文本</p>';
    const positions = findImagePositions(rawText, html);
    expect(positions.length).toBe(1);
    // 应指向 "清单如下：" 末尾 + 1（空段起点）
    expect(rawText.slice(0, positions[0])).toContain('清单如下：');
    expect(rawText.slice(positions[0])).not.toContain('清单如下：');
  });

  it('6: 2 张图按 HTML 顺序升序返回', () => {
    const rawText = 'AAA\n\nBBB\n\nCCC\n\nDDD';
    const html = '<p>AAA</p><p><img src="a" /></p><p>BBB</p><p>CCC</p><p><img src="b" /></p><p>DDD</p>';
    const positions = findImagePositions(rawText, html);
    expect(positions.length).toBe(2);
    // 第一张 chip 应在 AAA 末尾后
    expect(rawText.slice(0, positions[0])).toContain('AAA');
    // 第二张 chip 应在 CCC 末尾后
    expect(rawText.slice(0, positions[1])).toContain('CCC');
    expect(positions[0] < positions[1]).toBe(true);
  });

  it('7: 前段文本被多次出现时（避免错配前文），用 lastIndexOf', () => {
    const rawText = '清单如下：\n\n\n第一段\n\n\n清单如下：\n\n\n第二段';
    const html = '<p>清单如下：</p><p><img src="1" /></p><p>第一段</p><p>清单如下：</p><p><img src="2" /></p><p>第二段</p>';
    const positions = findImagePositions(rawText, html);
    expect(positions.length).toBe(2);
    // 第二个 chip 应在 "第二段" 之前的 "清单如下：" 末尾
    const beforeSecond = rawText.slice(0, positions[1]);
    expect(beforeSecond.lastIndexOf('清单如下：')).toBeGreaterThan(rawText.indexOf('第一段'));
  });
});
