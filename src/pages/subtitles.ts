import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';

interface AsrModel {
  engine: string;
  model_id: string;
  display_name: string;
  size: string;
  installed: boolean;
  downloading: boolean;
  download_progress: number;
}

interface AsrEnvironmentStatus {
  python_installed: boolean;
  python_version: string | null;
  gpu_available: boolean;
  gpu_name: string | null;
  installed_models: AsrModel[];
  environment_ready: boolean;
}

interface TranscriptionConfig {
  input_file: string;
  engine: string;
  language: string;
  model: string;
  output_format: string;
  hardware_mode: string;
  vad_enabled: boolean;
  demucs_enabled: boolean;
  enable_punctuation: boolean;
  max_seconds: number;
  max_chars: number;
  traditional_chinese: boolean;
  auto_segment: boolean;
}

let selectedFile: { path: string; name: string; size: number; duration: number | null } | null = null;
let asrEnvironmentStatus: AsrEnvironmentStatus | null = null;
let currentEngine: string = 'whisper';

export function renderSubtitlesPage(container: HTMLElement) {
  container.innerHTML = `
    <div class="page subtitles-page">
      <h1 class="page-title">字幕</h1>

      <section class="file-input-section">
        <div id="file-dropzone" class="file-dropzone">
          <div class="dropzone-content">
            <span class="dropzone-icon">📁</span>
            <p class="dropzone-text">拖放影音檔案至此</p>
            <p class="dropzone-hint">或</p>
            <button id="select-file-btn" class="primary-button">選擇檔案</button>
          </div>
        </div>

        <div id="file-info" class="file-info hidden">
          <div class="file-info-header">
            <span class="file-icon">🎬</span>
            <div class="file-details">
              <h3 id="file-name" class="file-name"></h3>
              <p id="file-meta" class="file-meta"></p>
            </div>
            <button id="clear-file-btn" class="icon-button" title="清除檔案">✕</button>
          </div>
        </div>
      </section>

      <section class="asr-engine-section">
        <h2 class="section-title">ASR 引擎</h2>

        <div class="engine-tabs">
          <button class="engine-tab active" data-category="local">本地引擎</button>
          <button class="engine-tab" data-category="cloud">雲端引擎 (BYOK)</button>
        </div>

        <div id="local-engines" class="engine-category active">
          <div class="engine-selection">
            <label class="radio-label">
              <input type="radio" name="engine" value="whisper" checked />
              <span>Whisper</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="engine" value="qwen" />
              <span>Qwen3-ASR</span>
            </label>
          </div>

          <div id="whisper-config" class="engine-config">
            <div class="config-row">
              <label class="config-label">語言</label>
              <select id="whisper-language" class="config-select">
                <option value="auto">自動偵測</option>
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="ja">日文</option>
                <option value="ko">韓文</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">模型大小</label>
              <select id="whisper-model" class="config-select">
                <option value="tiny">Tiny (最快，精度低)</option>
                <option value="base">Base</option>
                <option value="small">Small</option>
                <option value="medium">Medium (推薦)</option>
                <option value="large">Large (最準，速度慢)</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">硬體模式</label>
              <select id="whisper-hardware" class="config-select">
                <option value="auto">自動</option>
                <option value="gpu">GPU</option>
                <option value="cpu">CPU</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">輸出格式</label>
              <select id="whisper-output" class="config-select">
                <option value="srt">SRT 字幕</option>
                <option value="txt">純文字</option>
                <option value="both">雙格式</option>
              </select>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="whisper-vad" />
                <span>啟用 VAD (語音活動偵測)</span>
              </label>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="whisper-demucs" />
                <span>啟用 Demucs (人聲分離)</span>
              </label>
            </div>
          </div>

          <div id="qwen-config" class="engine-config hidden">
            <div class="config-row">
              <label class="config-label">語言</label>
              <select id="qwen-language" class="config-select">
                <option value="auto">自動偵測</option>
                <option value="zh">中文</option>
                <option value="en">英文</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">模型</label>
              <select id="qwen-model" class="config-select">
                <option value="qwen3-asr-large">Qwen3-ASR-Large (推薦)</option>
                <option value="qwen3-asr-base">Qwen3-ASR-Base</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">輸出格式</label>
              <select id="qwen-output" class="config-select">
                <option value="srt">SRT 字幕</option>
                <option value="txt">純文字</option>
                <option value="both">雙格式</option>
              </select>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="qwen-punctuation" checked />
                <span>啟用標點符號</span>
              </label>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="qwen-traditional" />
                <span>繁體中文輸出</span>
              </label>
            </div>

            <div class="config-row">
              <label class="config-label">最長秒數</label>
              <input type="number" id="qwen-max-seconds" class="config-input" value="30" min="1" max="60" />
            </div>

            <div class="config-row">
              <label class="config-label">最長字數</label>
              <input type="number" id="qwen-max-chars" class="config-input" value="50" min="10" max="200" />
            </div>
          </div>
        </div>

        <div id="cloud-engines" class="engine-category hidden">
          <div class="engine-selection">
            <label class="radio-label">
              <input type="radio" name="cloud-engine" value="openai" />
              <span>OpenAI Whisper</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="cloud-engine" value="groq" />
              <span>Groq Whisper</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="cloud-engine" value="elevenlabs" />
              <span>ElevenLabs Scribe</span>
            </label>
          </div>

          <div id="cloud-config" class="engine-config">
            <div class="config-row">
              <label class="config-label">語言</label>
              <select id="cloud-language" class="config-select">
                <option value="auto">自動偵測</option>
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="ja">日文</option>
                <option value="ko">韓文</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">輸出格式</label>
              <select id="cloud-output" class="config-select">
                <option value="srt">SRT 字幕</option>
                <option value="txt">純文字</option>
                <option value="both">雙格式</option>
              </select>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="cloud-auto-segment" checked />
                <span>自動分段 (大檔案)</span>
              </label>
            </div>

            <div id="cloud-api-warning" class="warning-message">
              <span>⚠️</span>
              <span>請先在設定頁面中設定 API Key</span>
            </div>
          </div>
        </div>
      </section>

      <section class="asr-environment-section">
        <h2 class="section-title">環境狀態</h2>

        <div class="environment-status">
          <div class="status-row">
            <span class="status-label">Python 環境</span>
            <span id="python-status" class="status-value">檢查中...</span>
          </div>

          <div class="status-row">
            <span class="status-label">GPU 可用性</span>
            <span id="gpu-status" class="status-value">檢查中...</span>
          </div>

          <div id="environment-actions" class="environment-actions hidden">
            <button id="install-environment-btn" class="primary-button">安裝環境</button>
            <div id="install-progress" class="install-progress hidden">
              <div class="progress-bar">
                <div id="install-progress-fill" class="progress-fill"></div>
              </div>
              <p id="install-status-text" class="progress-text">安裝中...</p>
            </div>
          </div>
        </div>

        <div class="models-section">
          <h3 class="subsection-title">已安裝模型</h3>
          <div id="models-list" class="models-list">
            <p class="placeholder">載入中...</p>
          </div>
        </div>
      </section>

      <section id="transcription-progress-section" class="transcription-progress-section hidden">
        <h2 class="section-title">轉錄進度</h2>
        <div class="progress-container">
          <div class="progress-bar">
            <div id="transcription-progress-fill" class="progress-fill"></div>
          </div>
          <div class="progress-info">
            <span id="progress-percentage">0%</span>
            <span id="progress-time">0:00 / 0:00</span>
          </div>
          <p id="transcription-status" class="transcription-status">準備中...</p>
        </div>
      </section>

      <section id="transcription-result-section" class="transcription-result-section hidden">
        <h2 class="section-title">轉錄完成</h2>
        <div class="result-container">
          <p id="output-file-path" class="output-path"></p>
          <div class="result-actions">
            <button id="open-output-file-btn" class="primary-button">開啟檔案</button>
            <button id="show-in-folder-btn" class="secondary-button">在資料夾中顯示</button>
          </div>
        </div>
      </section>

      <div class="transcription-actions">
        <button id="start-transcription-btn" class="primary-button large-button" disabled>
          開始轉錄
        </button>
        <button id="cancel-transcription-btn" class="secondary-button large-button hidden">
          取消轉錄
        </button>
      </div>
    </div>
  `;

  attachSubtitlesEventListeners(container);
  checkAsrEnvironment();
}

