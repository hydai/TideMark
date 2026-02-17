import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ConfigManager, AppConfig } from '../config';
import { setLanguage, t, resolveLocalizedMessage } from '../i18n';
import { createTemplateEditor, type TemplateEditorInstance } from '../components/template-editor';
import { PREVIEW_SAMPLE_VARS, validateTemplate } from '../filename-template';

/** Module-scoped template editor instance (destroyed on re-render). */
let settingsTemplateEditor: TemplateEditorInstance | null = null;

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
  // Destroy any existing template editor before re-rendering
  if (settingsTemplateEditor) {
    settingsTemplateEditor.destroy();
    settingsTemplateEditor = null;
  }

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

  // Filename template section
  const filenameTemplateSection = createFilenameTemplateSection();
  page.appendChild(filenameTemplateSection);

  // Appearance settings section
  const appearanceSection = createAppearanceSection();
  page.appendChild(appearanceSection);

  // Records settings section
  const recordsSection = createRecordsSection();
  page.appendChild(recordsSection);

  // ASR API Keys section
  const asrSection = createAsrApiKeysSection();
  page.appendChild(asrSection);

  // Scheduled downloads settings section
  const scheduledSection = createScheduledDownloadsSection();
  page.appendChild(scheduledSection);

  // Channel bookmarks settings section
  const channelBookmarksSection = createChannelBookmarksSection();
  page.appendChild(channelBookmarksSection);

  // GPU acceleration section
  const gpuSection = createGpuSection();
  page.appendChild(gpuSection);

  // Platform authentication section
  const authSection = createAuthSection();
  page.appendChild(authSection);

  // About section
  const aboutSection = createAboutSection();
  page.appendChild(aboutSection);

  container.appendChild(page);

  // Attach event listeners
  attachGeneralEventListeners(container);
  attachDownloadEventListeners(container);
  attachFilenameTemplateEventListeners(container);
  attachAppearanceEventListeners(container);
  attachRecordsEventListeners(container);
  attachAsrApiKeysEventListeners(container);
  attachScheduledDownloadsEventListeners(container);
  attachChannelBookmarksEventListeners(container);
  attachGpuEventListeners(container);
  attachAuthEventListeners(container);
  attachAboutEventListeners(container);
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

  // Language — use locale codes as values, display names as labels
  const languageGroup = createDropdownGroupWithValues(
    'language',
    '語言',
    '介面語言',
    currentConfig?.language || 'zh-TW',
    [
      { value: 'zh-TW', label: '繁體中文' },
      { value: 'en', label: 'English' },
      { value: 'ja', label: '日本語' },
    ]
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

function createFilenameTemplateSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = t('settings.filenameTemplate.title');
  section.appendChild(sectionTitle);

  const description = document.createElement('p');
  description.className = 'setting-description';
  description.textContent = t('settings.filenameTemplate.description');
  section.appendChild(description);

  // Container for the template editor component
  const editorContainer = document.createElement('div');
  editorContainer.id = 'settings-template-editor-container';
  section.appendChild(editorContainer);

  // Validation error message
  const errorMsg = document.createElement('p');
  errorMsg.id = 'settings-template-error';
  errorMsg.className = 'form-error';
  errorMsg.style.display = 'none';
  section.appendChild(errorMsg);

  // Warning message (static-only template)
  const warnMsg = document.createElement('p');
  warnMsg.id = 'settings-template-warning';
  warnMsg.className = 'template-static-warning';
  warnMsg.style.display = 'none';
  warnMsg.textContent = t('settings.filenameTemplate.staticWarning');
  section.appendChild(warnMsg);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.id = 'settings-template-save-btn';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = t('settings.filenameTemplate.save');
  section.appendChild(saveBtn);

  return section;
}

