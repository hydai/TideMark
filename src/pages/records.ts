import { invoke } from '@tauri-apps/api/core';
import * as CloudSync from '../sync';
import { navigateToDownload } from '../app';
import { ConfigManager } from '../config';

interface Record {
  id: string;
  timestamp: string;
  live_time: string;
  title: string;
  topic: string;
  folder_id: string | null;
  channel_url: string;
  platform: string;
  sort_order?: number;
}

interface Folder {
  id: string;
  name: string;
  created: string;
  sort_order?: number;
}

interface RecordsData {
  records: Record[];
  folders: Folder[];
  folder_order: string[];
}

interface RecordGroup {
  title: string;
  records: Record[];
  collapsed: boolean;
}

const UNCATEGORIZED_ID = 'uncategorized';
const ALL_RECORDS_ID = 'all-records';

let currentData: RecordsData = { records: [], folders: [], folder_order: [] };
let currentFolderId: string | null = ALL_RECORDS_ID;
let searchQuery = '';
let editingFolderId: string | null = null;
let editingRecordId: string | null = null;
let draggedFolderId: string | null = null;
let syncState: CloudSync.SyncState | null = null;
let containerElement: HTMLElement | null = null;

export function renderRecordsPage(container: HTMLElement) {
  containerElement = container;

  // Load sync state and records
  Promise.all([
    CloudSync.getSyncState(),
    loadRecords()
  ]).then(([state]) => {
    syncState = state;

    // Start sync polling if logged in
    if (syncState.jwt && syncState.user) {
      CloudSync.startSyncPolling();
    }

    renderPage(container);

    // Listen for sync completion to refresh UI
    window.addEventListener('sync-completed', handleSyncCompleted);
  });
}

function handleSyncCompleted() {
  // Reload data and re-render
  loadRecords().then(() => {
    if (containerElement) {
      renderPage(containerElement);
    }
  });
}

async function loadRecords() {
  try {
    currentData = await invoke<RecordsData>('get_local_records');
  } catch (error) {
    console.error('Failed to load records:', error);
    alert(`載入記錄失敗: ${error}`);
  }
}

function renderPage(container: HTMLElement) {
  // Clear container
  container.textContent = '';

  // Create page structure
  const page = document.createElement('div');
  page.className = 'page records-page';

  const recordsContainer = document.createElement('div');
  recordsContainer.className = 'records-container';

  // Create sidebar
  const sidebar = createSidebar();
  recordsContainer.appendChild(sidebar);

  // Create main content
  const main = createMainContent();
  recordsContainer.appendChild(main);

  page.appendChild(recordsContainer);
  container.appendChild(page);

  attachEventListeners(container);
}

function createSyncSection(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'sync-section';

  if (!syncState || !syncState.user) {
    // Not logged in - show login button
    const loginBtn = document.createElement('button');
    loginBtn.className = 'sync-login-btn';
    loginBtn.textContent = 'Login with Google';
    loginBtn.onclick = handleLogin;
    section.appendChild(loginBtn);

    const localModeText = document.createElement('p');
    localModeText.className = 'sync-local-mode';
    localModeText.textContent = '本機模式 (未同步)';
    section.appendChild(localModeText);
  } else {
    // Logged in - show user info and status
    const userInfo = document.createElement('div');
    userInfo.className = 'sync-user-info';

    const emailText = document.createElement('p');
    emailText.className = 'sync-user-email';
    emailText.textContent = syncState.user.email;
    userInfo.appendChild(emailText);

    const statusContainer = document.createElement('div');
    statusContainer.className = 'sync-status-container';

    const statusIndicator = document.createElement('span');
    statusIndicator.className = `sync-status-indicator sync-status-${syncState.status}`;
    statusIndicator.textContent = getSyncStatusText(syncState.status);
    statusContainer.appendChild(statusIndicator);

    userInfo.appendChild(statusContainer);
    section.appendChild(userInfo);

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'sync-logout-btn';
    logoutBtn.textContent = '登出';
    logoutBtn.onclick = handleLogout;
    section.appendChild(logoutBtn);
  }

  return section;
}

