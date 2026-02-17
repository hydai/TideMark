import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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

interface PubSubStatus {
  connected: boolean;
  subscribed_channels: string[];
}

interface YouTubePollingStatus {
  active: boolean;
  polling_channels: string[];
  interval_seconds: number;
}

interface TwitchStreamEvent {
  channel_id: string;
  channel_name: string;
  timestamp: string;
  paused?: boolean;
}

interface YouTubeStreamEvent {
  channel_id: string;
  channel_name: string;
  video_id: string;
  timestamp: string;
  paused?: boolean;
}

interface PubSubStatusEvent {
  connected: boolean;
  message: string;
}

interface YouTubePollingStatusEvent {
  active: boolean;
  message: string;
  channels_count: number;
}

interface YouTubeChannelErrorEvent {
  channel_id: string;
  error: string;
}

interface ScheduledDownloadTask {
  id: string;
  preset_id: string;
  channel_name: string;
  platform: string;
  stream_id: string;
  stream_url: string;
  status: string; // "queued" | "downloading" | "completed" | "failed" | "cancelled"
  triggered_at: string;
  started_at: string | null;
  completed_at: string | null;
  file_path: string | null;
  file_size: number | null;
  error_message: string | null;
  download_task_id: string | null;
}

interface ScheduledDownloadTriggeredEvent {
  task_id: string;
  channel_name: string;
  platform: string;
}

interface ScheduledDownloadQueueUpdateEvent {
  queue: ScheduledDownloadTask[];
}

interface ScheduledDownloadCompleteEvent {
  task_id: string;
  channel_name: string;
  file_size: number | null;
}

interface ScheduledDownloadFailedEvent {
  task_id: string;
  channel_name: string;
  error: string;
}

interface DownloadProgressEvent {
  task_id: string;
  status: string;
  title: string;
  percentage: number;
  speed: string;
  eta: string;
  downloaded_bytes: number;
  total_bytes: number;
  output_path: string | null;
  error_message: string | null;
  is_recording: boolean | null;
  recorded_duration: string | null;
  bitrate: string | null;
}

interface DiskFullEvent {
  channel_name: string;
  free_bytes: number;
  required_bytes: number;
}

// Minimal bookmark shape needed for association display
interface BookmarkLink {
  channel_id: string;
  platform: string;
}

const DEFAULT_FILENAME_TEMPLATE = '[{type}] [{channel_name}] [{date}] {title}';

let presets: DownloadPreset[] = [];
// bookmarkLinks: set of "platform:channel_id" strings for quick lookup
const bookmarkLinks: Set<string> = new Set();
let containerEl: HTMLElement | null = null;
// Track modal state: null = closed, 'new' | preset id = editing
let editingPresetId: string | null = null;
let isNewPreset = false;

// PubSub state tracked on the frontend
let pubsubConnected = false;
let pubsubMessage = '';
// YouTube polling state
let youtubePollingActive = false;
let youtubePollingMessage = '';
let youtubePollingChannelsCount = 0;
let youtubePollingIntervalSecs = 90;
// channel_id -> 'live' | 'offline'
const liveStatusMap: Map<string, 'live' | 'offline'> = new Map();

// Scheduled download queue state
let scheduledQueue: ScheduledDownloadTask[] = [];
// Map of download_task_id -> progress data for running scheduled downloads
const scheduledProgressMap: Map<string, DownloadProgressEvent> = new Map();

// Tauri event unlisten functions — cleaned up when page is unmounted
const _unlisteners: UnlistenFn[] = [];

export async function renderScheduledDownloadsPage(container: HTMLElement) {
  containerEl = container;

  // Clean up any previously registered listeners to avoid duplicates.
  for (const unlisten of _unlisteners.splice(0)) {
    unlisten();
  }

  await loadPresets();
  await loadBookmarkLinks();
  await loadScheduledQueue();

  // Load current Twitch PubSub status from backend.
  try {
    const status = await invoke<PubSubStatus>('get_twitch_pubsub_status');
    pubsubConnected = status.connected;
    pubsubMessage = status.connected
      ? `已連線 (${status.subscribed_channels.length} 個頻道)`
      : '';
  } catch {
    pubsubConnected = false;
  }

  // Load current YouTube polling status from backend.
  try {
    const ytStatus = await invoke<YouTubePollingStatus>('get_youtube_polling_status');
    youtubePollingActive = ytStatus.active;
    youtubePollingChannelsCount = ytStatus.polling_channels.length;
    youtubePollingIntervalSecs = ytStatus.interval_seconds;
    youtubePollingMessage = ytStatus.active ? '輪詢中' : '';
  } catch {
    youtubePollingActive = false;
  }

  renderPage(container);
  await setupPubSubListeners();
}