function attachSubtitlesEventListeners(container: HTMLElement) {
  const dropzone = container.querySelector('#file-dropzone') as HTMLElement;
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');

      const files = (e as DragEvent).dataTransfer?.files;
      if (files && files.length > 0) {
        await handleFileSelection(files[0].path);
      }
    });
  }

  const selectFileBtn = container.querySelector('#select-file-btn');
  selectFileBtn?.addEventListener('click', async () => {
    const selected = await open({
      multiple: false,
      filters: [{
        name: 'Video/Audio',
        extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'mp3', 'wav', 'flac', 'm4a', 'ogg']
      }]
    });

    if (selected && typeof selected === 'string') {
      await handleFileSelection(selected);
    }
  });

  const clearFileBtn = container.querySelector('#clear-file-btn');
  clearFileBtn?.addEventListener('click', () => {
    selectedFile = null;
    updateFileDisplay();
    updateTranscriptionButton();
  });

  container.querySelectorAll('.engine-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      const category = target.dataset.category;

      container.querySelectorAll('.engine-tab').forEach((t) => t.classList.remove('active'));
      target.classList.add('active');

      container.querySelectorAll('.engine-category').forEach((c) => c.classList.remove('active'));
      const categoryElement = container.querySelector(`#${category}-engines`);
      categoryElement?.classList.add('active');

      updateTranscriptionButton();
    });
  });

  container.querySelectorAll('input[name="engine"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const target = e.currentTarget as HTMLInputElement;
      currentEngine = target.value;

      container.querySelectorAll('.engine-config').forEach((config) => {
        config.classList.add('hidden');
      });

      const configElement = container.querySelector(`#${target.value}-config`);
      configElement?.classList.remove('hidden');

      updateTranscriptionButton();
    });
  });

  container.querySelectorAll('input[name="cloud-engine"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const target = e.currentTarget as HTMLInputElement;
      currentEngine = target.value;
      checkCloudApiKey(target.value);
      updateTranscriptionButton();
    });
  });

  const installBtn = container.querySelector('#install-environment-btn');
  installBtn?.addEventListener('click', async () => {
    await installAsrEnvironment();
  });

  const startBtn = container.querySelector('#start-transcription-btn');
  startBtn?.addEventListener('click', async () => {
    await startTranscription();
  });

  const openOutputBtn = container.querySelector('#open-output-file-btn');
  openOutputBtn?.addEventListener('click', async () => {
    const outputPath = (window as any).lastOutputPath;
    if (outputPath) {
      try {
        await invoke('open_file', { path: outputPath });
      } catch (error) {
        console.error('Failed to open file:', error);
        alert('無法開啟檔案');
      }
    }
  });

  const showInFolderBtn = container.querySelector('#show-in-folder-btn');
  showInFolderBtn?.addEventListener('click', async () => {
    const outputPath = (window as any).lastOutputPath;
    if (outputPath) {
      try {
        await invoke('show_in_folder', { path: outputPath });
      } catch (error) {
        console.error('Failed to show in folder:', error);
        alert('無法開啟資料夾');
      }
    }
  });
}

