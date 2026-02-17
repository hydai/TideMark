/**
 * Extension i18n Engine (F9.4)
 *
 * Same key architecture and fallback chain as Desktop i18n (F9.1, F9.2):
 *   user language → zh-TW → raw key string
 *
 * Language preference is stored in Chrome Storage (NOT Cloud Sync).
 * Extension language is independent from Desktop app language.
 *
 * Translations are inlined as TypeScript constants for reliable bundling
 * in Chrome MV3 extensions (avoids JSON module import issues).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationMap = Record<string, any>;

/** Chrome Storage key for language preference. */
const LANGUAGE_STORAGE_KEY = 'language';

/** Supported locales. */
export const SUPPORTED_LOCALES = ['zh-TW', 'en', 'ja'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

// ── Inlined translation tables ────────────────────────────────────────────────

const ZH_TW: TranslationMap = {
  common: {
    actions: {
      save: '儲存',
      cancel: '取消',
      confirm: '確認',
      delete: '刪除',
      edit: '編輯',
      add: '新增',
      close: '關閉',
      copy: '複製',
      retry: '重試',
    },
  },
  extension: {
    title: 'Tidemark',
    platform: { youtube: 'YouTube', twitch: 'Twitch' },
    videoInfo: { currentTime: '當前時間: {time}' },
    recordForm: {
      topicPlaceholder: '輸入主題名稱 (可選)',
      recordButton: '記錄當前時間',
      recorded: '✓ 已記錄',
    },
    folders: {
      header: '資料夾',
      inputPlaceholder: '新增資料夾...',
      addButtonTitle: '新增資料夾',
      uncategorized: '未分類',
      deleteConfirm: '確定要刪除此資料夾嗎？資料夾內的記錄將移至「未分類」',
    },
    records: {
      header: '記錄列表',
      count: '共 {count} 筆',
      empty: '尚無記錄',
      labels: { time: '時間:', created: '建立:', platform: '平台:' },
      copyTimeTitle: '複製時間',
      vodLink: '前往 VOD →',
      deleteConfirm: '確定要刪除這筆記錄嗎?',
    },
    settings: {
      toggle: '⚙️ 設定',
      sync: {
        header: '雲端同步',
        notLoggedIn: '未登入',
        synced: '已同步',
        syncing: '同步中...',
        error: '同步錯誤',
        loginButton: '🔐 使用 Google 登入',
        loginDesc: '登入後可在多個裝置間同步記錄與資料夾',
        loggingIn: '登入中...',
        loggedInAs: '已登入為:',
        logoutButton: '登出',
        devMode: '開發測試模式',
        jwtPlaceholder: '貼上測試 JWT',
        setJwtButton: '設定測試 JWT',
      },
      dataBackup: {
        header: '資料備份與還原',
        exportButton: '📥 匯出資料',
        exportDesc: '匯出所有記錄與資料夾為 JSON 檔案',
        exportingButton: '匯出中...',
        importButton: '📤 匯入資料',
        importDesc: '從 JSON 檔案匯入記錄與資料夾',
      },
      language: {
        header: '語言 / Language',
        label: '顯示語言',
      },
    },
    importModal: {
      title: '選擇匯入模式',
      foundData: '找到 {stats}',
      mergeButton: '合併 (Merge)',
      overwriteButton: '覆寫 (Overwrite)',
      cancelButton: '取消',
      mergeHelp: '將匯入的資料加入現有資料，重複的 ID 會被跳過',
      overwriteHelp: '刪除所有現有資料，並替換為匯入的資料',
      mergeLabel: '合併:',
      overwriteLabel: '覆寫:',
    },
    time: {
      justNow: '剛剛',
      minutesAgo: '{count} 分鐘前',
      hoursAgo: '{count} 小時前',
    },
  },
  records: {
    defaultTopic: '無主題',
    exportStats: '{records} 筆記錄與 {folders} 個資料夾',
    importSuccess: {
      overwrite: '已覆寫：匯入 {records} 筆記錄與 {folders} 個資料夾',
      merge: '已合併：新增 {records} 筆記錄與 {folders} 個資料夾',
    },
  },
  errors: {
    e1_1a: '請在 YouTube 或 Twitch 頁面使用',
    e1_1b: '無法取得播放時間，請確認影片已載入',
    e1_1c: '請重新整理頁面',
    e1_1d: '儲存失敗，請稍後重試',
    e1_2b: '操作失敗',
    e1_4a: '檔案格式不正確',
    e1_4b: '無法匯入：資料版本不相容',
    e1_5: '讀取檔案失敗',
    e1_6a: '登入失敗，請稍後重試',
    e1_6d: '{field} 已被其他裝置更新',
    cannotGetPageInfo: '無法取得當前頁面資訊',
    copyFailed: '複製失敗',
    updateFailed: '更新失敗',
    exportFailed: '匯出失敗，請稍後重試',
    importFailed: '匯入失敗，請稍後重試',
    invalidJwt: '無效的 JWT',
    enterJwt: '請輸入 JWT',
    loginFailed: '登入失敗',
    logoutFailed: '登出失敗',
  },
  success: {
    recorded: '✓ 已記錄',
    jwtSet: '測試 JWT 已設定',
    loggedIn: '登入成功！',
    loggedOut: '已登出',
    exported: '已匯出 {records} 筆記錄與 {folders} 個資料夾',
  },
  i18n: {
    loadFailed: '語言載入失敗',
    fallbackMessage: '語言檔載入失敗，已切換回繁體中文',
  },
};

const EN: TranslationMap = {
  common: {
    actions: {
      save: 'Save',
      cancel: 'Cancel',
      confirm: 'Confirm',
      delete: 'Delete',
      edit: 'Edit',
      add: 'Add',
      close: 'Close',
      copy: 'Copy',
      retry: 'Retry',
    },
  },
  extension: {
    title: 'Tidemark',
    platform: { youtube: 'YouTube', twitch: 'Twitch' },
    videoInfo: { currentTime: 'Current time: {time}' },
    recordForm: {
      topicPlaceholder: 'Enter topic name (optional)',
      recordButton: 'Record Current Time',
      recorded: '✓ Recorded',
    },
    folders: {
      header: 'Folders',
      inputPlaceholder: 'Add folder...',
      addButtonTitle: 'Add folder',
      uncategorized: 'Uncategorized',
      deleteConfirm: 'Delete this folder? Records inside will be moved to "Uncategorized".',
    },
    records: {
      header: 'Record List',
      count: '{count} records',
      empty: 'No records yet',
      labels: { time: 'Time:', created: 'Created:', platform: 'Platform:' },
      copyTimeTitle: 'Copy time',
      vodLink: 'Go to VOD →',
      deleteConfirm: 'Delete this record?',
    },
    settings: {
      toggle: '⚙️ Settings',
      sync: {
        header: 'Cloud Sync',
        notLoggedIn: 'Not logged in',
        synced: 'Synced',
        syncing: 'Syncing...',
        error: 'Sync error',
        loginButton: '🔐 Sign in with Google',
        loginDesc: 'Sign in to sync records and folders across devices',
        loggingIn: 'Signing in...',
        loggedInAs: 'Signed in as:',
        logoutButton: 'Sign out',
        devMode: 'Developer test mode',
        jwtPlaceholder: 'Paste test JWT',
        setJwtButton: 'Set test JWT',
      },
      dataBackup: {
        header: 'Data Backup & Restore',
        exportButton: '📥 Export Data',
        exportDesc: 'Export all records and folders as a JSON file',
        exportingButton: 'Exporting...',
        importButton: '📤 Import Data',
        importDesc: 'Import records and folders from a JSON file',
      },
      language: {
        header: 'Language / 語言',
        label: 'Display language',
      },
    },
    importModal: {
      title: 'Select Import Mode',
      foundData: 'Found {stats}',
      mergeButton: 'Merge',
      overwriteButton: 'Overwrite',
      cancelButton: 'Cancel',
      mergeHelp: 'Add imported data to existing data; duplicate IDs are skipped',
      overwriteHelp: 'Delete all existing data and replace with imported data',
      mergeLabel: 'Merge:',
      overwriteLabel: 'Overwrite:',
    },
    time: {
      justNow: 'Just now',
      minutesAgo: '{count} min ago',
      hoursAgo: '{count} hr ago',
    },
  },
  records: {
    defaultTopic: 'No topic',
    exportStats: '{records} records and {folders} folders',
    importSuccess: {
      overwrite: 'Overwritten: imported {records} records and {folders} folders',
      merge: 'Merged: added {records} records and {folders} folders',
    },
  },
  errors: {
    e1_1a: 'Please use on a YouTube or Twitch page',
    e1_1b: 'Cannot get playback time, please make sure the video is loaded',
    e1_1c: 'Please refresh the page',
    e1_1d: 'Save failed, please try again',
    e1_2b: 'Operation failed',
    e1_4a: 'Invalid file format',
    e1_4b: 'Cannot import: incompatible data version',
    e1_5: 'Failed to read file',
    e1_6a: 'Sign in failed, please try again',
    e1_6d: '{field} was updated by another device',
    cannotGetPageInfo: 'Cannot get current page info',
    copyFailed: 'Copy failed',
    updateFailed: 'Update failed',
    exportFailed: 'Export failed, please try again',
    importFailed: 'Import failed, please try again',
    invalidJwt: 'Invalid JWT',
    enterJwt: 'Please enter a JWT',
    loginFailed: 'Sign in failed',
    logoutFailed: 'Sign out failed',
  },
  success: {
    recorded: '✓ Recorded',
    jwtSet: 'Test JWT set',
    loggedIn: 'Signed in!',
    loggedOut: 'Signed out',
    exported: 'Exported {records} records and {folders} folders',
  },
  i18n: {
    loadFailed: 'Language load failed',
    fallbackMessage: 'Failed to load language file, falling back to Traditional Chinese',
  },
};

const JA: TranslationMap = {
  common: {
    actions: {
      save: '保存',
      cancel: 'キャンセル',
      confirm: '確認',
      delete: '削除',
      edit: '編集',
      add: '追加',
      close: '閉じる',
      copy: 'コピー',
      retry: '再試行',
    },
  },
  extension: {
    title: 'Tidemark',
    platform: { youtube: 'YouTube', twitch: 'Twitch' },
    videoInfo: { currentTime: '現在時刻: {time}' },
    recordForm: {
      topicPlaceholder: 'トピック名を入力（任意）',
      recordButton: '現在時刻を記録',
      recorded: '✓ 記録済み',
    },
    folders: {
      header: 'フォルダー',
      inputPlaceholder: 'フォルダーを追加...',
      addButtonTitle: 'フォルダーを追加',
      uncategorized: '未分類',
      deleteConfirm: 'このフォルダーを削除しますか？フォルダー内の記録は「未分類」に移動します。',
    },
    records: {
      header: '記録リスト',
      count: '{count} 件',
      empty: '記録がありません',
      labels: { time: '時刻:', created: '作成:', platform: 'プラットフォーム:' },
      copyTimeTitle: '時刻をコピー',
      vodLink: 'VOD を開く →',
      deleteConfirm: 'この記録を削除しますか？',
    },
    settings: {
      toggle: '⚙️ 設定',
      sync: {
        header: 'クラウド同期',
        notLoggedIn: '未ログイン',
        synced: '同期済み',
        syncing: '同期中...',
        error: '同期エラー',
        loginButton: '🔐 Google でログイン',
        loginDesc: 'ログインすると複数のデバイス間で記録とフォルダーを同期できます',
        loggingIn: 'ログイン中...',
        loggedInAs: 'ログイン中:',
        logoutButton: 'ログアウト',
        devMode: '開発テストモード',
        jwtPlaceholder: 'テスト JWT を貼り付け',
        setJwtButton: 'テスト JWT を設定',
      },
      dataBackup: {
        header: 'データのバックアップと復元',
        exportButton: '📥 データをエクスポート',
        exportDesc: 'すべての記録とフォルダーを JSON ファイルとしてエクスポート',
        exportingButton: 'エクスポート中...',
        importButton: '📤 データをインポート',
        importDesc: 'JSON ファイルから記録とフォルダーをインポート',
      },
      language: {
        header: '言語 / Language',
        label: '表示言語',
      },
    },
    importModal: {
      title: 'インポートモードを選択',
      foundData: '{stats} が見つかりました',
      mergeButton: 'マージ (Merge)',
      overwriteButton: '上書き (Overwrite)',
      cancelButton: 'キャンセル',
      mergeHelp: 'インポートしたデータを既存データに追加します。ID が重複するものはスキップされます',
      overwriteHelp: 'すべての既存データを削除し、インポートしたデータに置き換えます',
      mergeLabel: 'マージ:',
      overwriteLabel: '上書き:',
    },
    time: {
      justNow: 'たった今',
      minutesAgo: '{count} 分前',
      hoursAgo: '{count} 時間前',
    },
  },
  records: {
    defaultTopic: 'トピックなし',
    exportStats: '{records} 件の記録と {folders} 個のフォルダー',
    importSuccess: {
      overwrite: '上書き完了：{records} 件の記録と {folders} 個のフォルダーをインポート',
      merge: 'マージ完了：{records} 件の記録と {folders} 個のフォルダーを追加',
    },
  },
  errors: {
    e1_1a: 'YouTube または Twitch のページで使用してください',
    e1_1b: '再生時刻を取得できません。動画が読み込まれているか確認してください',
    e1_1c: 'ページを更新してください',
    e1_1d: '保存に失敗しました。後でもう一度お試しください',
    e1_2b: '操作に失敗しました',
    e1_4a: 'ファイル形式が正しくありません',
    e1_4b: 'インポートできません：データのバージョンが互換性がありません',
    e1_5: 'ファイルの読み込みに失敗しました',
    e1_6a: 'ログインに失敗しました。後でもう一度お試しください',
    e1_6d: '{field} が別のデバイスで更新されました',
    cannotGetPageInfo: '現在のページ情報を取得できません',
    copyFailed: 'コピーに失敗しました',
    updateFailed: '更新に失敗しました',
    exportFailed: 'エクスポートに失敗しました。後でもう一度お試しください',
    importFailed: 'インポートに失敗しました。後でもう一度お試しください',
    invalidJwt: '無効な JWT',
    enterJwt: 'JWT を入力してください',
    loginFailed: 'ログインに失敗しました',
    logoutFailed: 'ログアウトに失敗しました',
  },
  success: {
    recorded: '✓ 記録済み',
    jwtSet: 'テスト JWT を設定しました',
    loggedIn: 'ログインしました！',
    loggedOut: 'ログアウトしました',
    exported: '{records} 件の記録と {folders} 個のフォルダーをエクスポートしました',
  },
  i18n: {
    loadFailed: '言語の読み込みに失敗しました',
    fallbackMessage: '言語ファイルの読み込みに失敗しました。繁体字中国語にフォールバックします',
  },
};

/** All translation maps keyed by locale. */
const translations: Record<string, TranslationMap> = {
  'zh-TW': ZH_TW,
  'en': EN,
  'ja': JA,
};

// ── State ─────────────────────────────────────────────────────────────────────

/** Currently active locale. */
let currentLocale: string = 'zh-TW';

/** Registered re-render callbacks. Called after language switches. */
const rerenderCallbacks: Array<() => void> = [];

// ── Public API ────────────────────────────────────────────────────────────────

/** Register a callback to be called after a language switch. */
export function setRerenderCallback(cb: () => void): void {
  rerenderCallbacks.push(cb);
}

/** Return the currently active locale code. */
export function getCurrentLanguage(): string {
  return currentLocale;
}

/**
 * Initialise the i18n engine.
 *
 * Loads the language preference from Chrome Storage and sets the active locale.
 * Falls back to zh-TW if the stored locale is not supported (E9.4a).
 */
export async function initI18n(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([LANGUAGE_STORAGE_KEY]);
    const stored = result[LANGUAGE_STORAGE_KEY] as string | undefined;

    if (stored && Object.prototype.hasOwnProperty.call(translations, stored)) {
      currentLocale = stored;
    } else {
      currentLocale = 'zh-TW';
    }
  } catch (err) {
    console.error('[i18n] Failed to load language preference from Chrome Storage:', err);
    currentLocale = 'zh-TW';
    // E9.4a: show fallback notice
    showFallbackNotice();
  }
}

