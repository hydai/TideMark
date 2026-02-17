import './style.css';
import { ConfigManager } from './config';
import { ThemeManager } from './theme';
import { renderApp, initGlobalToastListener, initNavigationListener, setCurrentRerenderCallback } from './app';
import { initI18n, setRerenderCallback } from './i18n';

async function init() {
  // Initialize config manager
  await ConfigManager.init();

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

  // Start global toast listener for scheduled download notifications
  await initGlobalToastListener();

  // Start cross-tab navigation listener (e.g. preset → channel bookmarks)
  initNavigationListener();
}

init();
