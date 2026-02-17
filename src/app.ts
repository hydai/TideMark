import { ConfigManager } from './config';
import { ThemeManager } from './theme';
import { renderDownloadPage } from './pages/download';
import { renderHistoryPage } from './pages/history';
import { renderSettingsPage as renderSettingsPageNew } from './pages/settings';
import { renderSubtitlesPage } from './pages/subtitles';
import { renderRecordsPage } from './pages/records';

type TabId = 'download' | 'history' | 'subtitles' | 'records' | 'settings' | 'scheduled-downloads';

let currentTab: TabId = 'download';

// Navigation data that can be set before switching tabs
let navigationData: any = null;

export function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  const config = ConfigManager.get();

  // Build app container DOM programmatically so the scheduled-downloads tab
  // can be conditionally included based on config.
  while (app.firstChild) {
    app.removeChild(app.firstChild);
  }

  const appContainer = document.createElement('div');
  appContainer.className = 'app-container';

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';

  const appTitle = document.createElement('div');
  appTitle.className = 'app-title';
  appTitle.textContent = 'Tidemark';
  sidebar.appendChild(appTitle);

  const tabNav = document.createElement('nav');
  tabNav.className = 'tab-nav';

  const tabs: { id: TabId; icon: string; label: string; conditional?: boolean }[] = [
    { id: 'download', icon: '📥', label: '下載' },
    { id: 'history', icon: '📜', label: '歷程' },
    { id: 'subtitles', icon: '💬', label: '字幕' },
    { id: 'records', icon: '🔖', label: '記錄' },
    { id: 'scheduled-downloads', icon: '🗓️', label: '排程下載', conditional: true },
    { id: 'settings', icon: '⚙️', label: '設定' },
  ];

  tabs.forEach(tab => {
    if (tab.conditional && tab.id === 'scheduled-downloads' && !config.enable_scheduled_downloads) {
      return;
    }

    const button = document.createElement('button');
    button.className = tab.id === 'download' ? 'tab-button active' : 'tab-button';
    button.dataset.tab = tab.id;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'tab-icon';
    iconSpan.textContent = tab.icon;
    button.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tab-label';
    labelSpan.textContent = tab.label;
    button.appendChild(labelSpan);

    tabNav.appendChild(button);
  });

  sidebar.appendChild(tabNav);
  appContainer.appendChild(sidebar);

  const main = document.createElement('main');
  main.className = 'content';

  const pageContainer = document.createElement('div');
  pageContainer.id = 'page-container';
  main.appendChild(pageContainer);

  appContainer.appendChild(main);
  app.appendChild(appContainer);

  // Attach event listeners
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      const tabId = target.dataset.tab as TabId;
      switchTab(tabId);
    });
  });

  // Initial render
  switchTab('download');
}

export function refreshAppNav() {
  // Re-render the entire app to reflect config changes (e.g. enabling scheduled downloads).
  renderApp();
}

function switchTab(tabId: TabId) {
  currentTab = tabId;

  // Update active tab button
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.remove('active');
    if ((button as HTMLElement).dataset.tab === tabId) {
      button.classList.add('active');
    }
  });

  // Render page content
  const container = document.getElementById('page-container');
  if (!container) return;

  switch (tabId) {
    case 'download':
      renderDownloadPage(container, navigationData);
      navigationData = null; // Clear after use
      break;
    case 'history':
      renderHistoryPage(container);
      break;
    case 'subtitles':
      renderSubtitlesPage(container);
      break;
    case 'records':
      renderRecordsPage(container);
      break;
    case 'scheduled-downloads':
      renderScheduledDownloadsPlaceholder(container);
      break;
    case 'settings':
      renderSettingsPageNew(container);
      break;
  }
}

// Export function to navigate with data
export function navigateToDownload(data: any) {
  navigationData = data;
  switchTab('download');
}

// Download page is now in pages/download.ts
// History page is now in pages/history.ts
// Subtitles page is now in pages/subtitles.ts
// Records page is now in pages/records.ts

function renderScheduledDownloadsPlaceholder(container: HTMLElement) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const page = document.createElement('div');
  page.className = 'page';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '排程下載';
  page.appendChild(title);

  const placeholder = document.createElement('p');
  placeholder.className = 'setting-description';
  placeholder.textContent = '排程下載功能即將推出。';
  page.appendChild(placeholder);

  container.appendChild(page);
}

function renderSettingsPage(container: HTMLElement) {
  const config = ConfigManager.get();

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const page = document.createElement('div');
  page.className = 'page';

  const pageTitle = document.createElement('h1');
  pageTitle.className = 'page-title';
  pageTitle.textContent = '設定';
  page.appendChild(pageTitle);

  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '外觀';
  section.appendChild(sectionTitle);

  const themeItem = document.createElement('div');
  themeItem.className = 'setting-item';

  const themeLabel = document.createElement('label');
  themeLabel.className = 'setting-label';
  themeLabel.textContent = '主題';
  themeItem.appendChild(themeLabel);

  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'button-group';

  const darkBtn = document.createElement('button');
  darkBtn.className = config.theme === 'dark' ? 'theme-button active' : 'theme-button';
  darkBtn.dataset.theme = 'dark';
  darkBtn.textContent = '深色';
  buttonGroup.appendChild(darkBtn);

  const lightBtn = document.createElement('button');
  lightBtn.className = config.theme === 'light' ? 'theme-button active' : 'theme-button';
  lightBtn.dataset.theme = 'light';
  lightBtn.textContent = '淺色';
  buttonGroup.appendChild(lightBtn);

  const systemBtn = document.createElement('button');
  systemBtn.className = config.theme === 'system' ? 'theme-button active' : 'theme-button';
  systemBtn.dataset.theme = 'system';
  systemBtn.textContent = '跟隨系統';
  buttonGroup.appendChild(systemBtn);

  themeItem.appendChild(buttonGroup);
  section.appendChild(themeItem);

  const compactItem = document.createElement('div');
  compactItem.className = 'setting-item';

  const compactLabel = document.createElement('label');
  compactLabel.className = 'setting-label';
  compactLabel.textContent = '緊湊模式';
  compactItem.appendChild(compactLabel);

  const compactToggle = document.createElement('button');
  compactToggle.className = config.compact ? 'toggle-button active' : 'toggle-button';
  compactToggle.id = 'compact-toggle';

  const compactToggleLabel = document.createElement('span');
  compactToggleLabel.className = 'toggle-label';
  compactToggleLabel.textContent = config.compact ? '開啟' : '關閉';
  compactToggle.appendChild(compactToggleLabel);

  compactItem.appendChild(compactToggle);
  section.appendChild(compactItem);

  page.appendChild(section);
  container.appendChild(page);

  // Attach theme button event listeners
  container.querySelectorAll('.theme-button').forEach((button) => {
    button.addEventListener('click', async (e) => {
      const target = e.currentTarget as HTMLElement;
      const theme = target.dataset.theme as 'dark' | 'light' | 'system';
      await ThemeManager.setTheme(theme);
      renderSettingsPage(container);
    });
  });

  // Attach compact toggle event listener
  const toggleEl = container.querySelector('#compact-toggle');
  toggleEl?.addEventListener('click', async () => {
    await ThemeManager.toggleCompact();
    renderSettingsPage(container);
  });
}
