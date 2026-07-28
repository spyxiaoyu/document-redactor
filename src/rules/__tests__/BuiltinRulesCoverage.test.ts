/**
 * 默认规则覆盖度审计：用户的真实 docx 不加任何 keyword，看自动识别率
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import mammoth from 'mammoth';
import { SensitiveFinder } from '@/engines/SensitiveFinder';
import { BUILTIN_RULES } from '../BuiltinRules';

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

describe('BuiltinRules coverage on user real docx', () => {
  it('reports what default rules auto-detect (no manual keywords)', async () => {
    if (!fs.existsSync(SRC)) return;

    const buf = fs.readFileSync(SRC);
    const extract = await mammoth.extractRawText(mammothInput(buf));
    const text = extract.value;

    const finder = new SensitiveFinder();
    BUILTIN_RULES.forEach(r => finder.addRule({
      id: r.type,
      type: r.type,
      pattern: r.pattern,
      weight: r.weight,
      enabled: true,
    }));
    // 不加 keyword
    const result = finder.findSensitiveContent(text, { includeDisabled: true });
    const matches = result.matches;

    console.log(`\n默认规则匹配总数: ${matches.length}`);
    const byType: Record<string, string[]> = {};
    matches.forEach(m => {
      if (!byType[m.type]) byType[m.type] = [];
      byType[m.type].push(m.value);
    });
    Object.entries(byType).forEach(([type, values]) => {
      console.log(`  ${type}: ${values.length} 个`);
      values.slice(0, 5).forEach(v => console.log(`    "${v}"`));
    });

    // 用户期望的 8 个核心字段
    const expected = [
      ['示例公司（北京）融媒体科技文化有限公司', 'COMPANY'],
      ['占位人', 'NAME'],
      ['13800000000', 'PHONE'],
      ['contact@client-b.test', 'EMAIL'],
      ['示例公司有限公司', 'COMPANY'],
      ['张某某', 'NAME'],
      ['13800000001', 'PHONE'],
      ['contact@client-a.test', 'EMAIL'],
    ] as const;
    console.log('\n=== 期望字段自动识别状态 ===');
    for (const [val, type] of expected) {
      const found = matches.some(m =>
        (m.value === val || m.value.includes(val)) && m.type === type
      );
      console.log(`  ${found ? '✅' : '❌'} ${val} (${type})`);
    }
  }, 30000);
});
