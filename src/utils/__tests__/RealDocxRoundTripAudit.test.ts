import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import JSZip from 'jszip';

describe('format-preservation real docx round-trip', () => {
  it('SAMPLE-CO-Z docx: header/footer/table/style 应保留', async () => {
    const { writeDocxFromEdits } = await import('@/utils/docxZipWriter');
    const buf = readFileSync('<repo-path>/模板/SAMPLE-CT-002-知识产权服务框架协议-SAMPLE-CO-Z.docx');
    // Node Buffer → ArrayBuffer: 用 Uint8Array 包一层（MEMORY 钉死的 Node 类型坑）
    const ab = new Uint8Array(buf).buffer;

    // 跑空 edits round-trip
    const out = await writeDocxFromEdits(ab, []);
    writeFileSync('/tmp/docx_audit/output.docx', new Uint8Array(out));

    // 对比 zip entries
    const origZip = await JSZip.loadAsync(ab);
    const outZip = await JSZip.loadAsync(out);

    const origEntries = Object.keys(origZip.files).sort();
    const outEntries = Object.keys(outZip.files).sort();

    console.log('orig entries count:', origEntries.length);
    console.log('out  entries count:', outEntries.length);
    console.log('orig key entries:', origEntries.filter(e => /document\.xml$|header|footer|styles|media|theme/.test(e)));
    console.log('out  key entries:', outEntries.filter(e => /document\.xml$|header|footer|styles|media|theme/.test(e)));

    // 检查关键 entry 还在不在
    expect(outEntries).toContain('word/document.xml');
    expect(outEntries).toContain('word/header1.xml');
    expect(outEntries).toContain('word/footer1.xml');
    expect(outEntries).toContain('word/styles.xml');

    // 内容完整性
    const origDoc = await origZip.file('word/document.xml')!.async('string');
    const outDoc = await outZip.file('word/document.xml')!.async('string');
    console.log('orig document.xml length:', origDoc.length);
    console.log('out  document.xml length:', outDoc.length);
    expect(outDoc).toBe(origDoc);  // 没改 edits 应该完全一致

    const origHeader = await origZip.file('word/header1.xml')!.async('string');
    const outHeader = await outZip.file('word/header1.xml')!.async('string');
    expect(outHeader).toBe(origHeader);

    // 检查表格还在不在
    expect(outDoc).toContain('<w:tbl');
  });

  it('方太 docx（3 张图）: word/media/ 图片应保留（媒体二进制不变）', async () => {
    const { writeDocxFromEdits } = await import('@/utils/docxZipWriter');
    const buf = readFileSync('<repo-path>/模板/SAMPLE-CT-003&腾讯网剧植入合同（客户版）-final.docx');
    const ab = new Uint8Array(buf).buffer;

    const out = await writeDocxFromEdits(ab, []);
    writeFileSync('/tmp/docx_audit/fangtai_output.docx', new Uint8Array(out));

    const origZip = await JSZip.loadAsync(ab);
    const outZip = await JSZip.loadAsync(out);

    const origMedia = Object.keys(origZip.files).filter(e => /^word\/media\//.test(e)).sort();
    const outMedia = Object.keys(outZip.files).filter(e => /^word\/media\//.test(e)).sort();

    console.log('orig media:', origMedia);
    console.log('out  media:', outMedia);

    // entry 列表必须完全一致
    expect(outMedia).toEqual(origMedia);

    // 媒体二进制必须 1:1 一致（图片 hash 不能变）
    for (const name of origMedia) {
      const origBin = await origZip.file(name)!.async('uint8array');
      const outBin = await outZip.file(name)!.async('uint8array');
      console.log(`${name}: orig ${origBin.length} bytes vs out ${outBin.length} bytes`);
      expect(outBin.length).toBe(origBin.length);
      // 字节级一致
      expect(Array.from(outBin)).toEqual(Array.from(origBin));
    }
  });
});
