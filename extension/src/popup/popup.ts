import type { Record as TidemarkRecord, Folder, PlaybackInfo, Platform, StorageData, ContentMessage, RecordGroup, ExportData, SyncUser, SyncStatus } from '../types';
import { MAX_RECORDS, UNCATEGORIZED_ID, EXPORT_VERSION } from '../types';
import {
  loginWithGoogle,
  logout,
  isLoggedIn,
  getCurrentUser,
  getSyncStatus,
  pushRecord,
  pushFolder,
  deleteRecordRemote,
  deleteFolderRemote,
  initSyncState,
  pullRemoteChanges,
  startSyncPolling,
  updateSyncState,
} from '../sync';
import { initI18n, t, setLanguage, getCurrentLanguage, setRerenderCallback, SUPPORTED_LOCALES, type SupportedLocale } from '../i18n';

// DOM elements
const errorMessage = document.getElementById('error-message') as HTMLDivElement;
const videoInfo = document.getElementById('video-info') as HTMLDivElement;
const videoTitle = document.getElementById('video-title') as HTMLDivElement;
const videoTime = document.getElementById('video-time') as HTMLDivElement;
const topicInput = document.getElementById('topic-input') as HTMLInputElement;
const recordButton = document.getElementById('record-button') as HTMLButtonElement;
const recordsList = document.getElementById('records-list') as HTMLDivElement;
const noRecords = document.getElementById('no-records') as HTMLDivElement;
const recordCount = document.getElementById('record-count') as HTMLDivElement;
const header = document.getElementById('header') as HTMLDivElement;
const platformIndicator = document.getElementById('platform-indicator') as HTMLDivElement;
const foldersList = document.getElementById('folders-list') as HTMLDivElement;
const folderInput = document.getElementById('folder-input') as HTMLInputElement;
const folderAddButton = document.getElementById('folder-add-button') as HTMLButtonElement;

// Settings elements
const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;
const settingsContent = document.getElementById('settings-content') as HTMLDivElement;
const exportButton = document.getElementById('export-button') as HTMLButtonElement;
const importButton = document.getElementById('import-button') as HTMLButtonElement;
const importFileInput = document.getElementById('import-file-input') as HTMLInputElement;
const importModal = document.getElementById('import-modal') as HTMLDivElement;
const importStats = document.getElementById('import-stats') as HTMLSpanElement;
const importMergeButton = document.getElementById('import-merge-button') as HTMLButtonElement;
const importOverwriteButton = document.getElementById('import-overwrite-button') as HTMLButtonElement;
const importCancelButton = document.getElementById('import-cancel-button') as HTMLButtonElement;

// Sync elements
const loginButton = document.getElementById('login-button') as HTMLButtonElement;
const logoutButton = document.getElementById('logout-button') as HTMLButtonElement;
const syncLoggedOut = document.getElementById('sync-logged-out') as HTMLDivElement;
const syncLoggedIn = document.getElementById('sync-logged-in') as HTMLDivElement;
const userEmail = document.getElementById('user-email') as HTMLSpanElement;
const syncStatusDisplay = document.getElementById('sync-status-display') as HTMLDivElement;
const syncStatusIcon = document.getElementById('sync-status-icon') as HTMLSpanElement;
const syncStatusText = document.getElementById('sync-status-text') as HTMLSpanElement;
const testJwtInput = document.getElementById('test-jwt-input') as HTMLInputElement;
const testJwtButton = document.getElementById('test-jwt-button') as HTMLButtonElement;

// State
let currentPlaybackInfo: PlaybackInfo | null = null;
let currentPlatform: Platform = 'unknown';
let retryCount = 0;
const MAX_RETRIES = 3;
let selectedFolderId: string = UNCATEGORIZED_ID;
let folders: Folder[] = [];
let draggedFolderElement: HTMLElement | null = null;
let draggedRecordElement: HTMLElement | null = null;
let draggedGroupElement: HTMLElement | null = null;
let recordGroups: RecordGroup[] = [];
let groupCollapsedState: Map<string, boolean> = new Map();
let pendingImportData: ExportData | null = null;

// ── i18n helpers ──────────────────────────────────────────────────────────────

/** Get the localised default topic string. */
function defaultTopic(): string {
  return t('records.defaultTopic');
}

/** Get the localised uncategorized folder name. */
function uncategorizedName(): string {
  return t('extension.folders.uncategorized');
}

/**
 * Update all static UI text to the current locale.
 * Called once on init and again on every language switch.
 */
function applyStaticTranslations(): void {
  // Record form
  topicInput.placeholder = t('extension.recordForm.topicPlaceholder');
  recordButton.textContent = t('extension.recordForm.recordButton');

  // Folders header
  const foldersHeaderEl = document.querySelector('#folders-header h2');
  if (foldersHeaderEl) {
    foldersHeaderEl.textContent = t('extension.folders.header');
  }
  folderInput.placeholder = t('extension.folders.inputPlaceholder');
  folderAddButton.title = t('extension.folders.addButtonTitle');

  // Records header
  const recordsHeaderEl = document.querySelector('#records-header h2');
  if (recordsHeaderEl) {
    recordsHeaderEl.textContent = t('extension.records.header');
  }

  // Settings toggle
  settingsToggle.textContent = t('extension.settings.toggle');

  // Settings — sync section
  const syncHeaderEl = document.querySelector('.settings-group:first-child h3');
  if (syncHeaderEl) {
    syncHeaderEl.textContent = t('extension.settings.sync.header');
  }
  loginButton.textContent = t('extension.settings.sync.loginButton');

  const loginDescEl = syncLoggedOut.querySelector('.settings-description');
  if (loginDescEl) {
    loginDescEl.textContent = t('extension.settings.sync.loginDesc');
  }

  logoutButton.textContent = t('extension.settings.sync.logoutButton');

  const devModeSummary = document.querySelector('.test-mode summary');
  if (devModeSummary) {
    devModeSummary.textContent = t('extension.settings.sync.devMode');
  }

  testJwtInput.placeholder = t('extension.settings.sync.jwtPlaceholder');
  testJwtButton.textContent = t('extension.settings.sync.setJwtButton');

  // Settings — data backup section
  const dataBackupHeaderEl = document.querySelector('.settings-group:nth-child(2) h3');
  if (dataBackupHeaderEl) {
    dataBackupHeaderEl.textContent = t('extension.settings.dataBackup.header');
  }

  // Don't overwrite export button if it's in "exporting" state
  if (!exportButton.disabled) {
    exportButton.textContent = t('extension.settings.dataBackup.exportButton');
  }

  const exportDescEl = exportButton.closest('.settings-item')?.querySelector('.settings-description');
  if (exportDescEl) {
    exportDescEl.textContent = t('extension.settings.dataBackup.exportDesc');
  }

  importButton.textContent = t('extension.settings.dataBackup.importButton');

  const importDescEl = importButton.closest('.settings-item')?.querySelector('.settings-description');
  if (importDescEl) {
    importDescEl.textContent = t('extension.settings.dataBackup.importDesc');
  }

  // Import modal static text
  const importModalTitle = importModal.querySelector('h3');
  if (importModalTitle) {
    importModalTitle.textContent = t('extension.importModal.title');
  }
  importMergeButton.textContent = t('extension.importModal.mergeButton');
  importOverwriteButton.textContent = t('extension.importModal.overwriteButton');
  importCancelButton.textContent = t('extension.importModal.cancelButton');

  const mergeHelp = importModal.querySelector('.modal-help p:first-child');
  if (mergeHelp) {
    mergeHelp.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = t('extension.importModal.mergeLabel') + ' ';
    mergeHelp.appendChild(strong);
    mergeHelp.appendChild(document.createTextNode(t('extension.importModal.mergeHelp')));
  }
  const overwriteHelp = importModal.querySelector('.modal-help p:last-child');
  if (overwriteHelp) {
    overwriteHelp.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = t('extension.importModal.overwriteLabel') + ' ';
    overwriteHelp.appendChild(strong);
    overwriteHelp.appendChild(document.createTextNode(t('extension.importModal.overwriteHelp')));
  }

  // No-records empty state
  noRecords.textContent = t('extension.records.empty');

  // Update language selector if it exists
  updateLanguageSelector();

  // Update sync status indicator text (without changing icon)
  const status = syncStatusDisplay.className.replace('settings-item', '').trim();
  if (status) {
    updateSyncStatusText(status as SyncStatus);
  }
}

