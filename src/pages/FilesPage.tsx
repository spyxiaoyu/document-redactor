import { useEffect, useState, useCallback } from 'react';
import { listRecords, updateRecordStatus } from '@/db';
import { FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/common';

export function FilesPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRecords = useCallback(() => {
    listRecords('active').then((data) => {
      setRecords(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await updateRecordStatus(id, 'deleted');
      loadRecords();
    } catch (err) {
      console.error('删除失败', err);
    }
  }, [loadRecords]);

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-6">我的文件</h1>
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>暂无脱敏文件</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">我的文件</h1>

      <div className="space-y-4">
        {records.map((record) => (
          <div
            key={record.id}
            className="flex items-center gap-4 rounded-lg border p-4"
          >
            <FileText className="h-8 w-8 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{record.fileName}</p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{record.fileType.toUpperCase()}</span>
                <span>{new Date(record.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              title="删除"
              className="text-destructive"
              onClick={() => handleDelete(record.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
