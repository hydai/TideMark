import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

interface DownloadPreset {
  id: string;
  channel_id: string;
  channel_name: string;
  platform: string;        // "twitch" | "youtube"
  enabled: boolean;
  quality: string;          // "best", "1080p", "720p", etc.
  content_type: string;     // "video+audio" | "audio_only"
  output_dir: string;
  filename_template: string;
  container_format: string; // "auto" | "mp4" | "mkv"
  created_at: string;       // ISO 8601
  last_triggered_at: string | null;
  trigger_count: number;
}

interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  platform: string;
}

const DEFAULT_FILENAME_TEMPLATE = '[{type}] [{channel_name}] [{date}] {title}';

let presets: DownloadPreset[] = [];
let containerEl: HTMLElement | null = null;
// Track modal state: null = closed, 'new' | preset id = editing
let editingPresetId: string | null = null;
let isNewPreset = false;

export async function renderScheduledDownloadsPage(container: HTMLElement) {
  containerEl = container;
  await loadPresets();
  renderPage(container);
}

async function loadPresets() {
  try {
    presets = await invoke<DownloadPreset[]>('get_scheduled_presets');
  } catch (error) {
    console.error('Failed to load presets:', error);
    presets = [];
  }
}

function renderPage(container: HTMLElement) {
  container.textContent = '';

  const page = document.createElement('div');
  page.className = 'page scheduled-downloads-page';

  // Page header
  const header = document.createElement('div');
  header.className = 'page-header';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '排程下載';
  header.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.className = 'primary-button';
  addBtn.id = 'add-preset-btn';
  addBtn.textContent = '新增預設';
  header.appendChild(addBtn);

  page.appendChild(header);

  // Preset list area
  const presetListSection = createPresetListSection();
  page.appendChild(presetListSection);

  // Placeholder areas for future features (SCHED-004-007)
  const monitorSection = createPlaceholderSection('監聽狀態', 'monitor-status-area');
  page.appendChild(monitorSection);

  const queueSection = createPlaceholderSection('下載佇列', 'download-queue-area');
  page.appendChild(queueSection);

  container.appendChild(page);

  // Attach event listeners
  addBtn.addEventListener('click', () => {
    openPresetModal(null);
  });

  // Render modal overlay if editing
  if (isNewPreset || editingPresetId !== null) {
    const preset = editingPresetId ? presets.find(p => p.id === editingPresetId) || null : null;
    const modal = createPresetModal(preset);
    container.appendChild(modal);
  }
}

function createPlaceholderSection(titleText: string, id: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sched-section placeholder-section';
  section.id = id;

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = titleText;
  section.appendChild(heading);

  return section;
}

function createPresetListSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sched-section preset-list-section';

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = '頻道預設';
  section.appendChild(heading);

  if (presets.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-message';
    emptyMsg.textContent = '尚無預設。請按「新增預設」新增頻道。';
    section.appendChild(emptyMsg);
    return section;
  }

  const table = document.createElement('table');
  table.className = 'presets-table';

  // Table header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const headers = ['頻道名稱', '平台', '啟用', '上次觸發', '累計下載', '操作'];
  headers.forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Table body
  const tbody = document.createElement('tbody');
  presets.forEach(preset => {
    const row = createPresetRow(preset);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  section.appendChild(table);
  return section;
}

function createPresetRow(preset: DownloadPreset): HTMLElement {
  const tr = document.createElement('tr');
  tr.className = 'preset-row';
  tr.dataset.presetId = preset.id;

  // Channel name
  const nameTd = document.createElement('td');
  nameTd.className = 'preset-channel-name';
  nameTd.textContent = preset.channel_name;
  tr.appendChild(nameTd);

  // Platform icon
  const platformTd = document.createElement('td');
  const platformBadge = document.createElement('span');
  platformBadge.className = `platform-badge ${preset.platform}`;
  platformBadge.textContent = preset.platform === 'youtube' ? 'YT' : 'TW';
  platformTd.appendChild(platformBadge);
  tr.appendChild(platformTd);

  // Enabled toggle
  const enabledTd = document.createElement('td');
  const toggleBtn = document.createElement('button');
  toggleBtn.className = preset.enabled ? 'toggle-button active' : 'toggle-button';
  toggleBtn.dataset.presetId = preset.id;
  toggleBtn.dataset.action = 'toggle';

  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'toggle-label';
  toggleLabel.textContent = preset.enabled ? '開啟' : '關閉';
  toggleBtn.appendChild(toggleLabel);

  enabledTd.appendChild(toggleBtn);
  tr.appendChild(enabledTd);

  // Last triggered
  const lastTriggerTd = document.createElement('td');
  lastTriggerTd.textContent = preset.last_triggered_at
    ? formatTimestamp(preset.last_triggered_at)
    : '從未';
  tr.appendChild(lastTriggerTd);

  // Trigger count
  const countTd = document.createElement('td');
  countTd.textContent = String(preset.trigger_count);
  tr.appendChild(countTd);

  // Actions
  const actionsTd = document.createElement('td');
  actionsTd.className = 'preset-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'action-btn edit-btn';
  editBtn.dataset.presetId = preset.id;
  editBtn.dataset.action = 'edit';
  editBtn.textContent = '編輯';
  actionsTd.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn delete-btn';
  deleteBtn.dataset.presetId = preset.id;
  deleteBtn.dataset.action = 'delete';
  deleteBtn.textContent = '刪除';
  actionsTd.appendChild(deleteBtn);

  tr.appendChild(actionsTd);

  // Row event listeners
  toggleBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = (e.currentTarget as HTMLElement).dataset.presetId;
    if (!id) return;
    const preset = presets.find(p => p.id === id);
    if (!preset) return;
    try {
      await invoke('toggle_preset_enabled', { id, enabled: !preset.enabled });
      preset.enabled = !preset.enabled;
      if (containerEl) renderPage(containerEl);
    } catch (error) {
      alert(`切換狀態失敗: ${error}`);
    }
  });

  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = (e.currentTarget as HTMLElement).dataset.presetId;
    if (id) openPresetModal(id);
  });

  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = (e.currentTarget as HTMLElement).dataset.presetId;
    if (!id) return;
    const preset = presets.find(p => p.id === id);
    if (!preset) return;
    if (confirm(`確定要刪除頻道「${preset.channel_name}」的預設嗎？`)) {
      try {
        await invoke('delete_scheduled_preset', { id });
        presets = presets.filter(p => p.id !== id);
        if (containerEl) renderPage(containerEl);
      } catch (error) {
        alert(`刪除預設失敗: ${error}`);
      }
    }
  });

  return tr;
}