// ── Language selector ─────────────────────────────────────────────────────────

const LANGUAGE_SELECTOR_ID = 'language-selector';

/** Insert or update the language selector in the settings panel. */
function ensureLanguageSelector(): void {
  if (document.getElementById(LANGUAGE_SELECTOR_ID)) {
    return; // Already created
  }

  // Find the settings content area and append the language group
  const langGroup = document.createElement('div');
  langGroup.className = 'settings-group';
  langGroup.id = 'language-settings-group';

  const langHeader = document.createElement('h3');
  langHeader.id = 'language-settings-header';
  langHeader.textContent = t('extension.settings.language.header');
  langGroup.appendChild(langHeader);

  const langItem = document.createElement('div');
  langItem.className = 'settings-item';

  const langLabel = document.createElement('label');
  langLabel.htmlFor = LANGUAGE_SELECTOR_ID;
  langLabel.className = 'settings-label';
  langLabel.textContent = t('extension.settings.language.label');
  langItem.appendChild(langLabel);

  const select = document.createElement('select');
  select.id = LANGUAGE_SELECTOR_ID;
  select.className = 'language-select';

  const options: Array<{ value: SupportedLocale; label: string }> = [
    { value: 'zh-TW', label: '繁體中文' },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' },
  ];

  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });

  select.value = getCurrentLanguage();

  select.addEventListener('change', async () => {
    const selected = select.value as SupportedLocale;
    if (SUPPORTED_LOCALES.includes(selected)) {
      await setLanguage(selected);
    }
  });

  langItem.appendChild(select);
  langGroup.appendChild(langItem);

  settingsContent.appendChild(langGroup);
}

/** Update the language selector value to match the current locale. */
function updateLanguageSelector(): void {
  const select = document.getElementById(LANGUAGE_SELECTOR_ID) as HTMLSelectElement | null;
  if (select) {
    select.value = getCurrentLanguage();
  }

  // Update header/label text
  const langHeader = document.getElementById('language-settings-header');
  if (langHeader) {
    langHeader.textContent = t('extension.settings.language.header');
  }

  const langLabel = document.querySelector(`label[for="${LANGUAGE_SELECTOR_ID}"]`);
  if (langLabel) {
    langLabel.textContent = t('extension.settings.language.label');
  }
}

// ── App initialization ────────────────────────────────────────────────────────

/**
 * Initialize popup
 */
async function init() {
  // Initialize i18n first (loads language preference from Chrome Storage)
  await initI18n();

  // Register re-render callback for language switches
  setRerenderCallback(onLanguageSwitch);

  // Apply static translations to DOM
  applyStaticTranslations();

  // Create language selector in settings panel
  ensureLanguageSelector();

  // Initialize sync state
  await initSyncState();

  // Update sync UI
  await updateSyncUI();

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    showError(t('errors.cannotGetPageInfo'));
    return;
  }

  // Detect platform from URL
  currentPlatform = detectPlatform(tab.url || '');

  if (currentPlatform === 'unknown') {
    showError(t('errors.e1_1a'));
    recordButton.disabled = true;
    return;
  }

  // Apply platform theme
  applyPlatformTheme(currentPlatform);

  // Get playback info from content script
  await getPlaybackInfo(tab.id);

  // Load existing folders and records
  await loadFolders();
  await loadRecords();

  // Set up event listeners
  setupEventListeners();

  // Start sync polling if logged in
  const loggedIn = await isLoggedIn();
  if (loggedIn) {
    startSyncPolling();
  }

  // Poll sync status every 2 seconds to update UI
  setInterval(updateSyncUI, 2000);
}

/**
 * Called after a language switch — re-applies all translations and re-renders
 * dynamic content (folders, records).
 */
function onLanguageSwitch(): void {
  applyStaticTranslations();

  // Re-render folders (has locale-dependent "Uncategorized" label)
  renderFolders();

  // Re-render records (has locale-dependent labels and counts)
  chrome.storage.local.get(['records'], (result) => {
    const data = result as Partial<StorageData>;
    const records = data.records || [];
    const filtered = records.filter(r => {
      if (selectedFolderId === UNCATEGORIZED_ID) return r.folderId === null;
      return r.folderId === selectedFolderId;
    });
    renderRecords(filtered);
  });

  // Re-render sync status
  const status = syncStatusDisplay.dataset.status as SyncStatus | undefined;
  if (status) {
    updateSyncStatusIndicator(status);
  }
}

/**
 * Detect platform from URL
 */
function detectPlatform(url: string): Platform {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'youtube';
  } else if (url.includes('twitch.tv')) {
    return 'twitch';
  }
  return 'unknown';
}

/**
 * Apply platform-specific theme
 */
function applyPlatformTheme(platform: Platform) {
  document.body.className = platform;
  header.className = platform;

  if (platform === 'youtube') {
    platformIndicator.textContent = t('extension.platform.youtube');
  } else if (platform === 'twitch') {
    platformIndicator.textContent = t('extension.platform.twitch');
  }
}

/**
 * Get playback info from content script
 */
async function getPlaybackInfo(tabId: number, retry = 0) {
  try {
    const message: ContentMessage = { type: 'GET_PLAYBACK_INFO' };

    const response = await chrome.tabs.sendMessage(tabId, message) as PlaybackInfo;

    if (response.success && response.liveTime && response.title) {
      currentPlaybackInfo = response;
      showVideoInfo(response);
      recordButton.disabled = false;
    } else {
      if (retry < MAX_RETRIES) {
        // Retry injection
        retryCount = retry + 1;
        setTimeout(() => getPlaybackInfo(tabId, retryCount), 1000);
      } else {
        showError(response.error || t('errors.e1_1b'));
        recordButton.disabled = true;
      }
    }
  } catch (error) {
    if (retry < MAX_RETRIES) {
      retryCount = retry + 1;
      setTimeout(() => getPlaybackInfo(tabId, retryCount), 1000);
    } else {
      showError(t('errors.e1_1c'));
      recordButton.disabled = true;
    }
  }
}

