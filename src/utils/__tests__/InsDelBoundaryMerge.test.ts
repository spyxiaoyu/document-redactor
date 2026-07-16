/**
 * Ins/Del 边界 Merge probe 测试 — TEST_SPECIFICATION §B 后续
 *
 * 锁定 bug：mergeRunsForCoverage 把 [runStart, runEnd) 区间内 <w:ins>/<w:del>
 * wrapper 当成普通 sibling 提取，导致它们的 inner <w:r> 内容被当作"普通 run 块"
 * 跳过。结果：
 *   - preservedSiblings = "<w:ins></w:ins>"（空 wrapper，w:id+w:author 还在）
 *   - inner <w:r> 的文本被吸进新 merged run，**且失去 <w:ins> wrapper**
 *   - Word 开着修订模式打开时，空 <w:ins w:id="X" w:author="spy"> 触发生成
 *     "插入修订标记"，叠加原 <w:del> 红波浪线 → 视觉段落错位 + 红波浪线
 *
 * 触发条件：maskedToken 区间跨越 <w:ins>/<w:del> 边界（即 maskedToken 在
 * concatenatedText 里的区间穿过 <w:p> 层级里 <w:ins>/<w:del> 的开闭标签位置）
 *
 * 修复方向：检测到跨 ins/del 边界时，**禁止 mergeRunsForCoverage**，改用
 * per-node replacement —— 每个 <w:t> 节点独立替换自己覆盖的 maskedToken 切片，
 * 保留所有 <w:ins>/<w:del> wrapper 完整性。
 *
 * 跑法：npx vitest run src/utils/__tests__/InsDelBoundaryMerge.test.ts
 */
import { describe, it, expect } from 'vitest';
import { applyDocxEdits } from '../docxWriter';

