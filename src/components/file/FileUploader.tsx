import { useCallback, useRef } from 'react';
import { Upload, FileText, FileSpreadsheet, Presentation } from 'lucide-react';
import { clsx } from 'clsx';
import { formatFileSize } from '@/utils';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  className?: string;
}

const formatIcons: Record<string, typeof FileText> = {
  'application/pdf': FileText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FileText,
  'application/msword': FileText,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileSpreadsheet,
  'application/vnd.ms-excel': FileSpreadsheet,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': Presentation,
  'text/plain': FileText,
  'text/csv': FileSpreadsheet,
};

export function FileUploader({ onFileSelect, accept, className }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
    // Reset so same file can be selected again
    e.target.value = '';
  }, [onFileSelect]);

  return (
    <label
      className={clsx(
        'flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-primary/50 cursor-pointer',
        className
      )}
    >
      <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
      <p className="mb-2 text-lg font-medium">拖拽文件到此处或点击上传</p>
      <p className="text-sm text-muted-foreground">
        支持 PDF、Word、Excel、图片等格式
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
      />
    </label>
  );
}

interface FileCardProps {
  file: File;
  onRemove?: () => void;
}

export function FileCard({ file, onRemove }: FileCardProps) {
  const Icon = formatIcons[file.type] || FileText;

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <Icon className="h-8 w-8 text-primary" />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
        >
          <span className="sr-only">移除</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
