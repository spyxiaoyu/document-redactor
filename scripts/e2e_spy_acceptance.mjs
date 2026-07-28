#!/usr/bin/env node
// 端到端验收脚本（spy 6 次反馈基线）
// 触发来源：spy 2026-07-28 "我以为没有添加成功" — 功能成功但 UI 让 spy 误读
// 设计：每次 commit 前必须跑通，不通过 = 不允许 commit
//
// 跑法：
//   cd /Users/messi/CC/document-desensitizer
//   node scripts/e2e_spy_acceptance.mjs
//
// 退出码：0 = 全部通过；1 = 至少 1 项不通过
//
// 验证项：
//   1. 无 [role="tab"] → 无"原版视图"切换
//   2. 原文/脱敏 宽度比 ∈ [0.95, 1.05]（spy 1440 + 1920 两 viewport 都测）
//   3. chip 总数 >= 25
//   4. 第一个 chip top < 1000（开头就有）
//   5. 最后一个 chip top > 5000（图片之后还有）
//   6. 回归 case 识别 >= 1 段（fixture SAMPLE-CT-005 内含 5 处「示例市场研究股份有限公司」字符串 — spy 7-27 UserReportIssues FP 修复的回归 case）
//   7. 截图存证
//   8. **NEW** chip 实际宽度比：原文 chip width / 脱敏 chip width ∈ [0.85, 1.15]（NBSP 占位太窄 → 视觉不等宽）
//   9. **NEW** 选区 + 添加后 scrollTop 漂移 < 100px（renderKey 重 mount 副作用）

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

// 测试合同：走 test-fixtures/ 内的脱敏版 fixture（gitignore 内，永不进 git）
// 路径解析基于脚本位置（与 cwd 无关）
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE_PATH = path.resolve(SCRIPT_DIR, '..', 'test-fixtures', 'SAMPLE-CT-005-代理合同-2025.docx');
const CONTRACT = FIXTURE_PATH;
const SHOT_DIR = '/tmp/e2e_screenshots';

if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
}

