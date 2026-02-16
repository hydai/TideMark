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
 * Constants
 */
export const MAX_RECORDS = 500;
export const DEFAULT_TOPIC = '無主題';
export const UNCATEGORIZED_ID = 'uncategorized';
export const UNCATEGORIZED_NAME = '未分類';
