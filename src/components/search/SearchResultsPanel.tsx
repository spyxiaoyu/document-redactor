import { useState, useCallback } from 'react';
import { Check, Eye, EyeOff, MousePointerClick, Plus } from 'lucide-react';
import { Button } from '@/components/common';

export interface SearchHit {
  /** 0-based 索引，全文第几处 */
  index: number;
  /** 在原文中 start 位置 */
  start: number;
  /** 在原文中 end 位置 */
  end: number;
  /** 命中的字符串（= keyword） */
  value: string;
  /** 前后各 ~30 字的上下文，让用户能"看到"这条在哪里 */
  contextBefore: string;
  contextAfter: string;
}

interface SearchResultsPanelProps {
  keyword: string;
  hits: SearchHit[];
  onJumpTo: (index: number) => void;
  onAddOne: (index: number) => void;
  onAddChecked: (indices: number[]) => void;
  onAddAll: () => void;
  onClearSearch: () => void;
}

export function SearchResultsPanel({
  keyword,
  hits,
  onJumpTo,
  onAddOne,
  onAddChecked,
  onAddAll,
  onClearSearch,
}: SearchResultsPanelProps) {
  // 默认全勾选（用户搜索词说明想脱敏，最少要 hover 取消）
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(hits.map(h => h.index))
  );

  const toggle = useCallback((idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const selectAll = () => setSelected(new Set(hits.map(h => h.index)));
  const selectNone = () => setSelected(new Set());
  const invertSelection = () => {
    setSelected(prev => {
      const next = new Set<number>();
      hits.forEach(h => {
        if (!prev.has(h.index)) next.add(h.index);
      });
      return next;
    });
  };

  const checkedCount = selected.size;

  if (hits.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        全文未找到 “<span className="font-mono">{keyword}</span>”。换个关键词试试。
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm">
          关键词 “<span className="font-mono font-semibold">{keyword}</span>”
          全文命中 <span className="font-bold text-primary">{hits.length}</span> 处
          {checkedCount > 0 && checkedCount < hits.length && (
            <span className="ml-2 text-muted-foreground">
              （已勾选 {checkedCount} 处）
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={selectAll}>全选</Button>
          <Button size="sm" variant="ghost" onClick={selectNone}>全不选</Button>
          <Button size="sm" variant="ghost" onClick={invertSelection}>反选</Button>
          <Button size="sm" variant="ghost" onClick={onClearSearch}>关闭</Button>
        </div>
      </div>

      {/* 命中列表 */}
      <div className="space-y-1 max-h-[280px] overflow-y-auto">
        {hits.map(hit => {
          const isChecked = selected.has(hit.index);
          return (
            <div
              key={hit.index}
              className={`flex items-start gap-2 rounded border p-2 text-sm transition-colors cursor-pointer ${
                isChecked
                  ? 'border-primary bg-primary/5'
                  : 'border-border opacity-60 hover:opacity-100'
              }`}
              onClick={() => toggle(hit.index)}
            >
              {/* Checkbox */}
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                  isChecked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/30'
                }`}
              >
                {isChecked && <Check className="h-3 w-3" />}
              </div>

              {/* Index + context */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>第 {hit.index + 1} 处</span>
                  <span>·</span>
                  <span>
                    字符 {hit.start}–{hit.end}
                  </span>
                </div>
                <p className="text-sm leading-relaxed mt-0.5 break-words">
                  <span className="text-muted-foreground">{hit.contextBefore}</span>
                  <mark className="bg-yellow-200 dark:bg-yellow-700 dark:text-yellow-100 px-0.5 rounded font-semibold">
                    {hit.value}
                  </mark>
                  <span className="text-muted-foreground">{hit.contextAfter}</span>
                </p>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onJumpTo(hit.index);
                  }}
                  className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                  title="跳到原文"
                >
                  <MousePointerClick className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddOne(hit.index);
                  }}
                  className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                  title="仅脱敏这一条"
                >
                  {isChecked
                    ? <Eye className="h-4 w-4 text-primary" />
                    : <EyeOff className="h-4 w-4" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer action buttons */}
      <div className="flex gap-2 pt-1 border-t">
        <Button
          className="flex-1"
          size="sm"
          disabled={checkedCount === 0}
          onClick={() => {
            const indices = Array.from(selected).sort((a, b) => a - b);
            onAddChecked(indices);
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          仅脱敏勾选 ({checkedCount} 处)
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onAddAll}
        >
          <Plus className="mr-1 h-4 w-4" />
          一键全部脱敏 ({hits.length} 处)
        </Button>
      </div>
    </div>
  );
}