/**
 * Show video information
 */
function showVideoInfo(info: PlaybackInfo) {
  videoTitle.textContent = info.title || '';
  videoTime.textContent = t('extension.videoInfo.currentTime', { time: info.liveTime || '' });
  videoInfo.classList.remove('hidden');
  errorMessage.classList.add('hidden');
}

/**
 * Show error message
 */
function showError(message: string) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
  videoInfo.classList.add('hidden');
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Record button click
  recordButton.addEventListener('click', handleRecord);

  // Enter key in topic input
  topicInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleRecord();
    }
  });

  // Folder add button click
  folderAddButton.addEventListener('click', handleCreateFolder);

  // Enter key in folder input
  folderInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleCreateFolder();
    }
  });

  // Settings toggle
  settingsToggle.addEventListener('click', toggleSettings);

  // Export button
  exportButton.addEventListener('click', handleExport);

  // Import button (triggers file picker)
  importButton.addEventListener('click', () => {
    importFileInput.click();
  });

  // File input change
  importFileInput.addEventListener('change', handleImportFileSelected);

  // Import modal buttons
  importMergeButton.addEventListener('click', () => handleImportConfirm('merge'));
  importOverwriteButton.addEventListener('click', () => handleImportConfirm('overwrite'));
  importCancelButton.addEventListener('click', closeImportModal);

  // Sync buttons
  loginButton.addEventListener('click', handleLogin);
  logoutButton.addEventListener('click', handleLogout);
  testJwtButton.addEventListener('click', handleTestJwt);
}

/**
 * Handle record creation
 */
async function handleRecord() {
  if (!currentPlaybackInfo || !currentPlaybackInfo.success) {
    return;
  }

  const topic = topicInput.value.trim() || defaultTopic();

  // Create record object
  const record: TidemarkRecord = {
    id: `record-${Date.now()}`,
    timestamp: new Date().toISOString(),
    liveTime: currentPlaybackInfo.liveTime!,
    title: currentPlaybackInfo.title!,
    topic,
    folderId: selectedFolderId === UNCATEGORIZED_ID ? null : selectedFolderId,
    channelUrl: currentPlaybackInfo.channelUrl!,
    platform: currentPlaybackInfo.platform
  };

  // Save to storage
  try {
    await saveRecord(record);

    // Clear input
    topicInput.value = '';

    // Reload records list
    await loadRecords();

    // Visual feedback
    recordButton.textContent = t('extension.recordForm.recorded');
    setTimeout(() => {
      recordButton.textContent = t('extension.recordForm.recordButton');
    }, 1500);
  } catch (error) {
    showError(t('errors.e1_1d'));
    console.error('Save record error:', error);
  }
}

/**
 * Save record to Chrome Storage
 */
async function saveRecord(record: TidemarkRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['records'], (result) => {
      const data = result as Partial<StorageData>;
      let records = data.records || [];

      // Add new record at the beginning
      records.unshift(record);

      // Enforce 500 record limit
      if (records.length > MAX_RECORDS) {
        records = records.slice(0, MAX_RECORDS);
      }

      // Save back to storage
      chrome.storage.local.set({ records }, async () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          // Push to cloud sync if logged in
          await pushRecord(record);
          resolve();
        }
      });
    });
  });
}

/**
 * Load records from Chrome Storage
 */
async function loadRecords(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['records'], (result) => {
      const data = result as Partial<StorageData>;
      const records = data.records || [];

      // Filter records by selected folder
      const filteredRecords = records.filter(r => {
        if (selectedFolderId === UNCATEGORIZED_ID) {
          return r.folderId === null;
        }
        return r.folderId === selectedFolderId;
      });

      renderRecords(filteredRecords);
      resolve();
    });
  });
}

/**
 * Render records list grouped by stream title
 */
function renderRecords(records: TidemarkRecord[]) {
  // Clear existing content
  recordsList.textContent = '';

  if (records.length === 0) {
    noRecords.classList.remove('hidden');
    noRecords.textContent = t('extension.records.empty');
    recordCount.textContent = '';
    return;
  }

  noRecords.classList.add('hidden');
  recordCount.textContent = t('extension.records.count', { count: records.length });

  // Group records by title
  recordGroups = groupRecordsByTitle(records);

  // Render each group
  recordGroups.forEach(group => {
    const groupElement = createGroupElement(group);
    recordsList.appendChild(groupElement);
  });
}

/**
 * Group records by stream title
 */
