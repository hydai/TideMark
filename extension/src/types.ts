/**
 * Record data model stored in Chrome Storage
 */
export interface Record {
  id: string;           // timestamp-based unique ID
  timestamp: string;    // local time when record was created (ISO 8601)
  liveTime: string;     // playback time HH:MM:SS or MM:SS
  title: string;        // stream/video title
  topic: string;        // user-entered topic (default "無主題")
  folderId: string | null; // folder ID or null for uncategorized
  channelUrl: string;   // VOD link with ?t= or youtu.be short link
  platform: string;     // "youtube" or "twitch"
  sortOrder?: number;   // sort order within group (optional for backward compatibility)
}

/**
 * Folder data model stored in Chrome Storage
 */
export interface Folder {
  id: string;       // "folder-{timestamp}" format
  name: string;     // Folder name
  created: string;  // ISO 8601 creation time
}

/**
 * Platform type
 */
export type Platform = 'youtube' | 'twitch' | 'unknown';

/**
 * Message sent from content script to popup
 */
export interface ContentMessage {
  type: 'GET_PLAYBACK_INFO';
}

/**
 * Response from content script to popup
 */
export interface PlaybackInfo {
  success: boolean;
  platform: Platform;
  currentTime?: number;        // seconds
  liveTime?: string;           // formatted HH:MM:SS
  title?: string;
  videoId?: string;            // YouTube only
  channelUrl?: string;
  error?: string;
}

/**
 * Storage structure
 */
export interface StorageData {
  records: Record[];
  folders: Folder[];
}

/**
 * Grouped records by stream title
 */
export interface RecordGroup {
  title: string;
  records: Record[];
  collapsed: boolean;
  sortOrder?: number; // order of group within folder
}

/**
 * Export/Import data structure
 */
export interface ExportData {
  version: string;
  exportedAt: string;  // ISO 8601
  records: Record[];
  folders: Folder[];
}

/**
 * Cloud Sync User Info
 */
export interface SyncUser {
  id: string;
  email: string;
}

/**
 * Sync Status
 */
export type SyncStatus = 'offline' | 'synced' | 'syncing' | 'error';

/**
 * Channel Bookmark data model stored in Chrome Storage
 */
export interface ChannelBookmark {
  id: string;
  channel_id: string;
  channel_name: string;
  platform: string;   // "youtube" or "twitch"
  notes: string;
  sort_order: number;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * Sync Queue Item
 */
export interface SyncQueueItem {
  id: string;
  action: 'create_record' | 'update_record' | 'delete_record' | 'create_folder' | 'update_folder' | 'delete_folder' | 'create_channel_bookmark' | 'update_channel_bookmark' | 'delete_channel_bookmark';
  data: any;
  timestamp: string;
}

/**
 * Sync State stored in Chrome Storage
 */
export interface SyncState {
  jwt: string | null;
  user: SyncUser | null;
  lastSyncedAt: string;
  queue: SyncQueueItem[];
  status: SyncStatus;
}

/**
 * API Record format (matches Cloud Sync API)
 */
export interface APIRecord {
  id: string;
  user_id: string;
  folder_id: string | null;
  timestamp: string;
  live_time: string;
  title: string;
  topic: string;
  channel_url: string;
  platform: 'youtube' | 'twitch';
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted: number;
}

/**
 * API Folder format (matches Cloud Sync API)
 */
export interface APIFolder {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted: number;
}

/**
 * API Channel Bookmark format (matches Cloud Sync API)
 */
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

/**
 * Constants
 */
export const MAX_RECORDS = 500;
export const DEFAULT_TOPIC = '無主題';
export const UNCATEGORIZED_ID = 'uncategorized';
export const UNCATEGORIZED_NAME = '未分類';
export const EXPORT_VERSION = '1.0';
export const CLOUD_SYNC_API_URL = 'http://localhost:8787'; // TODO: Make configurable
export const SYNC_POLL_INTERVAL = 4000; // 4 seconds
