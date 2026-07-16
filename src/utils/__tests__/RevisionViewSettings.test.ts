/**
 * RevisionView Settings 双保险 probe 测试 — TEST_SPECIFICATION §B 后续
 *
 * 锁定需求：spy 工作流要求保留修订数据 + 修订模式 ON + 视觉干净。
 *
 * 解决：在 word/settings.xml 注入/更新 <w:revisionView w:insDel="0" .../>，
 * 让 Word 默认隐藏 ins/del 显示。但 <w:trackChanges/> 不动（保留 spy's 修订模式）。
 *
 * 三种 case：
 *   1. 原 settings.xml 已有 <w:revisionView> → 替换属性
 *   2. 原 settings.xml 无 <w:revisionView> 但有 <w:trackChanges/> → 在 trackChanges 之前插入
 *   3. 都没有 → 在 <w:settings> 开标签后插入
 *
 * 跑法：npx vitest run src/utils/__tests__/RevisionViewSettings.test.ts
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { writeDocxFromEdits } from '../docxZipWriter';

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

/**
 * 构造一个最小可解析 docx：含 word/document.xml + word/settings.xml。
 * document.xml 含一段普通段落（确保能 applyDocxEdits）。
 */
async function makeMinimalDocx(settingsXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>敏感词文本</w:t></w:r></w:p></w:body></w:document>');
  zip.file('word/settings.xml', settingsXml);
  const buf = await zip.generateAsync({ type: 'uint8array' });
  return toArrayBuffer(buf);
}

async function readSettingsXml(docx: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(docx);
  return await zip.file('word/settings.xml')!.async('string');
}

describe('RevisionView Settings 双保险 — <w:revisionView w:insDel="0"> 注入', () => {
  it('scenario 1: 原 settings.xml 已有 <w:revisionView> → 属性替换', async () => {
    const origSettings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:revisionView w:insDel="1" w:comments="1"/>
  <w:trackChanges/>
</w:settings>`;
    const docx = await makeMinimalDocx(origSettings);

    const result = await writeDocxFromEdits(docx, [
      { maskedToken: '敏感词', originalValue: '____' },
    ]);

    const newSettings = await readSettingsXml(result);

    // 断言 1：<w:revisionView> 存在
    expect(newSettings).toMatch(/<w:revisionView\b/);
    // 断言 2：所有属性设为 "0"
    expect(newSettings).toMatch(/w:insDel="0"/);
    expect(newSettings).toMatch(/w:comments="0"/);
    expect(newSettings).toMatch(/w:formatting="0"/);
    expect(newSettings).toMatch(/w:inkAnnotations="0"/);
    expect(newSettings).toMatch(/w:markup="0"/);
    // 断言 3：原 <w:trackChanges/> 保留（不被吞）
    expect(newSettings).toMatch(/<w:trackChanges\b/);

    console.log('\n[scenario 1 — replace existing revisionView]');
    console.log('  new settings.xml:', newSettings);
  });

  it('scenario 2: 原 settings.xml 有 <w:trackChanges/> 但无 <w:revisionView> → 在 trackChanges 之前插入', async () => {
    const origSettings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:trackChanges/>
</w:settings>`;
    const docx = await makeMinimalDocx(origSettings);

    const result = await writeDocxFromEdits(docx, [
      { maskedToken: '敏感词', originalValue: '____' },
    ]);

    const newSettings = await readSettingsXml(result);

    // 断言 1：<w:revisionView> 存在 + 属性全 0
    expect(newSettings).toMatch(/<w:revisionView\b/);
    expect(newSettings).toMatch(/w:insDel="0"/);

    // 断言 2：schema 顺序正确：<w:revisionView> 必须在 <w:trackChanges> 之前
    const revisionViewIdx = newSettings.indexOf('<w:revisionView');
    const trackChangesIdx = newSettings.indexOf('<w:trackChanges');
    expect(revisionViewIdx).toBeGreaterThan(-1);
    expect(trackChangesIdx).toBeGreaterThan(-1);
    expect(revisionViewIdx).toBeLessThan(trackChangesIdx);

    // 断言 3：<w:trackChanges/> 保留
    expect(newSettings).toMatch(/<w:trackChanges\b/);

    console.log('\n[scenario 2 — insert before trackChanges]');
    console.log('  new settings.xml:', newSettings);
  });

  it('scenario 3: 原 settings.xml 既无 revisionView 也无 trackChanges → 在 <w:settings> 之后插入', async () => {
    const origSettings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
</w:settings>`;
    const docx = await makeMinimalDocx(origSettings);

    const result = await writeDocxFromEdits(docx, [
      { maskedToken: '敏感词', originalValue: '____' },
    ]);

    const newSettings = await readSettingsXml(result);

    // 断言 1：<w:revisionView> 存在
    expect(newSettings).toMatch(/<w:revisionView\b/);
    expect(newSettings).toMatch(/w:insDel="0"/);
    // 断言 2：插入在 <w:settings> 开标签之后（不一定在 trackChanges 之前因为没有 trackChanges）
    const settingsOpenIdx = newSettings.indexOf('<w:settings');
    const settingsCloseIdx = newSettings.indexOf('>', settingsOpenIdx);
    const revisionViewIdx = newSettings.indexOf('<w:revisionView');
    expect(revisionViewIdx).toBeGreaterThan(settingsCloseIdx);

    console.log('\n[scenario 3 — insert after <w:settings>]');
    console.log('  new settings.xml:', newSettings);
  });

  it('scenario 4: 双保险不影响 document.xml 的 mask 替换', async () => {
    const origSettings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:trackChanges/>
</w:settings>`;
    const docx = await makeMinimalDocx(origSettings);

    const result = await writeDocxFromEdits(docx, [
      { maskedToken: '敏感词', originalValue: '____' },
    ]);

    // 验证 document.xml 被正确 mask
    const resultZip = await JSZip.loadAsync(result);
    const newDoc = await resultZip.file('word/document.xml')!.async('string');
    expect(newDoc).toContain('____');
    expect(newDoc).not.toContain('敏感词');

    // 验证 settings.xml 注入 revisionView
    const newSettings = await readSettingsXml(result);
    expect(newSettings).toMatch(/<w:revisionView\b/);
    expect(newSettings).toMatch(/w:insDel="0"/);

    console.log('\n[scenario 4 — double safety (mask + revisionView)]');
    console.log('  document.xml masked ✓');
    console.log('  settings.xml has revisionView w:insDel="0" ✓');
  });
});