import './style.css';
import { ConfigManager } from './config';
import { ThemeManager } from './theme';
import { renderApp, initGlobalToastListener, initNavigationListener, setCurrentRerenderCallback, showMigrationWarningToast } from './app';
import { initI18n, setRerenderCallback, t } from './i18n';

async function init() {
  // Run config migrations and load config
  const migrationResult = await ConfigManager.init();

  // Initialize i18n with the user's preferred language
  const config = ConfigManager.get();
  const preferredLocale = config.language || 'zh-TW';
  await initI18n(preferredLocale);

  // Wire up language-switch re-render callback
  setRerenderCallback(() => {
    setCurrentRerenderCallback();
  });

  // Initialize theme manager
  ThemeManager.init();

  // Render the app
  renderApp();

  // Show migration warning toasts for any corrupted config files
  if (migrationResult.config_corrupted) {
    showMigrationWarningToast(t('migration.configCorrupted'));
  }
  if (migrationResult.presets_corrupted) {
    showMigrationWarningToast(t('migration.presetsCorrupted'));
  }
  if (migrationResult.bookmarks_corrupted) {
    showMigrationWarningToast(t('migration.bookmarksCorrupted'));
  }
  if (migrationResult.history_corrupted) {
    showMigrationWarningToast(t('migration.historyCorrupted'));
  }

  // Start global toast listener for scheduled download notifications
  await initGlobalToastListener();

  // Start cross-tab navigation listener (e.g. preset → channel bookmarks)
  initNavigationListener();
}

init();