function groupRecordsByTitle(records: TidemarkRecord[]): RecordGroup[] {
  const groupMap = new Map<string, TidemarkRecord[]>();

  // Group by title
  records.forEach(record => {
    const title = record.title;
    if (!groupMap.has(title)) {
      groupMap.set(title, []);
    }
    groupMap.get(title)!.push(record);
  });

  // Convert to array of groups
  const groups: RecordGroup[] = [];
  groupMap.forEach((recs, title) => {
    // Sort records within group by sortOrder or timestamp
    recs.sort((a, b) => {
      if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
        return a.sortOrder - b.sortOrder;
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    groups.push({
      title,
      records: recs,
      collapsed: groupCollapsedState.get(title) || false,
      sortOrder: recs[0].sortOrder
    });
  });

  // Sort groups by sortOrder or most recent record
  groups.sort((a, b) => {
    if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
      return a.sortOrder - b.sortOrder;
    }
    const aTime = new Date(a.records[0].timestamp).getTime();
    const bTime = new Date(b.records[0].timestamp).getTime();
    return bTime - aTime;
  });

  return groups;
}

/**
 * Create a group element
 */
function createGroupElement(group: RecordGroup): HTMLElement {
  const div = document.createElement('div');
  div.className = 'record-group';
  div.dataset.title = group.title;

  // Group header
  const groupHeader = document.createElement('div');
  groupHeader.className = 'record-group-header';
  groupHeader.draggable = true;

  // Collapse icon
  const collapseIcon = document.createElement('span');
  collapseIcon.className = 'group-collapse-icon';
  collapseIcon.textContent = group.collapsed ? '▶' : '▼';

  // Title
  const titleSpan = document.createElement('span');
  titleSpan.className = 'group-title';
  titleSpan.textContent = group.title;

  // Record count
  const countSpan = document.createElement('span');
  countSpan.className = 'group-count';
  countSpan.textContent = `${group.records.length}`;

  groupHeader.appendChild(collapseIcon);
  groupHeader.appendChild(titleSpan);
  groupHeader.appendChild(countSpan);

  // Click to toggle collapse
  groupHeader.addEventListener('click', () => {
    group.collapsed = !group.collapsed;
    groupCollapsedState.set(group.title, group.collapsed);
    loadRecords();
  });

  // Drag group
  groupHeader.addEventListener('dragstart', handleGroupDragStart);
  groupHeader.addEventListener('dragover', handleGroupDragOver);
  groupHeader.addEventListener('drop', handleGroupDrop);
  groupHeader.addEventListener('dragend', handleGroupDragEnd);
  groupHeader.addEventListener('dragleave', handleGroupDragLeave);

  div.appendChild(groupHeader);

  // Group content (records)
  if (!group.collapsed) {
    const content = document.createElement('div');
    content.className = 'record-group-content';

    group.records.forEach(record => {
      const recordItem = createRecordElement(record, group);
      content.appendChild(recordItem);
    });

    div.appendChild(content);
  }

  return div;
}

/**
 * Create a record element using safe DOM methods
 */
function createRecordElement(record: TidemarkRecord, group: RecordGroup): HTMLElement {
  const div = document.createElement('div');
  div.className = 'record-item';
  div.dataset.id = record.id;
  div.dataset.title = record.title;
  div.draggable = true;

  // Drag and drop for records
  div.addEventListener('dragstart', handleRecordDragStart);
  div.addEventListener('dragover', handleRecordDragOver);
  div.addEventListener('drop', handleRecordDrop);
  div.addEventListener('dragend', handleRecordDragEnd);
  div.addEventListener('dragleave', handleRecordDragLeave);

  // Header
  const recordHeader = document.createElement('div');
  recordHeader.className = 'record-header';

  const topic = document.createElement('div');
  topic.className = 'record-topic';
  topic.textContent = record.topic;

  // Double-click to edit topic
  topic.addEventListener('dblclick', () => handleEditTopic(record.id));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'record-delete';
  deleteBtn.textContent = '×';
  deleteBtn.dataset.id = record.id;
  deleteBtn.addEventListener('click', handleDelete);

  recordHeader.appendChild(topic);
  recordHeader.appendChild(deleteBtn);

  // Info section
  const info = document.createElement('div');
  info.className = 'record-info';

  // Time with copy button
  const timeLabel = document.createElement('span');
  timeLabel.className = 'record-label';
  timeLabel.textContent = t('extension.records.labels.time');

  const timeContainer = document.createElement('span');
  timeContainer.className = 'record-value-container';

  const timeValue = document.createElement('span');
  timeValue.className = 'record-value record-time';
  timeValue.textContent = record.liveTime;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'record-copy-btn';
  copyBtn.textContent = '📋';
  copyBtn.title = t('extension.records.copyTimeTitle');
  copyBtn.addEventListener('click', () => handleCopyTime(record.liveTime, copyBtn));

  timeContainer.appendChild(timeValue);
  timeContainer.appendChild(copyBtn);

  // Created timestamp
  const createdLabel = document.createElement('span');
  createdLabel.className = 'record-label';
  createdLabel.textContent = t('extension.records.labels.created');

  const createdValue = document.createElement('span');
  createdValue.className = 'record-value';
  createdValue.textContent = formatTimestamp(record.timestamp);

  // Platform
  const platformLabel = document.createElement('span');
  platformLabel.className = 'record-label';
  platformLabel.textContent = t('extension.records.labels.platform');

  const platformValue = document.createElement('span');
  platformValue.className = `record-platform ${record.platform}`;
  platformValue.textContent = record.platform;

  info.appendChild(timeLabel);
  info.appendChild(timeContainer);
  info.appendChild(createdLabel);
  info.appendChild(createdValue);
  info.appendChild(platformLabel);
  info.appendChild(platformValue);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'record-actions';

  // Go to VOD link
  const link = document.createElement('a');
  link.href = buildVODUrl(record);
  link.target = '_blank';
  link.className = 'record-link';
  link.textContent = t('extension.records.vodLink');

  actions.appendChild(link);

  div.appendChild(recordHeader);
  div.appendChild(info);
  div.appendChild(actions);

  // Suppress unused variable warning for group parameter
  void group;

  return div;
}

/**
 * Build VOD URL with fallback for Twitch
 */
function buildVODUrl(record: TidemarkRecord): string {
  // E1.3a: If Twitch VOD hasn't been generated, point to channel videos page
  if (record.platform === 'twitch' && record.channelUrl.includes('/videos/')) {
    // Already has VOD URL, use it
    return record.channelUrl;
  } else if (record.platform === 'twitch' && !record.channelUrl.includes('/videos/')) {
    // No VOD yet, extract channel name and point to videos page
    const channelMatch = record.channelUrl.match(/twitch\.tv\/([^/?]+)/);
    if (channelMatch) {
      return `https://www.twitch.tv/${channelMatch[1]}/videos`;
    }
  }

  // YouTube or valid Twitch VOD
  return record.channelUrl;
}

/**
 * Handle record deletion
 */
async function handleDelete(event: Event) {
  const button = event.target as HTMLButtonElement;
  const recordId = button.dataset.id;

  if (!recordId) return;

  // Confirm deletion
  if (!confirm(t('extension.records.deleteConfirm'))) {
    return;
  }

  try {
    await deleteRecord(recordId);
    await loadRecords();
  } catch (error) {
    showError(t('errors.e1_2b'));
    console.error('Delete record error:', error);
  }
}

/**
 * Delete record from Chrome Storage
 */
async function deleteRecord(recordId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['records'], (result) => {
      const data = result as Partial<StorageData>;
      const records = (data.records || []).filter(r => r.id !== recordId);

      chrome.storage.local.set({ records }, async () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          // Delete from cloud sync if logged in
          await deleteRecordRemote(recordId);
          resolve();
        }
      });
    });
  });
}

/**
 * Format ISO timestamp to readable string
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return t('extension.time.justNow');
  if (diffMins < 60) return t('extension.time.minutesAgo', { count: diffMins });
  if (diffMins < 1440) return t('extension.time.hoursAgo', { count: Math.floor(diffMins / 60) });

  return date.toLocaleDateString(currentLocaleForDate(), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Map our locale codes to BCP 47 tags for date formatting. */
function currentLocaleForDate(): string {
  const locale = getCurrentLanguage();
  switch (locale) {
    case 'zh-TW': return 'zh-TW';
    case 'ja': return 'ja-JP';
    case 'en': return 'en-US';
    default: return 'zh-TW';
  }
}

/**
 * Handle edit topic inline
 */
function handleEditTopic(recordId: string) {
  const recordItem = document.querySelector(`.record-item[data-id="${recordId}"]`) as HTMLElement;
  if (!recordItem) return;

  const topicDiv = recordItem.querySelector('.record-topic') as HTMLElement;
  const currentTopic = topicDiv.textContent || '';

  // Create input field
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'record-topic-input';
  input.value = currentTopic;

  // Replace topic div with input
  topicDiv.replaceWith(input);
  input.focus();
  input.select();

  // Handle edit completion
  const completeEdit = async () => {
    const newTopic = input.value.trim() || defaultTopic();

    // Restore topic div
    const newTopicDiv = document.createElement('div');
    newTopicDiv.className = 'record-topic';
    newTopicDiv.textContent = newTopic;
    newTopicDiv.addEventListener('dblclick', () => handleEditTopic(recordId));
    input.replaceWith(newTopicDiv);

    // Save if topic changed
    if (newTopic !== currentTopic) {
      try {
        await updateRecordTopic(recordId, newTopic);
        await loadRecords();
      } catch (error) {
        showError(t('errors.updateFailed'));
        console.error('Update topic error:', error);
      }
    }
  };

  input.addEventListener('blur', completeEdit);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      completeEdit();
    }
  });
}

