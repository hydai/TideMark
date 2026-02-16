import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ConfigManager, AppConfig } from '../config';

interface AuthConfig {
  twitch_token: string | null;
  youtube_cookies_path: string | null;
}

let currentAuthConfig: AuthConfig = {
  twitch_token: null,
  youtube_cookies_path: null,
};

let currentConfig: AppConfig | null = null;

export function renderSettingsPage(container: HTMLElement) {
  // Load both auth config and app config first
  Promise.all([loadAuthConfig(), loadAppConfig()]).then(() => {
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

async function loadAppConfig() {
  currentConfig = ConfigManager.get();
}

function renderSettingsUI(container: HTMLElement) {
  container.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'page settings-page';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '設定';
  page.appendChild(title);

  // General settings section
  const generalSection = createGeneralSection();
  page.appendChild(generalSection);

  // Download settings section
  const downloadSection = createDownloadSection();
  page.appendChild(downloadSection);

  // Appearance settings section
  const appearanceSection = createAppearanceSection();
  page.appendChild(appearanceSection);

  // Records settings section
  const recordsSection = createRecordsSection();
  page.appendChild(recordsSection);

  // Platform authentication section
  const authSection = createAuthSection();
  page.appendChild(authSection);

  container.appendChild(page);

  // Attach event listeners
  attachGeneralEventListeners(container);
  attachDownloadEventListeners(container);
  attachAppearanceEventListeners(container);
  attachRecordsEventListeners(container);
  attachAuthEventListeners(container);
}

function createGeneralSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '一般設定';
  section.appendChild(sectionTitle);

  // Default download folder
  const downloadFolderGroup = createFolderPickerGroup(
    'default-download-folder',
    '預設下載資料夾',
    '下載檔案的預設輸出路徑',
    currentConfig?.default_download_folder || '~/Tidemark/Downloads'
  );
  section.appendChild(downloadFolderGroup);

  // Default subtitle output folder
  const subtitleFolderGroup = createFolderPickerGroup(
    'default-subtitle-folder',
    '預設字幕輸出資料夾',
    '轉錄字幕的預設輸出路徑',
    currentConfig?.default_subtitle_folder || '~/Tidemark/Downloads'
  );
  section.appendChild(subtitleFolderGroup);

  // Launch on startup
  const launchGroup = createToggleGroup(
    'launch-on-startup',
    '開機自啟動',
    '系統啟動時自動執行',
    currentConfig?.launch_on_startup || false
  );
  section.appendChild(launchGroup);

  // Desktop notifications
  const notificationsGroup = createToggleGroup(
    'desktop-notifications',
    '桌面通知',
    '下載/轉錄完成時發送系統通知',
    currentConfig?.desktop_notifications !== false
  );
  section.appendChild(notificationsGroup);

  // Language
  const languageGroup = createDropdownGroup(
    'language',
    '語言',
    '介面語言',
    currentConfig?.language || '繁體中文',
    ['繁體中文', 'English', '日本語']
  );
  section.appendChild(languageGroup);

  // Timezone
  const timezoneGroup = createDropdownGroup(
    'timezone',
    '時區',
    '顯示時間的時區',
    currentConfig?.timezone || 'System',
    ['System', 'UTC', 'Asia/Taipei', 'America/New_York', 'Europe/London']
  );
  section.appendChild(timezoneGroup);

  return section;
}

function createDownloadSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '下載設定';
  section.appendChild(sectionTitle);

  // Enable transcoder
  const transcoderGroup = createToggleGroup(
    'enable-transcoder',
    '啟用轉碼器',
    '下載後是否進行轉碼',
    currentConfig?.enable_transcoder || false
  );
  section.appendChild(transcoderGroup);

  // Default video quality
  const qualityGroup = createDropdownGroup(
    'default-video-quality',
    '預設影片品質',
    '預設選擇的畫質',
    currentConfig?.default_video_quality || 'Highest',
    ['Highest', '1080p', '720p', '480p', '360p']
  );
  section.appendChild(qualityGroup);

  // Output container
  const containerGroup = createDropdownGroup(
    'output-container',
    '輸出容器',
    '預設輸出格式',
    currentConfig?.output_container || 'Auto',
    ['Auto', 'MP4', 'MKV']
  );
  section.appendChild(containerGroup);

  // Max concurrent downloads
  const concurrentGroup = createNumberInputGroup(
    'max-concurrent-downloads',
    '最大同時下載數量',
    '並行下載任務數',
    currentConfig?.max_concurrent_downloads || 3,
    1,
    10
  );
  section.appendChild(concurrentGroup);

  // Auto retry
  const retryGroup = createToggleGroup(
    'auto-retry',
    '自動重試',
    '下載失敗時是否自動重試',
    currentConfig?.auto_retry !== false
  );
  section.appendChild(retryGroup);

  // Max retry count
  const retryCountGroup = createNumberInputGroup(
    'max-retry-count',
    '最大重試次數',
    '自動重試次數上限',
    currentConfig?.max_retry_count || 3,
    1,
    10
  );
  section.appendChild(retryCountGroup);

  // Download speed limit
  const speedLimitGroup = createNumberInputGroup(
    'download-speed-limit',
    '下載速度限制 (MB/s)',
    '0 = 不限',
    currentConfig?.download_speed_limit || 0,
    0,
    1000
  );
  section.appendChild(speedLimitGroup);

  // Show codec options
  const codecGroup = createToggleGroup(
    'show-codec-options',
    '顯示編解碼器選項',
    '下載頁面是否顯示進階編解碼器欄位',
    currentConfig?.show_codec_options || false
  );
  section.appendChild(codecGroup);

  return section;
}

function createAppearanceSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '外觀設定';
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

  const currentTheme = currentConfig?.theme || 'system';

  const darkBtn = document.createElement('button');
  darkBtn.className = 'theme-button';
  darkBtn.dataset.theme = 'dark';
  darkBtn.textContent = '深色';
  if (currentTheme === 'dark') darkBtn.classList.add('active');
  buttonGroup.appendChild(darkBtn);

  const lightBtn = document.createElement('button');
  lightBtn.className = 'theme-button';
  lightBtn.dataset.theme = 'light';
  lightBtn.textContent = '淺色';
  if (currentTheme === 'light') lightBtn.classList.add('active');
  buttonGroup.appendChild(lightBtn);

  const systemBtn = document.createElement('button');
  systemBtn.className = 'theme-button';
  systemBtn.dataset.theme = 'system';
  systemBtn.textContent = '跟隨系統';
  if (currentTheme === 'system') systemBtn.classList.add('active');
  buttonGroup.appendChild(systemBtn);

  themeItem.appendChild(buttonGroup);
  section.appendChild(themeItem);

  // Animation effects
  const animationGroup = createToggleGroup(
    'animation-effects',
    '動畫效果',
    '開啟/關閉 UI 動畫',
    currentConfig?.animation !== false
  );
  section.appendChild(animationGroup);

  // Compact mode
  const compactGroup = createToggleGroup(
    'compact-mode',
    '緊湊模式',
    '減少 UI 間距',
    currentConfig?.compact || false
  );
  section.appendChild(compactGroup);

  return section;
}

function createRecordsSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = 'Records 設定';
  section.appendChild(sectionTitle);

  // Show "All Records" folder
  const allRecordsGroup = createToggleGroup(
    'show-all-records',
    '顯示「所有紀錄」Folder',
    '是否顯示合併所有 Folder 的虛擬 Folder',
    currentConfig?.show_all_records_folder !== false
  );
  section.appendChild(allRecordsGroup);

  // Show "Uncategorized" folder
  const uncategorizedGroup = createToggleGroup(
    'show-uncategorized',
    '顯示「未分類」Folder',
    '是否顯示未分類 Folder',
    currentConfig?.show_uncategorized_folder !== false
  );
  section.appendChild(uncategorizedGroup);

  // Download clip before offset
  const beforeOffsetGroup = createNumberInputGroup(
    'clip-before-offset',
    '下載片段前偏移秒數',
    'Record → Download 時，開始時間往前偏移',
    currentConfig?.download_clip_before_offset || 10,
    0,
    300
  );
  section.appendChild(beforeOffsetGroup);

  // Download clip after offset
  const afterOffsetGroup = createNumberInputGroup(
    'clip-after-offset',
    '下載片段後偏移秒數',
    'Record → Download 時，結束時間往後偏移',
    currentConfig?.download_clip_after_offset || 10,
    0,
    300
  );
  section.appendChild(afterOffsetGroup);

  return section;
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

