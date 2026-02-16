import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

interface AuthConfig {
  twitch_token: string | null;
  youtube_cookies_path: string | null;
}

let currentAuthConfig: AuthConfig = {
  twitch_token: null,
  youtube_cookies_path: null,
};

export function renderSettingsPage(container: HTMLElement) {
  // Load auth config first
  loadAuthConfig().then(() => {
    renderSettingsUI(container);
  });
}

async function loadAuthConfig() {
  try {
    currentAuthConfig = await invoke<AuthConfig>('get_auth_config');
  } catch (error) {
    console.error('Failed to load auth config:', error);
  }
}

function renderSettingsUI(container: HTMLElement) {
  container.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'page settings-page';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '設定';
  page.appendChild(title);

  // Platform authentication section
  const authSection = createAuthSection();
  page.appendChild(authSection);

  // Appearance section
  const appearanceSection = createAppearanceSection();
  page.appendChild(appearanceSection);

  container.appendChild(page);

  // Attach event listeners
  attachAuthEventListeners(container);
  attachThemeEventListeners(container);
}

function createAuthSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '平台認證';
  section.appendChild(sectionTitle);

  // Twitch OAuth Token
  const twitchGroup = createTwitchAuthGroup();
  section.appendChild(twitchGroup);

  // YouTube Cookies
  const youtubeGroup = createYouTubeAuthGroup();
  section.appendChild(youtubeGroup);

  // Clear button
  const clearGroup = document.createElement('div');
  clearGroup.className = 'setting-group';

  const clearBtn = document.createElement('button');
  clearBtn.id = 'clear-auth-btn';
  clearBtn.className = 'btn btn-secondary';
  clearBtn.textContent = '清除所有認證資訊';
  clearGroup.appendChild(clearBtn);

  section.appendChild(clearGroup);

  return section;
}

function createTwitchAuthGroup(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'setting-group';

  const groupTitle = document.createElement('h3');
  groupTitle.className = 'setting-group-title';
  groupTitle.textContent = 'Twitch OAuth Token';
  group.appendChild(groupTitle);

  const description = document.createElement('p');
  description.className = 'setting-description';
  description.textContent = '用於下載訂閱者限定內容。取得方式：登入 Twitch 後，開啟瀏覽器開發者工具，在 Network 分頁中尋找請求標頭中的 Authorization token。';
  group.appendChild(description);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'auth-input-group';

  const input = document.createElement('input');
  input.type = 'password';
  input.id = 'twitch-token-input';
  input.className = 'auth-input';
  input.placeholder = '請輸入 Twitch OAuth Token';
  input.value = currentAuthConfig.twitch_token || '';
  inputGroup.appendChild(input);

  const validateBtn = document.createElement('button');
  validateBtn.id = 'twitch-validate-btn';
  validateBtn.className = 'btn btn-primary';
  validateBtn.textContent = '驗證';
  inputGroup.appendChild(validateBtn);

  group.appendChild(inputGroup);

  const statusDiv = document.createElement('div');
  statusDiv.id = 'twitch-status';
  statusDiv.className = 'auth-status';

  const hasTwitchToken = currentAuthConfig.twitch_token !== null && currentAuthConfig.twitch_token !== '';
  const statusSpan = document.createElement('span');
  statusSpan.className = hasTwitchToken ? 'status-verified' : 'status-unverified';
  statusSpan.textContent = hasTwitchToken ? '✓ 已驗證' : '未設定';
  statusDiv.appendChild(statusSpan);

  group.appendChild(statusDiv);

  return group;
}