/**
 * Update record topic in storage
 */
async function updateRecordTopic(recordId: string, newTopic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['records'], (result) => {
      const data = result as Partial<StorageData>;
      const records = data.records || [];

      const record = records.find(r => r.id === recordId);
      if (record) {
        record.topic = newTopic;
      }

      chrome.storage.local.set({ records }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Handle copy time to clipboard
 */
async function handleCopyTime(liveTime: string, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(liveTime);

    // Visual feedback
    const originalText = button.textContent;
    button.textContent = '✓';
    button.style.color = '#4caf50';

    setTimeout(() => {
      button.textContent = originalText;
      button.style.color = '';
    }, 1500);
  } catch (error) {
    console.error('Copy to clipboard failed:', error);
    showError(t('errors.copyFailed'));
  }
}

// ==================== Record Drag and Drop ====================

/**
 * Handle record drag start
 */
function handleRecordDragStart(event: DragEvent) {
  const target = event.target as HTMLElement;
  draggedRecordElement = target;
  target.classList.add('dragging');

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', target.dataset.id || '');
  }
}

/**
 * Handle record drag over
 */
function handleRecordDragOver(event: DragEvent) {
  event.preventDefault();

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  const target = event.currentTarget as HTMLElement;

  // Don't allow dropping on self
  if (target === draggedRecordElement) {
    return;
  }

  // Only allow dropping within same group
  if (draggedRecordElement && target.dataset.title === draggedRecordElement.dataset.title) {
    target.classList.add('drag-over');
  }
}

/**
 * Handle record drag leave
 */
function handleRecordDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  target.classList.remove('drag-over');
}

/**
 * Handle record drop
 */
function handleRecordDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget as HTMLElement;
  target.classList.remove('drag-over');

  // Don't allow dropping on self
  if (target === draggedRecordElement || !draggedRecordElement) {
    return;
  }

  // Only allow dropping within same group
  if (target.dataset.title !== draggedRecordElement.dataset.title) {
    return;
  }

  // Reorder records
  const draggedId = draggedRecordElement.dataset.id;
  const targetId = target.dataset.id;

  if (draggedId && targetId) {
    reorderRecordsInGroup(draggedId, targetId);
  }
}

/**
 * Handle record drag end
 */
function handleRecordDragEnd(event: DragEvent) {
  const target = event.target as HTMLElement;
  target.classList.remove('dragging');
  draggedRecordElement = null;

  // Clean up all drag-over classes
  document.querySelectorAll('.record-item').forEach(item => {
    item.classList.remove('drag-over');
  });
}

/**
 * Reorder records within the same group
 */
async function reorderRecordsInGroup(draggedId: string, targetId: string) {
  try {
    const result = await chrome.storage.local.get(['records']) as Partial<StorageData>;
    let records = result.records || [];

    const draggedIndex = records.findIndex(r => r.id === draggedId);
    const targetIndex = records.findIndex(r => r.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) {
      return;
    }

    // Only reorder within same title group
    if (records[draggedIndex].title !== records[targetIndex].title) {
      return;
    }

    // Remove dragged record
    const [draggedRecord] = records.splice(draggedIndex, 1);

    // Find new target index after removal
    const newTargetIndex = records.findIndex(r => r.id === targetId);

    // Insert before target
    records.splice(newTargetIndex, 0, draggedRecord);

    // Update sortOrder for all records in the group
    const title = draggedRecord.title;
    const groupRecords = records.filter(r => r.title === title);
    groupRecords.forEach((record, index) => {
      record.sortOrder = index;
    });

    await chrome.storage.local.set({ records });
    await loadRecords();
  } catch (error) {
    showError(t('errors.e1_2b'));
    console.error('Reorder records error:', error);
  }
}

// ==================== Group Drag and Drop ====================

/**
 * Handle group drag start
 */
function handleGroupDragStart(event: DragEvent) {
  const target = event.target as HTMLElement;
  const groupElement = target.closest('.record-group') as HTMLElement;
  draggedGroupElement = groupElement;
  groupElement.classList.add('dragging');

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', groupElement.dataset.title || '');
  }
}

/**
 * Handle group drag over
 */
function handleGroupDragOver(event: DragEvent) {
  event.preventDefault();

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  const target = event.currentTarget as HTMLElement;
  const groupElement = target.closest('.record-group') as HTMLElement;

  // Don't allow dropping on self
  if (groupElement === draggedGroupElement) {
    return;
  }

  groupElement.classList.add('drag-over');
}

/**
 * Handle group drag leave
 */
function handleGroupDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  const groupElement = target.closest('.record-group') as HTMLElement;
  groupElement.classList.remove('drag-over');
}

/**
 * Handle group drop
 */
function handleGroupDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget as HTMLElement;
  const groupElement = target.closest('.record-group') as HTMLElement;
  groupElement.classList.remove('drag-over');

  // Don't allow dropping on self
  if (groupElement === draggedGroupElement || !draggedGroupElement) {
    return;
  }

  // Reorder groups
  const draggedTitle = draggedGroupElement.dataset.title;
  const targetTitle = groupElement.dataset.title;

  if (draggedTitle && targetTitle) {
    reorderGroups(draggedTitle, targetTitle);
  }
}

/**
 * Handle group drag end
 */
function handleGroupDragEnd(event: DragEvent) {
  if (draggedGroupElement) {
    draggedGroupElement.classList.remove('dragging');
  }
  draggedGroupElement = null;

  // Clean up all drag-over classes
  document.querySelectorAll('.record-group').forEach(item => {
    item.classList.remove('drag-over');
  });
}

/**
 * Reorder groups
 */
async function reorderGroups(draggedTitle: string, targetTitle: string) {
  const draggedIndex = recordGroups.findIndex(g => g.title === draggedTitle);
  const targetIndex = recordGroups.findIndex(g => g.title === targetTitle);

  if (draggedIndex === -1 || targetIndex === -1) {
    return;
  }

  // Remove dragged group
  const [draggedGroup] = recordGroups.splice(draggedIndex, 1);

  // Insert before target
  recordGroups.splice(targetIndex, 0, draggedGroup);

  // Update sortOrder for all groups
  recordGroups.forEach((group, index) => {
    group.sortOrder = index;
    group.records.forEach(record => {
      record.sortOrder = index;
    });
  });

  try {
    // Save updated records with new sortOrder
    const result = await chrome.storage.local.get(['records']) as Partial<StorageData>;
    const records = result.records || [];

    // Update sortOrder for each record based on group order
    recordGroups.forEach((group, groupIndex) => {
      group.records.forEach(record => {
        const foundRecord = records.find(r => r.id === record.id);
        if (foundRecord) {
          foundRecord.sortOrder = groupIndex;
        }
      });
    });

    await chrome.storage.local.set({ records });
    await loadRecords();
  } catch (error) {
    showError(t('errors.e1_2b'));
    console.error('Reorder groups error:', error);
  }
}