/**
 * Switch the active language.
 *
 * 1. Validates the target locale is supported.
 * 2. On success, persists the choice to Chrome Storage and triggers re-renders.
 * 3. On failure (E9.4a), falls back to zh-TW.
 */
export async function setLanguage(locale: string): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(translations, locale)) {
    console.warn(`[i18n] Unsupported locale "${locale}", falling back to zh-TW.`);
    currentLocale = 'zh-TW';
    showFallbackNotice();
    triggerRerender();
    return;
  }

  currentLocale = locale;

  try {
    await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: locale });
  } catch (err) {
    console.error('[i18n] Failed to persist language preference:', err);
  }

  triggerRerender();
}

function triggerRerender(): void {
  rerenderCallbacks.forEach(cb => {
    try {
      cb();
    } catch (err) {
      console.error('[i18n] Re-render callback threw an error:', err);
    }
  });
}

// ── Translation lookup ────────────────────────────────────────────────────────

/**
 * Look up a flat dotted key in a translation map.
 * E.g. "extension.records.empty" traverses nested objects.
 */
function lookup(map: TranslationMap, key: string): string | undefined {
  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = map;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') {
      return undefined;
    }
    node = node[part];
  }
  if (typeof node === 'string') {
    return node;
  }
  return undefined;
}

