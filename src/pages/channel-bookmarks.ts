import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ConfigManager } from '../config';

interface ChannelBookmark {
  id: string;
  channel_id: string;
  channel_name: string;
  platform: string;     // "twitch" | "youtube"
  notes: string;
  sort_order: number;
  created_at: string;   // ISO 8601
  updated_at: string;   // ISO 8601
}

interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  platform: string;
}

interface ChannelMetadata {
  channel_id: string;
  platform: string;
  avatar_url: string | null;
  follower_count: number | null;
  last_stream_at: string | null;  // ISO 8601
  last_refreshed_at: string;      // ISO 8601
}

interface BookmarkSortOrder {
  id: string;
  sort_order: number;
}

interface ChannelLiveStatus {
  channel_id: string;
  platform: string;
  is_live: boolean;
}

interface LiveStatusUpdatePayload {
  channel_id: string;
  platform: string;
  is_live: boolean;
}

// Minimal preset shape needed for association display
interface DownloadPresetLink {
  channel_id: string;
  platform: string;
  enabled: boolean;
}

interface ChannelVideo {
  video_id: string;
  title: string;
  url: string;
  thumbnail_url: string | null;
  published_at: string;      // ISO 8601
  duration: string | null;   // e.g. "1:23:45"
  view_count: number | null;
  content_type: string;      // "video" / "clip" / "stream"
}

// Transient in-memory cache: key = "platform:channel_id" → videos list.
// Not persisted; cleared when renderPage() is called (on tab switch/re-render).
const videoCache: Map<string, ChannelVideo[]> = new Map();

let bookmarks: ChannelBookmark[] = [];
// presetLinks: key = "platform:channel_id" → enabled (true/false)
const presetLinks: Map<string, boolean> = new Map();
let containerEl: HTMLElement | null = null;

// Drag-and-drop state
let dragSrcId: string | null = null;

// Live status: key = "platform:channel_id" → is_live
const liveStatuses: Map<string, boolean> = new Map();

// Tauri event unlisten function (set once on first render)
let liveStatusUnlisten: (() => void) | null = null;

// Channel metadata cache: key = "platform:channel_id" → ChannelMetadata
const metadataCache: Map<string, ChannelMetadata> = new Map();

export async function renderChannelBookmarksPage(container: HTMLElement) {
  containerEl = container;
  await loadBookmarks();
  await loadInitialLiveStatuses();
  await loadPresetLinks();
  await loadMetadataCache();
  await ensureLiveStatusListener();
  const config = ConfigManager.get();
  // Read and clear any focus target set by cross-tab navigation (F8.7)
  const focusTarget = (window as any).__bookmarksFocusTarget as
    { channelId: string; platform: string } | undefined;
  if (focusTarget) {
    delete (window as any).__bookmarksFocusTarget;
  }
  renderPage(container, config.enable_scheduled_downloads);
  if (focusTarget) {
    highlightBookmarkCard(focusTarget.channelId, focusTarget.platform);
  }
  // Kick off background stale-metadata refresh (does not block render)
  checkAndRefreshStaleMetadata();
}

async function loadBookmarks() {
  try {
    bookmarks = await invoke<ChannelBookmark[]>('get_channel_bookmarks');
    bookmarks.sort((a, b) => a.sort_order - b.sort_order);
  } catch (error) {
    console.error('Failed to load bookmarks:', error);
    bookmarks = [];
  }
}

async function loadInitialLiveStatuses() {
  try {
    const statuses = await invoke<ChannelLiveStatus[]>('get_channel_live_statuses');
    for (const s of statuses) {
      liveStatuses.set(`${s.platform}:${s.channel_id}`, s.is_live);
    }
  } catch (error) {
    // get_channel_live_statuses may fail if monitoring is not started — that's fine
    console.debug('Failed to load initial live statuses (monitoring may be inactive):', error);
  }
}

/** Load all scheduled presets and build the presetLinks map for association display. */
async function loadPresetLinks() {
  presetLinks.clear();
  try {
    const presets = await invoke<DownloadPresetLink[]>('get_scheduled_presets');
    for (const p of presets) {
      presetLinks.set(`${p.platform}:${p.channel_id}`, p.enabled);
    }
  } catch (error) {
    // Scheduled downloads may be disabled — that's fine
    console.debug('Failed to load scheduled presets for link display:', error);
  }
}

/** Load the persisted metadata cache from disk and populate metadataCache. */
async function loadMetadataCache() {
  try {
    const entries = await invoke<ChannelMetadata[]>('get_channel_metadata_cache');
    for (const entry of entries) {
      metadataCache.set(`${entry.platform}:${entry.channel_id}`, entry);
    }
  } catch (error) {
    console.debug('Failed to load metadata cache:', error);
  }
}