function getSyncStatusText(status: string): string {
  switch (status) {
    case 'synced':
      return '已同步';
    case 'syncing':
      return '同步中...';
    case 'error':
      return '同步錯誤';
    case 'offline':
    default:
      return '離線';
  }
}

async function handleLogin() {
  const result = await CloudSync.loginWithGoogle();

  if (result.success) {
    // Reload sync state and re-render
    syncState = await CloudSync.getSyncState();
    if (containerElement) {
      renderPage(containerElement);
    }
  } else {
    alert(result.error || '登入失敗');
  }
}

async function handleLogout() {
  if (confirm('確定要登出嗎？本機資料將保留，但不會再同步至雲端。')) {
    await CloudSync.logout();
    syncState = await CloudSync.getSyncState();
    if (containerElement) {
      renderPage(containerElement);
    }
  }
}

function createSidebar(): HTMLElement {
  const aside = document.createElement('aside');
  aside.className = 'folders-sidebar';

  // Sync status section
  const syncSection = createSyncSection();
  aside.appendChild(syncSection);

  // Sidebar header
  const header = document.createElement('div');
  header.className = 'sidebar-header';
  const h2 = document.createElement('h2');
  h2.textContent = '資料夾';
  header.appendChild(h2);
  aside.appendChild(header);

  // Folder list
  const folderList = document.createElement('div');
  folderList.className = 'folder-list';

  const folders: Array<{ id: string; name: string; isVirtual?: boolean; isSystem?: boolean }> = [
    { id: ALL_RECORDS_ID, name: '所有記錄', isVirtual: true },
    { id: UNCATEGORIZED_ID, name: '未分類', isSystem: true },
  ];

  // Add user folders in order
  const orderedFolders = currentData.folder_order
    .map(id => currentData.folders.find(f => f.id === id))
    .filter(f => f !== undefined) as Folder[];

  folders.push(...orderedFolders);

  folders.forEach(folder => {
    const folderItem = createFolderItem(folder);
    folderList.appendChild(folderItem);
  });

  aside.appendChild(folderList);

  // Folder actions
  const actions = document.createElement('div');
  actions.className = 'folder-actions';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'new-folder-input';
  input.placeholder = '新資料夾名稱';
  input.className = 'folder-name-input';
  actions.appendChild(input);

  const button = document.createElement('button');
  button.id = 'create-folder-btn';
  button.className = 'primary-button';
  button.textContent = '新增資料夾';
  actions.appendChild(button);

  aside.appendChild(actions);

  return aside;
}

function createFolderItem(folder: { id: string; name: string; isVirtual?: boolean; isSystem?: boolean }): HTMLElement {
  const isActive = currentFolderId === folder.id;
  const canEdit = !folder.isVirtual && !folder.isSystem;
  const canDrag = !folder.isVirtual && !folder.isSystem;
  const isEditing = editingFolderId === folder.id;

  const div = document.createElement('div');
  div.className = 'folder-item';
  if (isActive) div.classList.add('active');
  if (canDrag) div.classList.add('draggable');
  div.dataset.folderId = folder.id;
  if (canDrag) div.draggable = true;

  if (isEditing) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-edit-input';
    input.value = folder.name;
    input.dataset.folderId = folder.id;
    div.appendChild(input);
  } else {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-name';
    nameSpan.textContent = folder.name;
    div.appendChild(nameSpan);

    const countSpan = document.createElement('span');
    countSpan.className = 'record-count';
    countSpan.textContent = `(${getRecordCountForFolder(folder.id)})`;
    div.appendChild(countSpan);
  }

  if (canEdit && !isEditing) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-folder-btn';
    deleteBtn.dataset.folderId = folder.id;
    deleteBtn.title = '刪除資料夾';
    deleteBtn.textContent = '×';
    div.appendChild(deleteBtn);
  }

  return div;
}

