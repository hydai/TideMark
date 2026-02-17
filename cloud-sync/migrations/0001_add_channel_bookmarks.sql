-- Migration 0001: Add channel_bookmarks table

CREATE TABLE channel_bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch')),
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_channel_bookmarks_user_updated ON channel_bookmarks(user_id, updated_at);
CREATE UNIQUE INDEX idx_channel_bookmarks_user_channel ON channel_bookmarks(user_id, channel_id, platform) WHERE deleted = 0;