/** Format a follower count number as a short string, e.g. 12500 → "12.5K". */
function formatFollowerCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  } else if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(count);
}

/** Return a relative time string like "3 天前". */
function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay >= 1) return `${diffDay} 天前`;
  if (diffHour >= 1) return `${diffHour} 小時前`;
  if (diffMin >= 1) return `${diffMin} 分鐘前`;
  return '剛剛';
}

/** Silently refresh stale metadata entries in background and update card UI. */
async function checkAndRefreshStaleMetadata() {
  const config = ConfigManager.get();
  const maxAgeMs = (config.metadata_refresh_interval_hours ?? 24) * 60 * 60 * 1000;
  const now = Date.now();

  // Collect which bookmarks need refreshing
  const staleBookmarks = bookmarks.filter((bm) => {
    const key = `${bm.platform}:${bm.channel_id}`;
    const cached = metadataCache.get(key);
    if (!cached) return true;  // no cache entry → stale
    const age = now - new Date(cached.last_refreshed_at).getTime();
    return age > maxAgeMs;
  });

  if (staleBookmarks.length === 0) return;

  // Refresh each stale bookmark one at a time (avoid parallel API flooding)
  const updatedEntries: ChannelMetadata[] = [];
  for (const bm of staleBookmarks) {
    try {
      const meta = await invoke<ChannelMetadata>('fetch_channel_metadata', {
        channelId: bm.channel_id,
        platform: bm.platform,
      });
      const key = `${meta.platform}:${meta.channel_id}`;
      metadataCache.set(key, meta);
      updateCardMetadataUI(bm.channel_id, bm.platform, meta);
      updatedEntries.push(meta);
    } catch (_err) {
      // Silently ignore individual fetch failures
    }
  }

  if (updatedEntries.length > 0) {
    // Merge updated entries into the full cache list and persist
    const allEntries: ChannelMetadata[] = [...metadataCache.values()];
    try {
      await invoke('save_channel_metadata_cache', { cache: allEntries });
    } catch (_err) {
      // Ignore save failure
    }
  }
}

/** Manually refresh metadata for a single channel and update cache + UI. */
async function refreshMetadataForChannel(channelId: string, platform: string) {
  try {
    const meta = await invoke<ChannelMetadata>('fetch_channel_metadata', {
      channelId,
      platform,
    });
    const key = `${meta.platform}:${meta.channel_id}`;
    metadataCache.set(key, meta);
    updateCardMetadataUI(channelId, platform, meta);

    // Persist
    const allEntries: ChannelMetadata[] = [...metadataCache.values()];
    await invoke('save_channel_metadata_cache', { cache: allEntries });
  } catch (_err) {
    // Silently ignore
  }
}

/** Update the avatar, follower count, and last stream time on a visible card. */
function updateCardMetadataUI(channelId: string, platform: string, meta: ChannelMetadata) {
  const cards = document.querySelectorAll<HTMLElement>('.bookmark-card');
  let card: HTMLElement | null = null;
  for (const c of Array.from(cards)) {
    if (c.dataset.channelId === channelId && c.dataset.platform === platform) {
      card = c;
      break;
    }
  }
  if (!card) return;

  // Update avatar image
  const avatar = card.querySelector<HTMLImageElement>('.bookmark-avatar');
  if (avatar && meta.avatar_url) {
    avatar.src = meta.avatar_url;
    avatar.style.display = '';
  }
  const avatarPlaceholder = card.querySelector<HTMLElement>('.bookmark-avatar-placeholder');
  if (avatarPlaceholder && meta.avatar_url) {
    avatarPlaceholder.style.display = 'none';
  }

  // Update follower count
  const followerEl = card.querySelector<HTMLElement>('.bookmark-follower-count');
  if (followerEl) {
    if (meta.follower_count !== null && meta.follower_count !== undefined) {
      const suffix = platform === 'youtube' ? '訂閱者' : '追蹤者';
      followerEl.textContent = `${formatFollowerCount(meta.follower_count)} ${suffix}`;
      followerEl.style.display = '';
    }
  }

  // Update last stream time
  const lastStreamEl = card.querySelector<HTMLElement>('.bookmark-last-stream');
  if (lastStreamEl && meta.last_stream_at) {
    lastStreamEl.textContent = `${formatRelativeTime(meta.last_stream_at)}直播`;
    lastStreamEl.style.display = '';
  }
}