function createMainContent(): HTMLElement {
  const main = document.createElement('main');
  main.className = 'records-main';

  // Header
  const header = document.createElement('div');
  header.className = 'records-header';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = getFolderTitle();
  header.appendChild(title);

  const searchBox = document.createElement('div');
  searchBox.className = 'search-box';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'search-input';
  searchInput.placeholder = '搜尋標題、主題或頻道...';
  searchInput.value = searchQuery;
  searchInput.className = 'search-input';
  searchBox.appendChild(searchInput);

  header.appendChild(searchBox);
  main.appendChild(header);

  // Content
  const content = document.createElement('div');
  content.className = 'records-content';

  const records = getFilteredRecords();
  if (records.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-message';
    emptyMsg.textContent = '沒有記錄';
    content.appendChild(emptyMsg);
  } else {
    const groups = groupRecordsByTitle(records);
    groups.forEach(group => {
      const groupEl = createRecordGroup(group);
      content.appendChild(groupEl);
    });
  }

  main.appendChild(content);

  return main;
}

function createRecordGroup(group: RecordGroup): HTMLElement {
  const div = document.createElement('div');
  div.className = 'record-group';

  // Group header
  const header = document.createElement('div');
  header.className = 'group-header';
  header.dataset.groupTitle = group.title;

  const icon = document.createElement('span');
  icon.className = 'collapse-icon';
  icon.textContent = group.collapsed ? '▶' : '▼';
  header.appendChild(icon);

  const titleEl = document.createElement('h3');
  titleEl.className = 'group-title';
  titleEl.textContent = group.title;
  header.appendChild(titleEl);

  const count = document.createElement('span');
  count.className = 'group-count';
  count.textContent = `(${group.records.length})`;
  header.appendChild(count);

  div.appendChild(header);

  // Group records
  if (!group.collapsed) {
    const recordsDiv = document.createElement('div');
    recordsDiv.className = 'group-records';

    group.records.forEach(record => {
      const recordEl = createRecordElement(record);
      recordsDiv.appendChild(recordEl);
    });

    div.appendChild(recordsDiv);
  }

  return div;
}

function createRecordElement(record: Record): HTMLElement {
  const isEditing = editingRecordId === record.id;
  const platformBadge = record.platform === 'youtube' ? 'YT' : 'TW';
  const platformClass = record.platform === 'youtube' ? 'youtube' : 'twitch';

  const div = document.createElement('div');
  div.className = 'record-item';
  div.dataset.recordId = record.id;

  // Main content
  const mainDiv = document.createElement('div');
  mainDiv.className = 'record-main';

  const badge = document.createElement('span');
  badge.className = `platform-badge ${platformClass}`;
  badge.textContent = platformBadge;
  mainDiv.appendChild(badge);

  const info = document.createElement('div');
  info.className = 'record-info';

  if (isEditing) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'record-edit-input';
    input.value = record.topic;
    input.dataset.recordId = record.id;
    info.appendChild(input);
  } else {
    const topic = document.createElement('span');
    topic.className = 'record-topic';
    topic.textContent = record.topic;
    info.appendChild(topic);
  }

  const meta = document.createElement('div');
  meta.className = 'record-meta';

  const time = document.createElement('span');
  time.className = 'record-time';
  time.textContent = record.live_time;
  meta.appendChild(time);

  const timestamp = document.createElement('span');
  timestamp.className = 'record-timestamp';
  timestamp.textContent = formatTimestamp(record.timestamp);
  meta.appendChild(timestamp);

  info.appendChild(meta);
  mainDiv.appendChild(info);
  div.appendChild(mainDiv);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'record-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'record-action-btn download-btn';
  downloadBtn.dataset.recordId = record.id;
  downloadBtn.title = '下載片段';
  downloadBtn.textContent = '📥';
  actions.appendChild(downloadBtn);

  const linkBtn = document.createElement('a');
  linkBtn.href = record.channel_url;
  linkBtn.target = '_blank';
  linkBtn.className = 'record-action-btn link-btn';
  linkBtn.title = '前往 VOD';
  linkBtn.textContent = '🔗';
  actions.appendChild(linkBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'record-action-btn delete-btn';
  deleteBtn.dataset.recordId = record.id;
  deleteBtn.title = '刪除記錄';
  deleteBtn.textContent = '🗑️';
  actions.appendChild(deleteBtn);

  div.appendChild(actions);

  return div;
}

