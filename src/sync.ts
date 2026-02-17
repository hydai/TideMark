/**
 * Cloud Sync Service for Desktop App
 * Handles synchronization with Cloud Sync API via Tauri backend
 */

import { invoke } from '@tauri-apps/api/core';

export interface SyncState {
  jwt: string | null;
  user: SyncUser | null;
  last_synced_at: string;
  status: 'offline' | 'syncing' | 'synced' | 'error';
}

export interface SyncUser {
  id: string;
  email: string;
}

export interface APIRecord {
  id: string;
  user_id: string;
  folder_id: string | null;
  timestamp: string;
  live_time: string;
  title: string;
  topic: string;
  channel_url: string;
  platform: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted: number;
}

export interface APIFolder {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted: number;
}

export interface APIChannelBookmark {
  id: string;
  user_id: string;
  channel_id: string;
  channel_name: string;
  platform: string;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted: number;
}

export interface SyncResponse {
  records: APIRecord[];
  folders: APIFolder[];
  channel_bookmarks: APIChannelBookmark[];
  synced_at: string;
}

export interface Record {
  id: string;
  timestamp: string;
  live_time: string;
  title: string;
  topic: string;
  folder_id: string | null;
  channel_url: string;
  platform: string;
  sort_order?: number;
}

export interface Folder {
  id: string;
  name: string;
  created: string;
  sort_order?: number;
}