function openPresetModal(presetId: string | null) {
  if (presetId) {
    editingPresetId = presetId;
    isNewPreset = false;
  } else {
    editingPresetId = null;
    isNewPreset = true;
  }
  if (containerEl) renderPage(containerEl);
}

function closePresetModal() {
  editingPresetId = null;
  isNewPreset = false;
  if (containerEl) renderPage(containerEl);
}

function createPresetModal(existingPreset: DownloadPreset | null): HTMLElement {
  // Modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal preset-modal';

  // Modal header
  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';

  const modalTitle = document.createElement('h2');
  modalTitle.textContent = existingPreset ? '編輯頻道預設' : '新增頻道預設';
  modalHeader.appendChild(modalTitle);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close-btn';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closePresetModal);
  modalHeader.appendChild(closeBtn);

  modal.appendChild(modalHeader);

  // Modal body
  const modalBody = document.createElement('div');
  modalBody.className = 'modal-body';

  // Channel URL + Resolve section
  const urlSection = document.createElement('div');
  urlSection.className = 'form-group';

  const urlLabel = document.createElement('label');
  urlLabel.className = 'form-label';
  urlLabel.textContent = '頻道網址';
  urlSection.appendChild(urlLabel);

  const urlRow = document.createElement('div');
  urlRow.className = 'url-resolve-row';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'form-input';
  urlInput.id = 'preset-url-input';
  urlInput.placeholder = 'https://twitch.tv/channelname 或 https://youtube.com/@handle';
  urlRow.appendChild(urlInput);

  const resolveBtn = document.createElement('button');
  resolveBtn.className = 'secondary-button';
  resolveBtn.id = 'resolve-channel-btn';
  resolveBtn.textContent = '解析';
  urlRow.appendChild(resolveBtn);

  urlSection.appendChild(urlRow);

  // Channel info display (after resolving)
  const channelInfoDiv = document.createElement('div');
  channelInfoDiv.className = 'channel-info-display';
  channelInfoDiv.id = 'channel-info-display';
  channelInfoDiv.style.display = 'none';

  const channelInfoName = document.createElement('span');
  channelInfoName.className = 'channel-info-name';
  channelInfoName.id = 'channel-info-name';
  channelInfoDiv.appendChild(channelInfoName);

  const channelInfoPlatform = document.createElement('span');
  channelInfoPlatform.className = 'channel-info-platform';
  channelInfoPlatform.id = 'channel-info-platform';
  channelInfoDiv.appendChild(channelInfoPlatform);

  urlSection.appendChild(channelInfoDiv);

  // Error message for URL
  const urlError = document.createElement('p');
  urlError.className = 'form-error';
  urlError.id = 'url-error';
  urlError.style.display = 'none';
  urlSection.appendChild(urlError);

  modalBody.appendChild(urlSection);

  // Hidden fields for resolved channel data
  const channelIdInput = document.createElement('input');
  channelIdInput.type = 'hidden';
  channelIdInput.id = 'preset-channel-id';
  modalBody.appendChild(channelIdInput);

  const channelNameInput = document.createElement('input');
  channelNameInput.type = 'hidden';
  channelNameInput.id = 'preset-channel-name';
  modalBody.appendChild(channelNameInput);

  const platformInput = document.createElement('input');
  platformInput.type = 'hidden';
  platformInput.id = 'preset-platform';
  modalBody.appendChild(platformInput);

  // Quality
  const qualityGroup = createFormGroup('品質', createSelectElement('preset-quality', [
    { value: 'best', label: '最佳' },
    { value: '1080p', label: '1080p' },
    { value: '720p', label: '720p' },
    { value: '480p', label: '480p' },
    { value: '360p', label: '360p' },
  ], existingPreset?.quality || 'best'));
  modalBody.appendChild(qualityGroup);

  // Content type
  const contentTypeGroup = createFormGroup('內容類型', createSelectElement('preset-content-type', [
    { value: 'video+audio', label: '影片+音訊' },
    { value: 'audio_only', label: '僅音訊' },
  ], existingPreset?.content_type || 'video+audio'));
  modalBody.appendChild(contentTypeGroup);

  // Output directory
  const outputDirSection = document.createElement('div');
  outputDirSection.className = 'form-group';

  const outputDirLabel = document.createElement('label');
  outputDirLabel.className = 'form-label';
  outputDirLabel.textContent = '輸出資料夾';
  outputDirSection.appendChild(outputDirLabel);

  const outputDirRow = document.createElement('div');
  outputDirRow.className = 'url-resolve-row';

  const outputDirInput = document.createElement('input');
  outputDirInput.type = 'text';
  outputDirInput.className = 'form-input';
  outputDirInput.id = 'preset-output-dir';
  outputDirInput.placeholder = '~/Tidemark/Downloads';
  outputDirInput.value = existingPreset?.output_dir || '';
  outputDirRow.appendChild(outputDirInput);

  const folderPickerBtn = document.createElement('button');
  folderPickerBtn.className = 'secondary-button';
  folderPickerBtn.id = 'preset-folder-picker-btn';
  folderPickerBtn.textContent = '選擇';
  outputDirRow.appendChild(folderPickerBtn);

  outputDirSection.appendChild(outputDirRow);

  const outputDirError = document.createElement('p');
  outputDirError.className = 'form-error';
  outputDirError.id = 'output-dir-error';
  outputDirError.style.display = 'none';
  outputDirSection.appendChild(outputDirError);

  modalBody.appendChild(outputDirSection);

  // Filename template
  const filenameGroup = createFormGroup('檔名模板',
    createTextInput('preset-filename-template',
      existingPreset?.filename_template || DEFAULT_FILENAME_TEMPLATE));
  modalBody.appendChild(filenameGroup);

  // Container format
  const containerGroup = createFormGroup('容器格式', createSelectElement('preset-container-format', [
    { value: 'auto', label: 'Auto' },
    { value: 'mp4', label: 'MP4' },
    { value: 'mkv', label: 'MKV' },
  ], existingPreset?.container_format || 'auto'));
  modalBody.appendChild(containerGroup);

  modal.appendChild(modalBody);

  // Modal footer with Save/Cancel buttons
  const modalFooter = document.createElement('div');
  modalFooter.className = 'modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'secondary-button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', closePresetModal);
  modalFooter.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'primary-button';
  saveBtn.id = 'save-preset-btn';
  saveBtn.textContent = '儲存';
  modalFooter.appendChild(saveBtn);

  modal.appendChild(modalFooter);
  overlay.appendChild(modal);

  // If editing existing preset, pre-fill channel info
  if (existingPreset) {
    channelIdInput.value = existingPreset.channel_id;
    channelNameInput.value = existingPreset.channel_name;
    platformInput.value = existingPreset.platform;

    // Show resolved info
    channelInfoDiv.style.display = 'flex';
    channelInfoName.textContent = existingPreset.channel_name;
    channelInfoPlatform.textContent = existingPreset.platform === 'youtube' ? 'YouTube' : 'Twitch';
    channelInfoPlatform.className = `channel-info-platform platform-badge ${existingPreset.platform}`;
  }

  // Attach resolve button event
  resolveBtn.addEventListener('click', async () => {
    const urlVal = urlInput.value.trim();
    if (!urlVal) {
      showError('url-error', '請輸入頻道網址');
      return;
    }

    resolveBtn.disabled = true;
    resolveBtn.textContent = '解析中...';
    hideError('url-error');

    try {
      const info = await invoke<ChannelInfo>('resolve_channel_info', { url: urlVal });

      // Store resolved data
      channelIdInput.value = info.channel_id;
      channelNameInput.value = info.channel_name;
      platformInput.value = info.platform;

      // Display resolved info
      channelInfoDiv.style.display = 'flex';
      channelInfoName.textContent = info.channel_name;
      channelInfoPlatform.textContent = info.platform === 'youtube' ? 'YouTube' : 'Twitch';
      channelInfoPlatform.className = `channel-info-platform platform-badge ${info.platform}`;
      channelInfoPlatform.textContent = info.platform === 'youtube' ? 'YT' : 'TW';

    } catch (error) {
      const errorMsg = String(error);
      showError('url-error', errorMsg.includes('無法辨識') ? '無法辨識此頻道' : `解析失敗: ${errorMsg}`);
      channelInfoDiv.style.display = 'none';
      channelIdInput.value = '';
      channelNameInput.value = '';
      platformInput.value = '';
    } finally {
      resolveBtn.disabled = false;
      resolveBtn.textContent = '解析';
    }
  });

  // Folder picker event
  folderPickerBtn.addEventListener('click', async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected) {
      outputDirInput.value = selected as string;
      hideError('output-dir-error');
    }
  });

  // Save button event
  saveBtn.addEventListener('click', async () => {
    await handleSavePreset(existingPreset);
  });

  // Close overlay on background click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closePresetModal();
    }
  });

  return overlay;
}