function getFolderTitle(): string {
  if (currentFolderId === ALL_RECORDS_ID) return '所有記錄';
  if (currentFolderId === UNCATEGORIZED_ID) return '未分類';

  const folder = currentData.folders.find(f => f.id === currentFolderId);
  return folder ? folder.name : '記錄';
}

function getRecordCountForFolder(folderId: string): number {
  if (folderId === ALL_RECORDS_ID) {
    return currentData.records.length;
  }
  if (folderId === UNCATEGORIZED_ID) {
    return currentData.records.filter(r => r.folder_id === null).length;
  }
  return currentData.records.filter(r => r.folder_id === folderId).length;
}

function getFilteredRecords(): Record[] {
  let records = currentData.records;

  // Filter by folder
  if (currentFolderId === UNCATEGORIZED_ID) {
    records = records.filter(r => r.folder_id === null);
  } else if (currentFolderId !== ALL_RECORDS_ID) {
    records = records.filter(r => r.folder_id === currentFolderId);
  }

  // Filter by search query
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    records = records.filter(r =>
      r.title.toLowerCase().includes(query) ||
      r.topic.toLowerCase().includes(query) ||
      r.channel_url.toLowerCase().includes(query)
    );
  }

  return records;
}

function groupRecordsByTitle(records: Record[]): RecordGroup[] {
  const groupMap = new Map<string, Record[]>();

  for (const record of records) {
    const title = record.title;
    if (!groupMap.has(title)) {
      groupMap.set(title, []);
    }
    groupMap.get(title)!.push(record);
  }

  return Array.from(groupMap.entries()).map(([title, records]) => ({
    title,
    records: records.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    collapsed: false,
  }));
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

// Parse time string (HH:MM:SS, MM:SS, or seconds) to total seconds
function parseTimeToSeconds(time: string): number {
  // Pure seconds
  if (/^\d+$/.test(time)) {
    return parseInt(time, 10);
  }

  // HH:MM:SS or MM:SS
  const parts = time.split(':').map(p => parseInt(p, 10));

  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }

  return 0;
}

// Format seconds to HH:MM:SS or MM:SS
function formatSecondsToTime(seconds: number): string {
  if (seconds < 0) seconds = 0;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } else {
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }
}