async function loadPresets() {
  try {
    presets = await invoke<DownloadPreset[]>('get_scheduled_presets');
  } catch (error) {
    console.error('Failed to load presets:', error);
    presets = [];
  }
}

async function loadScheduledQueue() {
  try {
    scheduledQueue = await invoke<ScheduledDownloadTask[]>('get_scheduled_download_queue');
  } catch (error) {
    console.error('Failed to load scheduled queue:', error);
    scheduledQueue = [];
  }
}

async function loadBookmarkLinks() {
  bookmarkLinks.clear();
  try {
    const bms = await invoke<BookmarkLink[]>('get_channel_bookmarks');
    for (const bm of bms) {
      bookmarkLinks.add(`${bm.platform}:${bm.channel_id}`);
    }
  } catch (error) {
    // Channel bookmarks may be disabled — that's fine
    console.debug('Failed to load channel bookmarks for link display:', error);
  }
}

async function setupPubSubListeners() {
  const statusUn = await listen<PubSubStatusEvent>('twitch-pubsub-status', (event) => {
    pubsubConnected = event.payload.connected;
    pubsubMessage = event.payload.message;
    updateMonitorStatusUI();
  });

  const streamUpUn = await listen<TwitchStreamEvent>('twitch-stream-up', (event) => {
    liveStatusMap.set(event.payload.channel_id, 'live');
    updatePresetLiveStatus(event.payload.channel_id, 'live');
  });

  const streamDownUn = await listen<TwitchStreamEvent>('twitch-stream-down', (event) => {
    liveStatusMap.set(event.payload.channel_id, 'offline');
    updatePresetLiveStatus(event.payload.channel_id, 'offline');
  });

  // YouTube event listeners
  const ytPollingStatusUn = await listen<YouTubePollingStatusEvent>('youtube-polling-status', (event) => {
    youtubePollingActive = event.payload.active;
    youtubePollingMessage = event.payload.message;
    youtubePollingChannelsCount = event.payload.channels_count;
    updateMonitorStatusUI();
  });

  const ytStreamLiveUn = await listen<YouTubeStreamEvent>('youtube-stream-live', (event) => {
    liveStatusMap.set(event.payload.channel_id, 'live');
    updatePresetLiveStatus(event.payload.channel_id, 'live');
  });

  const ytChannelErrorUn = await listen<YouTubeChannelErrorEvent>('youtube-channel-error', (event) => {
    showToast(`YouTube 頻道錯誤 (${event.payload.channel_id}): ${event.payload.error}`);
    // Update preset list since it may have been disabled.
    loadPresets().then(() => {
      if (containerEl) renderPage(containerEl);
    });
  });

  // Scheduled download event listeners
  const schedTriggeredUn = await listen<ScheduledDownloadTriggeredEvent>('scheduled-download-triggered', (event) => {
    showToast(`排程下載已觸發：${event.payload.channel_name} (${event.payload.platform})`);
  });

  const schedQueueUpdateUn = await listen<ScheduledDownloadQueueUpdateEvent>('scheduled-download-queue-update', (event) => {
    scheduledQueue = event.payload.queue;
    refreshQueueUI();
  });

  const schedCompleteUn = await listen<ScheduledDownloadCompleteEvent>('scheduled-download-complete', (event) => {
    const sizeMb = event.payload.file_size
      ? (event.payload.file_size / (1024 * 1024)).toFixed(1)
      : '?';
    showToast(`排程下載完成：${event.payload.channel_name}（${sizeMb} MB）`);
    refreshQueueUI();
  });

  const schedFailedUn = await listen<ScheduledDownloadFailedEvent>('scheduled-download-failed', (event) => {
    showToast(`排程下載失敗：${event.payload.channel_name} — ${event.payload.error}`);
    refreshQueueUI();
  });

  const diskFullUn = await listen<DiskFullEvent>('scheduled-download-disk-full', (event) => {
    const freeMb = (event.payload.free_bytes / (1024 * 1024)).toFixed(0);
    showToast(`磁碟空間不足 (剩餘 ${freeMb} MB)，已暫停排程下載：${event.payload.channel_name}`);
  });

  const dlProgressUn = await listen<DownloadProgressEvent>('download-progress', (event) => {
    // Track progress for scheduled downloads (those with matching download_task_id).
    const dl = event.payload;
    // Find if any queued task has this download_task_id.
    const sched = scheduledQueue.find(t => t.download_task_id === dl.task_id);
    if (sched) {
      scheduledProgressMap.set(dl.task_id, dl);
      refreshQueueUI();
    }
  });

  _unlisteners.push(
    statusUn, streamUpUn, streamDownUn,
    ytPollingStatusUn, ytStreamLiveUn, ytChannelErrorUn,
    schedTriggeredUn, schedQueueUpdateUn, schedCompleteUn, schedFailedUn,
    diskFullUn, dlProgressUn,
  );
}