// Helper functions to create setting groups
function createFolderPickerGroup(id: string, label: string, description: string, value: string): HTMLElement {
  const group = document.createElement('div');
  group.className = 'setting-group';

  const groupTitle = document.createElement('h3');
  groupTitle.className = 'setting-group-title';
  groupTitle.textContent = label;
  group.appendChild(groupTitle);

  const desc = document.createElement('p');
  desc.className = 'setting-description';
  desc.textContent = description;
  group.appendChild(desc);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'folder-input-group';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = `${id}-input`;
  input.className = 'folder-input';
  input.value = value;
  input.readOnly = true;
  inputGroup.appendChild(input);

  const browseBtn = document.createElement('button');
  browseBtn.id = `${id}-btn`;
  browseBtn.className = 'btn btn-primary';
  browseBtn.textContent = '瀏覽...';
  inputGroup.appendChild(browseBtn);

  group.appendChild(inputGroup);

  return group;
}

function createToggleGroup(id: string, label: string, description: string, value: boolean): HTMLElement {
  const group = document.createElement('div');
  group.className = 'setting-item';

  const labelDiv = document.createElement('div');
  labelDiv.className = 'setting-label-group';

  const labelElement = document.createElement('label');
  labelElement.className = 'setting-label';
  labelElement.textContent = label;
  labelDiv.appendChild(labelElement);

  const desc = document.createElement('p');
  desc.className = 'setting-description-inline';
  desc.textContent = description;
  labelDiv.appendChild(desc);

  group.appendChild(labelDiv);

  const toggleButton = document.createElement('button');
  toggleButton.id = id;
  toggleButton.className = value ? 'toggle-button active' : 'toggle-button';
  toggleButton.dataset.value = value ? 'true' : 'false';

  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'toggle-label';
  toggleLabel.textContent = value ? '開啟' : '關閉';
  toggleButton.appendChild(toggleLabel);

  group.appendChild(toggleButton);

  return group;
}

function createDropdownGroup(id: string, label: string, description: string, value: string, options: string[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'setting-item';

  const labelDiv = document.createElement('div');
  labelDiv.className = 'setting-label-group';

  const labelElement = document.createElement('label');
  labelElement.className = 'setting-label';
  labelElement.textContent = label;
  labelDiv.appendChild(labelElement);

  const desc = document.createElement('p');
  desc.className = 'setting-description-inline';
  desc.textContent = description;
  labelDiv.appendChild(desc);

  group.appendChild(labelDiv);

  const select = document.createElement('select');
  select.id = id;
  select.className = 'setting-select';

  options.forEach(option => {
    const optionElement = document.createElement('option');
    optionElement.value = option;
    optionElement.textContent = option;
    if (option === value) {
      optionElement.selected = true;
    }
    select.appendChild(optionElement);
  });

  group.appendChild(select);

  return group;
}

function createNumberInputGroup(id: string, label: string, description: string, value: number, min: number, max: number): HTMLElement {
  const group = document.createElement('div');
  group.className = 'setting-item';

  const labelDiv = document.createElement('div');
  labelDiv.className = 'setting-label-group';

  const labelElement = document.createElement('label');
  labelElement.className = 'setting-label';
  labelElement.textContent = label;
  labelDiv.appendChild(labelElement);

  const desc = document.createElement('p');
  desc.className = 'setting-description-inline';
  desc.textContent = description;
  labelDiv.appendChild(desc);

  group.appendChild(labelDiv);

  const input = document.createElement('input');
  input.type = 'number';
  input.id = id;
  input.className = 'setting-number-input';
  input.value = value.toString();
  input.min = min.toString();
  input.max = max.toString();

  group.appendChild(input);

  return group;
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

// Event listener functions
function attachGeneralEventListeners(container: HTMLElement) {
  // Default download folder
  const downloadFolderBtn = container.querySelector('#default-download-folder-btn');
  const downloadFolderInput = container.querySelector('#default-download-folder-input') as HTMLInputElement;

  downloadFolderBtn?.addEventListener('click', async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    if (selected && typeof selected === 'string') {
      downloadFolderInput.value = selected;
      await ConfigManager.update({ default_download_folder: selected });
    }
  });

  // Default subtitle folder
  const subtitleFolderBtn = container.querySelector('#default-subtitle-folder-btn');
  const subtitleFolderInput = container.querySelector('#default-subtitle-folder-input') as HTMLInputElement;

  subtitleFolderBtn?.addEventListener('click', async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    if (selected && typeof selected === 'string') {
      subtitleFolderInput.value = selected;
      await ConfigManager.update({ default_subtitle_folder: selected });
    }
  });

  // Launch on startup
  attachToggleListener(container, 'launch-on-startup', 'launch_on_startup');

  // Desktop notifications
  attachToggleListener(container, 'desktop-notifications', 'desktop_notifications');

  // Language
  attachDropdownListener(container, 'language', 'language');

  // Timezone
  attachDropdownListener(container, 'timezone', 'timezone');
}