/**
 * Apply `{variable}` interpolation to a string.
 *
 * Missing params are left as-is with a warning.
 */
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{([^,}]+)\}/g, (_match, name) => {
    const trimmed = name.trim();
    if (Object.prototype.hasOwnProperty.call(params, trimmed)) {
      return String(params[trimmed]);
    }
    console.warn(`[i18n] Missing interpolation param: "${trimmed}" in template: "${template}"`);
    return `{${trimmed}}`;
  });
}

/**
 * Translate a key, optionally substituting `{variable}` placeholders.
 *
 * Fallback chain: current locale → zh-TW → raw key string (E9.2a).
 */
export function t(key: string, params?: Record<string, string | number>): string {
  // 1. Try current locale
  let raw: string | undefined;
  const currentMap = translations[currentLocale];
  if (currentMap) {
    raw = lookup(currentMap, key);
  }

  // 2. Fallback to zh-TW
  if (raw === undefined && currentLocale !== 'zh-TW') {
    const zhMap = translations['zh-TW'];
    if (zhMap) {
      raw = lookup(zhMap, key);
    }
  }

  // 3. Fallback to raw key string (E9.2a)
  if (raw === undefined) {
    console.warn(`[i18n] Missing translation key: "${key}" in locale "${currentLocale}"`);
    return key;
  }

  if (!params) {
    return raw;
  }

  return interpolate(raw, params);
}