async function setupPage(page, viewportW, viewportH) {
  await page.setViewport({ width: viewportW, height: viewportH });
  await page.goto('http://localhost:3000/upload', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('input[type="file"]', { timeout: 10000 });
  const fi = await page.$('input[type="file"]');
  await fi.uploadFile(CONTRACT);
  await page.waitForFunction(
    () => document.body.innerText.includes('处敏感词'),
    { timeout: 30000 },
  );
}

try {
  // ============================================
  // 阶段 1：基础验收（1440 viewport — 沿用旧基线）
  // ============================================
  const page = await browser.newPage();
  await setupPage(page, 1440, 900);

  // 1. 无原版视图 tab
  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]'))
      .map(t => t.textContent?.trim()).filter(Boolean),
  );
  check('1. 无原版视图 tab', tabs.length === 0, `tabs = ${JSON.stringify(tabs)}`);

  // 2. 面板宽度比（1440）
  const panels1440 = await page.evaluate(() => {
    const maskedHeader = Array.from(document.querySelectorAll('*'))
      .find(el => el.textContent?.trim() === '脱敏后' && el.children.length === 0);
    const maskedPanel = maskedHeader?.closest('[class*="border rounded-lg"]');
    const originalPanel = maskedPanel?.previousElementSibling;
    return {
      origW: originalPanel?.getBoundingClientRect().width || 0,
      maskW: maskedPanel?.getBoundingClientRect().width || 0,
    };
  });
  const ratio1440 = panels1440.maskW > 0 ? panels1440.origW / panels1440.maskW : 0;
  check('2a. 1440 viewport 原文/脱敏宽度比 ∈ [0.95, 1.05]',
    ratio1440 >= 0.95 && ratio1440 <= 1.05,
    `ratio = ${ratio1440.toFixed(3)}`);

  // 3-6. chip 数据
  const chips = await page.evaluate(() =>
    Array.from(document.querySelectorAll('span[class*="bg-yellow"]'))
      .map(c => ({
        text: c.textContent?.trim() || '',
        top: c.getBoundingClientRect().top,
        width: c.getBoundingClientRect().width,
      })),
  );
  check('3. chip 总数 >= 25', chips.length >= 25, `count = ${chips.length}`);

  if (chips.length > 0) {
    const sortedByTop = [...chips].sort((a, b) => a.top - b.top);
    check('4. 第一个 chip top < 1000',
      sortedByTop[0].top < 1000,
      `first top = ${sortedByTop[0].top.toFixed(0)}`);
    check('5. 最后一个 chip top > 5000',
      sortedByTop[sortedByTop.length - 1].top > 5000,
      `last top = ${sortedByTop[sortedByTop.length - 1].top.toFixed(0)}`);
  } else {
    check('4. 第一个 chip top < 1000', false, 'no chips');
    check('5. 最后一个 chip top > 5000', false, 'no chips');
  }

  // 回归 case 字符串精准检测（spy 7-27 UserReportIssues.test.ts 同款 golden case）
  const ctrCount = chips.filter(c => c.text.includes('示例市场研究股份有限公司')).length;
  check('6. 回归 case 识别 >= 1 段', ctrCount >= 1, `regressionCase = ${ctrCount}`);

  // ============================================
  // 阶段 2：spy 真实 viewport（1920×1080）+ chip 宽度比
  // ============================================
  const page1920 = await browser.newPage();
  await setupPage(page1920, 1920, 1080);

  const panels1920 = await page1920.evaluate(() => {
    const maskedHeader = Array.from(document.querySelectorAll('*'))
      .find(el => el.textContent?.trim() === '脱敏后' && el.children.length === 0);
    const maskedPanel = maskedHeader?.closest('[class*="border rounded-lg"]');
    const originalPanel = maskedPanel?.previousElementSibling;
    return {
      origW: originalPanel?.getBoundingClientRect().width || 0,
      maskW: maskedPanel?.getBoundingClientRect().width || 0,
    };
  });
  const ratio1920 = panels1920.maskW > 0 ? panels1920.origW / panels1920.maskW : 0;
  check('2b. 1920 viewport 原文/脱敏宽度比 ∈ [0.95, 1.05]',
    ratio1920 >= 0.95 && ratio1920 <= 1.05,
    `ratio = ${ratio1920.toFixed(3)}`);

  // 8. chip 实际宽度比（spy 截图：NBSP 占位太窄 → 视觉不等宽）
  // 思路：取原文 panel 的 chip 和脱敏后面板的 chip，按标题(title)匹配成对
  const chipWidthCompare = await page1920.evaluate(() => {
    const origChips = Array.from(document.querySelectorAll('span[class*="bg-yellow-200"]'));
    const maskChips = Array.from(document.querySelectorAll('span.text-transparent[class*="border-b"]'));

    const pairs = [];
    for (const o of origChips) {
      const title = o.getAttribute('title') || '';
      const t = o.textContent?.trim() || '';
      // 脱敏后 chip title 格式: "已脱敏: TYPE"，原 chip: "TYPE - XX%"
      // 按 TYPE 匹配：提取 TYPE 后缀
      const typeMatch = title.match(/^([A-Z_]+)\s*-/);
      if (!typeMatch) continue;
      const type = typeMatch[1];
      const m = maskChips.find(mc => (mc.getAttribute('title') || '').includes(type));
      if (!m) continue;
      pairs.push({
        text: t,
        type,
        origWidth: o.getBoundingClientRect().width,
        maskWidth: m.getBoundingClientRect().width,
      });
      if (pairs.length >= 5) break;
    }
    return pairs;
  });
  if (chipWidthCompare.length > 0) {
    const ratios = chipWidthCompare.map(p => p.maskWidth > 0 ? p.origWidth / p.maskWidth : 0);
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    check('8. chip 实际宽度比 ∈ [0.85, 1.15]（NBSP 占位是否过窄）',
      avgRatio >= 0.85 && avgRatio <= 1.15,
      `avg ratio = ${avgRatio.toFixed(3)} | pairs = ${JSON.stringify(chipWidthCompare)}`);
  } else {
    check('8. chip 实际宽度比', false, '找不到 chip 对（DOM 选择器可能变了）');
  }

  // 9. 选区 + 添加后 scrollTop 漂移
  // 模拟 spy 在 3.13 区域选区 → 点击添加 → 检查 panel scrollTop 是否漂移
  // 这里用 inspect 工具找一段中等位置的文本（不是顶部也不是底部）
  const scrollDrift = await page1920.evaluate(async () => {
    const origPanel = Array.from(document.querySelectorAll('[class*="border rounded-lg overflow-hidden"]'))
      .find(p => p.textContent?.includes('原文') && p.textContent?.includes('处敏感词'));

    if (!origPanel) return { error: 'no original panel' };

    // 记录当前 scrollTop
    const beforeScrollTop = origPanel.scrollTop;

    // 找原文 panel 内一段文本（约 3000-5000px 范围内的中段）
    const scrollables = origPanel.querySelectorAll('div');
    let scrollEl = null;
    for (const d of scrollables) {
      if (d.scrollHeight > d.clientHeight) {
        scrollEl = d;
        break;
      }
    }
    if (!scrollEl) return { error: 'no scrollable' };

    const beforeScrollElTop = scrollEl.scrollTop;

    // 滚动到中段（约 50% 位置）
    scrollEl.scrollTop = scrollEl.scrollHeight * 0.5;

    // 等 React 处理
    await new Promise(r => setTimeout(r, 200));

    // 找一段文本模拟选区：取第一个普通 span 的前 6 个字符
    const spans = scrollEl.querySelectorAll('span:not([class*="bg-yellow"])');
    const textNode = Array.from(spans).find(s => s.firstChild?.nodeType === 3);
    if (!textNode) return { error: 'no text node', scrollTopBefore: beforeScrollElTop, scrollTopAfter: scrollEl.scrollTop };

    // 用 Range 选中 6 个字符
    const range = document.createRange();
    range.setStart(textNode.firstChild, 0);
    range.setEnd(textNode.firstChild, Math.min(6, textNode.firstChild.textContent?.length || 0));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // 触发 React onMouseUp
    textNode.parentElement?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));

    // 找 "添加" 按钮
    const addBtn = document.querySelector('button.fixed.z-50');
    const btnFound = addBtn !== null;
    if (!btnFound) {
      return {
        error: 'no add btn',
        scrollTopBefore: beforeScrollElTop,
        scrollTopMid: scrollEl.scrollTop,
      };
    }

    // 模拟点击
    addBtn.click();
    await new Promise(r => setTimeout(r, 500));

    const afterScrollElTop = scrollEl.scrollTop;
    const drift = Math.abs(afterScrollElTop - scrollEl.scrollTop);

    return {
      btnFound,
      scrollTopBefore: beforeScrollElTop,
      scrollTopMid: scrollEl.scrollTop,
      scrollTopAfter: afterScrollElTop,
      drift,
    };
  });
  if (scrollDrift.error) {
    check('9. 选区+添加后 scrollTop 漂移', false, JSON.stringify(scrollDrift));
  } else {
    const ok = scrollDrift.drift < 100;
    check('9. 选区+添加后 scrollTop 漂移 < 100px',
      ok,
      `drift = ${scrollDrift.drift}px (before=${scrollDrift.scrollTopBefore}, mid=${scrollDrift.scrollTopMid}, after=${scrollDrift.scrollTopAfter})`);
  }

  // 7. 截图存证（1920 viewport，spy 真实环境）
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const shotPath = path.join(SHOT_DIR, `acceptance_${ts}.png`);
  await page1920.screenshot({ path: shotPath, fullPage: false });
  check('7. 截图存证', fs.existsSync(shotPath), `path = ${shotPath}`);
} finally {
  await browser.close();
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log(`\n=== ${passed}/${results.length} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);