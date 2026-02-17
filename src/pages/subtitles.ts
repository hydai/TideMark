import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { t, resolveLocalizedMessage } from '../i18n';

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
      <h1 class="page-title">${t('subtitles.title')}</h1>

      <section class="file-input-section">
        <div id="file-dropzone" class="file-dropzone">
          <div class="dropzone-content">
            <span class="dropzone-icon">📁</span>
            <p class="dropzone-text">${t('subtitles.fileInput.dropzoneText')}</p>
            <p class="dropzone-hint">${t('subtitles.fileInput.dropzoneHint')}</p>
            <button id="select-file-btn" class="primary-button">${t('subtitles.fileInput.selectFile')}</button>
          </div>
        </div>

        <div id="file-info" class="file-info hidden">
          <div class="file-info-header">
            <span class="file-icon">🎬</span>
            <div class="file-details">
              <h3 id="file-name" class="file-name"></h3>
              <p id="file-meta" class="file-meta"></p>
            </div>
            <button id="clear-file-btn" class="icon-button" title="${t('subtitles.fileInput.clearFile')}">✕</button>
          </div>
        </div>
      </section>

      <section class="asr-engine-section">
        <h2 class="section-title">${t('subtitles.engine.title')}</h2>

        <div class="engine-tabs">
          <button class="engine-tab active" data-category="local">${t('subtitles.engine.localEngine')}</button>
          <button class="engine-tab" data-category="cloud">${t('subtitles.engine.cloudEngine')}</button>
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
              <label class="config-label">${t('subtitles.config.language')}</label>
              <select id="whisper-language" class="config-select">
                <option value="auto">${t('subtitles.config.languageAuto')}</option>
                <option value="zh">${t('subtitles.config.languageZh')}</option>
                <option value="en">${t('subtitles.config.languageEn')}</option>
                <option value="ja">${t('subtitles.config.languageJa')}</option>
                <option value="ko">${t('subtitles.config.languageKo')}</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">${t('subtitles.config.modelSize')}</label>
              <select id="whisper-model" class="config-select">
                <option value="tiny">${t('subtitles.config.modelTiny')}</option>
                <option value="base">${t('subtitles.config.modelBase')}</option>
                <option value="small">${t('subtitles.config.modelSmall')}</option>
                <option value="medium">${t('subtitles.config.modelMedium')}</option>
                <option value="large">${t('subtitles.config.modelLarge')}</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">${t('subtitles.config.hardwareMode')}</label>
              <select id="whisper-hardware" class="config-select">
                <option value="auto">${t('subtitles.config.hardwareAuto')}</option>
                <option value="gpu">${t('subtitles.config.hardwareGpu')}</option>
                <option value="cpu">${t('subtitles.config.hardwareCpu')}</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">${t('subtitles.config.outputFormat')}</label>
              <select id="whisper-output" class="config-select">
                <option value="srt">${t('subtitles.config.outputSrt')}</option>
                <option value="txt">${t('subtitles.config.outputTxt')}</option>
                <option value="both">${t('subtitles.config.outputBoth')}</option>
              </select>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="whisper-vad" />
                <span>${t('subtitles.config.enableVad')}</span>
              </label>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="whisper-demucs" />
                <span>${t('subtitles.config.enableDemucs')}</span>
              </label>
            </div>
          </div>

          <div id="qwen-config" class="engine-config hidden">
            <div class="config-row">
              <label class="config-label">${t('subtitles.config.language')}</label>
              <select id="qwen-language" class="config-select">
                <option value="auto">${t('subtitles.config.languageAuto')}</option>
                <option value="zh">${t('subtitles.config.languageZh')}</option>
                <option value="en">${t('subtitles.config.languageEn')}</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">${t('subtitles.config.modelQwen')}</label>
              <select id="qwen-model" class="config-select">
                <option value="qwen3-asr-large">Qwen3-ASR-Large (推薦)</option>
                <option value="qwen3-asr-base">Qwen3-ASR-Base</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">${t('subtitles.config.outputFormat')}</label>
              <select id="qwen-output" class="config-select">
                <option value="srt">${t('subtitles.config.outputSrt')}</option>
                <option value="txt">${t('subtitles.config.outputTxt')}</option>
                <option value="both">${t('subtitles.config.outputBoth')}</option>
              </select>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="qwen-punctuation" checked />
                <span>${t('subtitles.config.enablePunctuation')}</span>
              </label>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="qwen-traditional" />
                <span>${t('subtitles.config.traditionalChinese')}</span>
              </label>
            </div>

            <div class="config-row">
              <label class="config-label">${t('subtitles.config.maxSeconds')}</label>
              <input type="number" id="qwen-max-seconds" class="config-input" value="30" min="1" max="60" />
            </div>

            <div class="config-row">
              <label class="config-label">${t('subtitles.config.maxChars')}</label>
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
              <label class="config-label">${t('subtitles.config.language')}</label>
              <select id="cloud-language" class="config-select">
                <option value="auto">${t('subtitles.config.languageAuto')}</option>
                <option value="zh">${t('subtitles.config.languageZh')}</option>
                <option value="en">${t('subtitles.config.languageEn')}</option>
                <option value="ja">${t('subtitles.config.languageJa')}</option>
                <option value="ko">${t('subtitles.config.languageKo')}</option>
              </select>
            </div>

            <div class="config-row">
              <label class="config-label">${t('subtitles.config.outputFormat')}</label>
              <select id="cloud-output" class="config-select">
                <option value="srt">${t('subtitles.config.outputSrt')}</option>
                <option value="txt">${t('subtitles.config.outputTxt')}</option>
                <option value="both">${t('subtitles.config.outputBoth')}</option>
              </select>
            </div>

            <div class="config-row">
              <label class="checkbox-label">
                <input type="checkbox" id="cloud-auto-segment" checked />
                <span>${t('subtitles.config.autoSegment')}</span>
              </label>
            </div>

            <div id="cloud-api-warning" class="warning-message">
              <span>⚠️</span>
              <span>${t('subtitles.config.apiKeyWarning')}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="asr-environment-section">
        <h2 class="section-title">${t('subtitles.environment.title')}</h2>

        <div class="environment-status">
          <div class="status-row">
            <span class="status-label">${t('subtitles.environment.python')}</span>
            <span id="python-status" class="status-value">${t('subtitles.environment.checking')}</span>
          </div>

          <div class="status-row">
            <span class="status-label">${t('subtitles.environment.gpu')}</span>
            <span id="gpu-status" class="status-value">${t('subtitles.environment.checking')}</span>
          </div>

          <div id="environment-actions" class="environment-actions hidden">
            <button id="install-environment-btn" class="primary-button">${t('subtitles.environment.install')}</button>
            <div id="install-progress" class="install-progress hidden">
              <div class="progress-bar">
                <div id="install-progress-fill" class="progress-fill"></div>
              </div>
              <p id="install-status-text" class="progress-text">${t('subtitles.environment.installing')}</p>
            </div>
          </div>
        </div>

        <div class="models-section">
          <h3 class="subsection-title">${t('subtitles.environment.installedModels')}</h3>
          <div id="models-list" class="models-list">
            <p class="placeholder">${t('common.actions.loading')}</p>
          </div>
        </div>
      </section>

      <section id="transcription-progress-section" class="transcription-progress-section hidden">
        <h2 class="section-title">${t('subtitles.progress.title')}</h2>
        <div class="progress-container">
          <div class="progress-bar">
            <div id="transcription-progress-fill" class="progress-fill"></div>
          </div>
          <div class="progress-info">
            <span id="progress-percentage">0%</span>
            <span id="progress-time">0:00 / 0:00</span>
          </div>
          <p id="transcription-status" class="transcription-status">${t('subtitles.progress.preparing')}</p>
        </div>
      </section>

      <section id="transcription-result-section" class="transcription-result-section hidden">
        <h2 class="section-title">${t('subtitles.result.title')}</h2>
        <div class="result-container">
          <p id="output-file-path" class="output-path"></p>
          <div class="result-actions">
            <button id="open-output-file-btn" class="primary-button">${t('subtitles.result.openFile')}</button>
            <button id="show-in-folder-btn" class="secondary-button">${t('subtitles.result.showInFolder')}</button>
          </div>
        </div>
      </section>

      <div class="transcription-actions">
        <button id="start-transcription-btn" class="primary-button large-button" disabled>
          ${t('subtitles.actions.start')}
        </button>
        <button id="cancel-transcription-btn" class="secondary-button large-button hidden">
          ${t('subtitles.actions.cancel')}
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
        await handleFileSelection((files[0] as any).path);
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
        alert(t('subtitles.error.cannotOpenFile'));
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
        alert(t('subtitles.error.cannotOpenFolder'));
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
    alert(t('subtitles.error.cannotReadFile'));
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
    const durationText = selectedFile.duration ? formatDuration(selectedFile.duration) : t('common.actions.unknown');
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
    pythonStatus.textContent = t('subtitles.environment.checkFailed');
    pythonStatus.className = 'status-value status-error';
    gpuStatus.textContent = t('common.actions.unknown');
    gpuStatus.className = 'status-value';
    return;
  }

  if (asrEnvironmentStatus.python_installed) {
    pythonStatus.textContent = t('subtitles.environment.pythonInstalled', { version: asrEnvironmentStatus.python_version || 'Unknown' });
    pythonStatus.className = 'status-value status-success';
    environmentActions.classList.add('hidden');
  } else {
    pythonStatus.textContent = t('subtitles.environment.pythonNotInstalled');
    pythonStatus.className = 'status-value status-error';
    environmentActions.classList.remove('hidden');
  }

  if (asrEnvironmentStatus.gpu_available) {
    gpuStatus.textContent = t('subtitles.environment.gpuAvailable', { name: asrEnvironmentStatus.gpu_name || 'GPU' });
    gpuStatus.className = 'status-value status-success';
  } else {
    gpuStatus.textContent = t('subtitles.environment.gpuNotAvailable');
    gpuStatus.className = 'status-value status-warning';
  }

  if (asrEnvironmentStatus.installed_models.length === 0) {
    modelsList.textContent = '';
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder';
    placeholder.textContent = t('subtitles.environment.noModels');
    modelsList.appendChild(placeholder);
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
        deleteBtn.textContent = t('subtitles.environment.deleteModel');
        deleteBtn.onclick = () => deleteModel(model.engine, model.model_id);
        modelActions.appendChild(deleteBtn);
      } else if (model.downloading) {
        const progressText = document.createElement('span');
        progressText.className = 'download-progress';
        progressText.textContent = t('subtitles.environment.downloading', { progress: String(model.download_progress) });
        modelActions.appendChild(progressText);
      } else {
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn-primary small-button';
        downloadBtn.textContent = t('subtitles.environment.downloadModel');
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
    alert(t('subtitles.error.installSuccess'));
    await checkAsrEnvironment();
  } catch (error) {
    console.error('Failed to install ASR environment:', error);
    alert(t('subtitles.error.installFailed', { error: resolveLocalizedMessage(String(error)) }));
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
    alert(t('subtitles.error.modelDownloadStarted'));
    await checkAsrEnvironment();
  } catch (error) {
    console.error('Failed to download model:', error);
    alert(t('subtitles.error.modelDownloadFailed', { error: resolveLocalizedMessage(String(error)) }));
  }
}