// ==================== Drag Record to Folder ====================

// Add drop zone for folders - we need to modify folder elements to accept record drops
// This will be handled by modifying the folder drag handlers

// ==================== Folder Management ====================

/**
 * Load folders from Chrome Storage
 */
async function loadFolders(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['folders'], (result) => {
      const data = result as Partial<StorageData>;
      folders = data.folders || [];
      renderFolders();
      resolve();
    });
  });
}

/**
 * Render folders list
 */
function renderFolders() {
  foldersList.textContent = '';

  // Always show "Uncategorized" first
  const uncategorizedItem = createFolderElement({
    id: UNCATEGORIZED_ID,
    name: uncategorizedName(),
    created: new Date().toISOString()
  }, true);
  foldersList.appendChild(uncategorizedItem);

  // Render user-created folders
  folders.forEach(folder => {
    const folderItem = createFolderElement(folder, false);
    foldersList.appendChild(folderItem);
  });
}

/**
 * Create a folder element
 */
function createFolderElement(folder: Folder, isUncategorized: boolean): HTMLElement {
  const div = document.createElement('div');
  div.className = 'folder-item';
  div.dataset.id = folder.id;

  if (isUncategorized) {
    div.classList.add('uncategorized');
  }

  if (folder.id === selectedFolderId) {
    div.classList.add('active');
  }

  // Make draggable (except uncategorized)
  if (!isUncategorized) {
    div.draggable = true;
    div.addEventListener('dragstart', handleFolderDragStart);
  }

  // Always accept drops (for both folder reordering and record moving)
  div.addEventListener('dragover', handleFolderDragOver);
  div.addEventListener('drop', handleFolderDrop);
  div.addEventListener('dragend', handleFolderDragEnd);
  div.addEventListener('dragleave', handleFolderDragLeave);

  // Folder name
  const nameSpan = document.createElement('span');
  nameSpan.className = 'folder-name';
  nameSpan.textContent = folder.name;

  // Double-click to rename (except uncategorized)
  if (!isUncategorized) {
    nameSpan.addEventListener('dblclick', () => handleRenameFolder(folder.id));
  }

  // Click to select folder
  div.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).classList.contains('folder-delete')) {
      return;
    }
    selectFolder(folder.id);
  });

  div.appendChild(nameSpan);

  // Delete button (except uncategorized)
  if (!isUncategorized) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'folder-delete';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteFolder(folder.id);
    });
    div.appendChild(deleteBtn);
  }

  return div;
}

/**
 * Select a folder
 */
function selectFolder(folderId: string) {
  selectedFolderId = folderId;
  renderFolders();
  loadRecords();
}

/**
 * Handle create folder
 */
async function handleCreateFolder() {
  const name = folderInput.value.trim();

  // E1.2a: Blank folder name - silently reject
  if (!name) {
    return;
  }

  const folder: Folder = {
    id: `folder-${Date.now()}`,
    name,
    created: new Date().toISOString()
  };

  try {
    await saveFolder(folder);
    folderInput.value = '';
    await loadFolders();
  } catch (error) {
    // E1.2b: Storage write failure
    showError(t('errors.e1_2b'));
    console.error('Save folder error:', error);
  }
}

/**
 * Save folder to Chrome Storage
 */
async function saveFolder(folder: Folder): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['folders'], (result) => {
      const data = result as Partial<StorageData>;
      const storedFolders = data.folders || [];

      // Find index if updating existing folder
      const existingIndex = storedFolders.findIndex(f => f.id === folder.id);
      if (existingIndex !== -1) {
        storedFolders[existingIndex] = folder;
      } else {
        storedFolders.push(folder);
      }

      chrome.storage.local.set({ folders: storedFolders }, async () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          // Push to cloud sync if logged in
          const sortOrder = existingIndex !== -1 ? existingIndex : storedFolders.length - 1;
          await pushFolder(folder, sortOrder);
          resolve();
        }
      });
    });
  });
}

/**
 * Handle rename folder
 */
function handleRenameFolder(folderId: string) {
  const folderItem = document.querySelector(`.folder-item[data-id="${folderId}"]`) as HTMLElement;
  if (!folderItem) return;

  const nameSpan = folderItem.querySelector('.folder-name') as HTMLElement;
  const currentName = nameSpan.textContent || '';

  // Create input field
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-name-input';
  input.value = currentName;

  // Replace name span with input
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  // Handle rename completion
  const completeRename = async () => {
    const newName = input.value.trim();

    // Restore name span
    const newNameSpan = document.createElement('span');
    newNameSpan.className = 'folder-name';
    newNameSpan.textContent = newName || currentName;
    newNameSpan.addEventListener('dblclick', () => handleRenameFolder(folderId));
    input.replaceWith(newNameSpan);

    // Save if name changed and not blank
    if (newName && newName !== currentName) {
      try {
        await updateFolderName(folderId, newName);
        await loadFolders();
      } catch (error) {
        showError(t('errors.e1_2b'));
        console.error('Rename folder error:', error);
      }
    }
  };

  input.addEventListener('blur', completeRename);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      completeRename();
    }
  });
}

/**
 * Update folder name in storage
 */
async function updateFolderName(folderId: string, newName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['folders'], (result) => {
      const data = result as Partial<StorageData>;
      const storedFolders = data.folders || [];

      const folder = storedFolders.find(f => f.id === folderId);
      if (folder) {
        folder.name = newName;
      }

      chrome.storage.local.set({ folders: storedFolders }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Handle delete folder
 */
async function handleDeleteFolder(folderId: string) {
  // Confirmation dialog
  if (!confirm(t('extension.folders.deleteConfirm'))) {
    return;
  }

  try {
    await deleteFolder(folderId);

    // If deleted folder was selected, switch to uncategorized
    if (selectedFolderId === folderId) {
      selectedFolderId = UNCATEGORIZED_ID;
    }

    await loadFolders();
    await loadRecords();
  } catch (error) {
    showError(t('errors.e1_2b'));
    console.error('Delete folder error:', error);
  }
}

/**
 * Delete folder from storage and move records to uncategorized
 */
async function deleteFolder(folderId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['folders', 'records'], (result) => {
      const data = result as Partial<StorageData>;
      const storedFolders = (data.folders || []).filter(f => f.id !== folderId);
      const records = data.records || [];

      // Move all records in this folder to uncategorized
      records.forEach(record => {
        if (record.folderId === folderId) {
          record.folderId = null;
        }
      });

      chrome.storage.local.set({ folders: storedFolders, records }, async () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          // Delete from cloud sync if logged in
          await deleteFolderRemote(folderId);
          resolve();
        }
      });
    });
  });
}

/**
 * Handle folder drag start
 */
function handleFolderDragStart(event: DragEvent) {
  const target = event.target as HTMLElement;
  draggedFolderElement = target;
  target.classList.add('dragging');

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', target.dataset.id || '');
  }
}

/**
 * Handle folder drag over
 */