/** Scroll to and briefly highlight the bookmark card for a given channel. */
function highlightBookmarkCard(channelId: string, platform: string) {
  const cards = document.querySelectorAll<HTMLElement>('.bookmark-card');
  for (const card of Array.from(cards)) {
    if (card.dataset.channelId === channelId && card.dataset.platform === platform) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('bookmark-card-highlight');
      setTimeout(() => card.classList.remove('bookmark-card-highlight'), 2000);
      break;
    }
  }
}

/** Register (once) the channel-live-status-update listener.
 *  When a status update comes in, update the in-memory map and refresh the badge
 *  on any visible card matching the channel. */
async function ensureLiveStatusListener() {
  if (liveStatusUnlisten) return; // Already registered

  liveStatusUnlisten = await listen<LiveStatusUpdatePayload>(
    'channel-live-status-update',
    (event) => {
      const { channel_id, platform, is_live } = event.payload;
      const key = `${platform}:${channel_id}`;
      liveStatuses.set(key, is_live);
      // Update badge on the card if it's visible in the DOM.
      updateCardBadge(channel_id, platform, is_live);
    }
  );
}

/** Update the live-status badge on the card for a given channel without re-rendering the whole page. */
function updateCardBadge(channel_id: string, platform: string, is_live: boolean) {
  // Find matching card by iterating - safer than CSS attribute selector escaping.
  const cards = document.querySelectorAll<HTMLElement>('.bookmark-card');
  let card: HTMLElement | null = null;
  for (const c of Array.from(cards)) {
    if (c.dataset.channelId === channel_id && c.dataset.platform === platform) {
      card = c;
      break;
    }
  }
  if (!card) return;

  let badge = card.querySelector<HTMLElement>('.bookmark-live-badge');
  if (is_live) {
    if (!badge) {
      badge = createLiveBadge(is_live);
      // Insert badge after the avatar wrapper
      const avatarWrapper = card.querySelector('.bookmark-avatar-wrapper');
      if (avatarWrapper && avatarWrapper.nextSibling) {
        card.insertBefore(badge, avatarWrapper.nextSibling);
      } else {
        card.appendChild(badge);
      }
    } else {
      badge.className = 'bookmark-live-badge live';
      badge.textContent = '直播中';
    }
  } else {
    if (!badge) {
      badge = createLiveBadge(is_live);
      const avatarWrapper = card.querySelector('.bookmark-avatar-wrapper');
      if (avatarWrapper && avatarWrapper.nextSibling) {
        card.insertBefore(badge, avatarWrapper.nextSibling);
      } else {
        card.appendChild(badge);
      }
    } else {
      badge.className = 'bookmark-live-badge offline';
      badge.textContent = '';
    }
  }
}

/** Create a live status badge element. */
function createLiveBadge(isLive: boolean): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `bookmark-live-badge ${isLive ? 'live' : 'offline'}`;
  badge.textContent = isLive ? '直播中' : '';
  return badge;
}

function renderPage(container: HTMLElement, scheduledEnabled: boolean) {
  // Clear transient video cache on every full re-render so that
  // re-expanding a card always fetches fresh data.
  videoCache.clear();
  container.textContent = '';

  const page = document.createElement('div');
  page.className = 'page channel-bookmarks-page';

  // Page header
  const header = document.createElement('div');
  header.className = 'page-header';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '頻道書籤';
  header.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.className = 'primary-button';
  addBtn.id = 'add-bookmark-btn';
  addBtn.textContent = '新增書籤';
  header.appendChild(addBtn);

  page.appendChild(header);

  // Hint banner when scheduled downloads are disabled
  if (!scheduledEnabled) {
    const banner = document.createElement('div');
    banner.className = 'bookmark-status-hint';
    banner.textContent = '啟用排程下載以獲取即時直播狀態';
    page.appendChild(banner);
  }

  // Add bookmark form (hidden by default)
  const addForm = createAddForm();
  page.appendChild(addForm);

  // Bookmark list
  const listSection = createBookmarkList(scheduledEnabled);
  page.appendChild(listSection);

  container.appendChild(page);

  // Wire up "新增書籤" button
  addBtn.addEventListener('click', () => {
    const form = document.getElementById('add-bookmark-form');
    if (!form) return;
    const isHidden = form.style.display === 'none' || form.style.display === '';
    form.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      const input = document.getElementById('bookmark-url-input') as HTMLInputElement;
      input?.focus();
    }
  });
}

