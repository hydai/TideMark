import { ConfigManager } from './config';

export class ThemeManager {
  private static mediaQuery: MediaQueryList | null = null;

  static init() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery.addEventListener('change', () => {
      this.apply();
    });
    this.apply();
  }

  static apply() {
    const config = ConfigManager.get();
    let effectiveTheme: 'dark' | 'light' = 'dark';

    if (config.theme === 'system') {
      effectiveTheme = this.mediaQuery?.matches ? 'dark' : 'light';
    } else {
      effectiveTheme = config.theme;
    }

    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.documentElement.setAttribute('data-compact', String(config.compact));
  }

  static async setTheme(theme: 'dark' | 'light' | 'system') {
    await ConfigManager.set('theme', theme);
    this.apply();
  }

  static async toggleCompact() {
    const config = ConfigManager.get();
    await ConfigManager.set('compact', !config.compact);
    this.apply();
  }
}
