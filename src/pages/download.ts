import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

interface VideoQuality {
  format_id: string;
  quality: string;
  ext: string;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
}

interface VideoInfo {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number | null;
  platform: string;
  content_type: string;
  is_live: boolean;
  qualities: VideoQuality[];
}

interface DownloadConfig {
  url: string;
  video_info: VideoInfo;
  format_id: string;
  content_type: string;
  video_codec: string | null;
  audio_codec: string | null;
  output_filename: string;
  output_folder: string;
  container_format: string;
  time_range: TimeRange | null;
}

interface TimeRange {
  start: string | null;
  end: string | null;
}

interface DownloadProgress {
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
  // Live recording specific fields
  is_recording?: boolean;
  recorded_duration?: string;
  bitrate?: string;
}

let currentVideoInfo: VideoInfo | null = null;
let currentUrl: string = '';
let downloadTasks: Map<string, DownloadProgress> = new Map();

export function renderDownloadPage(container: HTMLElement) {
  container.innerHTML = `
    <div class="page download-page">
      <h1 class="page-title">下載</h1>

      <div class="url-input-section">
        <div class="input-group">
          <input
            type="text"
            id="url-input"
            class="url-input"
            placeholder="貼上 YouTube 或 Twitch 連結..."
          />
          <button id="fetch-btn" class="primary-button">貼上並取得</button>
        </div>
        <div id="error-message" class="error-message hidden"></div>
      </div>

      <div id="video-info-section" class="video-info-section hidden">
        <div class="video-info-card">
          <div class="video-thumbnail-container">
            <img id="video-thumbnail" class="video-thumbnail" alt="Video thumbnail" />
            <div id="live-badge" class="live-badge hidden">直播中</div>
          </div>

          <div class="video-details">
            <h2 id="video-title" class="video-title"></h2>
            <p id="video-channel" class="video-channel"></p>
            <p id="video-duration" class="video-duration"></p>
          </div>
        </div>

        <div class="download-config">
          <h3 class="section-title">下載設定</h3>

          <div class="config-row">
            <label class="config-label">影片品質</label>
            <select id="quality-select" class="config-select">
              <option value="">載入中...</option>
            </select>
          </div>

          <div class="config-row">
            <label class="config-label">內容類型</label>
            <select id="content-type-select" class="config-select">
              <option value="video+audio">影片+音訊</option>
              <option value="video_only">僅影片</option>
              <option value="audio_only">僅音訊</option>
            </select>
          </div>

          <div class="config-row" id="video-codec-row">
            <label class="config-label">影片編解碼器</label>
            <select id="video-codec-select" class="config-select">
              <option value="h264">H.264</option>
              <option value="vp9">VP9</option>
              <option value="av1">AV1</option>
            </select>
          </div>

          <div class="config-row" id="audio-codec-row">
            <label class="config-label">音訊編解碼器</label>
            <select id="audio-codec-select" class="config-select">
              <option value="aac">AAC</option>
              <option value="mp3">MP3</option>
              <option value="opus">Opus</option>
            </select>
          </div>

          <div class="config-row">
            <label class="config-label">輸出檔名</label>
            <input type="text" id="filename-input" class="config-input" value="{title}_{resolution}" />
            <div class="filename-help">
              可用變數: {type}, {id}, {title}, {channel}, {channel_name}, {date}, {resolution}, {duration}
            </div>
          </div>

          <div class="config-row">
            <label class="config-label">輸出資料夾</label>
            <div class="folder-picker">
              <input type="text" id="folder-input" class="config-input" value="~/Downloads" readonly />
              <button id="folder-btn" class="secondary-button">選擇</button>
            </div>
          </div>

          <div class="config-row">
            <label class="config-label">輸出容器格式</label>
            <select id="container-select" class="config-select">
              <option value="auto">自動</option>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          </div>

          <div class="config-row">
            <label class="config-label">時間範圍（選填）</label>
            <div class="time-range-inputs">
              <input type="text" id="start-time-input" class="time-input" placeholder="開始時間 (HH:MM:SS)" />
              <span class="time-separator">至</span>
              <input type="text" id="end-time-input" class="time-input" placeholder="結束時間 (HH:MM:SS)" />
            </div>
            <div class="time-range-help">
              支援格式: HH:MM:SS (例: 01:30:45)、MM:SS (例: 90:45)、純秒數 (例: 5445)
            </div>
            <div id="time-range-error" class="time-range-error hidden"></div>
          </div>

          <div class="config-row">
            <button id="start-download-btn" class="primary-button large-button">開始下載</button>
            <button id="record-stream-btn" class="primary-button large-button hidden" style="margin-left: 12px; background: #e91e63;">錄製直播</button>
          </div>
        </div>
      </div>

      <div id="downloads-section" class="downloads-section">
        <h3 class="section-title">下載進度</h3>
        <div id="downloads-list" class="downloads-list"></div>
      </div>
    </div>
  `;

  // Attach event listeners
  const urlInput = container.querySelector('#url-input') as HTMLInputElement;
  const fetchBtn = container.querySelector('#fetch-btn') as HTMLButtonElement;
  const errorMessage = container.querySelector('#error-message') as HTMLElement;
  const videoInfoSection = container.querySelector('#video-info-section') as HTMLElement;
  const qualitySelect = container.querySelector('#quality-select') as HTMLSelectElement;
  const contentTypeSelect = container.querySelector('#content-type-select') as HTMLSelectElement;
  const videoCodecRow = container.querySelector('#video-codec-row') as HTMLElement;
  const audioCodecRow = container.querySelector('#audio-codec-row') as HTMLElement;
  const filenameInput = container.querySelector('#filename-input') as HTMLInputElement;
  const folderInput = container.querySelector('#folder-input') as HTMLInputElement;
  const folderBtn = container.querySelector('#folder-btn') as HTMLButtonElement;
  const containerSelect = container.querySelector('#container-select') as HTMLSelectElement;
  const startTimeInput = container.querySelector('#start-time-input') as HTMLInputElement;
  const endTimeInput = container.querySelector('#end-time-input') as HTMLInputElement;
  const timeRangeError = container.querySelector('#time-range-error') as HTMLElement;
  const startDownloadBtn = container.querySelector('#start-download-btn') as HTMLButtonElement;
  const recordStreamBtn = container.querySelector('#record-stream-btn') as HTMLButtonElement;
  const downloadsList = container.querySelector('#downloads-list') as HTMLElement;

  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showError('請輸入連結');
      return;
    }

    hideError();
    hideVideoInfo();
    fetchBtn.disabled = true;
    fetchBtn.textContent = '取得中...';

    try {
      const videoInfo = await invoke<VideoInfo>('fetch_video_info', { url });
      currentVideoInfo = videoInfo;
      currentUrl = url;
      displayVideoInfo(videoInfo);
    } catch (error) {
      showError(String(error));
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = '貼上並取得';
    }
  });

  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      fetchBtn.click();
    }
  });

  qualitySelect.addEventListener('change', () => {
    updateCodecVisibility();
  });

  contentTypeSelect.addEventListener('change', () => {
    updateCodecVisibility();
  });

  folderBtn.addEventListener('click', async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    if (selected) {
      folderInput.value = selected as string;
    }
  });

  startDownloadBtn.addEventListener('click', async () => {
    if (!currentVideoInfo) return;

    hideTimeRangeError();

    // Validate time range if provided
    const startTime = startTimeInput.value.trim();
    const endTime = endTimeInput.value.trim();

    let timeRange: TimeRange | null = null;

    if (startTime || endTime) {
      // Validate time format
      if (startTime && !isValidTimeFormat(startTime)) {
        showTimeRangeError('請輸入有效時間格式');
        return;
      }
      if (endTime && !isValidTimeFormat(endTime)) {
        showTimeRangeError('請輸入有效時間格式');
        return;
      }

      // Validate time range logic
      if (startTime && endTime) {
        const startSeconds = parseTimeToSeconds(startTime);
        const endSeconds = parseTimeToSeconds(endTime);

        if (startSeconds >= endSeconds) {
          showTimeRangeError('結束時間必須晚於開始時間');
          return;
        }

        // Validate against video duration
        if (currentVideoInfo.duration) {
          if (startSeconds > currentVideoInfo.duration) {
            showTimeRangeError('時間超出影片長度');
            return;
          }
          if (endSeconds > currentVideoInfo.duration) {
            showTimeRangeError('時間超出影片長度');
            return;
          }
        }
      }

      timeRange = {
        start: startTime || null,
        end: endTime || null,
      };
    }

    const config: DownloadConfig = {
      url: currentUrl,
      video_info: currentVideoInfo,
      format_id: qualitySelect.value,
      content_type: contentTypeSelect.value,
      video_codec: contentTypeSelect.value !== 'audio_only' ? (container.querySelector('#video-codec-select') as HTMLSelectElement).value : null,
      audio_codec: contentTypeSelect.value !== 'video_only' ? (container.querySelector('#audio-codec-select') as HTMLSelectElement).value : null,
      output_filename: filenameInput.value,
      output_folder: folderInput.value,
      container_format: containerSelect.value,
      time_range: timeRange,
    };

    try {
      const taskId = await invoke<string>('start_download', { config });
      console.log('Download started:', taskId);
    } catch (error) {
      showError(String(error));
    }
  });

  recordStreamBtn.addEventListener('click', async () => {
    if (!currentVideoInfo || !currentVideoInfo.is_live) return;

    const config: DownloadConfig = {
      url: currentUrl,
      video_info: currentVideoInfo,
      format_id: qualitySelect.value,
      content_type: contentTypeSelect.value,
      video_codec: contentTypeSelect.value !== 'audio_only' ? (container.querySelector('#video-codec-select') as HTMLSelectElement).value : null,
      audio_codec: contentTypeSelect.value !== 'video_only' ? (container.querySelector('#audio-codec-select') as HTMLSelectElement).value : null,
      output_filename: filenameInput.value,
      output_folder: folderInput.value,
      container_format: containerSelect.value,
      time_range: null, // No time range for live recording
    };

    try {
      const taskId = await invoke<string>('start_recording', { config });
      console.log('Recording started:', taskId);
    } catch (error) {
      showError(String(error));
    }
  });

  // Listen for download progress updates
  listen<DownloadProgress>('download-progress', (event) => {
    const progress = event.payload;
    downloadTasks.set(progress.task_id, progress);
    renderDownloadTasks(downloadsList);
  });

  // Load existing tasks
  loadDownloadTasks(downloadsList);

  function showError(message: string) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
  }

  function hideError() {
    errorMessage.classList.add('hidden');
  }

  function hideVideoInfo() {
    videoInfoSection.classList.add('hidden');
  }

  function showTimeRangeError(message: string) {
    timeRangeError.textContent = message;
    timeRangeError.classList.remove('hidden');
  }

  function hideTimeRangeError() {
    timeRangeError.classList.add('hidden');
  }

  function displayVideoInfo(info: VideoInfo) {
    const thumbnail = container.querySelector('#video-thumbnail') as HTMLImageElement;
    if (info.thumbnail) {
      thumbnail.src = info.thumbnail;
    } else {
      thumbnail.src = 'https://via.placeholder.com/320x180?text=No+Thumbnail';
    }

    const title = container.querySelector('#video-title') as HTMLElement;
    title.textContent = info.title;

    const channel = container.querySelector('#video-channel') as HTMLElement;
    channel.textContent = info.channel;

    const duration = container.querySelector('#video-duration') as HTMLElement;
    if (info.duration && !info.is_live) {
      duration.textContent = formatDuration(info.duration);
    } else if (info.is_live) {
      duration.textContent = '直播中';
    } else {
      duration.textContent = '時長未知';
    }

    const liveBadge = container.querySelector('#live-badge') as HTMLElement;
    if (info.is_live) {
      liveBadge.classList.remove('hidden');
      // Show record button, hide/dim download button for live streams
      recordStreamBtn.classList.remove('hidden');
      startDownloadBtn.textContent = '開始下載 (僅 VOD)';
      startDownloadBtn.disabled = true;
      // Hide time range inputs for live streams
      const timeRangeRow = container.querySelector('#start-time-input')?.closest('.config-row') as HTMLElement;
      if (timeRangeRow) {
        timeRangeRow.style.display = 'none';
      }
    } else {
      liveBadge.classList.add('hidden');
      // Show download button, hide record button for VODs
      recordStreamBtn.classList.add('hidden');
      startDownloadBtn.textContent = '開始下載';
      startDownloadBtn.disabled = false;
      // Show time range inputs for VODs
      const timeRangeRow = container.querySelector('#start-time-input')?.closest('.config-row') as HTMLElement;
      if (timeRangeRow) {
        timeRangeRow.style.display = 'flex';
      }
    }

    populateQualities(info.qualities);
    updateCodecVisibility();

    videoInfoSection.classList.remove('hidden');
  }

  function populateQualities(qualities: VideoQuality[]) {
    qualitySelect.innerHTML = '';

    if (qualities.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '無可用畫質';
      qualitySelect.appendChild(option);
      return;
    }

    const uniqueQualities = new Map<string, VideoQuality>();
    for (const quality of qualities) {
      if (!uniqueQualities.has(quality.quality)) {
        uniqueQualities.set(quality.quality, quality);
      }
    }

    const sortedQualities = Array.from(uniqueQualities.values()).sort((a, b) => {
      const getResolution = (q: string) => {
        if (q === 'audio only') return 0;
        const match = q.match(/(\d+)p/);
        return match ? parseInt(match[1]) : 0;
      };
      return getResolution(b.quality) - getResolution(a.quality);
    });

    for (const quality of sortedQualities) {
      const option = document.createElement('option');
      option.value = quality.format_id;
      option.textContent = `${quality.quality} (${quality.ext})`;
      qualitySelect.appendChild(option);
    }

    if (sortedQualities.length > 0) {
      qualitySelect.value = sortedQualities[0].format_id;
    }
  }

  function updateCodecVisibility() {
    const contentType = contentTypeSelect.value;

    if (contentType === 'audio_only') {
      videoCodecRow.style.display = 'none';
      audioCodecRow.style.display = 'flex';
    } else if (contentType === 'video_only') {
      videoCodecRow.style.display = 'flex';
      audioCodecRow.style.display = 'none';
    } else {
      videoCodecRow.style.display = 'flex';
      audioCodecRow.style.display = 'flex';
    }
  }

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
      return `${minutes}:${String(secs).padStart(2, '0')}`;
    }
  }
}

