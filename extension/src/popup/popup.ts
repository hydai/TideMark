import type { Record, PlaybackInfo, Platform, StorageData, ContentMessage } from '../types';
import { MAX_RECORDS, DEFAULT_TOPIC } from '../types';

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

// State
let currentPlaybackInfo: PlaybackInfo | null = null;
let currentPlatform: Platform = 'unknown';
let retryCount = 0;
const MAX_RETRIES = 3;

/**
 * Initialize popup
 */
async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    showError('無法取得當前頁面資訊');
    return;
  }

  // Detect platform from URL
  currentPlatform = detectPlatform(tab.url || '');

  if (currentPlatform === 'unknown') {
    showError('請在 YouTube 或 Twitch 頁面使用');
    recordButton.disabled = true;
    return;
  }

  // Apply platform theme
  applyPlatformTheme(currentPlatform);

  // Get playback info from content script
  await getPlaybackInfo(tab.id);

  // Load existing records
  await loadRecords();

  // Set up event listeners
  setupEventListeners();
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
    platformIndicator.textContent = 'YouTube';
  } else if (platform === 'twitch') {
    platformIndicator.textContent = 'Twitch';
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
        showError(response.error || '無法取得播放時間,請確認影片已載入');
        recordButton.disabled = true;
      }
    }
  } catch (error) {
    if (retry < MAX_RETRIES) {
      retryCount = retry + 1;
      setTimeout(() => getPlaybackInfo(tabId, retryCount), 1000);
    } else {
      showError('請重新整理頁面');
      recordButton.disabled = true;
    }
  }
}

/**
 * Show video information
 */
function showVideoInfo(info: PlaybackInfo) {
  videoTitle.textContent = info.title || '';
  videoTime.textContent = `當前時間: ${info.liveTime || ''}`;
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
}

/**
 * Handle record creation
 */
async function handleRecord() {
  if (!currentPlaybackInfo || !currentPlaybackInfo.success) {
    return;
  }

  const topic = topicInput.value.trim() || DEFAULT_TOPIC;

  // Create record object
  const record: Record = {
    id: `record-${Date.now()}`,
    timestamp: new Date().toISOString(),
    liveTime: currentPlaybackInfo.liveTime!,
    title: currentPlaybackInfo.title!,
    topic,
    folderId: null, // Uncategorized for now
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
    recordButton.textContent = '✓ 已記錄';
    setTimeout(() => {
      recordButton.textContent = '記錄當前時間';
    }, 1500);
  } catch (error) {
    showError('儲存失敗,請稍後重試');
    console.error('Save record error:', error);
  }
}

/**
 * Save record to Chrome Storage
 */
async function saveRecord(record: Record): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['records'], (result) => {
      const data = result as StorageData;
      let records = data.records || [];

      // Add new record at the beginning
      records.unshift(record);

      // Enforce 500 record limit
      if (records.length > MAX_RECORDS) {
        records = records.slice(0, MAX_RECORDS);
      }

      // Save back to storage
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
 * Load records from Chrome Storage
 */
async function loadRecords(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['records'], (result) => {
      const data = result as StorageData;
      const records = data.records || [];

      renderRecords(records);
      resolve();
    });
  });
}

/**
 * Render records list using safe DOM methods
 */
function renderRecords(records: Record[]) {
  // Clear existing content
  recordsList.textContent = '';

  if (records.length === 0) {
    noRecords.classList.remove('hidden');
    recordCount.textContent = '';
    return;
  }

  noRecords.classList.add('hidden');
  recordCount.textContent = `共 ${records.length} 筆`;

  // Create record items using DOM methods
  records.forEach(record => {
    const recordItem = createRecordElement(record);
    recordsList.appendChild(recordItem);
  });
}

/**
 * Create a record element using safe DOM methods
 */
function createRecordElement(record: Record): HTMLElement {
  const div = document.createElement('div');
  div.className = 'record-item';
  div.dataset.id = record.id;

  // Header
  const header = document.createElement('div');
  header.className = 'record-header';

  const topic = document.createElement('div');
  topic.className = 'record-topic';
  topic.textContent = record.topic;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'record-delete';
  deleteBtn.textContent = '×';
  deleteBtn.dataset.id = record.id;
  deleteBtn.addEventListener('click', handleDelete);

  header.appendChild(topic);
  header.appendChild(deleteBtn);

  // Info section
  const info = document.createElement('div');
  info.className = 'record-info';

  // Time
  const timeLabel = document.createElement('span');
  timeLabel.className = 'record-label';
  timeLabel.textContent = '時間:';

  const timeValue = document.createElement('span');
  timeValue.className = 'record-value record-time';
  timeValue.textContent = record.liveTime;

  // Title
  const titleLabel = document.createElement('span');
  titleLabel.className = 'record-label';
  titleLabel.textContent = '標題:';

  const titleValue = document.createElement('span');
  titleValue.className = 'record-value';
  titleValue.textContent = record.title;

  // Created timestamp
  const createdLabel = document.createElement('span');
  createdLabel.className = 'record-label';
  createdLabel.textContent = '建立:';

  const createdValue = document.createElement('span');
  createdValue.className = 'record-value';
  createdValue.textContent = formatTimestamp(record.timestamp);

  // Platform
  const platformLabel = document.createElement('span');
  platformLabel.className = 'record-label';
  platformLabel.textContent = '平台:';

  const platformValue = document.createElement('span');
  platformValue.className = `record-platform ${record.platform}`;
  platformValue.textContent = record.platform;

  info.appendChild(timeLabel);
  info.appendChild(timeValue);
  info.appendChild(titleLabel);
  info.appendChild(titleValue);
  info.appendChild(createdLabel);
  info.appendChild(createdValue);
  info.appendChild(platformLabel);
  info.appendChild(platformValue);

  // Link
  const link = document.createElement('a');
  link.href = record.channelUrl;
  link.target = '_blank';
  link.className = 'record-link';
  link.textContent = '前往 VOD →';

  div.appendChild(header);
  div.appendChild(info);
  div.appendChild(link);

  return div;
}

/**
 * Handle record deletion
 */
async function handleDelete(event: Event) {
  const button = event.target as HTMLButtonElement;
  const recordId = button.dataset.id;

  if (!recordId) return;

  // Confirm deletion
  if (!confirm('確定要刪除這筆記錄嗎?')) {
    return;
  }

  try {
    await deleteRecord(recordId);
    await loadRecords();
  } catch (error) {
    showError('刪除失敗,請稍後重試');
    console.error('Delete record error:', error);
  }
}

/**
 * Delete record from Chrome Storage
 */
async function deleteRecord(recordId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['records'], (result) => {
      const data = result as StorageData;
      const records = (data.records || []).filter(r => r.id !== recordId);

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
 * Format ISO timestamp to readable string
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return '剛剛';
  if (diffMins < 60) return `${diffMins} 分鐘前`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小時前`;

  return date.toLocaleDateString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Initialize on load
init();
