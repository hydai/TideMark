import type { Record, Folder, PlaybackInfo, Platform, StorageData, ContentMessage } from '../types';
import { MAX_RECORDS, DEFAULT_TOPIC, UNCATEGORIZED_ID, UNCATEGORIZED_NAME } from '../types';

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

// State
let currentPlaybackInfo: PlaybackInfo | null = null;
let currentPlatform: Platform = 'unknown';
let retryCount = 0;
const MAX_RETRIES = 3;
let selectedFolderId: string = UNCATEGORIZED_ID;
let folders: Folder[] = [];
let draggedFolderElement: HTMLElement | null = null;

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

  // Load existing folders and records
  await loadFolders();
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

  // Folder add button click
  folderAddButton.addEventListener('click', handleCreateFolder);

  // Enter key in folder input
  folderInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleCreateFolder();
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
      const data = result as Partial<StorageData>;
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
      const data = result as Partial<StorageData>;
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
    name: UNCATEGORIZED_NAME,
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
    div.addEventListener('dragover', handleFolderDragOver);
    div.addEventListener('drop', handleFolderDrop);
    div.addEventListener('dragend', handleFolderDragEnd);
    div.addEventListener('dragleave', handleFolderDragLeave);
  }

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
    showError('操作失敗');
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
      const folders = data.folders || [];

      folders.push(folder);

      chrome.storage.local.set({ folders }, () => {
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
        showError('操作失敗');
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
      const folders = data.folders || [];

      const folder = folders.find(f => f.id === folderId);
      if (folder) {
        folder.name = newName;
      }

      chrome.storage.local.set({ folders }, () => {
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
  if (!confirm('確定要刪除此資料夾嗎？資料夾內的記錄將移至「未分類」')) {
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
    showError('操作失敗');
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
      const folders = (data.folders || []).filter(f => f.id !== folderId);
      const records = data.records || [];

      // Move all records in this folder to uncategorized
      records.forEach(record => {
        if (record.folderId === folderId) {
          record.folderId = null;
        }
      });

      chrome.storage.local.set({ folders, records }, () => {
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

  // Don't allow dropping on uncategorized
  if (target.classList.contains('uncategorized')) {
    return;
  }

  // Don't allow dropping on self
  if (target === draggedFolderElement) {
    return;
  }

  target.classList.add('drag-over');
}

/**
 * Handle folder drag leave
 */
function handleFolderDragLeave(event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  target.classList.remove('drag-over');
}

/**
 * Handle folder drop
 */
function handleFolderDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();

  const target = event.currentTarget as HTMLElement;
  target.classList.remove('drag-over');

  // Don't allow dropping on uncategorized
  if (target.classList.contains('uncategorized')) {
    return;
  }

  // Don't allow dropping on self
  if (target === draggedFolderElement || !draggedFolderElement) {
    return;
  }

  // Reorder folders
  const draggedId = draggedFolderElement.dataset.id;
  const targetId = target.dataset.id;

  if (draggedId && targetId) {
    reorderFolders(draggedId, targetId);
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
  });
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
    showError('操作失敗');
    console.error('Reorder folders error:', error);
  }
}

/**
 * Save folders order to storage
 */
async function saveFoldersOrder(folders: Folder[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ folders }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// Initialize on load
init();
