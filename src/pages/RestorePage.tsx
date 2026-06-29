import { useState, useCallback } from 'react';
import { FileUploader } from '@/components/file';
import { Button, Input, Modal } from '@/components/common';
import { listRecords, updateRecordStatus } from '@/db';
import { CryptoManager } from '@/engines/CryptoManager';
import { Desensitizer } from '@/engines/Desensitizer';
import type { DesensitizationRecord, MappingEntry } from '@/types';
import { generateUUID } from '@/utils';
import { addAuditLog } from '@/db';
import { Unlock, Download, FileText, AlertCircle, Search } from 'lucide-react';
import JSZip from 'jszip';

const cryptoManager = new CryptoManager();
const desensitizer = new Desensitizer(cryptoManager);

interface RecordMatch {
  record: DesensitizationRecord;
  matchScore: number;
}

export function RestorePage() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [records, setRecords] = useState<RecordMatch[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<DesensitizationRecord | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [restoredContent, setRestoredContent] = useState<string | null>(null);
  const [decryptedMapping, setDecryptedMapping] = useState<MappingEntry[] | null>(null);
  // DOCX 内嵌的 mappingTable（从 docProps/desensitizer.xml 解析）
  const [embeddedMapping, setEmbeddedMapping] = useState<{ mappingTable: MappingEntry[]; saltB64: string; ivB64: string; dataB64: string } | null>(null);

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setError('');
    setRestoredContent(null);
    setDecryptedMapping(null);
    setEmbeddedMapping(null);

    // Step 1: 优先检测 DOCX 内嵌元数据（docProps/desensitizer.xml）
    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const metaXml = await zip.file('docProps/desensitizer.xml')?.async('string');

      if (metaXml) {
        // 解析内嵌元数据
        const saltMatch = metaXml.match(/<salt>([^<]+)<\/salt>/);
        const ivMatch = metaXml.match(/<iv>([^<]+)<\/iv>/);
        const dataMatch = metaXml.match(/<data>([^<]+)<\/data>/);

        if (saltMatch && ivMatch && dataMatch) {
          // 内嵌元数据存在，解密需要用户密码
          setEmbeddedMapping({
            saltB64: saltMatch[1],
            ivB64: ivMatch[1],
            dataB64: dataMatch[1],
            mappingTable: [] // 先占位，解密后填充
          });
          setShowPasswordModal(true);
          return;
        }
      }
    } catch {
      // 非 DOCX 或无内嵌元数据，继续走 DB 路径
    }

    // Step 2: 回退到 DB 记录查找
    const allRecords = await listRecords('active');
    const fileName = selectedFile.name.replace(/(_脱敏)?\.[^.]+$/, '');

    const matchedRecords: RecordMatch[] = allRecords
      .map(record => {
        const normalizedFileName = record.fileName.replace(/(_脱敏)?\.[^.]+$/, '');
        const matchScore = fileName.includes(normalizedFileName) || normalizedFileName.includes(fileName)
          ? 1
          : 0;
        return { record, matchScore };
      })
      .filter(r => r.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    setRecords(matchedRecords);

    if (matchedRecords.length === 1) {
      setSelectedRecord(matchedRecords[0].record);
      setShowPasswordModal(true);
    } else if (matchedRecords.length > 1) {
      setShowRecordModal(true);
    } else {
      setError('未找到对应的脱敏记录，请确保上传的是脱敏后的文件');
    }
  }, []);

  const handleSelectRecord = useCallback((record: DesensitizationRecord) => {
    setSelectedRecord(record);
    setShowRecordModal(false);
    setShowPasswordModal(true);
  }, []);

  const handleRestore = useCallback(async () => {
    if (!password) return;

    setIsProcessing(true);
    setError('');

    try {
      let mappingTable: MappingEntry[];
      let desensitizedText: string;

      if (embeddedMapping) {
        // 模式1：DOCX 内嵌元数据恢复
        // 用户密码派生 key，salt+iv 在 metadata XML 中
        const saltBytes = Uint8Array.from(atob(embeddedMapping.saltB64), c => c.charCodeAt(0));
        const ivBytes = Uint8Array.from(atob(embeddedMapping.ivB64), c => c.charCodeAt(0));
        const dataBytes = Uint8Array.from(atob(embeddedMapping.dataB64), c => c.charCodeAt(0));

        mappingTable = await desensitizer.decryptMappingTable(
          dataBytes.buffer as ArrayBuffer,
          password,
          saltBytes,
          ivBytes
        ) as MappingEntry[];

        // 用 mammoth 在浏览器提取纯文本（file.text() 对 DOCX 返回 ZIP 二进制，是乱码根因）
        const mammoth = await import('mammoth');
        const arrayBuffer = await file!.arrayBuffer();
        const result = await mammoth.extractRawText({ buffer: arrayBuffer as any });
        desensitizedText = result.value;
      } else if (selectedRecord) {
        // 模式2：DB 记录恢复
        mappingTable = await desensitizer.decryptMappingTable(
          selectedRecord.mappingTable,
          password,
          selectedRecord.keySalt,
          selectedRecord.iv
        ) as MappingEntry[];

        // DOCX 必须走 mammoth；否则 file.text() 拿到的是 ZIP 二进制乱码。
        // 其他格式保持 file.text()。
        if (file!.name.toLowerCase().endsWith('.docx')) {
          const mammoth = await import('mammoth');
          const buffer = await file!.arrayBuffer();
          const result = await mammoth.extractRawText({ buffer: buffer as any });
          desensitizedText = result.value;
        } else {
          desensitizedText = await file!.text();
        }
      } else {
        throw new Error('无可用恢复数据');
      }

      // 两种模式都走 desensitizer.restore（两趟替换，鲁棒处理交叉 originalValue / maskedToken）
      let restoredText: string;
      if (embeddedMapping || selectedRecord) {
        restoredText = await desensitizer.restore(desensitizedText, mappingTable, password);
      } else {
        throw new Error('无可用恢复数据');
      }

      if (!embeddedMapping && selectedRecord) {
        await updateRecordStatus(selectedRecord.id, 'restored');
        await addAuditLog({
          id: generateUUID(),
          timestamp: new Date(),
          action: 'restore',
          fileId: selectedRecord.id,
          fileHash: selectedRecord.fileHash,
          details: { matchCount: mappingTable.length }
        });
      }

      setRestoredContent(restoredText);
      setDecryptedMapping(mappingTable);
      setShowPasswordModal(false);
    } catch (err) {
      setError('密码错误或映射表解密失败');
    } finally {
      setIsProcessing(false);
    }
  }, [selectedRecord, password, file, embeddedMapping]);

  const handleDownload = useCallback(() => {
    if (!restoredContent || !selectedRecord) return;

    const originalFileName = selectedRecord.fileName.replace(/_脱敏$/, '');
    const blob = new Blob([restoredContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = originalFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [restoredContent, selectedRecord]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPassword('');
    setRecords([]);
    setSelectedRecord(null);
    setError('');
    setRestoredContent(null);
    setDecryptedMapping(null);
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">恢复脱敏文件</h1>

      {error && (
        <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {!file ? (
        <FileUploader onFileSelect={handleFileSelect} className="min-h-[400px]" />
      ) : restoredContent ? (
        <div className="space-y-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
              <Unlock className="h-5 w-5" />
              文件已成功恢复
            </div>
            <p className="text-sm text-green-600">
              共有 {decryptedMapping?.length || 0} 处敏感信息被还原
            </p>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-4 py-2 font-medium flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <span>恢复后的文件内容</span>
            </div>
            <div className="p-4 max-h-[400px] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                {restoredContent.slice(0, 50000)}
                {restoredContent.length > 50000 && (
                  <span className="text-muted-foreground">
                    ... (还有 {restoredContent.length - 50000} 字符未显示)
                  </span>
                )}
              </pre>
            </div>
          </div>

          <div className="flex gap-3">
            <Button className="flex-1" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              下载恢复后的文件
            </Button>
            <Button variant="outline" onClick={handleReset}>
              继续处理其他文件
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-muted/50 rounded-lg px-4 py-3 flex items-center gap-3">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {(file.size / 1024).toFixed(2)} KB
              </p>
            </div>
          </div>

          {records.length > 0 && (
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowRecordModal(true)}
                className="flex-1"
              >
                <Search className="mr-2 h-4 w-4" />
                选择脱敏记录 ({records.length})
              </Button>
              <Button variant="outline" onClick={handleReset}>
                重新选择文件
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Record selection modal */}
      <Modal
        isOpen={showRecordModal}
        onClose={() => setShowRecordModal(false)}
        title="选择脱敏记录"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            找到 {records.length} 条可能的脱敏记录，请选择对应的记录：
          </p>
          {records.map(({ record }) => (
            <div
              key={record.id}
              className={`p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors ${
                selectedRecord?.id === record.id ? 'border-primary bg-primary/5' : ''
              }`}
              onClick={() => handleSelectRecord(record)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{record.fileName}</p>
                  <p className="text-sm text-muted-foreground">
                    脱敏时间: {new Date(record.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  {record.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Password modal */}
      <Modal
        isOpen={showPasswordModal}
        onClose={() => {
          setShowPasswordModal(false);
          setPassword('');
        }}
        title="输入解密密码"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            请输入在脱敏时设置的密码来解密映射表并恢复文件。
          </p>
          <div>
            <label className="text-sm font-medium mb-1 block">密码</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入脱敏时的密码"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowPasswordModal(false)}>
              取消
            </Button>
            <Button onClick={handleRestore} disabled={isProcessing || !password}>
              {isProcessing ? '解密中...' : '恢复文件'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