function createAddForm(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.id = 'add-bookmark-form';
  wrapper.className = 'bookmark-add-form';
  wrapper.style.display = 'none';

  const inner = document.createElement('div');
  inner.className = 'bookmark-add-inner';

  // URL input row
  const urlRow = document.createElement('div');
  urlRow.className = 'url-resolve-row';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'form-input';
  urlInput.id = 'bookmark-url-input';
  urlInput.placeholder = 'https://twitch.tv/channelname 或 https://youtube.com/@handle';
  urlRow.appendChild(urlInput);

  const resolveBtn = document.createElement('button');
  resolveBtn.className = 'secondary-button';
  resolveBtn.id = 'bookmark-resolve-btn';
  resolveBtn.textContent = '解析';
  urlRow.appendChild(resolveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'secondary-button';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', () => {
    wrapper.style.display = 'none';
    clearAddForm();
  });
  urlRow.appendChild(cancelBtn);

  inner.appendChild(urlRow);

  // Channel info display (shown after resolve)
  const channelInfoDiv = document.createElement('div');
  channelInfoDiv.className = 'channel-info-display';
  channelInfoDiv.id = 'bookmark-channel-info';
  channelInfoDiv.style.display = 'none';
  inner.appendChild(channelInfoDiv);

  // Error message
  const errorMsg = document.createElement('p');
  errorMsg.className = 'form-error';
  errorMsg.id = 'bookmark-url-error';
  errorMsg.style.display = 'none';
  inner.appendChild(errorMsg);

  // Hidden resolved fields
  const channelIdInput = document.createElement('input');
  channelIdInput.type = 'hidden';
  channelIdInput.id = 'bookmark-channel-id';
  inner.appendChild(channelIdInput);

  const channelNameInput = document.createElement('input');
  channelNameInput.type = 'hidden';
  channelNameInput.id = 'bookmark-channel-name';
  inner.appendChild(channelNameInput);

  const platformInput = document.createElement('input');
  platformInput.type = 'hidden';
  platformInput.id = 'bookmark-platform';
  inner.appendChild(platformInput);

  // Save button (shown after resolve)
  const saveBtn = document.createElement('button');
  saveBtn.className = 'primary-button';
  saveBtn.id = 'bookmark-save-btn';
  saveBtn.textContent = '加入書籤';
  saveBtn.style.display = 'none';
  inner.appendChild(saveBtn);

  wrapper.appendChild(inner);

  // Resolve button logic
  resolveBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showFormError('bookmark-url-error', '請輸入頻道網址');
      return;
    }

    resolveBtn.disabled = true;
    resolveBtn.textContent = '解析中...';
    hideFormError('bookmark-url-error');
    channelInfoDiv.style.display = 'none';
    saveBtn.style.display = 'none';

    try {
      const info = await invoke<ChannelInfo>('resolve_channel_info', { url });

      channelIdInput.value = info.channel_id;
      channelNameInput.value = info.channel_name;
      platformInput.value = info.platform;

      // Show resolved info
      channelInfoDiv.textContent = '';
      const platformIcon = document.createElement('span');
      platformIcon.className = `bookmark-platform-icon ${info.platform}`;
      platformIcon.textContent = info.platform === 'youtube' ? '🔴' : '🟣';
      channelInfoDiv.appendChild(platformIcon);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'channel-info-name';
      nameSpan.textContent = info.channel_name;
      channelInfoDiv.appendChild(nameSpan);

      const platformLabel = document.createElement('span');
      platformLabel.className = `platform-badge ${info.platform}`;
      platformLabel.textContent = info.platform === 'youtube' ? 'YouTube' : 'Twitch';
      channelInfoDiv.appendChild(platformLabel);

      channelInfoDiv.style.display = 'flex';
      saveBtn.style.display = 'inline-block';

    } catch (error) {
      const errStr = String(error);
      const msg = errStr.includes('無法辨識') ? '無法辨識此頻道' : `解析失敗: ${errStr}`;
      showFormError('bookmark-url-error', msg);
      channelIdInput.value = '';
      channelNameInput.value = '';
      platformInput.value = '';
    } finally {
      resolveBtn.disabled = false;
      resolveBtn.textContent = '解析';
    }
  });

  // Allow pressing Enter to resolve
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') resolveBtn.click();
  });

  // Save bookmark
  saveBtn.addEventListener('click', async () => {
    const channelId = channelIdInput.value;
    const channelName = channelNameInput.value;
    const platform = platformInput.value;

    if (!channelId || !channelName || !platform) {
      showFormError('bookmark-url-error', '請先解析頻道網址');
      return;
    }

    saveBtn.disabled = true;

    const now = new Date().toISOString();
    const maxOrder = bookmarks.length > 0
      ? Math.max(...bookmarks.map(b => b.sort_order))
      : -1;

    const newBookmark: ChannelBookmark = {
      id: `bm-${Date.now()}`,
      channel_id: channelId,
      channel_name: channelName,
      platform,
      notes: '',
      sort_order: maxOrder + 1,
      created_at: now,
      updated_at: now,
    };

    try {
      await invoke('save_channel_bookmark', { bookmark: newBookmark });
      bookmarks.push(newBookmark);

      wrapper.style.display = 'none';
      clearAddForm();

      // Re-render page to show new bookmark
      if (containerEl) {
        const config = ConfigManager.get();
        renderPage(containerEl, config.enable_scheduled_downloads);
      }
    } catch (error) {
      const errStr = String(error);
      if (errStr.includes('已在書籤中')) {
        showFormError('bookmark-url-error', '此頻道已在書籤中');
      } else {
        showFormError('bookmark-url-error', `儲存失敗: ${errStr}`);
      }
      saveBtn.disabled = false;
    }
  });

  return wrapper;
}