function attachFilenameTemplateEventListeners(container: HTMLElement) {
  const editorContainer = container.querySelector('#settings-template-editor-container') as HTMLElement;
  const errorMsg = container.querySelector('#settings-template-error') as HTMLElement;
  const warnMsg = container.querySelector('#settings-template-warning') as HTMLElement;
  const saveBtn = container.querySelector('#settings-template-save-btn') as HTMLButtonElement;

  if (!editorContainer) return;

  const initialTemplate = currentConfig?.default_filename_template || '[{type}] [{channel_name}] [{date}] {title}';

  // Create the visual template editor
  settingsTemplateEditor = createTemplateEditor({
    container: editorContainer,
    initialTemplate,
    outputDir: currentConfig?.default_download_folder || '~/Tidemark/Downloads',
    extension: 'mp4',
    previewVars: PREVIEW_SAMPLE_VARS,
    deferredVars: [],
    onChange: (template) => {
      // Hide errors on change
      errorMsg.style.display = 'none';
      // Show static-only warning if template has no variables
      const hasVar = /\{[^}]+\}/.test(template);
      if (template.trim() && !hasVar) {
        warnMsg.style.display = 'block';
      } else {
        warnMsg.style.display = 'none';
      }
    },
  });

  saveBtn.addEventListener('click', async () => {
    const template = settingsTemplateEditor?.getValue() ?? '';

    // Validate: empty template (E10.5a)
    if (!template.trim()) {
      errorMsg.textContent = t('settings.filenameTemplate.emptyError');
      errorMsg.style.display = 'block';
      return;
    }

    // Validate recognized variables
    try {
      await validateTemplate(template);
    } catch (err) {
      errorMsg.textContent = resolveLocalizedMessage(String(err));
      errorMsg.style.display = 'block';
      return;
    }

    errorMsg.style.display = 'none';

    // Static-only template warning (E10.5b)
    const hasVar = /\{[^}]+\}/.test(template);
    if (!hasVar) {
      warnMsg.style.display = 'block';
    } else {
      warnMsg.style.display = 'none';
    }

    await ConfigManager.update({ default_filename_template: template });

    saveBtn.textContent = t('settings.filenameTemplate.saved');
    setTimeout(() => {
      saveBtn.textContent = t('settings.filenameTemplate.save');
    }, 2000);
  });
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

function createAsrApiKeysSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = 'ASR API Keys (BYOK)';
  section.appendChild(sectionTitle);

  const description = document.createElement('p');
  description.className = 'setting-description';
  description.textContent = '用於雲端 ASR 轉錄服務。API Key 將安全儲存於本機。';
  section.appendChild(description);

  // OpenAI API Key
  const openaiGroup = createApiKeyGroup('openai', 'OpenAI API Key', 'OpenAI Whisper API');
  section.appendChild(openaiGroup);

  // Groq API Key
  const groqGroup = createApiKeyGroup('groq', 'Groq API Key', 'Groq Whisper API (極快速度)');
  section.appendChild(groqGroup);

  // ElevenLabs API Key
  const elevenlabsGroup = createApiKeyGroup('elevenlabs', 'ElevenLabs API Key', 'ElevenLabs Scribe API');
  section.appendChild(elevenlabsGroup);

  return section;
}