export interface ChannelBookmark {
  id: string;
  channel_id: string;
  channel_name: string;
  platform: string;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const SYNC_POLL_INTERVAL = 4000; // 4 seconds

// NOTE: In production, these would be configured via environment variables or app config
// For development/testing, use test values or manual token input
const GOOGLE_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:8765/oauth/callback';

// Cloud Sync API URL - should be set via environment variable
// Default to the cloud-sync deployment URL
export const CLOUD_SYNC_API_URL = import.meta.env.VITE_CLOUD_SYNC_API_URL || 'https://tidemark-api.example.com';

let syncInterval: number | null = null;

/**
 * Get current sync state
 */
export async function getSyncState(): Promise<SyncState> {
  try {
    return await invoke<SyncState>('get_sync_state');
  } catch (error) {
    console.error('Failed to get sync state:', error);
    return {
      jwt: null,
      user: null,
      last_synced_at: '1970-01-01T00:00:00.000Z',
      status: 'offline',
    };
  }
}

/**
 * Update sync state
 */
export async function saveSyncState(state: SyncState): Promise<void> {
  try {
    await invoke('save_sync_state', { state });
  } catch (error) {
    console.error('Failed to save sync state:', error);
  }
}

/**
 * Start Google OAuth flow using system browser
 */
export async function loginWithGoogle(): Promise<{ success: boolean; error?: string }> {
  try {
    // Generate a simple OAuth URL for Google
    // In production, this should use proper PKCE flow
    const scope = 'openid email profile';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_OAUTH_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(GOOGLE_OAUTH_REDIRECT_URI)}&` +
      `response_type=id_token&` +
      `scope=${encodeURIComponent(scope)}&` +
      `nonce=${Date.now()}`;

    // Open system browser
    await invoke('open_url', { url: authUrl });

    // In a real implementation, we would:
    // 1. Start a local HTTP server on port 8765 to receive the callback
    // 2. Extract the id_token from the URL fragment
    // 3. Exchange it with the Cloud Sync API

    // For now, we'll simulate this with a prompt
    // This is a temporary solution for demonstration
    const idToken = await promptForToken();

    if (!idToken) {
      return { success: false, error: '無法取得 Google 授權' };
    }

    // Exchange Google token for JWT
    const response = await invoke<{ token: string }>('exchange_google_token', {
      googleToken: idToken,
    });

    const jwt = response.token;

    // Decode JWT to get user info (simple base64 decode for payload)
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    const user: SyncUser = {
      id: payload.sub,
      email: payload.email,
    };

    // Update sync state
    await saveSyncState({
      jwt,
      user,
      last_synced_at: new Date(0).toISOString(),
      status: 'synced',
    });

    // Start sync polling
    startSyncPolling();

    // Initial sync
    await pullRemoteChanges();

    return { success: true };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: `登入失敗: ${error}` };
  }
}

/**
 * Temporary function to prompt for token
 * In production, this would be replaced with proper OAuth callback handling
 */
async function promptForToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const token = prompt('請貼上 Google ID Token (暫時方案):');
    resolve(token);
  });
}

/**
 * Logout
 */
export async function logout(): Promise<void> {
  // Stop sync polling
  stopSyncPolling();

  // Clear sync state
  await saveSyncState({
    jwt: null,
    user: null,
    last_synced_at: '1970-01-01T00:00:00.000Z',
    status: 'offline',
  });
}

/**
 * Pull remote changes and merge with local data
 */
export async function pullRemoteChanges(): Promise<void> {
  try {
    const state = await getSyncState();
    if (!state.jwt || !state.user) {
      return;
    }

    // Update status to syncing
    await saveSyncState({ ...state, status: 'syncing' });

    // Pull from API
    const syncResponse = await invoke<SyncResponse>('sync_pull');

    // Get local data
    const localData = await invoke<{ records: Record[]; folders: Folder[]; folder_order: string[] }>('get_local_records');

    // Merge remote changes
    const recordsMap = new Map(localData.records.map((r) => [r.id, r]));
    const foldersMap = new Map(localData.folders.map((f) => [f.id, f]));

    // Apply remote records
    for (const remoteRecord of syncResponse.records) {
      if (remoteRecord.deleted === 1) {
        // Delete locally
        recordsMap.delete(remoteRecord.id);
      } else {
        // Add or update (last-write-wins)
        recordsMap.set(remoteRecord.id, {
          id: remoteRecord.id,
          timestamp: remoteRecord.timestamp,
          live_time: remoteRecord.live_time,
          title: remoteRecord.title,
          topic: remoteRecord.topic,
          folder_id: remoteRecord.folder_id,
          channel_url: remoteRecord.channel_url,
          platform: remoteRecord.platform,
          sort_order: remoteRecord.sort_order,
        });
      }
    }

    // Apply remote folders
    for (const remoteFolder of syncResponse.folders) {
      if (remoteFolder.deleted === 1) {
        // Delete locally
        foldersMap.delete(remoteFolder.id);
      } else {
        // Add or update
        foldersMap.set(remoteFolder.id, {
          id: remoteFolder.id,
          name: remoteFolder.name,
          created: remoteFolder.created_at,
          sort_order: remoteFolder.sort_order,
        });
      }
    }

    // Save merged data
    const mergedData = {
      records: Array.from(recordsMap.values()),
      folders: Array.from(foldersMap.values()),
      folder_order: localData.folder_order,
    };

    await invoke('save_local_records', { data: mergedData });

    // Apply remote channel bookmarks
    const remoteBookmarks: APIChannelBookmark[] = syncResponse.channel_bookmarks || [];
    for (const remoteBookmark of remoteBookmarks) {
      if (remoteBookmark.deleted === 1) {
        // Delete locally
        await invoke('delete_channel_bookmark', { id: remoteBookmark.id });
      } else {
        // Add or update (last-write-wins)
        const localBookmark: ChannelBookmark = {
          id: remoteBookmark.id,
          channel_id: remoteBookmark.channel_id,
          channel_name: remoteBookmark.channel_name,
          platform: remoteBookmark.platform,
          notes: remoteBookmark.notes,
          sort_order: remoteBookmark.sort_order,
          created_at: remoteBookmark.created_at,
          updated_at: remoteBookmark.updated_at,
        };
        await invoke('save_channel_bookmark', { bookmark: localBookmark });
      }
    }

    // Update sync state
    await saveSyncState({
      ...state,
      last_synced_at: syncResponse.synced_at,
      status: 'synced',
    });

    // Emit event to notify UI to refresh
    window.dispatchEvent(new CustomEvent('sync-completed'));
  } catch (error) {
    console.error('Pull changes error:', error);
    const state = await getSyncState();
    await saveSyncState({ ...state, status: 'error' });
  }
}

/**
 * Push a record to the cloud
 */
export async function pushRecord(record: Record): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    // Not logged in, skip sync
    return;
  }

  try {
    await saveSyncState({ ...state, status: 'syncing' });
    await invoke('sync_push_record', { record });
    await saveSyncState({ ...state, status: 'synced' });
  } catch (error) {
    console.error('Push record error:', error);
    await saveSyncState({ ...state, status: 'error' });
  }
}

/**
 * Delete a record in the cloud
 */
export async function deleteRecordRemote(recordId: string): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    return;
  }

  try {
    await saveSyncState({ ...state, status: 'syncing' });
    await invoke('sync_delete_record', { recordId });
    await saveSyncState({ ...state, status: 'synced' });
  } catch (error) {
    console.error('Delete record error:', error);
    await saveSyncState({ ...state, status: 'error' });
  }
}

/**
 * Push a folder to the cloud
 */
export async function pushFolder(folder: Folder): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    return;
  }

  try {
    await saveSyncState({ ...state, status: 'syncing' });
    await invoke('sync_push_folder', { folder });
    await saveSyncState({ ...state, status: 'synced' });
  } catch (error) {
    console.error('Push folder error:', error);
    await saveSyncState({ ...state, status: 'error' });
  }
}

/**
 * Delete a folder in the cloud
 */
export async function deleteFolderRemote(folderId: string): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    return;
  }

  try {
    await saveSyncState({ ...state, status: 'syncing' });
    await invoke('sync_delete_folder', { folderId });
    await saveSyncState({ ...state, status: 'synced' });
  } catch (error) {
    console.error('Delete folder error:', error);
    await saveSyncState({ ...state, status: 'error' });
  }
}

/**
 * Push a channel bookmark to the cloud
 */
export async function pushChannelBookmark(bookmark: ChannelBookmark): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    // Not logged in, skip sync
    return;
  }

  try {
    await saveSyncState({ ...state, status: 'syncing' });
    await invoke('sync_push_channel_bookmark', { bookmark });
    await saveSyncState({ ...state, status: 'synced' });
  } catch (error) {
    console.error('Push channel bookmark error:', error);
    await saveSyncState({ ...state, status: 'error' });
  }
}

/**
 * Delete a channel bookmark in the cloud
 */
export async function deleteChannelBookmarkRemote(bookmarkId: string): Promise<void> {
  const state = await getSyncState();
  if (!state.jwt || !state.user) {
    return;
  }

  try {
    await saveSyncState({ ...state, status: 'syncing' });
    await invoke('sync_delete_channel_bookmark', { bookmarkId });
    await saveSyncState({ ...state, status: 'synced' });
  } catch (error) {
    console.error('Delete channel bookmark error:', error);
    await saveSyncState({ ...state, status: 'error' });
  }
}

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
export async function getSyncStatus(): Promise<'offline' | 'syncing' | 'synced' | 'error'> {
  const state = await getSyncState();
  return state.status;
}