function clearAddForm() {
  const urlInput = document.getElementById('bookmark-url-input') as HTMLInputElement;
  const channelIdInput = document.getElementById('bookmark-channel-id') as HTMLInputElement;
  const channelNameInput = document.getElementById('bookmark-channel-name') as HTMLInputElement;
  const platformInput = document.getElementById('bookmark-platform') as HTMLInputElement;
  const channelInfoDiv = document.getElementById('bookmark-channel-info');
  const saveBtn = document.getElementById('bookmark-save-btn') as HTMLButtonElement;
  const errorEl = document.getElementById('bookmark-url-error');

  if (urlInput) urlInput.value = '';
  if (channelIdInput) channelIdInput.value = '';
  if (channelNameInput) channelNameInput.value = '';
  if (platformInput) platformInput.value = '';
  if (channelInfoDiv) { channelInfoDiv.style.display = 'none'; channelInfoDiv.textContent = ''; }
  if (saveBtn) { saveBtn.style.display = 'none'; saveBtn.disabled = false; }
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
}

function createBookmarkList(scheduledEnabled: boolean): HTMLElement {
  const section = document.createElement('section');
  section.className = 'bookmark-list-section';
  section.id = 'bookmark-list';

  if (bookmarks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = '尚未加入任何頻道書籤';
    section.appendChild(empty);
    return section;
  }

  bookmarks.forEach((bookmark) => {
    const statusKey = `${bookmark.platform}:${bookmark.channel_id}`;
    const liveStatus = scheduledEnabled ? liveStatuses.get(statusKey) : undefined;
    const presetEnabled = presetLinks.has(statusKey) ? presetLinks.get(statusKey)! : undefined;
    const metadata = metadataCache.get(statusKey) ?? null;
    const card = createBookmarkCard(bookmark, liveStatus, scheduledEnabled, presetEnabled, metadata);
    section.appendChild(card);
  });

  return section;
}

