import { invoke } from '@tauri-apps/api/core';

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

interface BookmarkSortOrder {
  id: string;
  sort_order: number;
}

let bookmarks: ChannelBookmark[] = [];
let containerEl: HTMLElement | null = null;

// Drag-and-drop state
let dragSrcId: string | null = null;

export async function renderChannelBookmarksPage(container: HTMLElement) {
  containerEl = container;
  await loadBookmarks();
  renderPage(container);
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

function renderPage(container: HTMLElement) {
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

  // Add bookmark form (hidden by default)
  const addForm = createAddForm();
  page.appendChild(addForm);

  // Bookmark list
  const listSection = createBookmarkList();
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
      if (containerEl) renderPage(containerEl);
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

function createBookmarkList(): HTMLElement {
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
    const card = createBookmarkCard(bookmark);
    section.appendChild(card);
  });

  return section;
}

function createBookmarkCard(bookmark: ChannelBookmark): HTMLElement {
  const card = document.createElement('div');
  card.className = 'bookmark-card';
  card.dataset.bookmarkId = bookmark.id;
  card.draggable = true;

  // Drag handle
  const dragHandle = document.createElement('div');
  dragHandle.className = 'bookmark-drag-handle';
  dragHandle.title = '拖曳以重新排序';
  dragHandle.textContent = '⋮⋮';
  card.appendChild(dragHandle);

  // Platform icon
  const platformIcon = document.createElement('span');
  platformIcon.className = `bookmark-platform-icon ${bookmark.platform}`;
  platformIcon.textContent = bookmark.platform === 'youtube' ? '🔴' : '🟣';
  card.appendChild(platformIcon);

  // Channel info
  const info = document.createElement('div');
  info.className = 'bookmark-info';

  const channelName = document.createElement('div');
  channelName.className = 'bookmark-channel-name';
  channelName.textContent = bookmark.channel_name;
  info.appendChild(channelName);

  const platformLabel = document.createElement('span');
  platformLabel.className = `platform-badge ${bookmark.platform}`;
  platformLabel.textContent = bookmark.platform === 'youtube' ? 'YouTube' : 'Twitch';
  info.appendChild(platformLabel);

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

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn delete-btn bookmark-delete-btn';
  deleteBtn.textContent = '刪除';
  deleteBtn.title = '刪除此書籤';
  card.appendChild(deleteBtn);

  // ── Event listeners ──

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
      if (containerEl) renderPage(containerEl);
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
    if (containerEl) renderPage(containerEl);
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
