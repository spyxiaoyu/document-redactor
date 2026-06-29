import { clsx } from 'clsx';
import type { SensitiveMatch, SensitiveType } from '@/types';
import { SENSITIVE_TYPE_LABELS } from '@/rules';
import { Eye, EyeOff, Check } from 'lucide-react';

interface SensitiveItemProps {
  match: SensitiveMatch;
  isSelected: boolean;
  onToggle: () => void;
}

const typeColors: Record<SensitiveType, string> = {
  PHONE: 'bg-blue-100 text-blue-800',
  ID_CARD: 'bg-purple-100 text-purple-800',
  EMAIL: 'bg-green-100 text-green-800',
  BANK_CARD: 'bg-orange-100 text-orange-800',
  IP: 'bg-gray-100 text-gray-800',
  AMOUNT: 'bg-yellow-100 text-yellow-800',
  AMOUNT_UPPER: 'bg-amber-100 text-amber-800',
  ADDRESS: 'bg-teal-100 text-teal-800',
  CONTRACT_NO: 'bg-indigo-100 text-indigo-800',
  PROJECT_NAME: 'bg-pink-100 text-pink-800',
  COMPANY: 'bg-cyan-100 text-cyan-800',
  NAME: 'bg-rose-100 text-rose-800',
  TAX_ID: 'bg-red-100 text-red-800',
  CUSTOM: 'bg-muted text-muted-foreground',
};

export function SensitiveItem({ match, isSelected, onToggle }: SensitiveItemProps) {
  const label = SENSITIVE_TYPE_LABELS[match.type] || match.type;

  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors cursor-pointer',
        isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
      )}
      onClick={onToggle}
    >
      <div
        className={clsx(
          'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors',
          isSelected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/30'
        )}
      >
        {isSelected && <Check className="h-4 w-4" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', typeColors[match.type])}>
            {label}
          </span>
          <span className="text-xs text-muted-foreground">
            {Math.round(match.confidence * 100)}% 置信度
          </span>
        </div>
        <p className="mt-1 truncate font-mono text-sm">{match.value}</p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{match.context}</p>
      </div>

      <div className="flex gap-1">
        {isSelected ? (
          <Eye className="h-4 w-4 text-primary" />
        ) : (
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