async function handleFileSelection(path: string) {
  try {
    const fileName = path.split('/').pop() || path.split('\\').pop() || 'Unknown';

    let duration: number | null = null;
    try {
      duration = await invoke<number>('get_file_duration', { path });
    } catch (error) {
      console.warn('Failed to get file duration:', error);
    }

    let fileSize = 0;
    try {
      fileSize = await invoke<number>('get_file_size', { path });
    } catch (error) {
      console.warn('Failed to get file size:', error);
    }

    selectedFile = {
      path,
      name: fileName,
      size: fileSize,
      duration
    };

    updateFileDisplay();
    updateTranscriptionButton();
  } catch (error) {
    console.error('Error handling file selection:', error);
    alert('無法讀取檔案資訊');
  }
}

function updateFileDisplay() {
  const dropzone = document.getElementById('file-dropzone');
  const fileInfo = document.getElementById('file-info');
  const fileName = document.getElementById('file-name');
  const fileMeta = document.getElementById('file-meta');

  if (!dropzone || !fileInfo || !fileName || !fileMeta) return;

  if (selectedFile) {
    dropzone.classList.add('hidden');
    fileInfo.classList.remove('hidden');

    fileName.textContent = selectedFile.name;

    const sizeText = formatFileSize(selectedFile.size);
    const durationText = selectedFile.duration ? formatDuration(selectedFile.duration) : '未知';
    fileMeta.textContent = `${sizeText} • ${durationText}`;
  } else {
    dropzone.classList.remove('hidden');
    fileInfo.classList.add('hidden');
  }
}

