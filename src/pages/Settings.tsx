import { useSettingsStore } from '@/stores';
import { Button } from '@/components/common';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import type { SensitiveType } from '@/types';

export function SettingsPage() {
  const { settings, customRules, updateSettings, addCustomRule, removeCustomRule, toggleCustomRule } = useSettingsStore();
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleName, setNewRuleName] = useState('');

  const handleAddRule = () => {
    if (!newRulePattern || !newRuleName) {
      alert('请填写规则名称和正则表达式');
      return;
    }

    try {
      new RegExp(newRulePattern, 'gi');
    } catch {
      alert('无效的正则表达式');
      return;
    }

    addCustomRule({
      type: 'CUSTOM' as SensitiveType,
      pattern: new RegExp(newRulePattern, 'gi'),
      weight: 0.9,
      description: newRuleName,
      enabled: true
    });

    setNewRulePattern('');
    setNewRuleName('');
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">设置</h1>

      <div className="space-y-6">
        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">检测设置</h2>
          </div>
          <div className="p-4 space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoDetectEnabled}
                onChange={(e) => updateSettings({ autoDetectEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>自动检测敏感信息</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.customRulesEnabled}
                onChange={(e) => updateSettings({ customRulesEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>启用自定义规则</span>
            </label>
          </div>
        </section>

        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">自定义规则</h2>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="规则名称"
                value={newRuleName}
                onChange={(e) => setNewRuleName(e.target.value)}
                className="flex-1 h-10 px-3 rounded-md border border-input bg-background text-sm"
              />
              <input
                type="text"
                placeholder="正则表达式"
                value={newRulePattern}
                onChange={(e) => setNewRulePattern(e.target.value)}
                className="flex-[2] h-10 px-3 rounded-md border border-input bg-background text-sm"
              />
              <Button onClick={handleAddRule}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {customRules.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                暂无自定义规则
              </p>
            ) : (
              <div className="space-y-2">
                {customRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <button
                      onClick={() => toggleCustomRule(rule.id)}
                      className="text-muted-foreground hover:text-primary"
                    >
                      {rule.enabled ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </button>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{rule.description}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {rule.pattern.source}
                      </p>
                    </div>
                    <button
                      onClick={() => removeCustomRule(rule.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">外观</h2>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">主题</label>
              <div className="flex gap-2">
                {(['light', 'dark', 'system'] as const).map((theme) => (
                  <button
                    key={theme}
                    onClick={() => updateSettings({ theme })}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      settings.theme === theme
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    {theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
