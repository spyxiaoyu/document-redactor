/**
 * Restore 路径 probe 测试 — 验证 applyDocxEdits 在 mask 跨 <w:ins>/<w:del>
 * 修订追踪标记时，是否保留 ins/del 结构（spy 现场反馈：保留修订是核心需求）
 *
 * spy 现场场景：
 *   - 合同里 <w:del>作者</w:del><w:ins>设计师</w:ins> 修订历史
 *   - 工具脱敏后保留修订（v2 mask 测试已 PASS：<w:ins>=12, <w:del>=16 跟 orig 一致）
 *   - 工具恢复后必须**也**保留这些 ins/del（这是待验证的路径）
 *
 * 跑法：npx vitest run src/utils/__tests__/RestoreInsDelPreservation.test.ts
 */
import { describe, it, expect } from 'vitest';
import { applyDocxEdits } from '../docxWriter';

describe('Restore InsDel Preservation — applyDocxEdits 不能破坏 <w:ins>/<w:del> 修订追踪', () => {
  it('scenario 1: 单 run mask + restore 循环（不跨 ins/del）', () => {
    // 结构：<w:r>公司名</w:r><w:ins>设计师</w:ins><w:r>...</w:r>
    // Step 1: mask "公司名" → "____"（maskedToken = "____"，originalValue = "公司名"）
    // Step 2: restore "____" → "公司名"
    const origXml = `<w:p><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>甲方：公司名</w:t></w:r><w:ins w:id="1" w:author="spy" w:date="2022-08-19T13:58:05Z"><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>设计师</w:t></w:r></w:ins><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>其他</w:t></w:r></w:p>`;

    const origInsCount = (origXml.match(/<w:ins/g) || []).length;
    const origDelCount = (origXml.match(/<w:del/g) || []).length;
    const origDelTextCount = (origXml.match(/<w:delText/g) || []).length;

    // Step 1: mask
    const masked = applyDocxEdits(origXml, [
      { maskedToken: '公司名', originalValue: '____' },
    ]);
    expect(masked).toContain('____');
    expect(masked).not.toContain('公司名');  // 原文已被替换
    expect((masked.match(/<w:ins/g) || []).length).toBe(origInsCount);
    expect(masked).toContain('w:author="spy"');

    // Step 2: restore
    const restored = applyDocxEdits(masked, [
      { maskedToken: '____', originalValue: '公司名' },
    ]);
    expect(restored).toContain('公司名');  // 文字恢复
    expect(restored).not.toContain('____');  // mask token 清空
    expect((restored.match(/<w:ins/g) || []).length).toBe(origInsCount);
    expect(restored).toContain('w:author="spy"');
    expect(restored).toContain('<w:t>设计师</w:t>');  // ins 内容完整

    console.log('\n[scenario 1 result] (单 run mask + restore)');
    console.log(`  orig    ins=${origInsCount} del=${origDelCount} dT=${origDelTextCount}`);
    console.log(`  masked  ins=${(masked.match(/<w:ins/g) || []).length} del=${(masked.match(/<w:del/g) || []).length} dT=${(masked.match(/<w:delText/g) || []).length}`);
    console.log(`  restore ins=${(restored.match(/<w:ins/g) || []).length} del=${(restored.match(/<w:del/g) || []).length} dT=${(restored.match(/<w:delText/g) || []).length}`);
  });

  it('scenario 2: maskedToken 跨 <w:ins> 边界（最坏情况）', () => {
    // maskedToken 区间：触发 mergeRunsForCoverage（masked text 含 "____" 跨过 ins 边界）
    // 不直接构造原始 docx — 直接构造 maskedXml 测 restore 路径

    // 假设 spy 用 _ + ZWS 做 mask token（4 chars + ZWS）
    // 模拟：masked text contains "____" 跨过 ins 边界
    // 为此构造：先把 masked 在内存里替换为 "____"，再交给 applyDocxEdits

    // 注意：applyDocxEdits 用 maskedToken 找 + 替换 originalValue。
    // 我们要测的是 maskedToken "____" 跨 ins 边界时的处理
    // 构造一个真带 mask 的中间态：
    const maskedXml = `<w:p><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>甲</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>____</w:t></w:r><w:ins w:id="1" w:author="spy" w:date="2022-08-19T13:58:05Z"><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>戊己庚辛</w:t></w:r></w:ins><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>壬癸</w:t></w:r></w:p>`;

    // restore：把 "____" 替换为 "公司名"（原始值）
    const restored = applyDocxEdits(maskedXml, [
      { maskedToken: '____', originalValue: '公司名' },
    ]);

    // 关键断言：<w:ins> 必须保留
    expect(restored).toContain('<w:ins');
    expect(restored).toContain('w:author="spy"');
    expect(restored).toContain('戊己庚辛');  // ins 内部文本完整

    console.log('\n[scenario 2 result] (maskedToken 跨 ins 边界)');
    console.log('  restored XML:', restored);
  });

  it('scenario 3: maskedToken 跨 <w:del> 边界（含 delText）', () => {
    // <w:del> 含 <w:delText>（删除的文本）
    // 直接构造 maskedXml 测 restore 路径
    const maskedXml = `<w:p><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>甲</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>____</w:t></w:r><w:del w:id="1" w:author="spy" w:date="2022-08-19T13:58:02Z"><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:delText>戊己庚辛</w:delText></w:r></w:del><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>壬癸</w:t></w:r></w:p>`;

    const restored = applyDocxEdits(maskedXml, [
      { maskedToken: '____', originalValue: '公司名' },
    ]);

    // 关键断言：<w:del> 必须保留 + <w:delText> 完整
    expect(restored).toContain('<w:del');
    expect(restored).toContain('w:author="spy"');
    expect(restored).toContain('<w:delText>戊己庚辛</w:delText>');  // delText 完整

    console.log('\n[scenario 3 result] (maskedToken 跨 del 边界)');
    console.log('  restored XML:', restored);
  });

  it('scenario 4: 完整对照 spy 第21段结构 (mask + restore 循环)', () => {
    // spy 第21段真实结构片段（精简版）
    // 含 <w:r> + <w:del><w:r><w:delText>作者</w:delText></w:r></w:del> + <w:ins><w:r><w:t>设计师</w:t></w:r></w:ins> + <w:r>
    const origXml = `<w:p><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>甲方（甲集团公司），承诺与</w:t></w:r><w:del w:id="2" w:author="spy" w:date="2022-08-19T13:58:02Z"><w:r><w:rPr/><w:delText>作者</w:delText></w:r></w:del><w:ins w:id="3" w:author="spy" w:date="2022-08-19T13:58:05Z"><w:r><w:rPr/><w:t>设计师</w:t></w:r></w:ins><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>履行义务</w:t></w:r></w:p>`;

    const origInsCount = (origXml.match(/<w:ins/g) || []).length;
    const origDelCount = (origXml.match(/<w:del/g) || []).length;
    const origDelTextCount = (origXml.match(/<w:delText/g) || []).length;

    // mask: 把 "甲集团公司" 替换为 mask token
    const maskedXml = applyDocxEdits(origXml, [
      { maskedToken: '甲集团公司', originalValue: '____' + '' },
    ]);

    expect((maskedXml.match(/<w:ins/g) || []).length).toBe(origInsCount);
    expect((maskedXml.match(/<w:del/g) || []).length).toBe(origDelCount);
    expect((maskedXml.match(/<w:delText/g) || []).length).toBe(origDelTextCount);

    // restore: 把 ____ + ZWS 替换回 "甲集团公司"
    const restoredXml = applyDocxEdits(maskedXml, [
      { maskedToken: '____' + '', originalValue: '甲集团公司' },
    ]);

    // 关键断言：restore 后 ins/del/delText 数必须仍然等于原始
    expect((restoredXml.match(/<w:ins/g) || []).length).toBe(origInsCount);
    expect((restoredXml.match(/<w:del/g) || []).length).toBe(origDelCount);
    expect((restoredXml.match(/<w:delText/g) || []).length).toBe(origDelTextCount);

    // 文字必须恢复
    expect(restoredXml).toContain('甲集团公司');
    expect(restoredXml).toContain('<w:delText>作者</w:delText>');
    expect(restoredXml).toContain('<w:t>设计师</w:t>');

    console.log('\n[scenario 4 result] (完整循环 mask + restore)');
    console.log(`  orig  ins=${origInsCount} del=${origDelCount} delText=${origDelTextCount}`);
    console.log(`  masked ins=${(maskedXml.match(/<w:ins/g) || []).length} del=${(maskedXml.match(/<w:del/g) || []).length} delText=${(maskedXml.match(/<w:delText/g) || []).length}`);
    console.log(`  restore ins=${(restoredXml.match(/<w:ins/g) || []).length} del=${(restoredXml.match(/<w:del/g) || []).length} delText=${(restoredXml.match(/<w:delText/g) || []).length}`);
    console.log('  restored XML:', restoredXml);
  });
});