async function checkAsrEnvironment() {
  try {
    const status = await invoke<AsrEnvironmentStatus>('check_asr_environment');
    asrEnvironmentStatus = status;
    updateEnvironmentDisplay();
  } catch (error) {
    console.error('Failed to check ASR environment:', error);
    updateEnvironmentDisplay();
  }
}

function updateEnvironmentDisplay() {
  const pythonStatus = document.getElementById('python-status');
  const gpuStatus = document.getElementById('gpu-status');
  const environmentActions = document.getElementById('environment-actions');
  const modelsList = document.getElementById('models-list');

  if (!pythonStatus || !gpuStatus || !environmentActions || !modelsList) return;

  if (!asrEnvironmentStatus) {
    pythonStatus.textContent = '檢查失敗';
    pythonStatus.className = 'status-value status-error';
    gpuStatus.textContent = '未知';
    gpuStatus.className = 'status-value';
    return;
  }

  if (asrEnvironmentStatus.python_installed) {
    pythonStatus.textContent = `✓ 已安裝 (${asrEnvironmentStatus.python_version || 'Unknown'})`;
    pythonStatus.className = 'status-value status-success';
    environmentActions.classList.add('hidden');
  } else {
    pythonStatus.textContent = '✗ 未安裝';
    pythonStatus.className = 'status-value status-error';
    environmentActions.classList.remove('hidden');
  }

  if (asrEnvironmentStatus.gpu_available) {
    gpuStatus.textContent = `✓ 可用 (${asrEnvironmentStatus.gpu_name || 'GPU'})`;
    gpuStatus.className = 'status-value status-success';
  } else {
    gpuStatus.textContent = '✗ 不可用 (使用 CPU)';
    gpuStatus.className = 'status-value status-warning';
  }

  if (asrEnvironmentStatus.installed_models.length === 0) {
    modelsList.innerHTML = '<p class="placeholder">無已安裝模型</p>';
  } else {
    modelsList.innerHTML = '';
    asrEnvironmentStatus.installed_models.forEach((model) => {
      const modelCard = document.createElement('div');
      modelCard.className = 'model-card';

      const modelInfo = document.createElement('div');
      modelInfo.className = 'model-info';

      const modelName = document.createElement('h4');
      modelName.className = 'model-name';
      modelName.textContent = model.display_name;

      const modelSize = document.createElement('p');
      modelSize.className = 'model-size';
      modelSize.textContent = model.size;

      modelInfo.appendChild(modelName);
      modelInfo.appendChild(modelSize);

      const modelActions = document.createElement('div');
      modelActions.className = 'model-actions';

      if (model.installed) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-secondary small-button';
        deleteBtn.textContent = '刪除';
        deleteBtn.onclick = () => deleteModel(model.engine, model.model_id);
        modelActions.appendChild(deleteBtn);
      } else if (model.downloading) {
        const progressText = document.createElement('span');
        progressText.className = 'download-progress';
        progressText.textContent = `下載中 ${model.download_progress}%`;
        modelActions.appendChild(progressText);
      } else {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn-primary small-button';
        downloadBtn.textContent = '下載';
        downloadBtn.onclick = () => downloadModel(model.engine, model.model_id);
        modelActions.appendChild(downloadBtn);
      }

      modelCard.appendChild(modelInfo);
      modelCard.appendChild(modelActions);
      modelsList.appendChild(modelCard);
    });
  }

  updateTranscriptionButton();
}