// ── Fallback notice for language load failure (E9.4a) ─────────────────────────

/**
 * Show a notice in the popup when language falls back to zh-TW (E9.4a).
 */
function showFallbackNotice(): void {
  setTimeout(() => {
    const container = getOrCreateNoticeContainer();
    const el = document.createElement('div');
    el.className = 'i18n-fallback-notice';

    const titleEl = document.createElement('div');
    titleEl.className = 'i18n-fallback-notice-title';
    titleEl.textContent = lookup(ZH_TW, 'i18n.loadFailed') ?? '語言載入失敗';
    el.appendChild(titleEl);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'i18n-fallback-notice-body';
    bodyEl.textContent = lookup(ZH_TW, 'i18n.fallbackMessage') ?? '語言檔載入失敗，已切換回繁體中文';
    el.appendChild(bodyEl);

    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('i18n-fallback-notice-fade');
      setTimeout(() => el.remove(), 400);
    }, 5000);
  }, 100);
}

function getOrCreateNoticeContainer(): HTMLElement {
  let container = document.getElementById('i18n-notice-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'i18n-notice-container';
    container.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'z-index:9999',
      'display:flex',
      'flex-direction:column',
      'gap:4px',
    ].join(';');
    document.body.appendChild(container);
  }
  return container;
}