function createBookmarkCard(
  bookmark: ChannelBookmark,
  liveStatus: boolean | undefined,
  scheduledEnabled: boolean,
  presetEnabled?: boolean,
  metadata?: ChannelMetadata | null
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'bookmark-card';
  card.dataset.bookmarkId = bookmark.id;
  card.dataset.channelId = bookmark.channel_id;
  card.dataset.platform = bookmark.platform;
  card.draggable = true;

  // Drag handle
  const dragHandle = document.createElement('div');
  dragHandle.className = 'bookmark-drag-handle';
  dragHandle.title = '拖曳以重新排序';
  dragHandle.textContent = '⋮⋮';
  card.appendChild(dragHandle);

  // Avatar circle (40x40px) — shows image if available, otherwise platform emoji placeholder
  const avatarWrapper = document.createElement('div');
  avatarWrapper.className = 'bookmark-avatar-wrapper';

  if (metadata?.avatar_url) {
    const img = document.createElement('img');
    img.className = 'bookmark-avatar';
    img.src = metadata.avatar_url;
    img.alt = bookmark.channel_name;
    img.width = 40;
    img.height = 40;
    img.onerror = () => {
      // On load error, fall back to placeholder emoji
      img.style.display = 'none';
      placeholder.style.display = 'flex';
    };
    avatarWrapper.appendChild(img);

    const placeholder = document.createElement('div');
    placeholder.className = 'bookmark-avatar-placeholder';
    placeholder.style.display = 'none';
    placeholder.textContent = bookmark.platform === 'youtube' ? '🔴' : '🟣';
    avatarWrapper.appendChild(placeholder);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'bookmark-avatar-placeholder';
    placeholder.textContent = bookmark.platform === 'youtube' ? '🔴' : '🟣';
    avatarWrapper.appendChild(placeholder);

    // Add a hidden img element for later update via updateCardMetadataUI
    const img = document.createElement('img');
    img.className = 'bookmark-avatar';
    img.alt = bookmark.channel_name;
    img.width = 40;
    img.height = 40;
    img.style.display = 'none';
    avatarWrapper.appendChild(img);
  }

  card.appendChild(avatarWrapper);

  // Live status badge (only when scheduled downloads enabled)
  if (scheduledEnabled) {
    if (liveStatus === true) {
      const badge = document.createElement('span');
      badge.className = 'bookmark-live-badge live';
      badge.textContent = '直播中';
      card.appendChild(badge);
    } else if (liveStatus === false) {
      const badge = document.createElement('span');
      badge.className = 'bookmark-live-badge offline';
      card.appendChild(badge);
    }
    // liveStatus === undefined → no badge (unknown/initial state)
  }

  // Preset status badge (show when a matching scheduled preset exists)
  if (presetEnabled === true) {
    const presetBadge = document.createElement('span');
    presetBadge.className = 'bookmark-preset-badge enabled';
    presetBadge.textContent = '📡 排程啟用中';
    presetBadge.title = '此頻道已設定排程下載（啟用中）';
    card.appendChild(presetBadge);
  } else if (presetEnabled === false) {
    const presetBadge = document.createElement('span');
    presetBadge.className = 'bookmark-preset-badge disabled';
    presetBadge.textContent = '📡 排程已停用';
    presetBadge.title = '此頻道已設定排程下載（已停用）';
    card.appendChild(presetBadge);
  }
  // presetEnabled === undefined → no preset badge

  // Channel info (name + platform badge + metadata row)
  const info = document.createElement('div');
  info.className = 'bookmark-info';

  const channelName = document.createElement('div');
  channelName.className = 'bookmark-channel-name';
  channelName.textContent = bookmark.channel_name;
  info.appendChild(channelName);

  // Metadata row: follower count + last stream time
  const metaRow = document.createElement('div');
  metaRow.className = 'bookmark-meta-row';

  const platformLabel = document.createElement('span');
  platformLabel.className = `platform-badge ${bookmark.platform}`;
  platformLabel.textContent = bookmark.platform === 'youtube' ? 'YouTube' : 'Twitch';
  metaRow.appendChild(platformLabel);

  const followerEl = document.createElement('span');
  followerEl.className = 'bookmark-follower-count';
  if (metadata?.follower_count !== null && metadata?.follower_count !== undefined) {
    const suffix = bookmark.platform === 'youtube' ? '訂閱者' : '追蹤者';
    followerEl.textContent = `${formatFollowerCount(metadata.follower_count)} ${suffix}`;
  } else {
    followerEl.style.display = 'none';
  }
  metaRow.appendChild(followerEl);

  const lastStreamEl = document.createElement('span');
  lastStreamEl.className = 'bookmark-last-stream';
  if (metadata?.last_stream_at) {
    lastStreamEl.textContent = `${formatRelativeTime(metadata.last_stream_at)}直播`;
  } else {
    lastStreamEl.style.display = 'none';
  }
  metaRow.appendChild(lastStreamEl);

  info.appendChild(metaRow);

  card.appendChild(info);

  // Notes area (inline editable)
  const notesArea = document.createElement('div');
  notesArea.className = 'bookmark-notes-area';

  const notesDisplay = document.createElement('span');
  notesDisplay.className = 'bookmark-notes-display';
  notesDisplay.textContent = bookmark.notes || '（點擊新增備註）';
  if (!bookmark.notes) notesDisplay.classList.add('placeholder');
  notesArea.appendChild(notesDisplay);

  const notesInput = document.createElement('input');
  notesInput.type = 'text';
  notesInput.className = 'bookmark-notes-input form-input';
  notesInput.value = bookmark.notes;
  notesInput.placeholder = '輸入備註...';
  notesInput.style.display = 'none';
  notesArea.appendChild(notesInput);

  card.appendChild(notesArea);

  // Metadata refresh button
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'action-btn bookmark-refresh-btn';
  refreshBtn.title = '重新整理頻道資訊';
  refreshBtn.textContent = '↺';
  card.appendChild(refreshBtn);

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn delete-btn bookmark-delete-btn';
  deleteBtn.textContent = '刪除';
  deleteBtn.title = '刪除此書籤';
  card.appendChild(deleteBtn);

  // Expand/collapse button for video list
  const expandBtn = document.createElement('button');
  expandBtn.className = 'action-btn bookmark-expand-btn';
  expandBtn.textContent = '展開';
  expandBtn.title = '展開最新影片列表';
  card.appendChild(expandBtn);

  // Video list container (collapsed by default)
  const videoListEl = document.createElement('div');
  videoListEl.className = 'bookmark-video-list';
  videoListEl.style.display = 'none';
  card.appendChild(videoListEl);

  // ── Expand/collapse logic ──
  let isExpanded = false;

  expandBtn.addEventListener('click', async () => {
    isExpanded = !isExpanded;

    if (!isExpanded) {
      expandBtn.textContent = '展開';
      expandBtn.title = '展開最新影片列表';
      videoListEl.style.display = 'none';
      return;
    }

    expandBtn.textContent = '收起';
    expandBtn.title = '收起影片列表';
    videoListEl.style.display = 'block';

    const cacheKey = `${bookmark.platform}:${bookmark.channel_id}`;

    // Check transient cache first
    if (videoCache.has(cacheKey)) {
      renderVideoList(videoListEl, videoCache.get(cacheKey)!);
      return;
    }

    // Fetch fresh data
    renderVideoListLoading(videoListEl);

    try {
      const config = ConfigManager.get();
      const count = config.video_cache_count ?? 5;
      const videos = await invoke<ChannelVideo[]>('fetch_channel_videos', {
        channelId: bookmark.channel_id,
        platform: bookmark.platform,
        count,
      });
      videoCache.set(cacheKey, videos);
      renderVideoList(videoListEl, videos);
    } catch (err) {
      renderVideoListError(videoListEl, () => {
        // Retry: clear cache entry and re-trigger expand
        videoCache.delete(cacheKey);
        isExpanded = false;
        expandBtn.click();
      });
    }
  });

  // ── Event listeners ──

  // Refresh metadata button
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '…';
    await refreshMetadataForChannel(bookmark.channel_id, bookmark.platform);
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↺';
  });

  // Inline notes editing: click on notes to edit
  notesDisplay.addEventListener('click', () => {
    notesDisplay.style.display = 'none';
    notesInput.style.display = 'block';
    notesInput.focus();
    notesInput.select();
  });

  const saveNotes = async () => {
    const newNotes = notesInput.value.trim();
    notesInput.style.display = 'none';
    notesDisplay.textContent = newNotes || '（點擊新增備註）';
    notesDisplay.classList.toggle('placeholder', !newNotes);
    notesDisplay.style.display = '';

    if (newNotes !== bookmark.notes) {
      bookmark.notes = newNotes;
      try {
        await invoke('save_channel_bookmark', { bookmark });
      } catch (error) {
        console.error('Failed to save notes:', error);
      }
    }
  };

  notesInput.addEventListener('blur', saveNotes);
  notesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      notesInput.blur();
    } else if (e.key === 'Escape') {
      notesInput.value = bookmark.notes;
      notesInput.blur();
    }
  });

  // Delete button
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`確定要刪除頻道「${bookmark.channel_name}」的書籤嗎？`)) return;
    deleteBtn.disabled = true;
    try {
      await invoke('delete_channel_bookmark', { id: bookmark.id });
      bookmarks = bookmarks.filter(b => b.id !== bookmark.id);
      if (containerEl) {
        const config = ConfigManager.get();
        renderPage(containerEl, config.enable_scheduled_downloads);
      }
    } catch (error) {
      alert(`刪除失敗: ${error}`);
      deleteBtn.disabled = false;
    }
  });

  // Drag-and-drop events
  card.addEventListener('dragstart', (e) => {
    dragSrcId = bookmark.id;
    card.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', bookmark.id);
    }
  });

  card.addEventListener('dragend', () => {
    dragSrcId = null;
    card.classList.remove('dragging');
    // Remove all drop-target highlights
    document.querySelectorAll('.bookmark-card').forEach(el => {
      el.classList.remove('drag-over');
    });
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dragSrcId && dragSrcId !== bookmark.id) {
      card.classList.add('drag-over');
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over');
  });

  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');

    if (!dragSrcId || dragSrcId === bookmark.id) return;

    const srcIdx = bookmarks.findIndex(b => b.id === dragSrcId);
    const dstIdx = bookmarks.findIndex(b => b.id === bookmark.id);
    if (srcIdx === -1 || dstIdx === -1) return;

    // Reorder in memory
    const [moved] = bookmarks.splice(srcIdx, 1);
    bookmarks.splice(dstIdx, 0, moved);

    // Assign new sort_order values
    bookmarks.forEach((b, i) => {
      b.sort_order = i;
    });

    // Persist
    const orders: BookmarkSortOrder[] = bookmarks.map(b => ({
      id: b.id,
      sort_order: b.sort_order,
    }));

    try {
      await invoke('reorder_channel_bookmarks', { orders });
    } catch (error) {
      console.error('Failed to reorder bookmarks:', error);
    }

    // Re-render
    if (containerEl) {
      const config = ConfigManager.get();
      renderPage(containerEl, config.enable_scheduled_downloads);
    }
  });

  return card;
}

