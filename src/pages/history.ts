import { invoke } from '@tauri-apps/api/core';
import { t } from '../i18n';

interface DownloadHistory {
  id: string;
  url: string;
  title: string;
  channel: string;
  platform: string;
  content_type: string;
  status: string;
  file_path: string | null;
  file_size: number | null;
  resolution: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

let allHistory: DownloadHistory[] = [];
let filteredHistory: DownloadHistory[] = [];
let currentSearchKeyword = '';
let currentStatusFilter = 'all';
let currentSortBy: 'date' | 'title' | 'channel' = 'date';

export async function renderHistoryPage(container: HTMLElement) {
  container.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">${t('history.title')}</h1>
      </div>

      <div class="history-controls">
        <div class="search-box">
          <input
            type="text"
            id="history-search"
            class="search-input"
            placeholder="${t('history.search.placeholder')}"
          />
        </div>

        <div class="filter-controls">
          <select id="status-filter" class="filter-select">
            <option value="all">${t('history.filter.allStatus')}</option>
            <option value="completed">${t('history.filter.completed')}</option>
            <option value="failed">${t('history.filter.failed')}</option>
            <option value="cancelled">${t('history.filter.cancelled')}</option>
          </select>

          <select id="sort-by" class="filter-select">
            <option value="date">${t('history.sort.byDate')}</option>
            <option value="title">${t('history.sort.byTitle')}</option>
            <option value="channel">${t('history.sort.byChannel')}</option>
          </select>

          <button id="clear-all-btn" class="clear-all-btn">${t('history.actions.clearAll')}</button>
        </div>
      </div>

      <div id="history-list" class="history-list">
        <p class="loading-text">${t('history.loading')}</p>
      </div>
    </div>
  `;

  // Attach event listeners
  const searchInput = document.getElementById('history-search') as HTMLInputElement;
  searchInput?.addEventListener('input', (e) => {
    currentSearchKeyword = (e.target as HTMLInputElement).value;
    filterAndRenderHistory();
  });

  const statusFilter = document.getElementById('status-filter') as HTMLSelectElement;
  statusFilter?.addEventListener('change', (e) => {
    currentStatusFilter = (e.target as HTMLSelectElement).value;
    filterAndRenderHistory();
  });

  const sortBy = document.getElementById('sort-by') as HTMLSelectElement;
  sortBy?.addEventListener('change', (e) => {
    currentSortBy = (e.target as HTMLSelectElement).value as 'date' | 'title' | 'channel';
    filterAndRenderHistory();
  });

  const clearAllBtn = document.getElementById('clear-all-btn');
  clearAllBtn?.addEventListener('click', handleClearAll);

  // Load history
  await loadHistory();
}

async function loadHistory() {
  try {
    allHistory = await invoke<DownloadHistory[]>('get_download_history');
    filterAndRenderHistory();
  } catch (error) {
    console.error('載入歷程失敗:', error);
    const listContainer = document.getElementById('history-list');
    if (listContainer) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      const errorText = document.createElement('p');
      errorText.textContent = t('history.error.loadFailed');
      errorDiv.appendChild(errorText);
      listContainer.textContent = '';
      listContainer.appendChild(errorDiv);
    }
  }
}

function filterAndRenderHistory() {
  // Filter by search keyword
  filteredHistory = allHistory.filter((entry) => {
    const keyword = currentSearchKeyword.toLowerCase();
    if (keyword) {
      return (
        entry.title.toLowerCase().includes(keyword) ||
        entry.channel.toLowerCase().includes(keyword)
      );
    }
    return true;
  });

  // Filter by status
  if (currentStatusFilter !== 'all') {
    filteredHistory = filteredHistory.filter(
      (entry) => entry.status === currentStatusFilter
    );
  }

  // Sort
  filteredHistory.sort((a, b) => {
    if (currentSortBy === 'date') {
      return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
    } else if (currentSortBy === 'title') {
      return a.title.localeCompare(b.title);
    } else if (currentSortBy === 'channel') {
      return a.channel.localeCompare(b.channel);
    }
    return 0;
  });

  renderHistoryList();
}

function renderHistoryList() {
  const listContainer = document.getElementById('history-list');
  if (!listContainer) return;

  listContainer.textContent = '';

  if (filteredHistory.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state';
    const emptyText = document.createElement('p');
    emptyText.textContent = t('history.empty');
    emptyDiv.appendChild(emptyText);
    listContainer.appendChild(emptyDiv);
    return;
  }

  filteredHistory.forEach((entry) => {
    const entryDiv = createHistoryEntryElement(entry);
    listContainer.appendChild(entryDiv);
  });
}

function createHistoryEntryElement(entry: DownloadHistory): HTMLElement {
  const entryDiv = document.createElement('div');
  entryDiv.className = 'history-entry';
  entryDiv.dataset.id = entry.id;

  // Entry header
  const headerDiv = document.createElement('div');
  headerDiv.className = 'entry-header';

  const infoDiv = document.createElement('div');
  infoDiv.className = 'entry-info';

  const platformIcon = document.createElement('span');
  platformIcon.className = 'platform-icon';
  platformIcon.textContent = entry.platform === 'youtube' ? '🎬' : '🎮';

  const detailsDiv = document.createElement('div');
  detailsDiv.className = 'entry-details';

  const titleH3 = document.createElement('h3');
  titleH3.className = 'entry-title';
  titleH3.textContent = entry.title;

  const channelP = document.createElement('p');
  channelP.className = 'entry-channel';
  channelP.textContent = entry.channel;

  detailsDiv.appendChild(titleH3);
  detailsDiv.appendChild(channelP);

  infoDiv.appendChild(platformIcon);
  infoDiv.appendChild(detailsDiv);

  headerDiv.appendChild(infoDiv);
  headerDiv.appendChild(createStatusBadge(entry.status));

  entryDiv.appendChild(headerDiv);

  // Entry metadata
  const metadataDiv = document.createElement('div');
  metadataDiv.className = 'entry-metadata';

  const date = new Date(entry.started_at).toLocaleString('zh-TW');
  const fileSize = entry.file_size ? formatBytes(entry.file_size) : '-';
  const filePath = entry.file_path || '-';

  metadataDiv.appendChild(createMetadataItem(t('history.metadata.downloadDate'), date));
  metadataDiv.appendChild(createMetadataItem(t('history.metadata.fileSize'), fileSize));
  metadataDiv.appendChild(createMetadataItem(t('history.metadata.resolution'), entry.resolution || '-'));

  const pathItem = createMetadataItem(t('history.metadata.filePath'), filePath);
  pathItem.querySelector('.metadata-value')?.classList.add('file-path');
  metadataDiv.appendChild(pathItem);

  entryDiv.appendChild(metadataDiv);

  // Error message if present
  if (entry.error_message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-info';

    const errorLabel = document.createElement('span');
    errorLabel.className = 'error-label';
    errorLabel.textContent = t('history.error.errorMessage');

    const errorText = document.createElement('span');
    errorText.className = 'error-text';
    errorText.textContent = entry.error_message;

    errorDiv.appendChild(errorLabel);
    errorDiv.appendChild(errorText);
    entryDiv.appendChild(errorDiv);
  }

  // Entry actions
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'entry-actions';

  if (entry.status === 'completed' && entry.file_path) {
    const openFileBtn = document.createElement('button');
    openFileBtn.className = 'action-btn open-file-btn';
    openFileBtn.textContent = t('history.actions.openFile');
    openFileBtn.dataset.path = entry.file_path;
    openFileBtn.addEventListener('click', () => handleOpenFile(entry.file_path!));
    actionsDiv.appendChild(openFileBtn);

    const showFolderBtn = document.createElement('button');
    showFolderBtn.className = 'action-btn show-folder-btn';
    showFolderBtn.textContent = t('history.actions.showInFolder');
    showFolderBtn.dataset.path = entry.file_path;
    showFolderBtn.addEventListener('click', () => handleShowInFolder(entry.file_path!));
    actionsDiv.appendChild(showFolderBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn delete-btn';
  deleteBtn.textContent = t('history.actions.deleteRecord');
  deleteBtn.dataset.id = entry.id;
  deleteBtn.addEventListener('click', () => handleDeleteEntry(entry.id));
  actionsDiv.appendChild(deleteBtn);

  entryDiv.appendChild(actionsDiv);

  return entryDiv;
}

function createMetadataItem(label: string, value: string): HTMLElement {
  const itemDiv = document.createElement('div');
  itemDiv.className = 'metadata-item';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'metadata-label';
  labelSpan.textContent = label;

  const valueSpan = document.createElement('span');
  valueSpan.className = 'metadata-value';
  valueSpan.textContent = value;

  itemDiv.appendChild(labelSpan);
  itemDiv.appendChild(valueSpan);

  return itemDiv;
}

function createStatusBadge(status: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'status-badge';

  switch (status) {
    case 'completed':
      badge.classList.add('status-completed');
      badge.textContent = t('history.status.completed');
      break;
    case 'failed':
      badge.classList.add('status-failed');
      badge.textContent = t('history.status.failed');
      break;
    case 'cancelled':
      badge.classList.add('status-cancelled');
      badge.textContent = t('history.status.cancelled');
      break;
    case 'stream_interrupted':
      badge.classList.add('status-warning');
      badge.textContent = t('history.status.streamInterrupted');
      break;
    default:
      badge.classList.add('status-unknown');
      badge.textContent = status;
  }

  return badge;
}

async function handleOpenFile(path: string) {
  try {
    // Check if file exists
    const exists = await invoke<boolean>('check_file_exists', { path });
    if (!exists) {
      alert(t('history.error.fileNotFound'));
      return;
    }

    await invoke('open_file', { path });
  } catch (error) {
    console.error('開啟檔案失敗:', error);
    alert(t('history.error.openFileFailed'));
  }
}

async function handleShowInFolder(path: string) {
  try {
    await invoke('show_in_folder', { path });
  } catch (error) {
    console.error('開啟資料夾失敗:', error);
    alert(t('history.error.showFolderFailed'));
  }
}

async function handleDeleteEntry(id: string) {
  const confirmed = confirm(t('common.confirm.deleteRecord'));
  if (!confirmed) return;

  try {
    await invoke('delete_history_entry', { id });
    // Reload history
    await loadHistory();
  } catch (error) {
    console.error('刪除記錄失敗:', error);
    alert(t('history.error.deleteEntryFailed'));
  }
}

async function handleClearAll() {
  const confirmed = confirm(t('common.confirm.clearAllHistory'));
  if (!confirmed) return;

  try {
    await invoke('clear_all_history');
    // Reload history
    await loadHistory();
  } catch (error) {
    console.error('清空歷程失敗:', error);
    alert(t('history.error.clearAllFailed'));
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