/** Update only the monitor status bar without re-rendering the full page. */
function updateMonitorStatusUI() {
  const twitchStatusText = document.getElementById('twitch-pubsub-status-text');
  const twitchStatusDot = document.getElementById('twitch-pubsub-status-dot');
  const startBtn = document.getElementById('twitch-pubsub-start-btn') as HTMLButtonElement | null;
  const stopBtn = document.getElementById('twitch-pubsub-stop-btn') as HTMLButtonElement | null;

  if (twitchStatusText) {
    twitchStatusText.textContent = buildTwitchStatusLabel();
  }
  if (twitchStatusDot) {
    twitchStatusDot.className = pubsubConnected
      ? 'status-dot connected'
      : 'status-dot disconnected';
  }
  if (startBtn) startBtn.disabled = pubsubConnected;
  if (stopBtn) stopBtn.disabled = !pubsubConnected;

  // Update YouTube status text and buttons.
  const ytStatusText = document.getElementById('youtube-polling-status-text');
  const ytStatusDot = document.getElementById('youtube-polling-status-dot');
  const ytStartBtn = document.getElementById('youtube-polling-start-btn') as HTMLButtonElement | null;
  const ytStopBtn = document.getElementById('youtube-polling-stop-btn') as HTMLButtonElement | null;

  if (ytStatusText) {
    ytStatusText.textContent = buildYouTubeStatusLabel();
  }
  if (ytStatusDot) {
    ytStatusDot.className = youtubePollingActive
      ? 'status-dot connected'
      : 'status-dot disconnected';
  }
  if (ytStartBtn) ytStartBtn.disabled = youtubePollingActive;
  if (ytStopBtn) ytStopBtn.disabled = !youtubePollingActive;
}

function buildTwitchStatusLabel(): string {
  if (pubsubConnected) {
    const count = presets.filter(p => p.platform === 'twitch' && p.enabled).length;
    return `Twitch: 已連線 (${count} 個頻道)`;
  }
  if (pubsubMessage) return `Twitch: ${pubsubMessage}`;
  return 'Twitch: 已斷線';
}

function buildYouTubeStatusLabel(): string {
  if (youtubePollingActive) {
    const count = youtubePollingChannelsCount || presets.filter(p => p.platform === 'youtube' && p.enabled).length;
    return `YouTube: 輪詢中 (${count} 個頻道, 每 ${youtubePollingIntervalSecs} 秒)`;
  }
  if (youtubePollingMessage) return `YouTube: ${youtubePollingMessage}`;
  return 'YouTube: 已停止';
}

/** Refresh only the queue section without re-rendering the full page. */
function refreshQueueUI() {
  const queueArea = document.getElementById('download-queue-area');
  if (!queueArea) return;
  const newSection = createQueueSection();
  queueArea.replaceWith(newSection);
}