function createYouTubeAuthGroup(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'setting-group';

  const groupTitle = document.createElement('h3');
  groupTitle.className = 'setting-group-title';
  groupTitle.textContent = 'YouTube Cookies';
  group.appendChild(groupTitle);

  const description = document.createElement('p');
  description.className = 'setting-description';
  description.textContent = '用於下載會員專屬或私人影片。請使用瀏覽器擴充套件匯出 cookies.txt（Netscape 格式）。';
  group.appendChild(description);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'auth-input-group';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'youtube-cookies-path-display';
  input.className = 'auth-input';
  input.placeholder = '尚未匯入 cookies.txt';
  input.value = currentAuthConfig.youtube_cookies_path || '';
  input.readOnly = true;
  inputGroup.appendChild(input);

  const importBtn = document.createElement('button');
  importBtn.id = 'youtube-import-btn';
  importBtn.className = 'btn btn-primary';
  importBtn.textContent = '匯入 cookies.txt';
  inputGroup.appendChild(importBtn);

  group.appendChild(inputGroup);

  const statusDiv = document.createElement('div');
  statusDiv.id = 'youtube-status';
  statusDiv.className = 'auth-status';

  const hasYoutubeCookies = currentAuthConfig.youtube_cookies_path !== null && currentAuthConfig.youtube_cookies_path !== '';
  const statusSpan = document.createElement('span');
  statusSpan.className = hasYoutubeCookies ? 'status-verified' : 'status-unverified';
  statusSpan.textContent = hasYoutubeCookies ? '✓ 已匯入' : '未匯入';
  statusDiv.appendChild(statusSpan);

  group.appendChild(statusDiv);

  return group;
}

function createAppearanceSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '外觀';
  section.appendChild(sectionTitle);

  // Theme setting
  const themeItem = document.createElement('div');
  themeItem.className = 'setting-item';

  const themeLabel = document.createElement('label');
  themeLabel.className = 'setting-label';
  themeLabel.textContent = '主題';
  themeItem.appendChild(themeLabel);

  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'button-group';

  const darkBtn = document.createElement('button');
  darkBtn.className = 'theme-button';
  darkBtn.dataset.theme = 'dark';
  darkBtn.textContent = '深色';
  buttonGroup.appendChild(darkBtn);

  const lightBtn = document.createElement('button');
  lightBtn.className = 'theme-button';
  lightBtn.dataset.theme = 'light';
  lightBtn.textContent = '淺色';
  buttonGroup.appendChild(lightBtn);

  const systemBtn = document.createElement('button');
  systemBtn.className = 'theme-button';
  systemBtn.dataset.theme = 'system';
  systemBtn.textContent = '跟隨系統';
  buttonGroup.appendChild(systemBtn);

  themeItem.appendChild(buttonGroup);
  section.appendChild(themeItem);

  // Compact mode setting
  const compactItem = document.createElement('div');
  compactItem.className = 'setting-item';

  const compactLabel = document.createElement('label');
  compactLabel.className = 'setting-label';
  compactLabel.textContent = '緊湊模式';
  compactItem.appendChild(compactLabel);

  const toggleButton = document.createElement('button');
  toggleButton.id = 'compact-toggle';
  toggleButton.className = 'toggle-button';

  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'toggle-label';
  toggleLabel.textContent = '關閉';
  toggleButton.appendChild(toggleLabel);

  compactItem.appendChild(toggleButton);
  section.appendChild(compactItem);

  return section;
}