describe('Ins/Del 边界 Merge — maskedToken 跨 <w:ins>/<w:del> 边界时 wrapper 完整性', () => {
  it('scenario A: maskedToken 跨 <w:ins> 边界 → inner <w:r> 必须保留 + 文本替换', () => {
    // 原 XML：<w:r>甲</w:r> + <w:ins><w:r>敏感词</w:r></w:ins> + <w:r>后续</w:r>
    // maskedToken "甲敏感词后续" (6 chars) 区间 = [0, 6)
    // covering 节点 3 个：甲(0,1)、敏感词(1,4)、后续(4,6)
    // maskedToken 区间跨过 <w:ins> 边界（<w:ins> 开标签在位置 1 附近）
    const origXml = `<w:p><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>甲</w:t></w:r><w:ins w:id="3" w:author="spy" w:date="2022-08-19T13:58:05Z"><w:r><w:rPr/><w:t>敏感词</w:t></w:r></w:ins><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>后续</w:t></w:r></w:p>`;

    // length-matched originalValue (6 chars same as maskedToken)
    // 每个 covering 节点拿到对应切片：
    //   node 1 (1 char) → "M" (originalValue[0..1])
    //   node 2 (3 chars) → "ASK" (originalValue[1..4])
    //   node 3 (2 chars) → "ED" (originalValue[4..6])
    const masked = applyDocxEdits(origXml, [
      { maskedToken: '甲敏感词后续', originalValue: 'MASKED' },
    ]);

    // ===== 关键断言 =====

    // 断言 1：<w:ins> wrapper 必须完整（不是空 wrapper）
    expect(masked).toMatch(/<w:ins[^>]*>[\s\S]*?<\/w:ins>/);
    // 断言 1b：<w:ins> 不能是空 wrapper
    expect(masked).not.toMatch(/<w:ins[^>]*><\/w:ins>/);

    // 断言 2：<w:ins> 内部必须有 <w:r>（inner run 保留）
    expect(masked).toMatch(/<w:ins[^>]*>[\s\S]*?<w:r[^>]*>[\s\S]*?<\/w:r>[\s\S]*?<\/w:ins>/);

    // 断言 3：原始 inner <w:t> 内容 "敏感词" 必须被替换（mask 后不在 ins 内）
    expect(masked).not.toContain('敏感词');
    expect(masked).not.toContain('甲');
    expect(masked).not.toContain('后续');

    // 断言 4：masked XML 必须包含每个 covering 节点的切片
    //   node 1: <w:t>M</w:t>（或含 rPr 时 <w:t...>M</w:t>）
    //   node 2 (ins 内): <w:t>ASK</w:t>
    //   node 3: <w:t>ED</w:t>
    expect(masked).toMatch(/<w:t[^>]*>M<\/w:t>/);
    expect(masked).toMatch(/<w:t[^>]*>ASK<\/w:t>/);
    expect(masked).toMatch(/<w:t[^>]*>ED<\/w:t>/);

    // 断言 5：<w:ins> 的 w:id / w:author / w:date 完整保留
    expect(masked).toContain('w:id="3"');
    expect(masked).toContain('w:author="spy"');
    expect(masked).toContain('w:date="2022-08-19T13:58:05Z"');

    console.log('\n[scenario A — cross <w:ins> boundary]');
    console.log('  masked:', masked);
  });

  it('scenario B: maskedToken 跨 <w:del> 边界 → inner <w:r> 必须保留', () => {
    // 注：scanNodes 不识别 <w:delText>，所以这里用 <w:del><w:r><w:t>...</w:t></w:r></w:del>
    // 结构（OOXML schema 合法），让 scanNodes 能扫到 <w:t>。
    // 注 2：maskedToken 不能跨 <w:delText>（独立 bug，见 RestoreInsDelPreservation）。
    const origXml = `<w:p><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>甲</w:t></w:r><w:del w:id="2" w:author="spy" w:date="2022-08-19T13:58:02Z"><w:r><w:rPr/><w:t>敏感词</w:t></w:r></w:del><w:r><w:rPr><w:rFonts w:ascii="宋体"/></w:rPr><w:t>后续</w:t></w:r></w:p>`;

    const masked = applyDocxEdits(origXml, [
      { maskedToken: '甲敏感词后续', originalValue: 'MASKED' },
    ]);

    // 断言 1：<w:del> wrapper 必须完整
    expect(masked).toMatch(/<w:del[^>]*>[\s\S]*?<\/w:del>/);
    expect(masked).not.toMatch(/<w:del[^>]*><\/w:del>/);

    // 断言 2：<w:del> 内部必须有 <w:r>
    expect(masked).toMatch(/<w:del[^>]*>[\s\S]*?<w:r[^>]*>[\s\S]*?<\/w:r>[\s\S]*?<\/w:del>/);

    // 断言 3：原始 "敏感词" 不在 del 内部（已 mask）
    expect(masked).not.toContain('敏感词');

    // 断言 4：<w:del> 的 w:id / w:author / w:date 完整保留
    expect(masked).toContain('w:id="2"');
    expect(masked).toContain('w:author="spy"');
    expect(masked).toContain('w:date="2022-08-19T13:58:02Z"');

    // 断言 5：每个 covering 节点拿到切片
    expect(masked).toMatch(/<w:t[^>]*>M<\/w:t>/);
    expect(masked).toMatch(/<w:t[^>]*>ASK<\/w:t>/);
    expect(masked).toMatch(/<w:t[^>]*>ED<\/w:t>/);

    console.log('\n[scenario B — cross <w:del> boundary]');
    console.log('  masked:', masked);
  });

  it('scenario C: maskedToken 完全在 <w:ins> 内 → ins 完整 + 内容替换（边界外路径）', () => {
    // maskedToken 范围完全在 <w:ins> 的 inner <w:r> 内（不跨边界）
    // covering.length === 1，走 replaceSingleNode 路径
    const origXml = `<w:p><w:r><w:t>前面</w:t></w:r><w:ins w:id="5" w:author="spy"><w:r><w:t>敏感词</w:t></w:r></w:ins><w:r><w:t>后面</w:t></w:r></w:p>`;

    const masked = applyDocxEdits(origXml, [
      { maskedToken: '敏感词', originalValue: '____' },
    ]);

    // 断言 1：<w:ins> 完整保留
    expect(masked).toMatch(/<w:ins[^>]*>[\s\S]*?<w:r[^>]*>[\s\S]*?<w:t[^>]*>____<\/w:t>[\s\S]*?<\/w:r>[\s\S]*?<\/w:ins>/);
    // 断言 2：原 ins 内容 "敏感词" 已被替换
    expect(masked).not.toContain('敏感词');
    expect(masked).toContain('____');

    console.log('\n[scenario C — fully inside <w:ins>]');
    console.log('  masked:', masked);
  });

  it('scenario D: restore 路径同样不能破坏 ins/del wrapper', () => {
    // 模拟 spy 截图流程：mask 后 restore，验证 round-trip 后 ins/del 完整
    const origXml = `<w:p><w:r><w:t>甲</w:t></w:r><w:ins w:id="3" w:author="spy" w:date="2022-08-19T13:58:05Z"><w:r><w:t>敏感词</w:t></w:r></w:ins><w:r><w:t>后续</w:t></w:r></w:p>`;

    // Step 1: mask（length-matched 'MASKED' = 6 chars same as '甲敏感词后续'）
    const masked = applyDocxEdits(origXml, [
      { maskedToken: '甲敏感词后续', originalValue: 'MASKED' },
    ]);

    // 验证 mask 后 ins 完整 + 内容已替换
    expect(masked).toMatch(/<w:ins[^>]*>[\s\S]*?<w:r[^>]*>[\s\S]*?<w:t[^>]*>ASK<\/w:t>[\s\S]*?<\/w:r>[\s\S]*?<\/w:ins>/);
    expect(masked).not.toMatch(/<w:ins[^>]*><\/w:ins>/);

    // Step 2: restore（MASKED → 甲敏感词后续）
    const restored = applyDocxEdits(masked, [
      { maskedToken: 'MASKED', originalValue: '甲敏感词后续' },
    ]);

    // 关键断言：restore 后 inner <w:r> 文本恢复
    expect(restored).toContain('敏感词');
    // <w:ins> 完整（不是空 wrapper）
    expect(restored).toMatch(/<w:ins[^>]*>[\s\S]*?<w:r[^>]*>[\s\S]*?敏感词[\s\S]*?<\/w:r>[\s\S]*?<\/w:ins>/);
    // 不应该是空 <w:ins></w:ins>
    expect(restored).not.toMatch(/<w:ins[^>]*><\/w:ins>/);

    // 原文完整恢复（每个节点拿到对应切片）
    expect(restored).toMatch(/<w:t[^>]*>甲<\/w:t>/);
    expect(restored).toMatch(/<w:t[^>]*>敏感词<\/w:t>/);
    expect(restored).toMatch(/<w:t[^>]*>后续<\/w:t>/);

    console.log('\n[scenario D — mask + restore round-trip]');
    console.log('  masked:', masked);
    console.log('  restored:', restored);
  });

  it('scenario E: 跨多个 <w:ins>/<w:del> 边界（混合场景）', () => {
    // 跨 3 个 ins/del 边界：<w:r>前</w:r><w:ins><w:r>A</w:r></w:ins>
    //                       <w:r>B</w:r><w:del><w:r>C</w:r></w:del>
    //                       <w:ins><w:r>D</w:r></w:ins><w:r>后</w:r>
    // maskedToken "前ABCD后" 跨 4 个 covering nodes + 3 个 ins/del wrappers
    const origXml = `<w:p><w:r><w:t>前</w:t></w:r><w:ins w:id="1" w:author="spy"><w:r><w:t>A</w:t></w:r></w:ins><w:r><w:t>B</w:t></w:r><w:del w:id="2" w:author="spy"><w:r><w:t>C</w:t></w:r></w:del><w:ins w:id="3" w:author="spy"><w:r><w:t>D</w:t></w:r></w:ins><w:r><w:t>后</w:t></w:r></w:p>`;

    const masked = applyDocxEdits(origXml, [
      { maskedToken: '前ABCD后', originalValue: 'XYZ1234' },
    ]);

    // 断言：所有 3 个 ins/del wrapper 都完整（非空 + 保留 inner content）
    expect(masked).not.toMatch(/<w:ins[^>]*><\/w:ins>/);
    expect(masked).not.toMatch(/<w:del[^>]*><\/w:del>/);

    // 每个 wrapper 的 inner <w:t> 拿到对应切片
    //   "前" → 'X', 'A' → 'Y', 'B' → 'Z', 'C' → '1', 'D' → '2', '后' → '34'
    expect(masked).toMatch(/<w:t[^>]*>X<\/w:t>/);  // "前" 节点
    expect(masked).toMatch(/<w:ins[^>]*>[\s\S]*?<w:t[^>]*>Y<\/w:t>[\s\S]*?<\/w:ins>/);  // ins 1
    expect(masked).toMatch(/<w:t[^>]*>Z<\/w:t>/);  // "B" 节点
    expect(masked).toMatch(/<w:del[^>]*>[\s\S]*?<w:t[^>]*>1<\/w:t>[\s\S]*?<\/w:del>/);  // del
    expect(masked).toMatch(/<w:ins[^>]*>[\s\S]*?<w:t[^>]*>2<\/w:t>[\s\S]*?<\/w:ins>/);  // ins 2
    expect(masked).toMatch(/<w:t[^>]*>34<\/w:t>/);  // "后" 节点

    console.log('\n[scenario E — multi ins/del boundary]');
    console.log('  masked:', masked);
  });
});