async function loadDownloadTasks(container: HTMLElement) {
  try {
    const tasks = await invoke<DownloadProgress[]>('get_download_tasks');
    tasks.forEach(task => {
      downloadTasks.set(task.task_id, task);
    });
    renderDownloadTasks(container);
  } catch (error) {
    console.error('Failed to load download tasks:', error);
  }
}

function renderDownloadTasks(container: HTMLElement) {
  if (downloadTasks.size === 0) {
    container.innerHTML = '<p class="empty-message">目前沒有下載任務</p>';
    return;
  }

  container.innerHTML = '';

  downloadTasks.forEach((progress, taskId) => {
    const taskCard = createTaskCard(progress);
    container.appendChild(taskCard);
  });
}

function createTaskCard(progress: DownloadProgress): HTMLElement {
  const card = document.createElement('div');
  card.className = `download-task-card status-${progress.status}`;

  // Check if this is a live recording task
  const isRecording = progress.is_recording || progress.status === 'recording';

  card.innerHTML = `
    <div class="task-header">
      <h4 class="task-title">${progress.title}</h4>
      <span class="task-status">${getStatusText(progress.status)}</span>
      ${isRecording ? '<span class="live-indicator">🔴 直播錄製</span>' : ''}
    </div>

    <div class="task-progress">
      ${!isRecording ? `
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${progress.percentage}%"></div>
        </div>
        <div class="progress-info">
          <span class="progress-percentage">${progress.percentage.toFixed(1)}%</span>
          <span class="progress-speed">${progress.speed}</span>
          <span class="progress-eta">剩餘 ${progress.eta}</span>
        </div>
      ` : `
        <div class="recording-info">
          <div class="recording-stat">
            <span class="stat-label">已錄製時長</span>
            <span class="stat-value">${progress.recorded_duration || '00:00:00'}</span>
          </div>
          <div class="recording-stat">
            <span class="stat-label">檔案大小</span>
            <span class="stat-value">${formatBytes(progress.downloaded_bytes)}</span>
          </div>
          <div class="recording-stat">
            <span class="stat-label">串流位元率</span>
            <span class="stat-value">${progress.bitrate || 'N/A'}</span>
          </div>
        </div>
      `}
    </div>

    <div class="task-actions">
      ${progress.status === 'recording' ? `
        <button class="action-btn stop-recording-btn" data-task-id="${progress.task_id}">停止錄製</button>
        <button class="action-btn cancel-btn" data-task-id="${progress.task_id}">取消</button>
      ` : ''}
      ${progress.status === 'downloading' && !isRecording ? `
        <button class="action-btn pause-btn" data-task-id="${progress.task_id}">暫停</button>
        <button class="action-btn cancel-btn" data-task-id="${progress.task_id}">取消</button>
      ` : ''}
      ${progress.status === 'paused' ? `
        <button class="action-btn resume-btn" data-task-id="${progress.task_id}">恢復</button>
        <button class="action-btn cancel-btn" data-task-id="${progress.task_id}">取消</button>
      ` : ''}
      ${progress.status === 'processing' ? `
        <p class="processing-text">正在後處理...</p>
      ` : ''}
      ${progress.status === 'completed' && progress.output_path ? `
        <button class="action-btn open-btn" data-path="${progress.output_path}">開啟檔案</button>
        <button class="action-btn folder-btn" data-path="${progress.output_path}">顯示資料夾</button>
        <button class="action-btn transcribe-btn" data-path="${progress.output_path}">送往轉錄</button>
      ` : ''}
      ${progress.status === 'failed' && progress.error_message ? `
        <p class="error-text">${progress.error_message}</p>
      ` : ''}
      ${progress.status === 'stream_interrupted' ? `
        <p class="warning-text">串流中斷 - 已錄製內容保留</p>
        ${progress.output_path ? `
          <button class="action-btn open-btn" data-path="${progress.output_path}">開啟檔案</button>
          <button class="action-btn folder-btn" data-path="${progress.output_path}">顯示資料夾</button>
        ` : ''}
      ` : ''}
    </div>
  `;

  // Attach event listeners
  card.querySelectorAll('.stop-recording-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const taskId = (e.target as HTMLElement).dataset.taskId;
      if (taskId) {
        try {
          await invoke('stop_recording', { taskId });
        } catch (error) {
          console.error('Failed to stop recording:', error);
        }
      }
    });
  });

  card.querySelectorAll('.pause-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const taskId = (e.target as HTMLElement).dataset.taskId;
      if (taskId) {
        try {
          await invoke('pause_download', { taskId });
        } catch (error) {
          console.error('Failed to pause download:', error);
        }
      }
    });
  });

  card.querySelectorAll('.resume-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const taskId = (e.target as HTMLElement).dataset.taskId;
      if (taskId) {
        try {
          await invoke('resume_download', { taskId });
        } catch (error) {
          console.error('Failed to resume download:', error);
        }
      }
    });
  });

  card.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const taskId = (e.target as HTMLElement).dataset.taskId;
      if (taskId) {
        try {
          await invoke('cancel_download', { taskId });
        } catch (error) {
          console.error('Failed to cancel download:', error);
        }
      }
    });
  });

  card.querySelectorAll('.open-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const path = (e.target as HTMLElement).dataset.path;
      if (path) {
        try {
          await invoke('open_file', { path });
        } catch (error) {
          console.error('Failed to open file:', error);
        }
      }
    });
  });

  card.querySelectorAll('.folder-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const path = (e.target as HTMLElement).dataset.path;
      if (path) {
        try {
          await invoke('show_in_folder', { path });
        } catch (error) {
          console.error('Failed to show in folder:', error);
        }
      }
    });
  });

  card.querySelectorAll('.transcribe-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // TODO: Navigate to transcription page with this file
      const path = (e.target as HTMLElement).dataset.path;
      console.log('Send to transcription:', path);
    });
  });

  return card;
}

function getStatusText(status: string): string {
  const statusMap: Record<string, string> = {
    'queued': '排隊中',
    'downloading': '下載中',
    'recording': '錄製中',
    'processing': '處理中',
    'completed': '已完成',
    'failed': '失敗',
    'cancelled': '已取消',
    'paused': '已暫停',
    'stream_interrupted': '串流中斷',
  };
  return statusMap[status] || status;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Time format validation and parsing functions
function isValidTimeFormat(time: string): boolean {
  // Match HH:MM:SS, MM:SS, or pure seconds
  const hhmmss = /^\d{1,2}:\d{2}:\d{2}$/;
  const mmss = /^\d{1,}:\d{2}$/;
  const seconds = /^\d+$/;

  return hhmmss.test(time) || mmss.test(time) || seconds.test(time);
}

function parseTimeToSeconds(time: string): number {
  // Parse pure seconds
  if (/^\d+$/.test(time)) {
    return parseInt(time, 10);
  }

  // Parse HH:MM:SS or MM:SS
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