function handleFolderDragOver(event: DragEvent) {
  event.preventDefault();

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  const target = event.currentTarget as HTMLElement;

  // If dragging a record, allow drop on any folder
  if (draggedRecordElement) {
    target.classList.add('drag-over-record');
    return;
  }

  // If dragging a folder, don't allow dropping on uncategorized or self
  if (draggedFolderElement) {
    if (target.classList.contains('uncategorized') || target === draggedFolderElement) {
      return;
    }
    target.classList.add('drag-over');
  }
}

/**
 * Handle folder drag leave
 */
function handleFolderDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  target.classList.remove('drag-over');
  target.classList.remove('drag-over-record');
}

/**
 * Handle folder drop
 */
function handleFolderDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget as HTMLElement;
  target.classList.remove('drag-over');
  target.classList.remove('drag-over-record');

  // If dropping a record onto a folder, move the record
  if (draggedRecordElement) {
    const recordId = draggedRecordElement.dataset.id;
    const targetFolderId = target.dataset.id;

    if (recordId && targetFolderId) {
      moveRecordToFolder(recordId, targetFolderId);
    }
    return;
  }

  // If dropping a folder, reorder folders
  if (draggedFolderElement) {
    // Don't allow dropping on uncategorized
    if (target.classList.contains('uncategorized')) {
      return;
    }

    // Don't allow dropping on self
    if (target === draggedFolderElement) {
      return;
    }

    const draggedId = draggedFolderElement.dataset.id;
    const targetId = target.dataset.id;

    if (draggedId && targetId) {
      reorderFolders(draggedId, targetId);
    }
  }
}

/**
 * Handle folder drag end
 */
function handleFolderDragEnd(event: DragEvent) {
  const target = event.target as HTMLElement;
  target.classList.remove('dragging');
  draggedFolderElement = null;

  // Clean up all drag-over classes
  document.querySelectorAll('.folder-item').forEach(item => {
    item.classList.remove('drag-over');
    item.classList.remove('drag-over-record');
  });
}

/**
 * Move record to a different folder
 */
async function moveRecordToFolder(recordId: string, targetFolderId: string): Promise<void> {
  try {
    const result = await chrome.storage.local.get(['records']) as Partial<StorageData>;
    const records = result.records || [];

    const record = records.find(r => r.id === recordId);
    if (record) {
      // Update folderId (null for uncategorized)
      record.folderId = targetFolderId === UNCATEGORIZED_ID ? null : targetFolderId;
    }

    await chrome.storage.local.set({ records });

    // If moving from current folder, refresh the view
    await loadRecords();
  } catch (error) {
    showError(t('errors.e1_2b'));
    console.error('Move record error:', error);
  }
}

/**
 * Reorder folders array
 */
async function reorderFolders(draggedId: string, targetId: string) {
  const draggedIndex = folders.findIndex(f => f.id === draggedId);
  const targetIndex = folders.findIndex(f => f.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return;
  }

  // Remove dragged folder
  const [draggedFolder] = folders.splice(draggedIndex, 1);

  // Insert before target
  folders.splice(targetIndex, 0, draggedFolder);

  try {
    await saveFoldersOrder(folders);
    await loadFolders();
  } catch (error) {
    showError(t('errors.e1_2b'));
    console.error('Reorder folders error:', error);
  }
}

/**
 * Save folders order to storage
 */
