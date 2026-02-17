/**
 * i18n Core Engine (F9.1, F9.2, F9.3)
 *
 * - t(key, params?) — translate with optional interpolation / plural support
 * - setLanguage(locale) — switch language and trigger page re-render
 * - getCurrentLanguage() / loadLanguage(locale)
 *
 * Fallback chain: user language → zh-TW → raw key string
 */

type TranslationMap = Record<string, string | Record<string, string | Record<string, string>>>;

/** Loaded translation maps keyed by locale code. */
const loadedLanguages: Record<string, TranslationMap> = {};

/** Currently active locale. */
let currentLocale = 'zh-TW';

/**
 * Registered page re-render callback.  Set by app.ts via `setRerenderCallback`.
 */
let rerenderCallback: (() => void) | null = null;

/** Register a callback that is called after a language switch to re-render the
 *  current page.  Called once from app.ts during init. */
export function setRerenderCallback(cb: () => void): void {
  rerenderCallback = cb;
}

/** Return the currently active locale code. */
export function getCurrentLanguage(): string {
  return currentLocale;
}

/**
 * Load a language JSON file from the bundled assets.
 *
 * Returns `true` on success, `false` on failure (E9.1a / E9.1b).
 */
export async function loadLanguage(locale: string): Promise<boolean> {
  if (loadedLanguages[locale]) {
    return true; // already cached
  }

  try {
    const response = await fetch(`/locales/${locale}.json`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const raw = await response.text();
    const data = JSON.parse(raw) as TranslationMap;
    loadedLanguages[locale] = data;
    return true;
  } catch (err) {
    console.error(`[i18n] Failed to load language "${locale}":`, err);
    return false;
  }
}

/**
 * Switch the active language.
 *
 * 1. Loads the target language file.
 * 2. On success, persists the choice and triggers re-render.
 * 3. On failure (E9.1a/E9.1b), falls back to zh-TW and shows a toast.
 */
export async function setLanguage(locale: string): Promise<void> {
  // Make sure zh-TW baseline is always loaded
  if (!loadedLanguages['zh-TW']) {
    await loadLanguage('zh-TW');
  }

  const ok = await loadLanguage(locale);

  if (!ok && locale !== 'zh-TW') {
    console.warn(`[i18n] Falling back to zh-TW because "${locale}" failed to load.`);
    currentLocale = 'zh-TW';
    showFallbackToast();
  } else {
    currentLocale = ok ? locale : 'zh-TW';
  }

  // Trigger page re-render
  if (rerenderCallback) {
    rerenderCallback();
  }
}

/**
 * Initialise the i18n engine.
 *
 * Loads zh-TW (always required) and the user's preferred locale.
 */
export async function initI18n(preferredLocale: string = 'zh-TW'): Promise<void> {
  // Always load the base zh-TW
  await loadLanguage('zh-TW');

  if (preferredLocale !== 'zh-TW') {
    const ok = await loadLanguage(preferredLocale);
    if (ok) {
      currentLocale = preferredLocale;
    } else {
      currentLocale = 'zh-TW';
      showFallbackToast();
    }
  } else {
    currentLocale = 'zh-TW';
  }
}

// ── Translation lookup ────────────────────────────────────────────────────────

/**
 * Look up a flat dotted key in a translation map.
 * E.g. "download.settings.quality" traverses nested objects.
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
 * Missing params are left as-is (E9.2b) with a warning.
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
 * Handle plural forms:  `{count, one:..., other:...}`
 *
 * The `other` branch may itself contain `{variable}` placeholders such as
 * `{count} items`, so the regex must allow balanced inner braces.
 *
 * Replaces the plural expression in-place before normal interpolation.
 */
function resolvePlurals(template: string, params: Record<string, string | number>): string {
  // The `other:` branch value can contain {variable} placeholders (e.g. {count}).
  // Use a character class that permits { } pairs inside `other`.
  return template.replace(
    /\{(\w+),\s*one:([^,}]+),\s*other:((?:[^{}]|\{[^}]*\})*)\}/g,
    (_match, countKey, one, other) => {
      const count = params[countKey];
      if (count === undefined) {
        console.warn(`[i18n] Missing plural count param: "${countKey}" in template: "${template}"`);
        return _match;
      }
      return Number(count) === 1 ? one.trim() : other.trim();
    }
  );
}

