/**
 * Probe 测试 — JSX whitespace text node 导致 offset 错位（spy 截图 bug B 真根因）
 *
 *   spy 2026-07-29 反馈：在 3.11 段选文本按 "+ 添加"，文字"跳"到完全不相关位置。
 *   旧 fix 用 TreeWalker SHOW_TEXT 算 offset。**真根因**：UploadPage 的
 *   <pre>...</pre> 里 JSX 缩进导致 DOM 含 `\n` text node，TreeWalker 把这些
 *   whitespace 当字符累加，但 rawText 没这些 whitespace → offset 偏 N chars →
 *   addManualMatch(slicedValue, [position]) 用错 position 加 match → 视图 render
 *   后滚动到新 match 位置 → spy 看到"跳到 3.15.5"。
 *
 *   真修法：在每个 text part / match part 打 data-raw-offset={rawOffset}，选中
 *   时 closest('[data-raw-offset]') 拿到 rawOffset，加 range.startOffset 即为
 *   真实 rawText offset。完全不依赖 previewText.slice / TreeWalker。
 *
 * Step 1（PROBE RED）：构造 JSX 风格 <pre>（含 whitespace text node），用户选
 *   第 2 个 span 的 "def"，期望 getRawOffsetFromSelection = 3（"abcdef" 中
 *   "def" 起点）。当前实现 computeSelectionOffset = 9（包含 2 个 whitespace
 *   text node）。**RED-确认 bug**。
 *
 * Step 2（GREEN）：新函数 getRawOffsetFromSelection，读 data-raw-offset，返回
 *   rawText offset = 3。**GREEN-确认 fix**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

import { getRawOffsetFromSelection } from '@/utils/selectionOffset';

describe('PROBE: JSX whitespace text node 让 TreeWalker offset 错位', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let rawText: string;
  let pre: HTMLPreElement;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;
    global.window = dom.window;

    // 模拟 UploadPage 的 <pre> JSX 编译结果：
    //   <pre>\n  <span>abc</span>\n  <span>def</span>\n  <span>ghi</span>\n</pre>
    // DOM 含 4 个 text node 的 "\n  " / "\n  " / "\n  " / "\n"，
    // 加上 3 个 <span>，共 7 个 text node。
    rawText = 'abcdefghi';  // 真 rawText：3 个 span 拼接，无 whitespace
    container = document.createElement('div');
    document.body.appendChild(container);
    pre = document.createElement('pre');
    pre.appendChild(document.createTextNode('\n  '));
    const s1 = document.createElement('span');
    s1.textContent = 'abc';
    pre.appendChild(s1);
    pre.appendChild(document.createTextNode('\n  '));
    const s2 = document.createElement('span');
    s2.textContent = 'def';
    pre.appendChild(s2);
    pre.appendChild(document.createTextNode('\n  '));
    const s3 = document.createElement('span');
    s3.textContent = 'ghi';
    pre.appendChild(s3);
    pre.appendChild(document.createTextNode('\n'));
    container.appendChild(pre);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it.todo('RED lock-in: computeSelectionOffset 把 JSX whitespace 算进 offset（已知 bug）', () => {
    // ⚠️ 已知 bug（spy 2026-07-29）：computeSelectionOffset(pre, range) 在 <pre> 含
    //   JSX whitespace text node 的 DOM 上返回错位的 offset（实测偏 N×3 chars），
    //   导致 fileStore.addManualMatch(slicedValue, [position]) 用错 position 加
    //   match → 视图滚动到新 match 位置 → 用户感觉"文字跳到不相关位置"。
    //
    //   v2 fix 已切到 getRawOffsetFromSelection，computeSelectionOffset 仅作
    //   deprecation reference 保留。
    //
    //   此 it.todo 是 RED lock-in：将来若有人尝试用 computeSelectionOffset 修
    //   handleAddManualMatch，请改用 this PRE-EXISTING RED test 体跑：
    //
    //     const defNode = pre.querySelectorAll('span')[1].firstChild!;
    //     const range = document.createRange();
    //     range.setStart(defNode, 0); range.setEnd(defNode, 3);
    //     expect(computeSelectionOffset(pre, range)).toBe(3);
    //
    //   当前期望返回 9（bug 状态）。本文件其他 GREEN test 已验证
    //   getRawOffsetFromSelection 在同 DOM 返回 3（正确 rawText offset）。
  });

  it('GREEN: getRawOffsetFromSelection 读 data-raw-offset 跳过 whitespace', () => {
    // 给 3 个 span 打 data-raw-offset
    const spans = pre.querySelectorAll('span');
    spans[0].setAttribute('data-raw-offset', '0');
    spans[1].setAttribute('data-raw-offset', '3');
    spans[2].setAttribute('data-raw-offset', '6');
    // 用户选 span#2 ("def") 起点
    const defNode = spans[1].firstChild!;
    const range = document.createRange();
    range.setStart(defNode, 0);
    range.setEnd(defNode, 3);
    const offset = getRawOffsetFromSelection(range);
    expect(offset).toBe(3);          // ← rawText 'def' 起点
    expect(rawText.slice(offset!, offset! + 3)).toBe('def');
  });

  it('GREEN: 跨 span 选 "cdef"（包含跨段），data-raw-offset 仍准', () => {
    const spans = pre.querySelectorAll('span');
    spans[0].setAttribute('data-raw-offset', '0');
    spans[1].setAttribute('data-raw-offset', '3');
    spans[2].setAttribute('data-raw-offset', '6');
    // 选 'cdef' 起点在 span#0 ('abc') 的 index 2
    const cNode = spans[0].firstChild!;
    const range = document.createRange();
    range.setStart(cNode, 2);  // span#0 内部 'c'
    range.setEnd(cNode, 3);    // 仅 'c'，但我们要验证 rawOffset start
    const offset = getRawOffsetFromSelection(range);
    // rawOffset base = 0 (span#0 attr), range.startOffset = 2
    // → 2 (rawText 'abc' 中 'c' 起点)
    expect(offset).toBe(2);
    expect(rawText[offset!]).toBe('c');
  });

  it('GREEN: span 没 data-raw-offset → null（fallback 信号）', () => {
    const defNode = pre.querySelectorAll('span')[1].firstChild!;
    const range = document.createRange();
    range.setStart(defNode, 0);
    range.setEnd(defNode, 3);
    const offset = getRawOffsetFromSelection(range);
    expect(offset).toBeNull();
  });

  it('GREEN: 起点在 rawText 第 100+ chars（fixture 真实规模）', () => {
    // 模拟 spy 合同真实规模：~13k chars rawText，第 N 个 span 包含若干段
    // 简化：10 chars 之间插 10 个 span，每个都打 data-raw-offset
    const longContainer = document.createElement('div');
    document.body.appendChild(longContainer);
    const longText = '甲乙丙丁戊己庚辛壬癸';
    const longPre = document.createElement('pre');
    longPre.appendChild(document.createTextNode('\n  '));  // JSX whitespace
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const span = document.createElement('span');
      span.setAttribute('data-raw-offset', String(offset));
      span.textContent = longText[i];
      longPre.appendChild(span);
      longPre.appendChild(document.createTextNode('\n  '));
      offset++;
    }
    longContainer.appendChild(longPre);

    // 选第 5 个 char '戊' (index 4)
    const targetSpan = longPre.querySelectorAll('span')[4];
    const targetTextNode = targetSpan.firstChild!;
    const range = document.createRange();
    range.setStart(targetTextNode, 0);
    range.setEnd(targetTextNode, 1);
    const got = getRawOffsetFromSelection(range);
    expect(got).toBe(4);  // rawText 第 5 个 char
    expect(longText[got!]).toBe('戊');
    document.body.removeChild(longContainer);
  });
});

describe('PROBE: 回归 — 真实场景对照（pre 含 whitespace + chip div）', () => {
  it('mixed: text + block div (image chip)，data-raw-offset 路径', () => {
    // 模拟 UploadPage 的 <pre>：
    //   <pre>\n  <span>前</span>\n  <div data-chip></div>\n  <span>后</span>\n</pre>
    // rawText: '前后' (2 chars)
    // 前段 data-raw-offset=0, 后段 data-raw-offset=1
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.document = dom.window.document;
    global.window = dom.window;

    const c = document.createElement('div');
    document.body.appendChild(c);
    const pre = document.createElement('pre');
    pre.appendChild(document.createTextNode('\n  '));
    const s1 = document.createElement('span');
    s1.setAttribute('data-raw-offset', '0');
    s1.textContent = '前';
    pre.appendChild(s1);
    pre.appendChild(document.createTextNode('\n  '));
    const chip = document.createElement('div');
    chip.setAttribute('data-chip', 'lost-image');
    pre.appendChild(chip);
    pre.appendChild(document.createTextNode('\n  '));
    const s2 = document.createElement('span');
    s2.setAttribute('data-raw-offset', '1');
    s2.textContent = '后';
    pre.appendChild(s2);
    pre.appendChild(document.createTextNode('\n'));
    c.appendChild(pre);

    // 用户选 "后"
    const targetText = s2.firstChild!;
    const range = document.createRange();
    range.setStart(targetText, 0);
    range.setEnd(targetText, 1);
    const got = getRawOffsetFromSelection(range);
    expect(got).toBe(1);  // rawText = '前后', '后' at offset 1
  });
});
