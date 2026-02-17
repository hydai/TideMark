/**
 * Cloud Sync Service
 * Handles synchronization with the Cloud Sync API
 */

import {
  CLOUD_SYNC_API_URL,
  SYNC_POLL_INTERVAL,
  type Record,
  type Folder,
  type ChannelBookmark,
  type SyncState,
  type SyncQueueItem,
  type APIRecord,
  type APIFolder,
  type APIChannelBookmark,
  type SyncUser,
  type SyncStatus,
} from './types';

/**
 * Initialize sync state in storage
 */
export async function initSyncState(): Promise<void> {
  const result = await chrome.storage.local.get(['syncState']);
  if (!result.syncState) {
    const initialState: SyncState = {
      jwt: null,
      user: null,
      lastSyncedAt: new Date(0).toISOString(),
      queue: [],
      status: 'offline',
    };
    await chrome.storage.local.set({ syncState: initialState });
  }
}

/**
 * Get current sync state
 */
export async function getSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get(['syncState']) as { syncState?: SyncState };
  return result.syncState || {
    jwt: null,
    user: null,
    lastSyncedAt: new Date(0).toISOString(),
    queue: [],
    status: 'offline',
  };
}

/**
 * Update sync state
 */
export async function updateSyncState(updates: Partial<SyncState>): Promise<void> {
  const current = await getSyncState();
  const updated = { ...current, ...updates };
  await chrome.storage.local.set({ syncState: updated });
}

/**
 * Login with Google OAuth
 */