function createApiKeyGroup(provider: string, label: string, description: string): HTMLElement {
  const group = document.createElement('div');
  group.className = 'setting-group api-key-group';

  const groupTitle = document.createElement('h3');
  groupTitle.className = 'setting-group-title';
  groupTitle.textContent = label;
  group.appendChild(groupTitle);

  const desc = document.createElement('p');
  desc.className = 'setting-description';
  desc.textContent = description;
  group.appendChild(desc);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'auth-input-group';

  const input = document.createElement('input');
  input.type = 'password';
  input.id = `${provider}-api-key-input`;
  input.className = 'auth-input';
  input.placeholder = '請輸入 API Key';
  inputGroup.appendChild(input);

  const toggleVisibilityBtn = document.createElement('button');
  toggleVisibilityBtn.id = `${provider}-toggle-visibility-btn`;
  toggleVisibilityBtn.className = 'btn btn-secondary';
  toggleVisibilityBtn.textContent = '顯示';
  inputGroup.appendChild(toggleVisibilityBtn);

  const testBtn = document.createElement('button');
  testBtn.id = `${provider}-test-btn`;
  testBtn.className = 'btn btn-primary';
  testBtn.textContent = '測試連線';
  inputGroup.appendChild(testBtn);

  const saveBtn = document.createElement('button');
  saveBtn.id = `${provider}-save-btn`;
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '儲存';
  inputGroup.appendChild(saveBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.id = `${provider}-delete-btn`;
  deleteBtn.className = 'btn btn-secondary';
  deleteBtn.textContent = '移除';
  inputGroup.appendChild(deleteBtn);

  group.appendChild(inputGroup);

  const statusDiv = document.createElement('div');
  statusDiv.id = `${provider}-status`;
  statusDiv.className = 'auth-status';

  const statusSpan = document.createElement('span');
  statusSpan.className = 'status-unverified';
  statusSpan.textContent = '載入中...';
  statusDiv.appendChild(statusSpan);

  group.appendChild(statusDiv);

  return group;
}

function createScheduledDownloadsSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '排程下載設定';
  section.appendChild(sectionTitle);

  // Enable scheduled downloads
  const enableGroup = createToggleGroup(
    'enable-scheduled-downloads',
    '啟用排程下載',
    '啟用後側邊欄將顯示「排程下載」頁籤',
    currentConfig?.enable_scheduled_downloads || false
  );
  section.appendChild(enableGroup);

  // Close behavior
  const closeBehaviorGroup = createDropdownGroupWithValues(
    'close-behavior',
    '關閉行為',
    '關閉視窗時的行為',
    currentConfig?.close_behavior || 'minimize_to_tray',
    [
      { value: 'minimize_to_tray', label: '最小化至系統列' },
      { value: 'quit', label: '完全關閉' },
    ]
  );
  section.appendChild(closeBehaviorGroup);

  // YouTube polling interval
  const pollingGroup = createNumberInputGroup(
    'youtube-polling-interval',
    'YouTube 輪詢間隔 (秒)',
    '定期檢查頻道是否開播的間隔，範圍 30–300 秒',
    currentConfig?.youtube_polling_interval ?? 90,
    30,
    300
  );
  section.appendChild(pollingGroup);

  // Trigger cooldown
  const cooldownGroup = createNumberInputGroup(
    'trigger-cooldown',
    '觸發冷卻期 (秒)',
    '同一頻道觸發下載後的冷卻等待時間',
    currentConfig?.trigger_cooldown ?? 300,
    0,
    86400
  );
  section.appendChild(cooldownGroup);

  // Scheduled download notification
  const notificationGroup = createDropdownGroupWithValues(
    'scheduled-download-notification',
    '排程下載通知',
    '排程下載開始時的通知方式',
    currentConfig?.scheduled_download_notification || 'both',
    [
      { value: 'os', label: 'OS 通知' },
      { value: 'toast', label: '應用程式內 Toast' },
      { value: 'both', label: '兩者' },
      { value: 'none', label: '關閉' },
    ]
  );
  section.appendChild(notificationGroup);

  // Notification permission hint (shown asynchronously after render)
  const notifHint = document.createElement('p');
  notifHint.id = 'notification-permission-hint';
  notifHint.className = 'setting-hint';
  notifHint.style.display = 'none';
  section.appendChild(notifHint);
  // Check OS notification permission and surface hint if denied.
  invoke<string>('check_notification_permission').then((state) => {
    if (state === 'denied') {
      notifHint.textContent = '系統通知權限已被拒絕。請在系統設定中允許 Tidemark 發送通知，否則僅 Toast 通知有效。';
      notifHint.style.display = 'block';
    }
  }).catch(() => {
    // Permission check failed; silently ignore.
  });

  // Scheduled download auto transcribe
  const autoTranscribeGroup = createToggleGroup(
    'scheduled-download-auto-transcribe',
    '排程下載自動轉錄',
    '排程下載完成後自動執行字幕轉錄',
    currentConfig?.scheduled_download_auto_transcribe || false
  );
  section.appendChild(autoTranscribeGroup);

  // Auto start monitoring
  const autoStartGroup = createToggleGroup(
    'auto-start-monitoring',
    '開機自動啟動監聽',
    '應用程式啟動時自動開始監聽排程',
    currentConfig?.auto_start_monitoring !== false
  );
  section.appendChild(autoStartGroup);

  return section;
}

function createChannelBookmarksSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '頻道書籤設定';
  section.appendChild(sectionTitle);

  // Enable channel bookmarks
  const enableGroup = createToggleGroup(
    'enable-channel-bookmarks',
    '啟用頻道書籤',
    '啟用後側邊欄將顯示「頻道書籤」頁籤',
    currentConfig?.enable_channel_bookmarks || false
  );
  section.appendChild(enableGroup);

  // Metadata refresh interval
  const metadataRefreshGroup = createNumberInputGroup(
    'metadata-refresh-interval-hours',
    '元資料自動刷新間隔（小時）',
    '自動刷新頻道元資料的間隔，範圍 1–168 小時',
    currentConfig?.metadata_refresh_interval_hours ?? 24,
    1,
    168
  );
  section.appendChild(metadataRefreshGroup);

  // Video cache count
  const videoCacheGroup = createNumberInputGroup(
    'video-cache-count',
    '影片快取數量',
    '每個頻道快取的最新影片數量，範圍 1–20',
    currentConfig?.video_cache_count ?? 5,
    1,
    20
  );
  section.appendChild(videoCacheGroup);

  return section;
}

function createGpuSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = 'GPU 加速設定';
  section.appendChild(sectionTitle);

  // Enable hardware encoding
  const hardwareEncodingGroup = createToggleGroup(
    'enable-hardware-encoding',
    '下載硬體編碼',
    '啟用 GPU 硬體編碼加速下載',
    currentConfig?.enable_hardware_encoding || false
  );
  section.appendChild(hardwareEncodingGroup);

  // Hardware encoder selection
  const encoderGroup = document.createElement('div');
  encoderGroup.className = 'setting-item';
  encoderGroup.id = 'hardware-encoder-group';

  const encoderLabelDiv = document.createElement('div');
  encoderLabelDiv.className = 'setting-label-group';

  const encoderLabel = document.createElement('label');
  encoderLabel.className = 'setting-label';
  encoderLabel.textContent = '硬體編碼器';
  encoderLabelDiv.appendChild(encoderLabel);

  const encoderDesc = document.createElement('p');
  encoderDesc.className = 'setting-description-inline';
  encoderDesc.textContent = '選擇硬體編碼器（自動偵測或手動選擇）';
  encoderLabelDiv.appendChild(encoderDesc);

  encoderGroup.appendChild(encoderLabelDiv);

  const encoderSelect = document.createElement('select');
  encoderSelect.id = 'hardware-encoder';
  encoderSelect.className = 'setting-select';

  // Add default "auto" option
  const autoOption = document.createElement('option');
  autoOption.value = 'auto';
  autoOption.textContent = '自動';
  encoderSelect.appendChild(autoOption);

  encoderGroup.appendChild(encoderSelect);
  section.appendChild(encoderGroup);

  // Frontend rendering acceleration
  const frontendAccelGroup = createToggleGroup(
    'enable-frontend-acceleration',
    '前端渲染加速',
    'Tauri WebView 硬體加速（變更後需重啟）',
    currentConfig?.enable_frontend_acceleration !== false
  );
  section.appendChild(frontendAccelGroup);

  // Load available hardware encoders
  invoke<string[]>('get_available_hardware_encoders')
    .then(encoders => {
      // Clear existing options except "auto"
      encoderSelect.innerHTML = '';

      encoders.forEach(encoder => {
        const option = document.createElement('option');
        option.value = encoder;
        if (encoder === 'auto') {
          option.textContent = '自動';
        } else {
          option.textContent = encoder;
        }
        if (encoder === (currentConfig?.hardware_encoder || 'auto')) {
          option.selected = true;
        }
        encoderSelect.appendChild(option);
      });
    })
    .catch(error => {
      console.error('Failed to load hardware encoders:', error);
    });

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

function createAboutSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'settings-section';

  const sectionTitle = document.createElement('h2');
  sectionTitle.className = 'section-title';
  sectionTitle.textContent = '關於 Tidemark';
  section.appendChild(sectionTitle);

  // App version
  const versionGroup = document.createElement('div');
  versionGroup.className = 'setting-group';

  const versionLabel = document.createElement('h3');
  versionLabel.className = 'setting-group-title';
  versionLabel.textContent = '版本資訊';
  versionGroup.appendChild(versionLabel);

  const versionInfo = document.createElement('p');
  versionInfo.className = 'setting-description';
  versionInfo.id = 'app-version-info';
  versionInfo.textContent = '載入中...';
  versionGroup.appendChild(versionInfo);

  const checkUpdateBtn = document.createElement('button');
  checkUpdateBtn.id = 'check-update-btn';
  checkUpdateBtn.className = 'btn btn-primary';
  checkUpdateBtn.textContent = '檢查更新';
  versionGroup.appendChild(checkUpdateBtn);

  const updateStatus = document.createElement('div');
  updateStatus.id = 'update-status';
  updateStatus.className = 'auth-status';
  versionGroup.appendChild(updateStatus);

  section.appendChild(versionGroup);

  // Tool versions
  const toolVersionsGroup = document.createElement('div');
  toolVersionsGroup.className = 'setting-group';

  const toolVersionsLabel = document.createElement('h3');
  toolVersionsLabel.className = 'setting-group-title';
  toolVersionsLabel.textContent = '核心工具版本';
  toolVersionsGroup.appendChild(toolVersionsLabel);

  const toolVersionsInfo = document.createElement('div');
  toolVersionsInfo.id = 'tool-versions-info';
  toolVersionsInfo.className = 'setting-description';
  toolVersionsInfo.textContent = '載入中...';
  toolVersionsGroup.appendChild(toolVersionsInfo);

  section.appendChild(toolVersionsGroup);

  // License information
  const licenseGroup = document.createElement('div');
  licenseGroup.className = 'setting-group';

  const licenseLabel = document.createElement('h3');
  licenseLabel.className = 'setting-group-title';
  licenseLabel.textContent = '開源授權';
  licenseGroup.appendChild(licenseLabel);

  const licenseDesc = document.createElement('p');
  licenseDesc.className = 'setting-description';
  licenseDesc.textContent = 'Tidemark 是開源軟體，遵循 MIT License。';
  licenseGroup.appendChild(licenseDesc);

  const licenseLinkBtn = document.createElement('button');
  licenseLinkBtn.id = 'license-link-btn';
  licenseLinkBtn.className = 'btn btn-secondary';
  licenseLinkBtn.textContent = '查看授權資訊';
  licenseGroup.appendChild(licenseLinkBtn);

  section.appendChild(licenseGroup);

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