/** Show a brief toast notification. */
function showToast(message: string) {
  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

/** Update only the live-status badge in the preset table row. */
function updatePresetLiveStatus(channelId: string, status: 'live' | 'offline') {
  const badge = document.querySelector(`[data-live-channel="${channelId}"]`);
  if (!badge) return;
  badge.textContent = status === 'live' ? '直播中' : '離線';
  badge.className = status === 'live' ? 'live-badge live' : 'live-badge offline';
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

  // Monitor status area (Twitch PubSub)
  const monitorSection = createMonitorStatusSection();
  page.appendChild(monitorSection);

  const queueSection = createQueueSection();
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

function createQueueSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sched-section queue-section';
  section.id = 'download-queue-area';

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = '下載佇列';
  section.appendChild(heading);

  if (scheduledQueue.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = '目前無排程下載任務。';
    section.appendChild(empty);
    return section;
  }

  // Separate tasks by status.
  const running = scheduledQueue.filter(t => t.status === 'downloading');
  const queued = scheduledQueue.filter(t => t.status === 'queued');
  const completed = scheduledQueue.filter(t => t.status === 'completed');
  const failed = scheduledQueue.filter(t => t.status === 'failed' || t.status === 'cancelled');

  // Running downloads
  if (running.length > 0) {
    const runningHeader = document.createElement('h3');
    runningHeader.className = 'queue-sub-title';
    runningHeader.textContent = '下載中';
    section.appendChild(runningHeader);
    running.forEach(task => {
      section.appendChild(createQueueTaskRow(task, 'running'));
    });
  }

  // Queued downloads
  if (queued.length > 0) {
    const queuedHeader = document.createElement('h3');
    queuedHeader.className = 'queue-sub-title';
    queuedHeader.textContent = '等待中';
    section.appendChild(queuedHeader);
    queued.forEach((task, index) => {
      section.appendChild(createQueueTaskRow(task, 'queued', index + 1));
    });
  }

  // Completed downloads
  if (completed.length > 0) {
    const completedHeader = document.createElement('h3');
    completedHeader.className = 'queue-sub-title';
    completedHeader.textContent = '已完成';
    section.appendChild(completedHeader);
    completed.forEach(task => {
      section.appendChild(createQueueTaskRow(task, 'completed'));
    });
  }

  // Failed/Cancelled downloads
  if (failed.length > 0) {
    const failedHeader = document.createElement('h3');
    failedHeader.className = 'queue-sub-title';
    failedHeader.textContent = '失敗 / 已取消';
    section.appendChild(failedHeader);
    failed.forEach(task => {
      section.appendChild(createQueueTaskRow(task, 'failed'));
    });
  }

  return section;
}

function createQueueTaskRow(
  task: ScheduledDownloadTask,
  rowType: 'running' | 'queued' | 'completed' | 'failed',
  queuePosition?: number,
): HTMLElement {
  const row = document.createElement('div');
  row.className = `queue-task-row queue-task-${rowType}`;
  row.dataset.taskId = task.id;

  // Left side: channel info
  const info = document.createElement('div');
  info.className = 'queue-task-info';

  const platformBadge = document.createElement('span');
  platformBadge.className = `platform-badge ${task.platform}`;
  platformBadge.textContent = task.platform === 'youtube' ? 'YT' : 'TW';
  info.appendChild(platformBadge);

  const channelName = document.createElement('span');
  channelName.className = 'queue-task-channel';
  channelName.textContent = task.channel_name;
  info.appendChild(channelName);

  row.appendChild(info);

  // Middle: status-specific content
  const statusArea = document.createElement('div');
  statusArea.className = 'queue-task-status-area';

  if (rowType === 'running') {
    // Show progress bar and live stats.
    const progress = task.download_task_id
      ? scheduledProgressMap.get(task.download_task_id)
      : null;

    const progressBar = document.createElement('div');
    progressBar.className = 'queue-progress-bar';
    const fill = document.createElement('div');
    fill.className = 'queue-progress-fill';
    fill.style.width = `${progress?.percentage ?? 0}%`;
    progressBar.appendChild(fill);
    statusArea.appendChild(progressBar);

    const stats = document.createElement('div');
    stats.className = 'queue-task-stats';
    if (progress?.is_recording) {
      stats.textContent = `錄製中 ${progress.recorded_duration ?? '00:00:00'} | ${progress.bitrate ?? 'N/A'} | ${progress.speed}`;
    } else if (progress) {
      stats.textContent = `${progress.percentage.toFixed(1)}% | ${progress.speed} | ETA: ${progress.eta}`;
    } else {
      stats.textContent = '錄製中...';
    }
    statusArea.appendChild(stats);

  } else if (rowType === 'queued') {
    const pos = document.createElement('span');
    pos.className = 'queue-position';
    pos.textContent = `佇列第 ${queuePosition} 位`;
    statusArea.appendChild(pos);

    const triggeredAt = document.createElement('span');
    triggeredAt.className = 'queue-task-time';
    triggeredAt.textContent = `觸發於 ${formatTimestamp(task.triggered_at)}`;
    statusArea.appendChild(triggeredAt);

  } else if (rowType === 'completed') {
    const completedAt = document.createElement('span');
    completedAt.className = 'queue-task-time';
    completedAt.textContent = task.completed_at ? `完成於 ${formatTimestamp(task.completed_at)}` : '已完成';
    statusArea.appendChild(completedAt);

    if (task.file_size) {
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'queue-task-size';
      sizeSpan.textContent = `${(task.file_size / (1024 * 1024)).toFixed(1)} MB`;
      statusArea.appendChild(sizeSpan);
    }

  } else if (rowType === 'failed') {
    const errorSpan = document.createElement('span');
    errorSpan.className = 'queue-task-error';
    errorSpan.textContent = task.error_message ?? (task.status === 'cancelled' ? '已取消' : '失敗');
    statusArea.appendChild(errorSpan);
  }

  row.appendChild(statusArea);

  // Right side: action buttons
  const actions = document.createElement('div');
  actions.className = 'queue-task-actions';

  if (rowType === 'running' || rowType === 'queued') {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn delete-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try {
        await invoke('cancel_scheduled_download', { taskId: task.id });
        showToast('已取消排程下載');
      } catch (err) {
        showToast(`取消失敗: ${err}`);
        cancelBtn.disabled = false;
      }
    });
    actions.appendChild(cancelBtn);
  }

  if (rowType === 'completed' && task.file_path) {
    const openBtn = document.createElement('button');
    openBtn.className = 'action-btn edit-btn';
    openBtn.textContent = '開啟檔案';
    openBtn.addEventListener('click', async () => {
      if (task.file_path) {
        try {
          await invoke('open_file', { path: task.file_path });
        } catch (err) {
          console.error('Failed to open file:', err);
        }
      }
    });
    actions.appendChild(openBtn);
  }

  if (rowType === 'failed') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'action-btn edit-btn';
    retryBtn.textContent = '重試';
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      try {
        await invoke('retry_scheduled_download', { taskId: task.id });
        showToast('已重新加入佇列');
      } catch (err) {
        showToast(`重試失敗: ${err}`);
        retryBtn.disabled = false;
      }
    });
    actions.appendChild(retryBtn);
  }

  row.appendChild(actions);
  return row;
}

