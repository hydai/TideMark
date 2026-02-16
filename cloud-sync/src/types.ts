// Type definitions for Tidemark Cloud Sync API

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface Folder {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted: number;
}

export interface Record {
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

export interface JWTPayload {
  sub: string; // user_id
  email: string;
  iat: number;
  exp: number;
}

export interface GoogleTokenInfo {
  iss: string;
  sub: string;
  email: string;
  email_verified: boolean;
  aud: string;
  exp: number;
  iat: number;
}

export interface SyncResponse {
  records: Record[];
  folders: Folder[];
  synced_at: string;
}

export interface RecordInput {
  id: string;
  folder_id: string | null;
  timestamp: string;
  live_time: string;
  title: string;
  topic: string;
  channel_url: string;
  platform: 'youtube' | 'twitch';
  sort_order?: number;
  created_at: string;
  updated_at: string;
}

export interface FolderInput {
  id: string;
  name: string;
  sort_order?: number;
  created_at: string;
  updated_at: string;
}