async function handleSavePreset(existingPreset: DownloadPreset | null) {
  const channelIdInput = document.getElementById('preset-channel-id') as HTMLInputElement;
  const channelNameInput = document.getElementById('preset-channel-name') as HTMLInputElement;
  const platformInput = document.getElementById('preset-platform') as HTMLInputElement;
  const qualitySelect = document.getElementById('preset-quality') as HTMLSelectElement;
  const contentTypeSelect = document.getElementById('preset-content-type') as HTMLSelectElement;
  const outputDirInput = document.getElementById('preset-output-dir') as HTMLInputElement;
  const filenameInput = document.getElementById('preset-filename-template') as HTMLInputElement;
  const containerSelect = document.getElementById('preset-container-format') as HTMLSelectElement;

  // Validate channel is resolved
  if (!channelIdInput.value) {
    showError('url-error', '請先解析頻道網址');
    return;
  }

  // Validate output dir
  if (!outputDirInput.value.trim()) {
    showError('output-dir-error', '請選擇輸出資料夾');
    return;
  }

  hideError('url-error');
  hideError('output-dir-error');

  // Check for duplicate channel (only for new presets)
  if (!existingPreset) {
    const duplicate = presets.find(p => p.channel_id === channelIdInput.value
      && p.platform === platformInput.value);
    if (duplicate) {
      const overwrite = confirm('此頻道已有預設，是否覆蓋？');
      if (!overwrite) return;
      // Remove old preset
      try {
        await invoke('delete_scheduled_preset', { id: duplicate.id });
        presets = presets.filter(p => p.id !== duplicate.id);
      } catch (error) {
        alert(`無法覆蓋舊預設: ${error}`);
        return;
      }
    }
  }

  const now = new Date().toISOString();
  const preset: DownloadPreset = {
    id: existingPreset?.id || `preset-${Date.now()}`,
    channel_id: channelIdInput.value,
    channel_name: channelNameInput.value,
    platform: platformInput.value,
    enabled: existingPreset?.enabled ?? true,
    quality: qualitySelect.value,
    content_type: contentTypeSelect.value,
    output_dir: outputDirInput.value.trim(),
    filename_template: filenameInput.value.trim() || DEFAULT_FILENAME_TEMPLATE,
    container_format: containerSelect.value,
    created_at: existingPreset?.created_at || now,
    last_triggered_at: existingPreset?.last_triggered_at ?? null,
    trigger_count: existingPreset?.trigger_count ?? 0,
  };

  try {
    await invoke('save_scheduled_preset', { preset });

    // Update local cache
    const existingIdx = presets.findIndex(p => p.id === preset.id);
    if (existingIdx >= 0) {
      presets[existingIdx] = preset;
    } else {
      presets.push(preset);
    }

    closePresetModal();
  } catch (error) {
    const errStr = String(error);
    if (errStr.includes('輸出資料夾無效')) {
      showError('output-dir-error', '輸出資料夾無效');
    } else {
      alert(`儲存預設失敗: ${error}`);
    }
  }
}

function createFormGroup(labelText: string, inputEl: HTMLElement): HTMLElement {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = labelText;
  group.appendChild(label);

  group.appendChild(inputEl);
  return group;
}

function createSelectElement(id: string, options: { value: string; label: string }[], selectedValue: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'form-select';
  select.id = id;

  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === selectedValue) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  return select;
}

function createTextInput(id: string, value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  input.id = id;
  input.value = value;
  return input;
}

function showError(elementId: string, message: string) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

function hideError(elementId: string) {
  const el = document.getElementById(elementId);
  if (el) {
    el.style.display = 'none';
    el.textContent = '';
  }
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
