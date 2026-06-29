import { create } from 'zustand';
import type { UserSettings, CustomRule } from '@/types';
import { getSetting, setSetting as dbSetSetting } from '@/db';
import { generateUUID } from '@/utils';

interface SettingsState {
  settings: UserSettings;
  customRules: CustomRule[];
  isLoaded: boolean;

  loadSettings: () => Promise<void>;
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  addCustomRule: (rule: Omit<CustomRule, 'id' | 'createdAt' | 'updatedAt'>) => void;
  removeCustomRule: (id: string) => void;
  toggleCustomRule: (id: string) => void;
}

const defaultSettings: UserSettings = {
  customRulesEnabled: true,
  autoDetectEnabled: true,
  theme: 'light',
  language: 'zh-CN'
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  customRules: [],
  isLoaded: false,

  loadSettings: async () => {
    const [customRulesEnabled, autoDetectEnabled, theme, language, customRules] = await Promise.all([
      getSetting('customRulesEnabled'),
      getSetting('autoDetectEnabled'),
      getSetting('theme'),
      getSetting('language'),
      getSetting('customRules')
    ]);

    set({
      settings: {
        customRulesEnabled: (customRulesEnabled as boolean | null) ?? defaultSettings.customRulesEnabled,
        autoDetectEnabled: (autoDetectEnabled as boolean | null) ?? defaultSettings.autoDetectEnabled,
        theme: (theme as 'light' | 'dark' | 'system' | null) ?? defaultSettings.theme,
        language: (language as 'zh-CN' | 'en-US' | null) ?? defaultSettings.language
      },
      customRules: (customRules as CustomRule[]) || [],
      isLoaded: true
    });
  },

  updateSettings: async (updates) => {
    const { settings } = get();
    const newSettings = { ...settings, ...updates };
    set({ settings: newSettings });

    for (const [key, value] of Object.entries(updates)) {
      await dbSetSetting(key as keyof UserSettings, value);
    }
  },

  addCustomRule: (rule) => {
    const { customRules } = get();
    const newRule: CustomRule = {
      ...rule,
      id: generateUUID(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const newRules = [...customRules, newRule];
    set({ customRules: newRules });
    dbSetSetting('customRules', newRules);
  },

  removeCustomRule: (id) => {
    const { customRules } = get();
    const newRules = customRules.filter(r => r.id !== id);
    set({ customRules: newRules });
    dbSetSetting('customRules', newRules);
  },

  toggleCustomRule: (id) => {
    const { customRules } = get();
    const newRules = customRules.map(r =>
      r.id === id ? { ...r, enabled: !r.enabled, updatedAt: new Date() } : r
    );
    set({ customRules: newRules });
    dbSetSetting('customRules', newRules);
  }
}));
