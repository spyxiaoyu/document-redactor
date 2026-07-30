import { useState } from 'react';
import type { SensitiveMatch, SensitiveType } from '@/types';
import { SensitiveItem } from './SensitiveItem';
import { SENSITIVE_TYPE_LABELS } from '@/rules';
import { Check, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/common';

interface SensitivePanelProps {
  matches: SensitiveMatch[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRemove: (id: string) => void;
}

export function SensitivePanel({
  matches,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onRemove
}: SensitivePanelProps) {
  const [showDetails, setShowDetails] = useState(false);

  const groupedByType = matches.reduce((acc, match) => {
    if (!acc[match.type]) acc[match.type] = [];
    acc[match.type].push(match);
    return acc;
  }, {} as Record<SensitiveType, SensitiveMatch[]>);

  const typeOrder: SensitiveType[] = [
    'NAME', 'PHONE', 'EMAIL', 'ID_CARD', 'BANK_CARD', 'TAX_ID',
    'ADDRESS', 'COMPANY', 'PROJECT_NAME', 'CONTRACT_NO',
    'AMOUNT', 'AMOUNT_UPPER', 'IP', 'CUSTOM'
  ];

  const sortedTypes = Object.keys(groupedByType).sort((a, b) => {
    const indexA = typeOrder.indexOf(a as SensitiveType);
    const indexB = typeOrder.indexOf(b as SensitiveType);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  }) as SensitiveType[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">检测到 {matches.length} 处敏感信息</h3>
          <p className="text-sm text-muted-foreground">
            已选择 {selectedIds.size} 处
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onSelectAll}>
            <Check className="mr-1 h-4 w-4" />
            全选
          </Button>
          <Button size="sm" variant="outline" onClick={onDeselectAll}>
            <EyeOff className="mr-1 h-4 w-4" />
            取消全选
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="sensitive-panel-toggle"
            onClick={() => setShowDetails(!showDetails)}
            aria-expanded={showDetails}
          >
            {showDetails ? (
              <ChevronUp className="mr-1 h-4 w-4" />
            ) : (
              <ChevronDown className="mr-1 h-4 w-4" />
            )}
            {showDetails ? '收起' : '展开'}
          </Button>
        </div>
      </div>

      {showDetails && (
        <div className="space-y-4 max-h-[500px] overflow-y-auto">
          {sortedTypes.map(type => {
            const typeMatches = groupedByType[type];
            const label = SENSITIVE_TYPE_LABELS[type];

            return (
              <div key={type} className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Eye className="h-4 w-4" />
                  {label} ({typeMatches.length})
                </div>
                <div className="space-y-1">
                  {typeMatches.map(match => (
                    <SensitiveItem
                      key={match.id}
                      match={match}
                      isSelected={selectedIds.has(match.id)}
                      onToggle={() => onToggle(match.id)}
                      onRemove={() => onRemove(match.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
