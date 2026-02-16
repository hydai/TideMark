import { ConfigManager } from './config';
import { ThemeManager } from './theme';
import { renderDownloadPage } from './pages/download';
import { renderHistoryPage } from './pages/history';
import { renderSettingsPage as renderSettingsPageNew } from './pages/settings';
import { renderSubtitlesPage } from './pages/subtitles';

type TabId = 'download' | 'history' | 'subtitles' | 'records' | 'settings';

let currentTab: TabId = 'download';

export function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  // Safe static HTML template
  const template = `
    <div class="app-container">
      <aside class="sidebar">
        <div class="app-title">Tidemark</div>
        <nav class="tab-nav">
          <button class="tab-button active" data-tab="download">
            <span class="tab-icon">📥</span>
            <span class="tab-label">下載</span>
          </button>
          <button class="tab-button" data-tab="history">
            <span class="tab-icon">📜</span>
            <span class="tab-label">歷程</span>
          </button>
          <button class="tab-button" data-tab="subtitles">
            <span class="tab-icon">💬</span>
            <span class="tab-label">字幕</span>
          </button>
          <button class="tab-button" data-tab="records">
            <span class="tab-icon">🔖</span>
            <span class="tab-label">記錄</span>
          </button>
          <button class="tab-button" data-tab="settings">
            <span class="tab-icon">⚙️</span>
            <span class="tab-label">設定</span>
          </button>
        </nav>
      </aside>
      <main class="content">
        <div id="page-container"></div>
      </main>
    </div>
  `;
  app.innerHTML = template;

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
      renderDownloadPage(container);
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
    case 'settings':
      renderSettingsPageNew(container);
      break;
  }
}

// Download page is now in pages/download.ts
// History page is now in pages/history.ts
// Subtitles page is now in pages/subtitles.ts

function renderRecordsPage(container: HTMLElement) {
  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">記錄</h1>
      <p class="placeholder">記錄頁面（開發中）</p>
    </div>
  `;
}

function renderSettingsPage(container: HTMLElement) {
  const config = ConfigManager.get();

  container.innerHTML = `
    <div class="page">
      <h1 class="page-title">設定</h1>

      <section class="settings-section">
        <h2 class="section-title">外觀</h2>

        <div class="setting-item">
          <label class="setting-label">主題</label>
          <div class="button-group">
            <button class="theme-button ${config.theme === 'dark' ? 'active' : ''}" data-theme="dark">深色</button>
            <button class="theme-button ${config.theme === 'light' ? 'active' : ''}" data-theme="light">淺色</button>
            <button class="theme-button ${config.theme === 'system' ? 'active' : ''}" data-theme="system">跟隨系統</button>
          </div>
        </div>

        <div class="setting-item">
          <label class="setting-label">緊湊模式</label>
          <button class="toggle-button ${config.compact ? 'active' : ''}" id="compact-toggle">
            <span class="toggle-label">${config.compact ? '開啟' : '關閉'}</span>
          </button>
        </div>
      </section>
    </div>
  `;

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
  const compactToggle = container.querySelector('#compact-toggle');
  compactToggle?.addEventListener('click', async () => {
    await ThemeManager.toggleCompact();
    renderSettingsPage(container);
  });
}
