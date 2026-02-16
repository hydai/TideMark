import { invoke } from '@tauri-apps/api/core';

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

let currentVideoInfo: VideoInfo | null = null;

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

            <div class="quality-section">
              <label class="setting-label">可用畫質</label>
              <select id="quality-select" class="quality-select">
                <option value="">載入中...</option>
              </select>
            </div>

            <div id="codec-section" class="codec-section">
              <div class="codec-info">
                <span class="codec-label">影片編碼：</span>
                <span id="video-codec" class="codec-value">-</span>
              </div>
              <div class="codec-info">
                <span class="codec-label">音訊編碼：</span>
                <span id="audio-codec" class="codec-value">-</span>
              </div>
            </div>

            <div id="live-record-section" class="live-record-section hidden">
              <button class="primary-button">錄製直播</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach event listeners
  const urlInput = container.querySelector('#url-input') as HTMLInputElement;
  const fetchBtn = container.querySelector('#fetch-btn') as HTMLButtonElement;
  const errorMessage = container.querySelector('#error-message') as HTMLElement;
  const videoInfoSection = container.querySelector('#video-info-section') as HTMLElement;
  const qualitySelect = container.querySelector('#quality-select') as HTMLSelectElement;

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
      displayVideoInfo(videoInfo);
    } catch (error) {
      showError(String(error));
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = '貼上並取得';
    }
  });

  // Allow Enter key to trigger fetch
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      fetchBtn.click();
    }
  });

  // Update codec info when quality changes
  qualitySelect.addEventListener('change', () => {
    updateCodecInfo();
  });

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

  function displayVideoInfo(info: VideoInfo) {
    // Set thumbnail
    const thumbnail = container.querySelector('#video-thumbnail') as HTMLImageElement;
    if (info.thumbnail) {
      thumbnail.src = info.thumbnail;
    } else {
      thumbnail.src = 'https://via.placeholder.com/320x180?text=No+Thumbnail';
    }

    // Set title and channel
    const title = container.querySelector('#video-title') as HTMLElement;
    title.textContent = info.title;

    const channel = container.querySelector('#video-channel') as HTMLElement;
    channel.textContent = info.channel;

    // Set duration
    const duration = container.querySelector('#video-duration') as HTMLElement;
    if (info.duration && !info.is_live) {
      duration.textContent = formatDuration(info.duration);
    } else if (info.is_live) {
      duration.textContent = '直播中';
    } else {
      duration.textContent = '時長未知';
    }

    // Show/hide live badge
    const liveBadge = container.querySelector('#live-badge') as HTMLElement;
    if (info.is_live) {
      liveBadge.classList.remove('hidden');
    } else {
      liveBadge.classList.add('hidden');
    }

    // Show/hide live record section
    const liveRecordSection = container.querySelector('#live-record-section') as HTMLElement;
    if (info.is_live) {
      liveRecordSection.classList.remove('hidden');
    } else {
      liveRecordSection.classList.add('hidden');
    }

    // Populate quality options
    populateQualities(info.qualities);

    // Show video info
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

    // Group by quality and filter duplicates
    const uniqueQualities = new Map<string, VideoQuality>();
    for (const quality of qualities) {
      if (!uniqueQualities.has(quality.quality)) {
        uniqueQualities.set(quality.quality, quality);
      }
    }

    // Sort by quality (descending)
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

    // Auto-select first option
    if (sortedQualities.length > 0) {
      qualitySelect.value = sortedQualities[0].format_id;
      updateCodecInfo();
    }
  }

  function updateCodecInfo() {
    if (!currentVideoInfo) return;

    const selectedFormatId = qualitySelect.value;
    const quality = currentVideoInfo.qualities.find(q => q.format_id === selectedFormatId);

    const videoCodec = container.querySelector('#video-codec') as HTMLElement;
    const audioCodec = container.querySelector('#audio-codec') as HTMLElement;

    if (quality) {
      videoCodec.textContent = quality.vcodec || '-';
      audioCodec.textContent = quality.acodec || '-';
    } else {
      videoCodec.textContent = '-';
      audioCodec.textContent = '-';
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