async function deleteModel(engine: string, model: string) {
  if (!confirm(t('subtitles.error.confirmDeleteModel'))) return;

  try {
    await invoke('delete_asr_model', { engine, model });
    alert(t('subtitles.error.modelDeleted'));
    await checkAsrEnvironment();
  } catch (error) {
    console.error('Failed to delete model:', error);
    alert(t('subtitles.error.modelDeleteFailed', { error: resolveLocalizedMessage(String(error)) }));
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
      messageSpan.textContent = t('subtitles.config.apiKeyWarningProvider', { provider: providerName });
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
    alert(t('subtitles.error.noFileSelected'));
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
      startBtn.textContent = t('subtitles.actions.inProgress');
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
    status.textContent = t('subtitles.progress.transcribing');
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
    progressTime.textContent = t('subtitles.progress.segments', { current: String(currentSegment), total: String(totalSegments) });
  }

  if (status) {
    status.textContent = t('subtitles.progress.uploading', { current: String(currentSegment), total: String(totalSegments) });
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
    startBtn.textContent = t('subtitles.actions.start');
  }
  if (cancelBtn) cancelBtn.classList.add('hidden');

  // Update result display
  const outputFilePathEl = document.getElementById('output-file-path');
  if (outputFilePathEl) {
    outputFilePathEl.textContent = t('subtitles.result.outputFile', { path: outputPath });
  }

  // Store output path for later actions
  (window as any).lastOutputPath = outputPath;

  alert(t('subtitles.error.transcriptionComplete'));
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
    startBtn.textContent = t('subtitles.actions.start');
  }
  if (cancelBtn) cancelBtn.classList.add('hidden');

  alert(t('subtitles.error.transcriptionFailed', { error: message }));
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