function attachDownloadEventListeners(container: HTMLElement) {
  // Enable transcoder
  attachToggleListener(container, 'enable-transcoder', 'enable_transcoder');

  // Default video quality
  attachDropdownListener(container, 'default-video-quality', 'default_video_quality');

  // Output container
  attachDropdownListener(container, 'output-container', 'output_container');

  // Max concurrent downloads
  attachNumberInputListener(container, 'max-concurrent-downloads', 'max_concurrent_downloads');

  // Auto retry
  attachToggleListener(container, 'auto-retry', 'auto_retry');

  // Max retry count
  attachNumberInputListener(container, 'max-retry-count', 'max_retry_count');

  // Download speed limit
  attachNumberInputListener(container, 'download-speed-limit', 'download_speed_limit');

  // Show codec options
  attachToggleListener(container, 'show-codec-options', 'show_codec_options');
}

function attachAppearanceEventListeners(container: HTMLElement) {
  // Theme buttons
  container.querySelectorAll('.theme-button').forEach((button) => {
    button.addEventListener('click', async (e) => {
      const target = e.currentTarget as HTMLElement;
      const theme = target.dataset.theme as 'dark' | 'light' | 'system';

      // Update active state
      container.querySelectorAll('.theme-button').forEach(btn => btn.classList.remove('active'));
      target.classList.add('active');

      // Save theme
      await ConfigManager.update({ theme });
    });
  });

  // Animation effects
  attachToggleListener(container, 'animation-effects', 'animation');

  // Compact mode
  attachToggleListener(container, 'compact-mode', 'compact');
}

function attachRecordsEventListeners(container: HTMLElement) {
  // Show all records folder
  attachToggleListener(container, 'show-all-records', 'show_all_records_folder');

  // Show uncategorized folder
  attachToggleListener(container, 'show-uncategorized', 'show_uncategorized_folder');

  // Clip before offset
  attachNumberInputListener(container, 'clip-before-offset', 'download_clip_before_offset');

  // Clip after offset
  attachNumberInputListener(container, 'clip-after-offset', 'download_clip_after_offset');
}

function attachToggleListener(container: HTMLElement, elementId: string, configKey: keyof AppConfig) {
  const toggle = container.querySelector(`#${elementId}`);
  toggle?.addEventListener('click', async () => {
    const toggleLabel = toggle.querySelector('.toggle-label');
    const currentValue = toggle.getAttribute('data-value') === 'true';
    const newValue = !currentValue;

    if (toggleLabel) {
      toggleLabel.textContent = newValue ? '開啟' : '關閉';
    }
    toggle.classList.toggle('active');
    toggle.setAttribute('data-value', newValue ? 'true' : 'false');

    await ConfigManager.update({ [configKey]: newValue });
  });
}

function attachDropdownListener(container: HTMLElement, elementId: string, configKey: keyof AppConfig) {
  const select = container.querySelector(`#${elementId}`) as HTMLSelectElement;
  select?.addEventListener('change', async () => {
    await ConfigManager.update({ [configKey]: select.value });
  });
}

function attachNumberInputListener(container: HTMLElement, elementId: string, configKey: keyof AppConfig) {
  const input = container.querySelector(`#${elementId}`) as HTMLInputElement;
  input?.addEventListener('change', async () => {
    const value = parseInt(input.value, 10);
    if (!isNaN(value)) {
      await ConfigManager.update({ [configKey]: value });
    }
  });
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
