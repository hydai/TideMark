import type { Record, Folder, PlaybackInfo, Platform, StorageData, ContentMessage, RecordGroup, ExportData, SyncUser, SyncStatus } from '../types';
import { MAX_RECORDS, DEFAULT_TOPIC, UNCATEGORIZED_ID, UNCATEGORIZED_NAME, EXPORT_VERSION } from '../types';
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

/**
 * Initialize popup
 */
async function init() {
  // Initialize sync state
  await initSyncState();

  // Update sync UI
  await updateSyncUI();

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

  // Start sync polling if logged in
  const loggedIn = await isLoggedIn();
  if (loggedIn) {
    startSyncPolling();
  }

  // Poll sync status every 2 seconds to update UI
  setInterval(updateSyncUI, 2000);
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
function groupRecordsByTitle(records: Record[]): RecordGroup[] {
  const groupMap = new Map<string, Record[]>();

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
  groupMap.forEach((records, title) => {
    // Sort records within group by sortOrder or timestamp
    records.sort((a, b) => {
      if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
        return a.sortOrder - b.sortOrder;
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    groups.push({
      title,
      records,
      collapsed: groupCollapsedState.get(title) || false,
      sortOrder: records[0].sortOrder
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
  const header = document.createElement('div');
  header.className = 'record-group-header';
  header.draggable = true;

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

  header.appendChild(collapseIcon);
  header.appendChild(titleSpan);
  header.appendChild(countSpan);

  // Click to toggle collapse
  header.addEventListener('click', () => {
    group.collapsed = !group.collapsed;
    groupCollapsedState.set(group.title, group.collapsed);
    loadRecords();
  });

  // Drag group
  header.addEventListener('dragstart', handleGroupDragStart);
  header.addEventListener('dragover', handleGroupDragOver);
  header.addEventListener('drop', handleGroupDrop);
  header.addEventListener('dragend', handleGroupDragEnd);
  header.addEventListener('dragleave', handleGroupDragLeave);

  div.appendChild(header);

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
function createRecordElement(record: Record, group: RecordGroup): HTMLElement {
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
  const header = document.createElement('div');
  header.className = 'record-header';

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

  header.appendChild(topic);
  header.appendChild(deleteBtn);

  // Info section
  const info = document.createElement('div');
  info.className = 'record-info';

  // Time with copy button
  const timeLabel = document.createElement('span');
  timeLabel.className = 'record-label';
  timeLabel.textContent = '時間:';

  const timeContainer = document.createElement('span');
  timeContainer.className = 'record-value-container';

  const timeValue = document.createElement('span');
  timeValue.className = 'record-value record-time';
  timeValue.textContent = record.liveTime;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'record-copy-btn';
  copyBtn.textContent = '📋';
  copyBtn.title = '複製時間';
  copyBtn.addEventListener('click', () => handleCopyTime(record.liveTime, copyBtn));

  timeContainer.appendChild(timeValue);
  timeContainer.appendChild(copyBtn);

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
  link.textContent = '前往 VOD →';

  actions.appendChild(link);

  div.appendChild(header);
  div.appendChild(info);
  div.appendChild(actions);

  return div;
}

/**
 * Build VOD URL with fallback for Twitch
 */
function buildVODUrl(record: Record): string {
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
    const newTopic = input.value.trim() || DEFAULT_TOPIC;

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
        showError('更新失敗');
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
    showError('複製失敗');
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
    showError('操作失敗');
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
    showError('操作失敗');
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

      // Find index if updating existing folder
      const existingIndex = folders.findIndex(f => f.id === folder.id);
      if (existingIndex !== -1) {
        folders[existingIndex] = folder;
      } else {
        folders.push(folder);
      }

      chrome.storage.local.set({ folders }, async () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          // Push to cloud sync if logged in
          const sortOrder = existingIndex !== -1 ? existingIndex : folders.length - 1;
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

      chrome.storage.local.set({ folders, records }, async () => {
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
    showError('操作失敗');
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
    exportButton.textContent = '匯出中...';

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
    showSuccess(`已匯出 ${exportData.records.length} 筆記錄與 ${exportData.folders.length} 個資料夾`);

  } catch (error) {
    console.error('Export error:', error);
    showError('匯出失敗，請稍後重試');
  } finally {
    // Re-enable button
    exportButton.disabled = false;
    exportButton.textContent = '📥 匯出資料';
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
      showError('檔案格式不正確');
      input.value = ''; // Reset input
      return;
    }

    // Validate data structure
    if (!validateImportData(importData)) {
      // E1.4b: Incompatible data structure
      showError('無法匯入：資料版本不相容');
      input.value = ''; // Reset input
      return;
    }

    // Store import data and show modal
    pendingImportData = importData;
    showImportModal(importData);

  } catch (error) {
    console.error('Import file read error:', error);
    showError('讀取檔案失敗');
  }

  // Reset file input
  input.value = '';
}

/**
 * Validate import data structure
 */
function validateImportData(data: any): data is ExportData {
  // Check required fields
  if (!data || typeof data !== 'object') {
    return false;
  }

  if (!data.version || typeof data.version !== 'string') {
    return false;
  }

  if (!data.exportedAt || typeof data.exportedAt !== 'string') {
    return false;
  }

  if (!Array.isArray(data.records)) {
    return false;
  }

  if (!Array.isArray(data.folders)) {
    return false;
  }

  // Validate each record has required fields
  for (const record of data.records) {
    if (!record.id || !record.timestamp || !record.liveTime ||
        !record.title || !record.topic || !record.channelUrl || !record.platform) {
      return false;
    }
  }

  // Validate each folder has required fields
  for (const folder of data.folders) {
    if (!folder.id || !folder.name || !folder.created) {
      return false;
    }
  }

  return true;
}

/**
 * Show import modal with data stats
 */
function showImportModal(data: ExportData) {
  importStats.textContent = `${data.records.length} 筆記錄與 ${data.folders.length} 個資料夾`;
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

      showSuccess(`已覆寫：匯入 ${pendingImportData.records.length} 筆記錄與 ${pendingImportData.folders.length} 個資料夾`);

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

      showSuccess(`已合併：新增 ${newRecords.length} 筆記錄與 ${newFolders.length} 個資料夾`);
    }

    // Close modal
    closeImportModal();

    // Reload data
    await loadFolders();
    await loadRecords();

  } catch (error) {
    console.error('Import error:', error);
    showError('匯入失敗，請稍後重試');
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
    userEmail.textContent = user.email;
  } else {
    // Show logged out UI
    syncLoggedOut.classList.remove('hidden');
    syncLoggedIn.classList.add('hidden');
  }

  // Update status indicator
  updateSyncStatusIndicator(status);
}

/**
 * Update sync status indicator
 */
function updateSyncStatusIndicator(status: SyncStatus) {
  // Remove all status classes
  syncStatusDisplay.classList.remove('offline', 'synced', 'syncing', 'error');

  // Add current status class
  syncStatusDisplay.classList.add(status);

  // Update icon and text
  switch (status) {
    case 'offline':
      syncStatusIcon.textContent = '⚪';
      syncStatusText.textContent = '未登入';
      break;
    case 'synced':
      syncStatusIcon.textContent = '🟢';
      syncStatusText.textContent = '已同步';
      break;
    case 'syncing':
      syncStatusIcon.textContent = '🔵';
      syncStatusText.textContent = '同步中...';
      break;
    case 'error':
      syncStatusIcon.textContent = '🔴';
      syncStatusText.textContent = '同步錯誤';
      break;
  }
}

/**
 * Handle login button click
 */
async function handleLogin() {
  try {
    loginButton.disabled = true;
    loginButton.textContent = '登入中...';

    const result = await loginWithGoogle();

    if (result.success) {
      showSuccess('登入成功！');
      await updateSyncUI();
      // Pull initial data
      await pullRemoteChanges();
      // Reload UI
      await loadFolders();
      await loadRecords();
    } else {
      showError(result.error || '登入失敗');
    }
  } catch (error) {
    console.error('Login error:', error);
    showError('登入失敗，請稍後重試');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = '🔐 使用 Google 登入';
  }
}

/**
 * Handle logout button click
 */
async function handleLogout() {
  try {
    logoutButton.disabled = true;
    await logout();
    showSuccess('已登出');
    await updateSyncUI();
  } catch (error) {
    console.error('Logout error:', error);
    showError('登出失敗');
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
    showError('請輸入 JWT');
    return;
  }

  try {
    // Decode JWT to extract user info
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    const user = {
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

    showSuccess('測試 JWT 已設定');
    testJwtInput.value = '';
    await updateSyncUI();
    await loadFolders();
    await loadRecords();
  } catch (error) {
    console.error('Test JWT error:', error);
    showError('無效的 JWT');
  }
}

// Initialize on load
init();