function showFormError(elementId: string, message: string) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

function hideFormError(elementId: string) {
  const el = document.getElementById(elementId);
  if (el) {
    el.style.display = 'none';
    el.textContent = '';
  }
}

// ── Video list rendering helpers (F8.4) ───────────────────────────────────────

/** Show a loading indicator inside the video list container. */
function renderVideoListLoading(container: HTMLElement) {
  container.textContent = '';
  const spinner = document.createElement('div');
  spinner.className = 'bookmark-video-loading';
  spinner.textContent = '載入中…';
  container.appendChild(spinner);
}

/** Show an error message with a retry button inside the video list container. */
function renderVideoListError(container: HTMLElement, onRetry: () => void) {
  container.textContent = '';
  const errDiv = document.createElement('div');
  errDiv.className = 'bookmark-video-error';

  const msg = document.createElement('span');
  msg.textContent = '無法載入影片列表，請稍後重試';
  errDiv.appendChild(msg);

  const retryBtn = document.createElement('button');
  retryBtn.className = 'secondary-button bookmark-video-retry-btn';
  retryBtn.textContent = '重試';
  retryBtn.addEventListener('click', onRetry);
  errDiv.appendChild(retryBtn);

  container.appendChild(errDiv);
}

/** Render a loaded video list, or an empty-state message when no videos exist. */
function renderVideoList(container: HTMLElement, videos: ChannelVideo[]) {
  container.textContent = '';

  if (videos.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bookmark-video-empty';
    empty.textContent = '此頻道目前沒有公開影片';
    container.appendChild(empty);
    return;
  }

  for (const video of videos) {
    container.appendChild(createVideoCard(video));
  }
}