/**
 * Translate a key, optionally substituting `{variable}` placeholders and
 * resolving plural forms.
 *
 * Fallback chain: current locale → zh-TW → raw key string (E9.2a).
 */
export function t(key: string, params?: Record<string, string | number>): string {
  // 1. Try current locale
  let raw: string | undefined;
  const currentMap = loadedLanguages[currentLocale];
  if (currentMap) {
    raw = lookup(currentMap, key);
  }

  // 2. Fallback to zh-TW
  if (raw === undefined && currentLocale !== 'zh-TW') {
    const zhMap = loadedLanguages['zh-TW'];
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

  // Resolve plurals first, then interpolate
  const resolved = resolvePlurals(raw, params);
  return interpolate(resolved, params);
}

// ── Backend LocalizedMessage resolver ────────────────────────────────────────

/**
 * A structured message object emitted by the Rust backend (F9.5).
 *
 * The backend emits `{ "key": "errors.download.failed", "params": { ... } }`
 * instead of raw Chinese strings so the frontend can resolve them via the
 * active locale.
 */
export interface LocalizedMessage {
  key: string;
  params?: Record<string, string | number>;
}

/**
 * Resolve a value that may be either a plain string or a `LocalizedMessage`
 * object received from the Rust backend.
 *
 * - If `msg` is a `LocalizedMessage` (has a `key` field), resolve it via
 *   `t(key, params)`.  If the key is missing in the locale (E9.5a) the raw
 *   key string is returned and a warning is logged.  If a required
 *   interpolation variable is absent (E9.5b) the placeholder is kept as-is.
 * - If `msg` is a plain string (backward-compatibility path), return it
 *   unchanged.
 */
export function resolveLocalizedMessage(msg: string | LocalizedMessage | null | undefined): string {
  if (msg === null || msg === undefined) {
    return '';
  }
  if (typeof msg === 'object' && 'key' in msg) {
    return t(msg.key, msg.params);
  }
  if (typeof msg === 'string') {
    // Try to parse as a JSON LocalizedMessage (used when backend stores
    // the message as a JSON string inside a string field, e.g. error_message).
    if (msg.startsWith('{') && msg.includes('"key"')) {
      try {
        const parsed = JSON.parse(msg) as LocalizedMessage;
        if (parsed && typeof parsed.key === 'string') {
          return t(parsed.key, parsed.params);
        }
      } catch {
        // Not valid JSON — fall through to plain string return
      }
    }
    // Plain string — backward-compatible pass-through
    return msg;
  }
  return String(msg);
}

// ── Toast notification for language load failure ──────────────────────────────

function showFallbackToast(): void {
  // Use a small delay to ensure the DOM is ready
  setTimeout(() => {
    const container = getOrCreateToastContainer();
    const el = document.createElement('div');
    el.className = 'global-toast global-toast-warning';

    const titleEl = document.createElement('div');
    titleEl.className = 'global-toast-title';
    titleEl.textContent = '語言載入失敗';
    el.appendChild(titleEl);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'global-toast-body';
    bodyEl.textContent = '語言檔載入失敗，已切換回繁體中文';
    el.appendChild(bodyEl);

    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('global-toast-fade-out');
      setTimeout(() => el.remove(), 400);
    }, 5000);
  }, 100);
}

function getOrCreateToastContainer(): HTMLElement {
  let container = document.getElementById('global-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'global-toast-container';
    container.className = 'global-toast-container';
    document.body.appendChild(container);
  }
  return container;
}
