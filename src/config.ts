import { invoke } from '@tauri-apps/api/core';

export interface AppConfig {
  theme: 'dark' | 'light' | 'system';
  animation: boolean;
  compact: boolean;
}

const defaultConfig: AppConfig = {
  theme: 'system',
  animation: true,
  compact: false,
};

export class ConfigManager {
  private static config: AppConfig = { ...defaultConfig };

  static async init() {
    try {
      const savedConfig = await invoke<AppConfig>('load_config');
      this.config = { ...defaultConfig, ...savedConfig };
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
      this.config = { ...defaultConfig };
    }
  }

  static get(): AppConfig {
    return { ...this.config };
  }

  static async update(updates: Partial<AppConfig>) {
    this.config = { ...this.config, ...updates };
    try {
      await invoke('save_config', { config: this.config });
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  static async set(key: keyof AppConfig, value: any) {
    await this.update({ [key]: value });
  }
}