async function installAsrEnvironment() {
  const installProgress = document.getElementById('install-progress');
  const installBtn = document.getElementById('install-environment-btn');

  if (installProgress && installBtn) {
    installBtn.classList.add('hidden');
    installProgress.classList.remove('hidden');
  }

  try {
    await invoke('install_asr_environment');
    alert('環境安裝成功！');
    await checkAsrEnvironment();
  } catch (error) {
    console.error('Failed to install ASR environment:', error);
    alert(`環境安裝失敗：${error}`);
  } finally {
    if (installProgress && installBtn) {
      installProgress.classList.add('hidden');
      installBtn.classList.remove('hidden');
    }
  }
}

async function downloadModel(engine: string, model: string) {
  try {
    await invoke('download_asr_model', { engine, model });
    alert('模型下載已開始');
    await checkAsrEnvironment();
  } catch (error) {
    console.error('Failed to download model:', error);
    alert(`模型下載失敗：${error}`);
  }
}

async function deleteModel(engine: string, model: string) {
  if (!confirm('確定要刪除此模型嗎？')) return;

  try {
    await invoke('delete_asr_model', { engine, model });
    alert('模型已刪除');
    await checkAsrEnvironment();
  } catch (error) {
    console.error('Failed to delete model:', error);
    alert(`模型刪除失敗：${error}`);
  }
}

function updateTranscriptionButton() {
  const startBtn = document.getElementById('start-transcription-btn') as HTMLButtonElement;
  if (!startBtn) return;

  const isLocalEngine = document.querySelector('.engine-tab.active')?.getAttribute('data-category') === 'local';
  const hasFile = selectedFile !== null;
  const environmentReady = asrEnvironmentStatus?.environment_ready || false;

  if (isLocalEngine) {
    startBtn.disabled = !(hasFile && environmentReady);
  } else {
    startBtn.disabled = !hasFile;
  }
}

let transcriptionUnlisteners: Array<() => void> = [];

async function checkCloudApiKey(provider: string) {
  const warningEl = document.getElementById('cloud-api-warning');
  if (!warningEl) return;

  try {
    const authConfig = await invoke<any>('get_auth_config');
    const keyField = `${provider}_api_key`;
    const hasKey = authConfig && authConfig[keyField];

    if (hasKey) {
      warningEl.style.display = 'none';
    } else {
      warningEl.style.display = 'flex';
      const providerName = provider === 'openai' ? 'OpenAI' : provider === 'groq' ? 'Groq' : 'ElevenLabs';
      // Clear existing content
      warningEl.textContent = '';
      // Create warning icon
      const iconSpan = document.createElement('span');
      iconSpan.textContent = '⚠️';
      // Create message text
      const messageSpan = document.createElement('span');
      messageSpan.textContent = `請先在設定頁面中設定 ${providerName} API Key`;
      // Append to warning element
      warningEl.appendChild(iconSpan);
      warningEl.appendChild(messageSpan);
    }
  } catch (error) {
    console.error('Failed to check API key:', error);
  }
}