export async function loginWithGoogle(): Promise<{ success: boolean; error?: string }> {
  try {
    // Get Google OAuth token using Chrome Identity API
    const token = await new Promise<string>((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(typeof result === 'string' ? result : result?.token || '');
        }
      });
    });

    if (!token) {
      return { success: false, error: '無法取得 Google 授權' };
    }

    // Exchange Google token for JWT
    const response = await fetch(`${CLOUD_SYNC_API_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      return { success: false, error: '登入失敗，請稍後重試' };
    }

    const data = await response.json();
    const jwt = data.token;

    // Decode JWT to get user info (simple base64 decode for payload)
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    const user: SyncUser = {
      id: payload.sub,
      email: payload.email,
    };

    // Update sync state
    await updateSyncState({
      jwt,
      user,
      status: 'synced',
    });

    // Start sync polling
    startSyncPolling();

    // Initial sync
    await pullRemoteChanges();

    return { success: true };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: '登入失敗，請稍後重試' };
  }
}

/**
 * Logout
 */
export async function logout(): Promise<void> {
  // Stop sync polling
  stopSyncPolling();

  // Clear sync state
  await updateSyncState({
    jwt: null,
    user: null,
    status: 'offline',
  });

  // Revoke Google OAuth token
  try {
    const token = await new Promise<string>((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (result) => {
        resolve(typeof result === 'string' ? result : result?.token || '');
      });
    });

    if (token) {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        // Token revoked
      });
    }
  } catch (error) {
    console.error('Logout error:', error);
  }
}

/**
 * Convert local Record to API format
 */
function recordToAPI(record: Record, userId: string): APIRecord {
  const now = new Date().toISOString();
  return {
    id: record.id,
    user_id: userId,
    folder_id: record.folderId,
    timestamp: record.timestamp,
    live_time: record.liveTime,
    title: record.title,
    topic: record.topic,
    channel_url: record.channelUrl,
    platform: record.platform as 'youtube' | 'twitch',
    sort_order: record.sortOrder || 0,
    created_at: record.timestamp,
    updated_at: now,
    deleted: 0,
  };
}

/**
 * Convert API Record to local format
 */
function apiToRecord(apiRecord: APIRecord): Record {
  return {
    id: apiRecord.id,
    timestamp: apiRecord.timestamp,
    liveTime: apiRecord.live_time,
    title: apiRecord.title,
    topic: apiRecord.topic,
    folderId: apiRecord.folder_id,
    channelUrl: apiRecord.channel_url,
    platform: apiRecord.platform,
    sortOrder: apiRecord.sort_order,
  };
}

/**
 * Convert local Folder to API format
 */
function folderToAPI(folder: Folder, userId: string, sortOrder: number): APIFolder {
  const now = new Date().toISOString();
  return {
    id: folder.id,
    user_id: userId,
    name: folder.name,
    sort_order: sortOrder,
    created_at: folder.created,
    updated_at: now,
    deleted: 0,
  };
}

/**
 * Convert API Folder to local format
 */
function apiToFolder(apiFolder: APIFolder): Folder {
  return {
    id: apiFolder.id,
    name: apiFolder.name,
    created: apiFolder.created_at,
  };
}

/**
 * Convert local ChannelBookmark to API format
 */
function channelBookmarkToAPI(bookmark: ChannelBookmark, userId: string): APIChannelBookmark {
  const now = new Date().toISOString();
  return {
    id: bookmark.id,
    user_id: userId,
    channel_id: bookmark.channel_id,
    channel_name: bookmark.channel_name,
    platform: bookmark.platform,
    notes: bookmark.notes,
    sort_order: bookmark.sort_order,
    created_at: bookmark.created_at,
    updated_at: now,
    deleted: 0,
  };
}

/**
 * Convert API ChannelBookmark to local format
 */
function apiToChannelBookmark(apiBookmark: APIChannelBookmark): ChannelBookmark {
  return {
    id: apiBookmark.id,
    channel_id: apiBookmark.channel_id,
    channel_name: apiBookmark.channel_name,
    platform: apiBookmark.platform,
    notes: apiBookmark.notes,
    sort_order: apiBookmark.sort_order,
    created_at: apiBookmark.created_at,
    updated_at: apiBookmark.updated_at,
  };
}

/**
 * Push a record to the cloud
 */
export async function pushRecord(record: Record): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    // Not logged in, queue for later
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'create_record',
      data: record,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    await updateSyncState({ status: 'syncing' });

    const apiRecord = recordToAPI(record, state.user.id);
    const response = await fetch(`${CLOUD_SYNC_API_URL}/records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.jwt}`,
      },
      body: JSON.stringify(apiRecord),
    });

    if (!response.ok) {
      throw new Error('Failed to push record');
    }

    await updateSyncState({ status: 'synced' });
  } catch (error) {
    console.error('Push record error:', error);
    await updateSyncState({ status: 'error' });
    // Queue for retry
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'create_record',
      data: record,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Delete a record in the cloud
 */
export async function deleteRecordRemote(recordId: string): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'delete_record',
      data: { recordId },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    await updateSyncState({ status: 'syncing' });

    const response = await fetch(`${CLOUD_SYNC_API_URL}/records/${recordId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${state.jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to delete record');
    }

    await updateSyncState({ status: 'synced' });
  } catch (error) {
    console.error('Delete record error:', error);
    await updateSyncState({ status: 'error' });
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'delete_record',
      data: { recordId },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Push a folder to the cloud
 */
export async function pushFolder(folder: Folder, sortOrder: number): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'create_folder',
      data: { folder, sortOrder },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    await updateSyncState({ status: 'syncing' });

    const apiFolder = folderToAPI(folder, state.user.id, sortOrder);
    const response = await fetch(`${CLOUD_SYNC_API_URL}/folders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.jwt}`,
      },
      body: JSON.stringify(apiFolder),
    });

    if (!response.ok) {
      throw new Error('Failed to push folder');
    }

    await updateSyncState({ status: 'synced' });
  } catch (error) {
    console.error('Push folder error:', error);
    await updateSyncState({ status: 'error' });
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'create_folder',
      data: { folder, sortOrder },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Delete a folder in the cloud
 */
export async function deleteFolderRemote(folderId: string): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'delete_folder',
      data: { folderId },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    await updateSyncState({ status: 'syncing' });

    const response = await fetch(`${CLOUD_SYNC_API_URL}/folders/${folderId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${state.jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to delete folder');
    }

    await updateSyncState({ status: 'synced' });
  } catch (error) {
    console.error('Delete folder error:', error);
    await updateSyncState({ status: 'error' });
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'delete_folder',
      data: { folderId },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Push a channel bookmark to the cloud
 */
export async function pushChannelBookmark(bookmark: ChannelBookmark): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'create_channel_bookmark',
      data: bookmark,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    await updateSyncState({ status: 'syncing' });

    const apiBookmark = channelBookmarkToAPI(bookmark, state.user.id);
    const response = await fetch(`${CLOUD_SYNC_API_URL}/channel-bookmarks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.jwt}`,
      },
      body: JSON.stringify(apiBookmark),
    });

    if (!response.ok) {
      throw new Error('Failed to push channel bookmark');
    }

    await updateSyncState({ status: 'synced' });
  } catch (error) {
    console.error('Push channel bookmark error:', error);
    await updateSyncState({ status: 'error' });
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'create_channel_bookmark',
      data: bookmark,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Delete a channel bookmark in the cloud
 */
export async function deleteChannelBookmarkRemote(bookmarkId: string): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'delete_channel_bookmark',
      data: { bookmarkId },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  try {
    await updateSyncState({ status: 'syncing' });

    const response = await fetch(`${CLOUD_SYNC_API_URL}/channel-bookmarks/${bookmarkId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${state.jwt}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to delete channel bookmark');
    }

    await updateSyncState({ status: 'synced' });
  } catch (error) {
    console.error('Delete channel bookmark error:', error);
    await updateSyncState({ status: 'error' });
    await queueSync({
      id: `sync-${Date.now()}-${Math.random()}`,
      action: 'delete_channel_bookmark',
      data: { bookmarkId },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Queue a sync operation for later
 */
async function queueSync(item: SyncQueueItem): Promise<void> {
  const state = await getSyncState();
  const queue = [...state.queue, item];
  await updateSyncState({ queue });
}

/**
 * Process sync queue
 */
export async function processQueue(): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user || state.queue.length === 0) {
    return;
  }

  const queue = [...state.queue];
  const failedItems: SyncQueueItem[] = [];

  for (const item of queue) {
    try {
      switch (item.action) {
        case 'create_record':
        case 'update_record':
          await pushRecord(item.data);
          break;
        case 'delete_record':
          await deleteRecordRemote(item.data.recordId);
          break;
        case 'create_folder':
        case 'update_folder':
          await pushFolder(item.data.folder, item.data.sortOrder);
          break;
        case 'delete_folder':
          await deleteFolderRemote(item.data.folderId);
          break;
        case 'create_channel_bookmark':
        case 'update_channel_bookmark':
          await pushChannelBookmark(item.data);
          break;
        case 'delete_channel_bookmark':
          await deleteChannelBookmarkRemote(item.data.bookmarkId);
          break;
      }
    } catch (error) {
      console.error('Queue processing error:', error);
      failedItems.push(item);
    }
  }

  await updateSyncState({ queue: failedItems });
}

/**
 * Pull remote changes
 */
export async function pullRemoteChanges(): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    return;
  }

  try {
    await updateSyncState({ status: 'syncing' });

    const response = await fetch(
      `${CLOUD_SYNC_API_URL}/sync?since=${encodeURIComponent(state.lastSyncedAt)}`,
      {
        headers: {
          Authorization: `Bearer ${state.jwt}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to pull changes');
    }

    const data = await response.json();
    const remoteRecords: APIRecord[] = data.records || [];
    const remoteFolders: APIFolder[] = data.folders || [];
    const remoteBookmarks: APIChannelBookmark[] = data.channel_bookmarks || [];

    // Get local data
    const localStorage = await chrome.storage.local.get(['records', 'folders', 'channelBookmarks']) as { records?: Record[]; folders?: Folder[]; channelBookmarks?: ChannelBookmark[] };
    const localRecords: Record[] = localStorage.records || [];
    const localFolders: Folder[] = localStorage.folders || [];
    const localBookmarks: ChannelBookmark[] = localStorage.channelBookmarks || [];

    // Merge remote changes
    const recordsMap = new Map(localRecords.map((r) => [r.id, r]));
    const foldersMap = new Map(localFolders.map((f) => [f.id, f]));
    const bookmarksMap = new Map(localBookmarks.map((b) => [b.id, b]));

    // Apply remote records
    for (const remoteRecord of remoteRecords) {
      if (remoteRecord.deleted === 1) {
        // Delete locally
        recordsMap.delete(remoteRecord.id);
      } else {
        // Add or update
        recordsMap.set(remoteRecord.id, apiToRecord(remoteRecord));
      }
    }

    // Apply remote folders
    for (const remoteFolder of remoteFolders) {
      if (remoteFolder.deleted === 1) {
        // Delete locally
        foldersMap.delete(remoteFolder.id);
      } else {
        // Add or update
        foldersMap.set(remoteFolder.id, apiToFolder(remoteFolder));
      }
    }

    // Apply remote channel bookmarks
    for (const remoteBookmark of remoteBookmarks) {
      if (remoteBookmark.deleted === 1) {
        // Delete locally
        bookmarksMap.delete(remoteBookmark.id);
      } else {
        // Add or update (last-write-wins)
        bookmarksMap.set(remoteBookmark.id, apiToChannelBookmark(remoteBookmark));
      }
    }

    // Save merged data
    await chrome.storage.local.set({
      records: Array.from(recordsMap.values()),
      folders: Array.from(foldersMap.values()),
      channelBookmarks: Array.from(bookmarksMap.values()),
    });

    // Update last synced time
    await updateSyncState({
      lastSyncedAt: data.synced_at || new Date().toISOString(),
      status: 'synced',
    });

    // Process any queued items
    await processQueue();
  } catch (error) {
    console.error('Pull changes error:', error);
    await updateSyncState({ status: 'error' });
  }
}

/**
 * Sync polling interval
 */
let syncInterval: number | null = null;

/**
 * Start sync polling
 */
export function startSyncPolling(): void {
  if (syncInterval !== null) {
    return; // Already polling
  }

  syncInterval = window.setInterval(() => {
    pullRemoteChanges();
  }, SYNC_POLL_INTERVAL);

  console.log('Sync polling started');
}

/**
 * Stop sync polling
 */
export function stopSyncPolling(): void {
  if (syncInterval !== null) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('Sync polling stopped');
  }
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(): Promise<boolean> {
  const state = await getSyncState();
  return state.jwt !== null && state.user !== null;
}

/**
 * Get current user
 */
export async function getCurrentUser(): Promise<SyncUser | null> {
  const state = await getSyncState();
  return state.user;
}

/**
 * Get current sync status
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const state = await getSyncState();
  return state.status;
}