function createMonitorStatusSection(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sched-section monitor-status-section';
  section.id = 'monitor-status-area';

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = '監聽狀態';
  section.appendChild(heading);

  // ── Twitch status row ──
  const twitchRow = document.createElement('div');
  twitchRow.className = 'monitor-status-row';

  const twitchDot = document.createElement('span');
  twitchDot.id = 'twitch-pubsub-status-dot';
  twitchDot.className = pubsubConnected ? 'status-dot connected' : 'status-dot disconnected';
  twitchRow.appendChild(twitchDot);

  const twitchStatusText = document.createElement('span');
  twitchStatusText.id = 'twitch-pubsub-status-text';
  twitchStatusText.className = 'monitor-status-text';
  twitchStatusText.textContent = buildTwitchStatusLabel();
  twitchRow.appendChild(twitchStatusText);

  section.appendChild(twitchRow);

  // Twitch button row
  const twitchBtnRow = document.createElement('div');
  twitchBtnRow.className = 'monitor-btn-row';

  const startBtn = document.createElement('button');
  startBtn.className = 'primary-button';
  startBtn.id = 'twitch-pubsub-start-btn';
  startBtn.textContent = '開始 Twitch 監聽';
  startBtn.disabled = pubsubConnected;
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = '連線中…';
    try {
      await invoke('start_twitch_pubsub');
      pubsubConnected = true;
      pubsubMessage = '';
      updateMonitorStatusUI();
    } catch (error) {
      startBtn.disabled = false;
      startBtn.textContent = '開始 Twitch 監聽';
      alert(`無法啟動 Twitch 監聽: ${error}`);
    }
  });
  twitchBtnRow.appendChild(startBtn);

  const stopBtn = document.createElement('button');
  stopBtn.className = 'secondary-button';
  stopBtn.id = 'twitch-pubsub-stop-btn';
  stopBtn.textContent = '停止 Twitch 監聽';
  stopBtn.disabled = !pubsubConnected;
  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    try {
      await invoke('stop_twitch_pubsub');
      pubsubConnected = false;
      pubsubMessage = '已停止監聽';
      updateMonitorStatusUI();
    } catch (error) {
      stopBtn.disabled = false;
      alert(`無法停止 Twitch 監聽: ${error}`);
    }
  });
  twitchBtnRow.appendChild(stopBtn);

  section.appendChild(twitchBtnRow);

  // ── YouTube status row ──
  const ytRow = document.createElement('div');
  ytRow.className = 'monitor-status-row';

  const ytDot = document.createElement('span');
  ytDot.id = 'youtube-polling-status-dot';
  ytDot.className = youtubePollingActive ? 'status-dot connected' : 'status-dot disconnected';
  ytRow.appendChild(ytDot);

  const ytStatusText = document.createElement('span');
  ytStatusText.id = 'youtube-polling-status-text';
  ytStatusText.className = 'monitor-status-text';
  ytStatusText.textContent = buildYouTubeStatusLabel();
  ytRow.appendChild(ytStatusText);

  section.appendChild(ytRow);

  // YouTube button row
  const ytBtnRow = document.createElement('div');
  ytBtnRow.className = 'monitor-btn-row';

  const ytStartBtn = document.createElement('button');
  ytStartBtn.className = 'primary-button';
  ytStartBtn.id = 'youtube-polling-start-btn';
  ytStartBtn.textContent = '開始 YouTube 輪詢';
  ytStartBtn.disabled = youtubePollingActive;
  ytStartBtn.addEventListener('click', async () => {
    ytStartBtn.disabled = true;
    ytStartBtn.textContent = '啟動中…';
    try {
      await invoke('start_youtube_polling');
      youtubePollingActive = true;
      youtubePollingMessage = '輪詢中';
      updateMonitorStatusUI();
    } catch (error) {
      ytStartBtn.disabled = false;
      ytStartBtn.textContent = '開始 YouTube 輪詢';
      alert(`無法啟動 YouTube 輪詢: ${error}`);
    }
  });
  ytBtnRow.appendChild(ytStartBtn);

  const ytStopBtn = document.createElement('button');
  ytStopBtn.className = 'secondary-button';
  ytStopBtn.id = 'youtube-polling-stop-btn';
  ytStopBtn.textContent = '停止 YouTube 輪詢';
  ytStopBtn.disabled = !youtubePollingActive;
  ytStopBtn.addEventListener('click', async () => {
    ytStopBtn.disabled = true;
    try {
      await invoke('stop_youtube_polling');
      youtubePollingActive = false;
      youtubePollingMessage = '已停止';
      updateMonitorStatusUI();
    } catch (error) {
      ytStopBtn.disabled = false;
      alert(`無法停止 YouTube 輪詢: ${error}`);
    }
  });
  ytBtnRow.appendChild(ytStopBtn);

  section.appendChild(ytBtnRow);

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
  const headers = ['頻道名稱', '平台', '狀態', '啟用', '上次觸發', '累計下載', '操作'];
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

  // Live status (Twitch and YouTube), shown when preset is enabled.
  const liveTd = document.createElement('td');
  if ((preset.platform === 'twitch' || preset.platform === 'youtube') && preset.enabled) {
    const currentStatus = liveStatusMap.get(preset.channel_id);
    const liveBadge = document.createElement('span');
    liveBadge.dataset.liveChannel = preset.channel_id;
    if (currentStatus === 'live') {
      liveBadge.className = 'live-badge live';
      liveBadge.textContent = '直播中';
    } else if (currentStatus === 'offline') {
      liveBadge.className = 'live-badge offline';
      liveBadge.textContent = '離線';
    } else {
      liveBadge.className = 'live-badge unknown';
      liveBadge.textContent = '—';
    }
    liveTd.appendChild(liveBadge);
  } else {
    liveTd.textContent = '—';
  }
  tr.appendChild(liveTd);

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

  // Bookmark icon — shown when a matching channel bookmark exists
  const presetKey = `${preset.platform}:${preset.channel_id}`;
  if (bookmarkLinks.has(presetKey)) {
    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = 'action-btn preset-bookmark-icon-btn';
    bookmarkBtn.title = '跳轉至頻道書籤';
    bookmarkBtn.textContent = '🔖';
    bookmarkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Dispatch custom event to app.ts navigation handler (avoids circular import)
      window.dispatchEvent(new CustomEvent('app:navigate-bookmarks', {
        detail: { channelId: preset.channel_id, platform: preset.platform },
      }));
    });
    actionsTd.appendChild(bookmarkBtn);
  }

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