/** Create a single video card element with thumbnail, title, and metadata. */
function createVideoCard(video: ChannelVideo): HTMLElement {
  const item = document.createElement('a');
  item.className = 'bookmark-video-item';
  item.href = video.url;
  item.target = '_blank';
  item.rel = 'noopener noreferrer';
  item.addEventListener('click', (e) => e.stopPropagation());
  item.addEventListener('dragstart', (e) => e.preventDefault());

  // Thumbnail (120×68 px)
  const thumb = document.createElement('div');
  thumb.className = 'bookmark-video-thumb';
  if (video.thumbnail_url) {
    const img = document.createElement('img');
    img.src = video.thumbnail_url;
    img.alt = video.title;
    img.width = 120;
    img.height = 68;
    img.loading = 'lazy';
    img.addEventListener('error', () => { img.style.display = 'none'; });
    thumb.appendChild(img);
  }
  item.appendChild(thumb);

  // Info column (title + meta row)
  const info = document.createElement('div');
  info.className = 'bookmark-video-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'bookmark-video-title';
  titleEl.textContent = video.title;
  info.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'bookmark-video-meta';

  // Relative date
  const dateEl = document.createElement('span');
  dateEl.className = 'bookmark-video-date';
  dateEl.textContent = formatRelativeDate(video.published_at);
  dateEl.title = video.published_at;
  meta.appendChild(dateEl);

  // Duration (if available)
  if (video.duration) {
    const sep1 = document.createElement('span');
    sep1.className = 'bookmark-video-sep';
    sep1.textContent = '·';
    meta.appendChild(sep1);

    const durEl = document.createElement('span');
    durEl.className = 'bookmark-video-duration';
    durEl.textContent = video.duration;
    meta.appendChild(durEl);
  }

  // View count (if available)
  if (video.view_count !== null && video.view_count !== undefined) {
    const sep2 = document.createElement('span');
    sep2.className = 'bookmark-video-sep';
    sep2.textContent = '·';
    meta.appendChild(sep2);

    const viewEl = document.createElement('span');
    viewEl.className = 'bookmark-video-views';
    viewEl.textContent = formatVideoViewCount(video.view_count);
    meta.appendChild(viewEl);
  }

  info.appendChild(meta);
  item.appendChild(info);

  return item;
}

/** Format an ISO 8601 date as a relative Chinese string (e.g. "3 天前"). */
function formatRelativeDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffSec < 60) return '剛才';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  if (diffHr < 24) return `${diffHr} 小時前`;
  if (diffDay < 7) return `${diffDay} 天前`;
  if (diffWeek < 4) return `${diffWeek} 週前`;
  if (diffMonth < 12) return `${diffMonth} 個月前`;
  return `${diffYear} 年前`;
}

/** Format a view count as a compact string (e.g. "12.3K 次觀看"). */
function formatVideoViewCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M 次觀看`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K 次觀看`;
  }
  return `${count} 次觀看`;
}
