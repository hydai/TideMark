// API route handlers

import type { Context } from 'hono';
import type { Env, RecordInput, FolderInput, Record, Folder, SyncResponse } from './types';
import { handleGoogleLogin } from './auth';

type Variables = {
  user_id: string;
};

// POST /auth/google
export async function authGoogle(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const body = await c.req.json();
    const googleToken = body.token;

    if (!googleToken) {
      return c.json({ error: 'Missing token' }, 400);
    }

    const jwt = await handleGoogleLogin(c.env, googleToken);

    if (!jwt) {
      return c.json({ error: 'Invalid Google token' }, 401);
    }

    return c.json({ token: jwt });
  } catch (error) {
    console.error('Auth error:', error);
    return c.json({ error: 'Authentication failed' }, 500);
  }
}

// GET /sync?since={iso8601}
export async function getSync(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const userId = c.get('user_id') as string;
    const since = c.req.query('since') || '1970-01-01T00:00:00.000Z';

    // Query records updated after 'since' (2 subrequests total: 1 for records, 1 for folders)
    const recordsResult = await c.env.DB.prepare(
      'SELECT * FROM records WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC'
    )
      .bind(userId, since)
      .all<Record>();

    const foldersResult = await c.env.DB.prepare(
      'SELECT * FROM folders WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC'
    )
      .bind(userId, since)
      .all<Folder>();

    const response: SyncResponse = {
      records: recordsResult.results || [],
      folders: foldersResult.results || [],
      synced_at: new Date().toISOString(),
    };

    return c.json(response);
  } catch (error) {
    console.error('Sync error:', error);
    return c.json({ error: 'Sync failed' }, 500);
  }
}

// POST /records
export async function createRecord(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const userId = c.get('user_id') as string;
    const record: RecordInput = await c.req.json();

    // Validate required fields
    if (!record.id || !record.timestamp || !record.live_time || !record.title || !record.channel_url || !record.platform) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Validate platform
    if (record.platform !== 'youtube' && record.platform !== 'twitch') {
      return c.json({ error: 'Invalid platform' }, 400);
    }

    // Upsert record (INSERT OR REPLACE)
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO records
       (id, user_id, folder_id, timestamp, live_time, title, topic, channel_url, platform, sort_order, created_at, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
      .bind(
        record.id,
        userId,
        record.folder_id || null,
        record.timestamp,
        record.live_time,
        record.title,
        record.topic || '無主題',
        record.channel_url,
        record.platform,
        record.sort_order || 0,
        record.created_at,
        record.updated_at
      )
      .run();

    return c.json({ success: true, id: record.id });
  } catch (error) {
    console.error('Create record error:', error);
    return c.json({ error: 'Failed to create record' }, 500);
  }
}

// DELETE /records/:id
export async function deleteRecord(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const userId = c.get('user_id') as string;
    const recordId = c.req.param('id');

    if (!recordId) {
      return c.json({ error: 'Missing record ID' }, 400);
    }

    // Soft delete: set deleted=1 and update updated_at
    const now = new Date().toISOString();
    const result = await c.env.DB.prepare(
      'UPDATE records SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?'
    )
      .bind(now, recordId, userId)
      .run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Record not found' }, 404);
    }

    return c.json({ success: true, id: recordId });
  } catch (error) {
    console.error('Delete record error:', error);
    return c.json({ error: 'Failed to delete record' }, 500);
  }
}

// POST /folders
export async function createFolder(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const userId = c.get('user_id') as string;
    const folder: FolderInput = await c.req.json();

    // Validate required fields
    if (!folder.id || !folder.name) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Upsert folder (INSERT OR REPLACE)
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO folders
       (id, user_id, name, sort_order, created_at, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    )
      .bind(
        folder.id,
        userId,
        folder.name,
        folder.sort_order || 0,
        folder.created_at,
        folder.updated_at
      )
      .run();

    return c.json({ success: true, id: folder.id });
  } catch (error) {
    console.error('Create folder error:', error);
    return c.json({ error: 'Failed to create folder' }, 500);
  }
}

// DELETE /folders/:id
export async function deleteFolder(c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const userId = c.get('user_id') as string;
    const folderId = c.req.param('id');

    if (!folderId) {
      return c.json({ error: 'Missing folder ID' }, 400);
    }

    // Soft delete: set deleted=1 and update updated_at
    const now = new Date().toISOString();
    const result = await c.env.DB.prepare(
      'UPDATE folders SET deleted = 1, updated_at = ? WHERE id = ? AND user_id = ?'
    )
      .bind(now, folderId, userId)
      .run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Folder not found' }, 404);
    }

    return c.json({ success: true, id: folderId });
  } catch (error) {
    console.error('Delete folder error:', error);
    return c.json({ error: 'Failed to delete folder' }, 500);
  }
}