function attachEventListeners(container: HTMLElement) {
  // Create folder button
  const createFolderBtn = container.querySelector('#create-folder-btn');
  const newFolderInput = container.querySelector('#new-folder-input') as HTMLInputElement;

  createFolderBtn?.addEventListener('click', async () => {
    const name = newFolderInput.value.trim();
    if (!name) return;

    try {
      const folder = await invoke<Folder>('create_folder', { name });
      currentData.folders.push(folder);
      currentData.folder_order.push(folder.id);
      newFolderInput.value = '';

      // Push to cloud if logged in
      await CloudSync.pushFolder(folder);

      renderPage(container);
    } catch (error) {
      alert(`建立資料夾失敗: ${error}`);
    }
  });

  newFolderInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      createFolderBtn?.dispatchEvent(new Event('click'));
    }
  });

  // Folder click to select
  container.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('delete-folder-btn')) return;
      if (target.classList.contains('folder-edit-input')) return;

      const folderId = (item as HTMLElement).dataset.folderId;
      if (folderId) {
        currentFolderId = folderId;
        renderPage(container);
      }
    });

    // Double-click to rename (only for user folders)
    item.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('folder-name')) {
        const folderId = (item as HTMLElement).dataset.folderId;
        if (folderId && folderId !== ALL_RECORDS_ID && folderId !== UNCATEGORIZED_ID) {
          editingFolderId = folderId;
          renderPage(container);

          // Focus input
          setTimeout(() => {
            const input = container.querySelector(`.folder-edit-input[data-folder-id="${folderId}"]`) as HTMLInputElement;
            input?.focus();
            input?.select();
          }, 0);
        }
      }
    });
  });

  // Folder edit input
  container.querySelectorAll('.folder-edit-input').forEach(input => {
    const inputEl = input as HTMLInputElement;

    inputEl.addEventListener('blur', async () => {
      const folderId = inputEl.dataset.folderId;
      const newName = inputEl.value.trim();

      if (folderId && newName) {
        const folder = currentData.folders.find(f => f.id === folderId);
        if (folder) {
          folder.name = newName;
          try {
            await invoke('update_folder', { folder });

            // Push to cloud if logged in
            await CloudSync.pushFolder(folder);

            editingFolderId = null;
            renderPage(container);
          } catch (error) {
            alert(`重新命名資料夾失敗: ${error}`);
          }
        }
      } else {
        editingFolderId = null;
        renderPage(container);
      }
    });

    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        inputEl.blur();
      }
    });
  });

  // Delete folder button
  container.querySelectorAll('.delete-folder-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = (btn as HTMLElement).dataset.folderId;
      if (!folderId) return;

      const folder = currentData.folders.find(f => f.id === folderId);
      if (!folder) return;

      if (confirm(`確定要刪除資料夾「${folder.name}」嗎？其中的記錄將移至「未分類」。`)) {
        try {
          await invoke('delete_folder', { id: folderId });

          // Push deletion to cloud if logged in
          await CloudSync.deleteFolderRemote(folderId);

          // Update records that were in this folder and push to cloud
          const affectedRecords = currentData.records.filter(r => r.folder_id === folderId);
          for (const record of affectedRecords) {
            record.folder_id = null;
            await CloudSync.pushRecord(record);
          }

          currentData.folders = currentData.folders.filter(f => f.id !== folderId);
          currentData.folder_order = currentData.folder_order.filter(id => id !== folderId);
          currentData.records.forEach(r => {
            if (r.folder_id === folderId) {
              r.folder_id = null;
            }
          });
          if (currentFolderId === folderId) {
            currentFolderId = UNCATEGORIZED_ID;
          }
          renderPage(container);
        } catch (error) {
          alert(`刪除資料夾失敗: ${error}`);
        }
      }
    });
  });

  // Folder drag and drop
  container.querySelectorAll('.folder-item[draggable="true"]').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedFolderId = (item as HTMLElement).dataset.folderId || null;
      (item as HTMLElement).classList.add('dragging');
    });

    item.addEventListener('dragend', (e) => {
      (item as HTMLElement).classList.remove('dragging');
      draggedFolderId = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedFolderId && draggedFolderId !== (item as HTMLElement).dataset.folderId) {
        (item as HTMLElement).classList.add('drag-over');
      }
    });

    item.addEventListener('dragleave', (e) => {
      (item as HTMLElement).classList.remove('drag-over');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      (item as HTMLElement).classList.remove('drag-over');

      const targetFolderId = (item as HTMLElement).dataset.folderId;
      if (!draggedFolderId || !targetFolderId || draggedFolderId === targetFolderId) return;

      // Reorder folders
      const fromIndex = currentData.folder_order.indexOf(draggedFolderId);
      const toIndex = currentData.folder_order.indexOf(targetFolderId);

      if (fromIndex !== -1 && toIndex !== -1) {
        currentData.folder_order.splice(fromIndex, 1);
        currentData.folder_order.splice(toIndex, 0, draggedFolderId);

        try {
          await invoke('reorder_folders', { folderOrder: currentData.folder_order });

          // Push all affected folders to cloud if logged in
          for (let i = 0; i < currentData.folder_order.length; i++) {
            const folderId = currentData.folder_order[i];
            const folder = currentData.folders.find(f => f.id === folderId);
            if (folder) {
              folder.sort_order = i;
              await CloudSync.pushFolder(folder);
            }
          }

          renderPage(container);
        } catch (error) {
          alert(`重新排序資料夾失敗: ${error}`);
        }
      }
    });
  });

  // Search input
  const searchInput = container.querySelector('#search-input') as HTMLInputElement;
  searchInput?.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    renderPage(container);
  });

  // Group collapse/expand
  container.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', () => {
      const icon = header.querySelector('.collapse-icon');
      if (icon) {
        icon.textContent = icon.textContent === '▶' ? '▼' : '▶';
        const groupRecords = header.nextElementSibling;
        if (groupRecords) {
          groupRecords.classList.toggle('hidden');
        }
      }
    });
  });

  // Record double-click to edit topic
  container.querySelectorAll('.record-topic').forEach(topic => {
    topic.addEventListener('dblclick', () => {
      const recordItem = topic.closest('.record-item') as HTMLElement;
      const recordId = recordItem?.dataset.recordId;
      if (recordId) {
        editingRecordId = recordId;
        renderPage(container);

        // Focus input
        setTimeout(() => {
          const input = container.querySelector(`.record-edit-input[data-record-id="${recordId}"]`) as HTMLInputElement;
          input?.focus();
          input?.select();
        }, 0);
      }
    });
  });

  // Record edit input
  container.querySelectorAll('.record-edit-input').forEach(input => {
    const inputEl = input as HTMLInputElement;

    inputEl.addEventListener('blur', async () => {
      const recordId = inputEl.dataset.recordId;
      const newTopic = inputEl.value.trim();

      if (recordId && newTopic) {
        const record = currentData.records.find(r => r.id === recordId);
        if (record) {
          record.topic = newTopic;
          try {
            await invoke('update_record', { record });

            // Push to cloud if logged in
            await CloudSync.pushRecord(record);

            editingRecordId = null;
            renderPage(container);
          } catch (error) {
            alert(`更新記錄失敗: ${error}`);
          }
        }
      } else {
        editingRecordId = null;
        renderPage(container);
      }
    });

    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        inputEl.blur();
      }
    });
  });

  // Delete record button
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const recordId = (btn as HTMLElement).dataset.recordId;
      if (!recordId) return;

      const record = currentData.records.find(r => r.id === recordId);
      if (!record) return;

      if (confirm(`確定要刪除記錄「${record.topic}」嗎？`)) {
        try {
          await invoke('delete_record', { id: recordId });

          // Push deletion to cloud if logged in
          await CloudSync.deleteRecordRemote(recordId);

          currentData.records = currentData.records.filter(r => r.id !== recordId);
          renderPage(container);
        } catch (error) {
          alert(`刪除記錄失敗: ${error}`);
        }
      }
    });
  });

  // Download clip button
  container.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const recordId = (btn as HTMLElement).dataset.recordId;
      if (!recordId) return;

      const record = currentData.records.find(r => r.id === recordId);
      if (!record) return;

      try {
        // Get config for offset values
        const config = ConfigManager.get();
        const beforeOffset = config.download_clip_before_offset || 10;
        const afterOffset = config.download_clip_after_offset || 10;

        // Parse live_time to seconds
        const liveTimeSeconds = parseTimeToSeconds(record.live_time);

        // Calculate start and end times
        const startSeconds = Math.max(0, liveTimeSeconds - beforeOffset);
        const endSeconds = liveTimeSeconds + afterOffset;

        // Format back to time strings
        const startTime = formatSecondsToTime(startSeconds);
        const endTime = formatSecondsToTime(endSeconds);

        // Check if VOD URL is valid
        if (!record.channel_url || record.channel_url.trim() === '') {
          alert('無法解析此記錄的連結');
          return;
        }

        // Navigate to download tab with pre-filled data
        navigateToDownload({
          url: record.channel_url,
          startTime: startTime,
          endTime: endTime,
        });
      } catch (error) {
        console.error('Failed to prepare download:', error);
        alert('無法準備下載: ' + error);
      }
    });
  });
}