function createDropdownGroupWithValues(
  id: string,
  label: string,
  description: string,
  value: string,
  options: { value: string; label: string }[]
): HTMLElement {
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
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    if (option.value === value) {
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

  // Language — call setLanguage() which triggers page re-render (F9.3)
  const languageSelect = container.querySelector('#language') as HTMLSelectElement;
  languageSelect?.addEventListener('change', async () => {
    const locale = languageSelect.value;
    await ConfigManager.update({ language: locale });
    await setLanguage(locale);
    // setLanguage calls the rerenderCallback registered in main.ts,
    // which re-renders the entire app including the settings page.
  });

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

function attachScheduledDownloadsEventListeners(container: HTMLElement) {
  // Enable scheduled downloads
  attachToggleListener(container, 'enable-scheduled-downloads', 'enable_scheduled_downloads');

  // Close behavior
  attachDropdownListener(container, 'close-behavior', 'close_behavior');

  // YouTube polling interval
  attachNumberInputListener(container, 'youtube-polling-interval', 'youtube_polling_interval');

  // Trigger cooldown
  attachNumberInputListener(container, 'trigger-cooldown', 'trigger_cooldown');

  // Scheduled download notification
  attachDropdownListener(container, 'scheduled-download-notification', 'scheduled_download_notification');

  // Scheduled download auto transcribe
  attachToggleListener(container, 'scheduled-download-auto-transcribe', 'scheduled_download_auto_transcribe');

  // Auto start monitoring
  attachToggleListener(container, 'auto-start-monitoring', 'auto_start_monitoring');
}

function attachChannelBookmarksEventListeners(container: HTMLElement) {
  // Enable channel bookmarks
  attachToggleListener(container, 'enable-channel-bookmarks', 'enable_channel_bookmarks');

  // Metadata refresh interval
  attachNumberInputListener(container, 'metadata-refresh-interval-hours', 'metadata_refresh_interval_hours');

  // Video cache count
  attachNumberInputListener(container, 'video-cache-count', 'video_cache_count');
}

function attachGpuEventListeners(container: HTMLElement) {
  // Enable hardware encoding
  attachToggleListener(container, 'enable-hardware-encoding', 'enable_hardware_encoding');

  // Hardware encoder selection
  attachDropdownListener(container, 'hardware-encoder', 'hardware_encoder');

  // Frontend acceleration
  const frontendAccelToggle = container.querySelector('#enable-frontend-acceleration');
  frontendAccelToggle?.addEventListener('click', async () => {
    const toggleLabel = frontendAccelToggle.querySelector('.toggle-label');
    const currentValue = frontendAccelToggle.getAttribute('data-value') === 'true';
    const newValue = !currentValue;

    if (toggleLabel) {
      toggleLabel.textContent = newValue ? '開啟' : '關閉';
    }
    frontendAccelToggle.classList.toggle('active');
    frontendAccelToggle.setAttribute('data-value', newValue ? 'true' : 'false');

    await ConfigManager.update({ enable_frontend_acceleration: newValue });

    // Show restart notice
    if (confirm('前端渲染加速設定變更後需要重啟應用程式才能生效。是否現在重啟？')) {
      // In a real app, we would trigger a restart here
      // For now, just show a message
      alert('請手動重啟應用程式以套用變更。');
    }
  });
}

function attachAsrApiKeysEventListeners(container: HTMLElement) {
  const providers = ['openai', 'groq', 'elevenlabs'];

  providers.forEach(provider => {
    const input = container.querySelector(`#${provider}-api-key-input`) as HTMLInputElement;
    const toggleBtn = container.querySelector(`#${provider}-toggle-visibility-btn`);
    const testBtn = container.querySelector(`#${provider}-test-btn`);
    const saveBtn = container.querySelector(`#${provider}-save-btn`);
    const deleteBtn = container.querySelector(`#${provider}-delete-btn`);
    const statusDiv = container.querySelector(`#${provider}-status`);

    // Load existing API key
    invoke<string | null>('get_api_key', { provider })
      .then(apiKey => {
        if (apiKey) {
          input.value = apiKey;
          updateStatusElement(statusDiv, 'verified', '✓ 已設定');
        } else {
          updateStatusElement(statusDiv, 'unverified', '未設定');
        }
      })
      .catch(error => {
        console.error(`Failed to load ${provider} API key:`, error);
        updateStatusElement(statusDiv, 'error', '載入失敗');
      });

    // Toggle visibility
    toggleBtn?.addEventListener('click', () => {
      if (input.type === 'password') {
        input.type = 'text';
        toggleBtn.textContent = '隱藏';
      } else {
        input.type = 'password';
        toggleBtn.textContent = '顯示';
      }
    });

    // Test connection
    testBtn?.addEventListener('click', async () => {
      const apiKey = input.value.trim();

      if (!apiKey) {
        updateStatusElement(statusDiv, 'error', '請輸入 API Key');
        return;
      }

      updateStatusElement(statusDiv, 'validating', '測試中...');

      try {
        const result = await invoke<{ success: boolean; message: string; quota_info: string | null }>('test_api_key', {
          provider,
          apiKey
        });

        if (result.success) {
          let message = resolveLocalizedMessage(result.message);
          if (result.quota_info) {
            message += ` (${resolveLocalizedMessage(result.quota_info)})`;
          }
          updateStatusElement(statusDiv, 'verified', `✓ ${message}`);
        } else {
          updateStatusElement(statusDiv, 'error', resolveLocalizedMessage(result.message));
        }
      } catch (error) {
        console.error(`${provider} API key test error:`, error);
        updateStatusElement(statusDiv, 'error', '測試失敗，請稍後重試');
      }
    });

    // Save API key
    saveBtn?.addEventListener('click', async () => {
      const apiKey = input.value.trim();

      if (!apiKey) {
        updateStatusElement(statusDiv, 'error', '請輸入 API Key');
        return;
      }

      try {
        await invoke('save_api_key', { provider, apiKey });
        updateStatusElement(statusDiv, 'verified', '✓ 已儲存');
      } catch (error) {
        console.error(`Failed to save ${provider} API key:`, error);
        updateStatusElement(statusDiv, 'error', '儲存失敗');
      }
    });

    // Delete API key
    deleteBtn?.addEventListener('click', async () => {
      if (!confirm(`確定要移除 ${provider.toUpperCase()} API Key 嗎？`)) {
        return;
      }

      try {
        await invoke('delete_api_key', { provider });
        input.value = '';
        updateStatusElement(statusDiv, 'unverified', '已移除');
      } catch (error) {
        console.error(`Failed to delete ${provider} API key:`, error);
        updateStatusElement(statusDiv, 'error', '移除失敗');
      }
    });
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

function attachAboutEventListeners(container: HTMLElement) {
  const versionInfo = container.querySelector('#app-version-info');
  const checkUpdateBtn = container.querySelector('#check-update-btn');
  const updateStatus = container.querySelector('#update-status');
  const toolVersionsInfo = container.querySelector('#tool-versions-info');
  const licenseLinkBtn = container.querySelector('#license-link-btn');

  // Load app version
  invoke<string>('get_app_version')
    .then(version => {
      if (versionInfo) {
        versionInfo.textContent = `版本：${version}`;
      }
    })
    .catch(error => {
      console.error('Failed to get app version:', error);
      if (versionInfo) {
        versionInfo.textContent = '版本：未知';
      }
    });

  // Load tool versions
  invoke<{ yt_dlp_version: string | null; ffmpeg_version: string | null; ffprobe_version: string | null }>('get_tool_versions')
    .then(versions => {
      if (toolVersionsInfo) {
        const lines = [];
        if (versions.yt_dlp_version) {
          lines.push(`yt-dlp: ${versions.yt_dlp_version}`);
        } else {
          lines.push('yt-dlp: 未安裝');
        }
        if (versions.ffmpeg_version) {
          lines.push(`FFmpeg: ${versions.ffmpeg_version}`);
        } else {
          lines.push('FFmpeg: 未安裝');
        }
        if (versions.ffprobe_version) {
          lines.push(`FFprobe: ${versions.ffprobe_version}`);
        }
        toolVersionsInfo.textContent = lines.join('\n');
      }
    })
    .catch(error => {
      console.error('Failed to get tool versions:', error);
      if (toolVersionsInfo) {
        toolVersionsInfo.textContent = '無法取得工具版本資訊';
      }
    });

  // Check for updates
  checkUpdateBtn?.addEventListener('click', async () => {
    updateStatusElement(updateStatus, 'validating', '檢查中...');

    try {
      const result = await invoke<{
        has_update: boolean;
        current_version: string;
        latest_version: string | null;
        release_notes: string | null;
        download_url: string | null;
      }>('check_for_updates');

      if (result.has_update && result.latest_version) {
        let message = `有新版本可用：${result.latest_version}`;
        updateStatusElement(updateStatus, 'verified', message);

        if (result.download_url && confirm(`${message}\n\n是否前往下載頁面？`)) {
          await invoke('open_url', { url: result.download_url });
        }
      } else {
        updateStatusElement(updateStatus, 'verified', '✓ 目前已是最新版本');
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      updateStatusElement(updateStatus, 'error', '檢查更新失敗');
    }
  });

  // License link
  licenseLinkBtn?.addEventListener('click', async () => {
    // Open GitHub repository license page
    const licenseUrl = 'https://github.com/tidemark/tidemark/blob/main/LICENSE';
    try {
      await invoke('open_url', { url: licenseUrl });
    } catch (error) {
      console.error('Failed to open license URL:', error);
      alert('無法開啟授權資訊頁面');
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
