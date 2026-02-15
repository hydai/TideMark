import './style.css';
import { ConfigManager } from './config';
import { ThemeManager } from './theme';
import { renderApp } from './app';

async function init() {
  // Initialize config manager
  await ConfigManager.init();

  // Initialize theme manager
  ThemeManager.init();

  // Render the app
  renderApp();
}

init();