function attachAuthEventListeners(container: HTMLElement) {
  // Twitch token validation
  const twitchValidateBtn = container.querySelector('#twitch-validate-btn');
  const twitchTokenInput = container.querySelector('#twitch-token-input') as HTMLInputElement;
  const twitchStatus = container.querySelector('#twitch-status');

  twitchValidateBtn?.addEventListener('click', async () => {
    const token = twitchTokenInput?.value.trim();

    if (!token) {
      updateStatusElement(twitchStatus, 'error', '請輸入 Token');
      return;
    }

    updateStatusElement(twitchStatus, 'validating', '驗證中...');

    try {
      const isValid = await invoke<boolean>('validate_twitch_token', { token });

      if (isValid) {
        // Save token
        await invoke('save_auth_config', {
          twitchToken: token,
          youtubeCookiesPath: currentAuthConfig.youtube_cookies_path
        });

        currentAuthConfig.twitch_token = token;
        updateStatusElement(twitchStatus, 'verified', '✓ 已驗證');
      } else {
        updateStatusElement(twitchStatus, 'error', 'Token 無效，請重新取得');
      }
    } catch (error) {
      console.error('Twitch token validation error:', error);
      updateStatusElement(twitchStatus, 'error', '驗證失敗，請稍後重試');
    }
  });

  // YouTube cookies import
  const youtubeImportBtn = container.querySelector('#youtube-import-btn');
  const youtubePathDisplay = container.querySelector('#youtube-cookies-path-display') as HTMLInputElement;
  const youtubeStatus = container.querySelector('#youtube-status');

  youtubeImportBtn?.addEventListener('click', async () => {
    try {
      // Open file picker
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Cookies',
          extensions: ['txt']
        }]
      });

      if (!selected || typeof selected !== 'string') {
        return;
      }

      updateStatusElement(youtubeStatus, 'validating', '驗證中...');

      // Validate cookies file
      const isValid = await invoke<boolean>('import_youtube_cookies', { path: selected });

      if (isValid) {
        // Save cookies path
        await invoke('save_auth_config', {
          twitchToken: currentAuthConfig.twitch_token,
          youtubeCookiesPath: selected
        });

        currentAuthConfig.youtube_cookies_path = selected;

        if (youtubePathDisplay) {
          youtubePathDisplay.value = selected;
        }

        updateStatusElement(youtubeStatus, 'verified', '✓ 已匯入');
      } else {
        updateStatusElement(youtubeStatus, 'error', 'Cookies 檔案格式不正確，請使用 Netscape 格式');
      }
    } catch (error) {
      console.error('YouTube cookies import error:', error);
      updateStatusElement(youtubeStatus, 'error', '匯入失敗，請稍後重試');
    }
  });

  // Clear all auth
  const clearAuthBtn = container.querySelector('#clear-auth-btn');
  clearAuthBtn?.addEventListener('click', async () => {
    if (!confirm('確定要清除所有認證資訊嗎？')) {
      return;
    }

    try {
      await invoke('save_auth_config', {
        twitchToken: null,
        youtubeCookiesPath: null
      });

      currentAuthConfig = {
        twitch_token: null,
        youtube_cookies_path: null,
      };

      // Re-render settings page
      renderSettingsUI(container);
    } catch (error) {
      console.error('Failed to clear auth config:', error);
      alert('清除失敗');
    }
  });
}

function updateStatusElement(element: Element | null, type: string, text: string) {
  if (!element) return;

  element.innerHTML = '';
  const statusSpan = document.createElement('span');
  statusSpan.className = `status-${type}`;
  statusSpan.textContent = text;
  element.appendChild(statusSpan);
}

function attachThemeEventListeners(container: HTMLElement) {
  // Theme buttons
  container.querySelectorAll('.theme-button').forEach((button) => {
    button.addEventListener('click', async (e) => {
      const target = e.currentTarget as HTMLElement;
      const theme = target.dataset.theme as 'dark' | 'light' | 'system';

      // Update active state
      container.querySelectorAll('.theme-button').forEach(btn => btn.classList.remove('active'));
      target.classList.add('active');

      // Save theme
      try {
        await invoke('save_config', {
          config: {
            theme,
            animation: true,
            compact: false,
            max_concurrent_downloads: 3,
          }
        });
      } catch (error) {
        console.error('Failed to save theme:', error);
      }
    });
  });

  // Compact toggle
  const compactToggle = container.querySelector('#compact-toggle');
  compactToggle?.addEventListener('click', async () => {
    const toggleLabel = compactToggle.querySelector('.toggle-label');
    if (toggleLabel) {
      const isCompact = toggleLabel.textContent === '開啟';
      toggleLabel.textContent = isCompact ? '關閉' : '開啟';
      compactToggle.classList.toggle('active');
    }
  });
}
