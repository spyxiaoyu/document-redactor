import type { FileFormat } from '@/types';

export function getFileFormat(file: File): FileFormat {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop() || '';

  const formatMap: Record<string, FileFormat> = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'text/html': 'html',
    'image/jpeg': 'image',
    'image/png': 'image',
    'image/gif': 'image',
    'image/webp': 'image',
    'image/bmp': 'image',
  };

  if (formatMap[mimeType]) {
    return formatMap[mimeType];
  }

  if (['pdf'].includes(ext)) return 'pdf';
  if (['docx'].includes(ext)) return 'docx';
  if (['doc'].includes(ext)) return 'doc';
  if (['xlsx', 'xlsm'].includes(ext)) return 'xlsx';
  if (['xls'].includes(ext)) return 'xls';
  if (['pptx'].includes(ext)) return 'pptx';
  if (['txt'].includes(ext)) return 'txt';
  if (['csv'].includes(ext)) return 'csv';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';

  throw new Error(`Unsupported file format: ${mimeType} (${ext})`);
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function createBlobUrl(data: ArrayBuffer | Blob, mimeType: string): string {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  return URL.createObjectURL(blob);
}

export function downloadBlob(data: ArrayBuffer, fileName: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
