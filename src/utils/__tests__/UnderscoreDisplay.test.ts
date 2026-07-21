/**
 * 下划线 + 零宽字符（ZWS）显示方案 e2e 验证：
 *   - maskedToken 格式：'_'.repeat(原值长度) + '\u200B' × (index+1)
 *   - 视觉上看是空白下划线（Word/WPS 不渲染 ZWS），但全局唯一可配对
 *   - 解决 spy's 法务痛点：避免 [COMPANY_0001] 这种"种类划分"在脱敏文件里产生误解
 *
 * 跑法：
 *   cd <本仓库根目录>
 *   npx vitest run src/utils/__tests__/UnderscoreDisplay.test.ts
 *
 * 输出：
 *   /tmp/spy-underscore-masked.docx    — 加密 docx（敏感字段已替换为视觉下划线）
 *   /tmp/spy-underscore-restored.docx  — 恢复 docx
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { writeDocxFromEdits } from '@/utils/docxZipWriter';
import { readDocxFromArrayBuffer } from '@/utils/docxZipReader';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { Desensitizer } from '@/engines/Desensitizer';
import { CryptoManager } from '@/engines/CryptoManager';
import { generateDisplayToken } from '@/utils';

const SRC = 'test-fixtures/sample-contract-A.docx';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}
function mammothInput(buf: Uint8Array) {
  const ab = toArrayBuffer(buf);
  return { buffer: ab, arrayBuffer: ab };
}

describe('ZWS 下划线方案：spy 真实 docx e2e 验证', () => {
  it('默认 SensitiveFinder → Desensitizer 生成 ZWS maskedToken → mask → restore', async () => {
    if (!fs.existsSync(SRC)) {
      console.log(`  skip: ${SRC} not found`);
      return;
    }

    const srcBuf = fs.readFileSync(SRC);
    const srcAb = toArrayBuffer(srcBuf);

    // 1) mammoth 提原文本
    const text = (await mammoth.extractRawText(mammothInput(srcBuf))).value;
    console.log(`\n=== 1. 原文 ===`);
    console.log(`  长度 ${text.length} chars`);

    // 2) SensitiveFinder 默认规则
    const finder = new SensitiveFinder();
    const detected = finder.findSensitiveContent(text);
    console.log(`\n=== 2. 默认规则检测 ===`);
    console.log(`  ${detected.matches.length} 个 match`);

    // 3) Desensitizer 用新的 generateDisplayToken 生成 maskedToken
    const desensitizer = new Desensitizer(new CryptoManager());
    const { mappingTable } = await desensitizer.desensitize(text, detected.matches, { mode: 'encrypt' });

    console.log(`\n=== 3. maskedToken 样本 ===`);
    for (let i = 0; i < Math.min(5, mappingTable.length); i++) {
      const e = mappingTable[i];
      const zwsCount = (e.maskedToken.match(/\u200B/g) || []).length;
      const visible = e.maskedToken.replace(/\u200B/g, '');
      console.log(`  [${i}] ${e.type} "${e.originalValue.slice(0, 20)}" → "${visible}" + ${zwsCount}×ZWS`);
    }

    // 4) 验证 maskedToken 视觉就是下划线（strip ZWS 后纯 `_`）
    console.log(`\n=== 4. 验证视觉是纯下划线 ===`);
    const notPureUnderscore: string[] = [];
    for (const e of mappingTable) {
      const visible = e.maskedToken.replace(/\u200B/g, '');
      if (!/^_+$/.test(visible)) {
        notPureUnderscore.push(`${e.type}: "${e.originalValue}" → visible="${visible}"`);
      }
    }
    if (notPureUnderscore.length === 0) {
      console.log(`  ✅ 全部 ${mappingTable.length} 个 maskedToken 视觉都是纯下划线`);
    } else {
      console.log(`  ❌ ${notPureUnderscore.length} 个 maskedToken 视觉不是纯下划线:`);
      notPureUnderscore.slice(0, 5).forEach(s => console.log(`    ${s}`));
    }

    // 5) 验证全局唯一（同长度不同原值不会冲突）
    console.log(`\n=== 5. 验证全局唯一 ===`);
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const e of mappingTable) {
      if (seen.has(e.maskedToken)) dups.push(e.maskedToken);
      seen.add(e.maskedToken);
    }
    if (dups.length === 0) {
      console.log(`  ✅ ${mappingTable.length} 个 maskedToken 全部唯一`);
    } else {
      console.log(`  ❌ ${dups.length} 个重复: ${dups.slice(0, 3).join(', ')}`);
    }

    // 6) B 方案 mask: 原值 → maskedToken
    const maskEdits = mappingTable.map(e => ({
      maskedToken: e.originalValue,
      originalValue: e.maskedToken,
    }));
    const maskedAb = await writeDocxFromEdits(srcAb, maskEdits);
    const masked = await readDocxFromArrayBuffer(maskedAb);

    console.log(`\n=== 6. 加密 docx ===`);
    console.log(`  ZIP entries: ${masked.fileNames.length}`);
    console.log(`  含 <w:tbl>? ${masked.documentXml.includes('<w:tbl') ? '✅' : '❌'}`);

    let maskSuccess = 0;
    for (const e of mappingTable) {
      if (masked.documentXml.includes(e.maskedToken)) maskSuccess++;
    }
    console.log(`  maskedToken 注入: ${maskSuccess}/${mappingTable.length}`);

    // 7) B 方案 restore: maskedToken → 原值
    const restoreEdits = mappingTable.map(e => ({
      maskedToken: e.maskedToken,
      originalValue: e.originalValue,
    }));
    const restoredAb = await writeDocxFromEdits(maskedAb, restoreEdits);
    const restored = await readDocxFromArrayBuffer(restoredAb);

    console.log(`\n=== 7. 恢复 docx ===`);
    console.log(`  ZIP entries: ${restored.fileNames.length}`);
    console.log(`  含 <w:tbl>? ${restored.documentXml.includes('<w:tbl') ? '✅' : '❌'}`);

    let restoreSuccess = 0;
    const failures: string[] = [];
    for (const e of mappingTable) {
      if (restored.documentXml.includes(e.originalValue)) {
        restoreSuccess++;
      } else if (failures.length < 5) {
        failures.push(`  ❌ ${e.type} "${e.originalValue.slice(0, 30)}"`);
      }
    }
    console.log(`  原值恢复: ${restoreSuccess}/${mappingTable.length}`);
    if (failures.length > 0) {
      console.log(`  失败示例:`);
      failures.forEach(f => console.log(f));
    }

    // 8) mammoth round-trip
    const restoredText = (await mammoth.extractRawText(mammothInput(new Uint8Array(restoredAb)))).value;
    console.log(`\n=== 8. mammoth round-trip ===`);
    console.log(`  baseline ${text.length} chars`);
    console.log(`  restored ${restoredText.length} chars`);

    // 9) 视觉验证：masked docx 拼接文本里没有可见的非下划线字符（除 ZWS）
    console.log(`\n=== 9. masked docx 视觉验证 ===`);
    const maskedConcat = masked.textNodes.map(n => n.text).join('');
    const zwsCount = (maskedConcat.match(/\u200B/g) || []).length;
    console.log(`  拼接文本长度: ${maskedConcat.length}`);
    console.log(`  ZWS 字符数: ${zwsCount}（Word/WPS 不渲染）`);

    // 写出文件供 spy 验证
    fs.writeFileSync('/tmp/spy-underscore-masked.docx', new Uint8Array(maskedAb));
    fs.writeFileSync('/tmp/spy-underscore-restored.docx', new Uint8Array(restoredAb));

    console.log(`\n📁 /tmp/spy-underscore-masked.docx    (${(maskedAb.byteLength / 1024).toFixed(1)} KB)`);
    console.log(`📁 /tmp/spy-underscore-restored.docx  (${(restoredAb.byteLength / 1024).toFixed(1)} KB)`);
  }, 30000);

  it('generateDisplayToken 单元测试', () => {
    // 边界 case
    expect(generateDisplayToken('占位人', 0)).toBe('__\u200B');
    expect(generateDisplayToken('占位人', 1)).toBe('__\u200B\u200B');
    // 视觉 strip ZWS 后是纯下划线
    expect(generateDisplayToken('示例公司（北京）融媒体科技文化有限公司', 5).replace(/\u200B/g, '')).toBe('_'.repeat(18));
    // 空字符串：visible 部分为空，但仍有 ZWS marker（保证 uniqueness）
    expect(generateDisplayToken('', 0)).toBe('\u200B');
  });
});