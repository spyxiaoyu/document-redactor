import { Upload, FileText, Key, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listRecords } from '@/db';
import { useEffect, useState } from 'react';

export function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ total: 0, restored: 0, active: 0 });

  useEffect(() => {
    listRecords().then(records => {
      setStats({
        total: records.length,
        restored: records.filter(r => r.status === 'restored').length,
        active: records.filter(r => r.status === 'active').length
      });
    });
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Data Masking Tool</h1>
        <p className="text-muted-foreground">
          Secure sensitive information redaction
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          icon={<Upload className="h-8 w-8" />}
          label="总处理文件"
          value={stats.total.toString()}
          onClick={() => navigate('/upload')}
        />
        <StatCard
          icon={<RotateCcw className="h-8 w-8" />}
          label="已恢复文件"
          value={stats.restored.toString()}
          onClick={() => navigate('/history')}
        />
        <StatCard
          icon={<FileText className="h-8 w-8" />}
          label="活跃文件"
          value={stats.active.toString()}
          onClick={() => navigate('/history')}
        />
        <StatCard
          icon={<Key className="h-8 w-8" />}
          label="自定义规则"
          value="管理"
          onClick={() => navigate('/settings')}
        />
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">快速开始</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <QuickStartCard
            step={1}
            title="上传文件"
            description="拖拽或选择要脱敏的文档"
            onClick={() => navigate('/upload')}
          />
          <QuickStartCard
            step={2}
            title="自动识别"
            description="系统自动检测敏感信息"
            onClick={() => navigate('/upload')}
          />
          <QuickStartCard
            step={3}
            title="加密脱敏"
            description="设置密钥，生成脱敏文件"
            onClick={() => navigate('/upload')}
          />
        </div>
      </div>

      <div className="mt-8 rounded-lg border bg-card p-6">
        <h2 className="text-xl font-semibold mb-4">支持的文件格式</h2>
        <div className="flex flex-wrap gap-2">
          {['PDF', 'Word (DOCX)', 'Excel (XLSX)', 'PPT (PPTX)', '图片 (PNG/JPG)', 'TXT', 'CSV', 'HTML'].map(format => (
            <span key={format} className="rounded-full bg-secondary px-3 py-1 text-sm">
              {format}
            </span>
          ))}
        </div>
      </div>

      {/* 卡片说明：解释"活跃文件"/"历史记录"区别、恢复方式、"删除"行为边界 */}
      <div className="mt-4 space-y-2 text-muted-foreground">
        <p className="text-xs">
          <strong className="font-medium text-foreground">活跃文件</strong>：当前在系统中且未恢复的脱敏文档（status: active）。
          完整列表看「历史记录」页（按 status badge 区分）。
        </p>
        <p className="text-xs">
          <strong className="font-medium text-foreground">历史记录</strong>：所有处理过的文档（已恢复 + 未恢复 + 已删除）。
        </p>
        <p className="text-xs">
          <strong className="font-medium text-foreground">如何恢复</strong>：去「恢复」页面，上传脱敏文件 + 输入密码即可。
          docx 自带加密元数据（docProps/desensitizer.xml），文件名不影响识别。
        </p>
        <p className="text-xs">
          <strong className="font-medium text-foreground">删除</strong>：仅清除本工具中存储的加密映射表与记录——您电脑上的脱敏文件需自行处理。
        </p>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
    >
      <div className="rounded-full bg-primary/10 p-3 text-primary">
        {icon}
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </button>
  );
}

function QuickStartCard({
  step,
  title,
  description,
  onClick
}: {
  step: number;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
        {step}
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