async function startTranscription() {
  if (!selectedFile) {
    alert('請先選擇檔案');
    return;
  }

  try {
    // Show progress section
    const progressSection = document.getElementById('transcription-progress-section');
    const resultSection = document.getElementById('transcription-result-section');
    const startBtn = document.getElementById('start-transcription-btn') as HTMLButtonElement;
    const cancelBtn = document.getElementById('cancel-transcription-btn') as HTMLButtonElement;

    if (progressSection) progressSection.classList.remove('hidden');
    if (resultSection) resultSection.classList.add('hidden');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = '轉錄中...';
    }
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    // Set up event listeners
    const progressUnlisten = await listen('transcription-progress', (event: any) => {
      const { processed, total } = event.payload;
      updateTranscriptionProgress(processed, total);
    });
    transcriptionUnlisteners.push(progressUnlisten);

    const cloudProgressUnlisten = await listen('cloud-transcription-progress', (event: any) => {
      const { current_segment, total_segments, percentage } = event.payload;
      updateCloudTranscriptionProgress(current_segment, total_segments, percentage);
    });
    transcriptionUnlisteners.push(cloudProgressUnlisten);

    const completeUnlisten = await listen('transcription-complete', (event: any) => {
      const { output_path } = event.payload;
      handleTranscriptionComplete(output_path);
    });
    transcriptionUnlisteners.push(completeUnlisten);

    const errorUnlisten = await listen('transcription-error', (event: any) => {
      const { message } = event.payload;
      handleTranscriptionError(message);
    });
    transcriptionUnlisteners.push(errorUnlisten);

    // Start transcription
    const config = buildTranscriptionConfig();
    await invoke('start_transcription', { config });

  } catch (error) {
    console.error('Failed to start transcription:', error);
    handleTranscriptionError(String(error));
  }
}

function updateTranscriptionProgress(processed: number, total: number) {
  const percentage = total > 0 ? (processed / total) * 100 : 0;

  const progressFill = document.getElementById('transcription-progress-fill');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressTime = document.getElementById('progress-time');
  const status = document.getElementById('transcription-status');

  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }

  if (progressPercentage) {
    progressPercentage.textContent = `${Math.round(percentage)}%`;
  }

  if (progressTime) {
    progressTime.textContent = `${formatDuration(processed)} / ${formatDuration(total)}`;
  }

  if (status) {
    status.textContent = '轉錄中...';
  }
}

function updateCloudTranscriptionProgress(currentSegment: number, totalSegments: number, percentage: number) {
  const progressFill = document.getElementById('transcription-progress-fill');
  const progressPercentage = document.getElementById('progress-percentage');
  const progressTime = document.getElementById('progress-time');
  const status = document.getElementById('transcription-status');

  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }

  if (progressPercentage) {
    progressPercentage.textContent = `${Math.round(percentage)}%`;
  }

  if (progressTime) {
    progressTime.textContent = `${currentSegment} / ${totalSegments} 段`;
  }

  if (status) {
    status.textContent = `上傳中 (${currentSegment}/${totalSegments})...`;
  }
}

function handleTranscriptionComplete(outputPath: string) {
  // Clean up event listeners
  transcriptionUnlisteners.forEach(unlisten => unlisten());
  transcriptionUnlisteners = [];

  // Hide progress, show result
  const progressSection = document.getElementById('transcription-progress-section');
  const resultSection = document.getElementById('transcription-result-section');
  const startBtn = document.getElementById('start-transcription-btn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel-transcription-btn') as HTMLButtonElement;

  if (progressSection) progressSection.classList.add('hidden');
  if (resultSection) resultSection.classList.remove('hidden');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = '開始轉錄';
  }
  if (cancelBtn) cancelBtn.classList.add('hidden');

  // Update result display
  const outputFilePathEl = document.getElementById('output-file-path');
  if (outputFilePathEl) {
    outputFilePathEl.textContent = `輸出檔案：${outputPath}`;
  }

  // Store output path for later actions
  (window as any).lastOutputPath = outputPath;

  alert('轉錄完成！');
}