async function saveFoldersOrder(orderedFolders: Folder[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ folders: orderedFolders }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * ========================================
 * Import/Export Functions
 * ========================================
 */

/**
 * Toggle settings panel
 */
function toggleSettings() {
  settingsContent.classList.toggle('hidden');
}

/**
 * Handle export data
 */
async function handleExport() {
  try {
    // Disable button during export
    exportButton.disabled = true;
    exportButton.textContent = t('extension.settings.dataBackup.exportingButton');

    // Get all data from storage
    const data = await getAllData();

    // Create export object
    const exportData: ExportData = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      records: data.records,
      folders: data.folders
    };

    // Convert to JSON
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create download link
    const filename = `tidemark-export-${new Date().toISOString().split('T')[0]}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Show success message
    showSuccess(t('success.exported', {
      records: exportData.records.length,
      folders: exportData.folders.length
    }));

  } catch (error) {
    console.error('Export error:', error);
    showError(t('errors.exportFailed'));
  } finally {
    // Re-enable button
    exportButton.disabled = false;
    exportButton.textContent = t('extension.settings.dataBackup.exportButton');
  }
}

/**
 * Handle import file selected
 */
async function handleImportFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  try {
    // Read file content
    const text = await file.text();

    // Parse JSON
    let importData: ExportData;
    try {
      importData = JSON.parse(text);
    } catch (e) {
      // E1.4a: Invalid JSON file
      showError(t('errors.e1_4a'));
      input.value = ''; // Reset input
      return;
    }

    // Validate data structure
    if (!validateImportData(importData)) {
      // E1.4b: Incompatible data structure
      showError(t('errors.e1_4b'));
      input.value = ''; // Reset input
      return;
    }

    // Store import data and show modal
    pendingImportData = importData;
    showImportModal(importData);

  } catch (error) {
    console.error('Import file read error:', error);
    showError(t('errors.e1_5'));
  }

  // Reset file input
  input.value = '';
}

/**
 * Validate import data structure
 */
function validateImportData(data: unknown): data is ExportData {
  // Check required fields
  if (!data || typeof data !== 'object') {
    return false;
  }

  const obj = data as Record<string, unknown>;

  if (!obj['version'] || typeof obj['version'] !== 'string') {
    return false;
  }

  if (!obj['exportedAt'] || typeof obj['exportedAt'] !== 'string') {
    return false;
  }

  if (!Array.isArray(obj['records'])) {
    return false;
  }

  if (!Array.isArray(obj['folders'])) {
    return false;
  }

  // Validate each record has required fields
  for (const record of obj['records'] as unknown[]) {
    const r = record as Record<string, unknown>;
    if (!r['id'] || !r['timestamp'] || !r['liveTime'] ||
        !r['title'] || !r['topic'] || !r['channelUrl'] || !r['platform']) {
      return false;
    }
  }

  // Validate each folder has required fields
  for (const folder of obj['folders'] as unknown[]) {
    const f = folder as Record<string, unknown>;
    if (!f['id'] || !f['name'] || !f['created']) {
      return false;
    }
  }

  return true;
}

/**
 * Show import modal with data stats
 */
function showImportModal(data: ExportData) {
  const statsText = t('records.exportStats', {
    records: data.records.length,
    folders: data.folders.length
  });
  importStats.textContent = statsText;

  const modalDesc = importModal.querySelector('.modal-description');
  if (modalDesc) {
    modalDesc.textContent = '';
    modalDesc.appendChild(document.createTextNode(t('extension.importModal.foundData', { stats: '' })));
    const statsSpan = document.createElement('span');
    statsSpan.id = 'import-stats';
    statsSpan.textContent = statsText;
    modalDesc.appendChild(statsSpan);
  }

  importModal.classList.remove('hidden');
}

/**
 * Close import modal
 */
function closeImportModal() {
  importModal.classList.add('hidden');
  pendingImportData = null;
}

/**
 * Handle import confirmation
 */
async function handleImportConfirm(mode: 'merge' | 'overwrite') {
  if (!pendingImportData) {
    return;
  }

  try {
    // Disable buttons during import
    importMergeButton.disabled = true;
    importOverwriteButton.disabled = true;
    importCancelButton.disabled = true;

    if (mode === 'overwrite') {
      // Overwrite: Replace all data
      await chrome.storage.local.set({
        records: pendingImportData.records,
        folders: pendingImportData.folders
      });

      showSuccess(t('records.importSuccess.overwrite', {
        records: pendingImportData.records.length,
        folders: pendingImportData.folders.length
      }));

    } else {
      // Merge: Add to existing data, skip duplicates by ID
      const currentData = await getAllData();

      // Create ID sets for deduplication
      const existingRecordIds = new Set(currentData.records.map(r => r.id));
      const existingFolderIds = new Set(currentData.folders.map(f => f.id));

      // Filter out duplicates
      const newRecords = pendingImportData.records.filter(r => !existingRecordIds.has(r.id));
      const newFolders = pendingImportData.folders.filter(f => !existingFolderIds.has(f.id));

      // Merge with existing data
      const mergedRecords = [...currentData.records, ...newRecords];
      const mergedFolders = [...currentData.folders, ...newFolders];

      // Apply MAX_RECORDS limit
      const finalRecords = mergedRecords.slice(0, MAX_RECORDS);

      await chrome.storage.local.set({
        records: finalRecords,
        folders: mergedFolders
      });

      showSuccess(t('records.importSuccess.merge', {
        records: newRecords.length,
        folders: newFolders.length
      }));
    }

    // Close modal
    closeImportModal();

    // Reload data
    await loadFolders();
    await loadRecords();

  } catch (error) {
    console.error('Import error:', error);
    showError(t('errors.importFailed'));
  } finally {
    // Re-enable buttons
    importMergeButton.disabled = false;
    importOverwriteButton.disabled = false;
    importCancelButton.disabled = false;
  }
}

/**
 * Get all data from storage
 */
async function getAllData(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['records', 'folders'], (result) => {
      const data = result as Partial<StorageData>;
      resolve({
        records: data.records || [],
        folders: data.folders || []
      });
    });
  });
}

/**
 * Show success message
 */
function showSuccess(message: string) {
  errorMessage.textContent = message;
  errorMessage.className = 'error success';
  errorMessage.style.display = 'block';

  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 3000);
}

/**
 * Update sync UI based on current state
 */
async function updateSyncUI() {
  const loggedIn = await isLoggedIn();
  const user = await getCurrentUser();
  const status = await getSyncStatus();

  if (loggedIn && user) {
    // Show logged in UI
    syncLoggedOut.classList.add('hidden');
    syncLoggedIn.classList.remove('hidden');

    // Update "logged in as" prefix
    const loggedInDesc = syncLoggedIn.querySelector('.settings-description');
    if (loggedInDesc) {
      // Set prefix text node (first text child before <strong>)
      const firstChild = loggedInDesc.firstChild;
      if (firstChild && firstChild.nodeType === Node.TEXT_NODE) {
        firstChild.textContent = t('extension.settings.sync.loggedInAs') + ' ';
      } else {
        loggedInDesc.insertBefore(
          document.createTextNode(t('extension.settings.sync.loggedInAs') + ' '),
          loggedInDesc.firstChild
        );
      }
    }
    userEmail.textContent = user.email;
  } else {
    // Show logged out UI
    syncLoggedOut.classList.remove('hidden');
    syncLoggedIn.classList.add('hidden');
  }

  // Update status indicator
  updateSyncStatusIndicator(status);
}

/** Update sync status text string without changing icon. */
function updateSyncStatusText(status: SyncStatus): void {
  switch (status) {
    case 'offline':
      syncStatusText.textContent = t('extension.settings.sync.notLoggedIn');
      break;
    case 'synced':
      syncStatusText.textContent = t('extension.settings.sync.synced');
      break;
    case 'syncing':
      syncStatusText.textContent = t('extension.settings.sync.syncing');
      break;
    case 'error':
      syncStatusText.textContent = t('extension.settings.sync.error');
      break;
  }
}

/**
 * Update sync status indicator
 */
function updateSyncStatusIndicator(status: SyncStatus) {
  // Remove all status classes
  syncStatusDisplay.classList.remove('offline', 'synced', 'syncing', 'error');

  // Add current status class and store for re-render
  syncStatusDisplay.classList.add(status);
  syncStatusDisplay.dataset.status = status;

  // Update icon and text
  switch (status) {
    case 'offline':
      syncStatusIcon.textContent = '⚪';
      syncStatusText.textContent = t('extension.settings.sync.notLoggedIn');
      break;
    case 'synced':
      syncStatusIcon.textContent = '🟢';
      syncStatusText.textContent = t('extension.settings.sync.synced');
      break;
    case 'syncing':
      syncStatusIcon.textContent = '🔵';
      syncStatusText.textContent = t('extension.settings.sync.syncing');
      break;
    case 'error':
      syncStatusIcon.textContent = '🔴';
      syncStatusText.textContent = t('extension.settings.sync.error');
      break;
  }
}

/**
 * Handle login button click
 */
async function handleLogin() {
  try {
    loginButton.disabled = true;
    loginButton.textContent = t('extension.settings.sync.loggingIn');

    const result = await loginWithGoogle();

    if (result.success) {
      showSuccess(t('success.loggedIn'));
      await updateSyncUI();
      // Pull initial data
      await pullRemoteChanges();
      // Reload UI
      await loadFolders();
      await loadRecords();
    } else {
      showError(result.error || t('errors.loginFailed'));
    }
  } catch (error) {
    console.error('Login error:', error);
    showError(t('errors.e1_6a'));
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = t('extension.settings.sync.loginButton');
  }
}

/**
 * Handle logout button click
 */
async function handleLogout() {
  try {
    logoutButton.disabled = true;
    await logout();
    showSuccess(t('success.loggedOut'));
    await updateSyncUI();
  } catch (error) {
    console.error('Logout error:', error);
    showError(t('errors.logoutFailed'));
  } finally {
    logoutButton.disabled = false;
  }
}

/**
 * Handle test JWT input (for development only)
 */
async function handleTestJwt() {
  const jwt = testJwtInput.value.trim();
  if (!jwt) {
    showError(t('errors.enterJwt'));
    return;
  }

  try {
    // Decode JWT to extract user info
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    const user: SyncUser = {
      id: payload.sub,
      email: payload.email,
    };

    // Update sync state
    await updateSyncState({
      jwt,
      user,
      status: 'synced',
      lastSyncedAt: new Date(0).toISOString(),
    });

    // Start sync polling
    startSyncPolling();

    // Pull initial data
    await pullRemoteChanges();

    showSuccess(t('success.jwtSet'));
    testJwtInput.value = '';
    await updateSyncUI();
    await loadFolders();
    await loadRecords();
  } catch (error) {
    console.error('Test JWT error:', error);
    showError(t('errors.invalidJwt'));
  }
}

// Initialize on load
init();