function handleTranscriptionError(message: string) {
  // Clean up event listeners
  transcriptionUnlisteners.forEach(unlisten => unlisten());
  transcriptionUnlisteners = [];

  // Hide progress
  const progressSection = document.getElementById('transcription-progress-section');
  const startBtn = document.getElementById('start-transcription-btn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel-transcription-btn') as HTMLButtonElement;

  if (progressSection) progressSection.classList.add('hidden');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = '開始轉錄';
  }
  if (cancelBtn) cancelBtn.classList.add('hidden');

  alert(`轉錄失敗：${message}`);
}

function buildTranscriptionConfig(): TranscriptionConfig {
  if (!selectedFile) {
    throw new Error('No file selected');
  }

  const isLocalEngine = document.querySelector('.engine-tab.active')?.getAttribute('data-category') === 'local';

  if (isLocalEngine) {
    const engineRadio = document.querySelector('input[name="engine"]:checked') as HTMLInputElement;
    const engine = engineRadio?.value || 'whisper';

    if (engine === 'whisper') {
      return {
        input_file: selectedFile.path,
        engine: 'whisper',
        language: (document.getElementById('whisper-language') as HTMLSelectElement)?.value || 'auto',
        model: (document.getElementById('whisper-model') as HTMLSelectElement)?.value || 'medium',
        output_format: (document.getElementById('whisper-output') as HTMLSelectElement)?.value || 'srt',
        hardware_mode: (document.getElementById('whisper-hardware') as HTMLSelectElement)?.value || 'auto',
        vad_enabled: (document.getElementById('whisper-vad') as HTMLInputElement)?.checked || false,
        demucs_enabled: (document.getElementById('whisper-demucs') as HTMLInputElement)?.checked || false,
        enable_punctuation: false,
        max_seconds: 0,
        max_chars: 0,
        traditional_chinese: false,
        auto_segment: false,
      };
    } else {
      return {
        input_file: selectedFile.path,
        engine: 'qwen',
        language: (document.getElementById('qwen-language') as HTMLSelectElement)?.value || 'auto',
        model: (document.getElementById('qwen-model') as HTMLSelectElement)?.value || 'qwen3-asr-large',
        output_format: (document.getElementById('qwen-output') as HTMLSelectElement)?.value || 'srt',
        hardware_mode: 'auto',
        vad_enabled: false,
        demucs_enabled: false,
        enable_punctuation: (document.getElementById('qwen-punctuation') as HTMLInputElement)?.checked || false,
        max_seconds: parseInt((document.getElementById('qwen-max-seconds') as HTMLInputElement)?.value || '30'),
        max_chars: parseInt((document.getElementById('qwen-max-chars') as HTMLInputElement)?.value || '50'),
        traditional_chinese: (document.getElementById('qwen-traditional') as HTMLInputElement)?.checked || false,
        auto_segment: false,
      };
    }
  } else {
    const cloudRadio = document.querySelector('input[name="cloud-engine"]:checked') as HTMLInputElement;
    const engine = cloudRadio?.value || 'openai';

    return {
      input_file: selectedFile.path,
      engine,
      language: (document.getElementById('cloud-language') as HTMLSelectElement)?.value || 'auto',
      model: '',
      output_format: (document.getElementById('cloud-output') as HTMLSelectElement)?.value || 'srt',
      hardware_mode: 'auto',
      vad_enabled: false,
      demucs_enabled: false,
      enable_punctuation: false,
      max_seconds: 0,
      max_chars: 0,
      traditional_chinese: false,
      auto_segment: (document.getElementById('cloud-auto-segment') as HTMLInputElement)?.checked || false,
    };
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

export function preloadFileToSubtitles(filePath: string) {
  handleFileSelection(filePath);
}
