// Unit tests for channel bookmark handlers
// Uses Vitest with mocked D1 database and Hono context

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleChannelBookmarkUpsert, handleChannelBookmarkDelete, getSync } from './handlers';

// Helper to create a mock D1 statement
function makeStmt(overrides: Partial<{
  run: () => Promise<{ meta: { changes: number } }>;
  all: <T>() => Promise<{ results: T[] }>;
}> = {}) {
  return {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    all: vi.fn().mockResolvedValue({ results: [] }),
    ...overrides,
  };
}

// Helper to create a mock Hono context
function makeContext(overrides: {
  userId?: string;
  body?: unknown;
  paramId?: string;
  query?: Record<string, string>;
  dbPrepare?: ReturnType<typeof makeStmt>;
} = {}) {
  const stmt = overrides.dbPrepare ?? makeStmt();

  const json = vi.fn((body: unknown, status?: number) => ({ body, status: status ?? 200 }));

  return {
    get: vi.fn((key: string) => (key === 'user_id' ? (overrides.userId ?? 'user-1') : undefined)),
    req: {
      json: vi.fn().mockResolvedValue(overrides.body ?? {}),
      param: vi.fn((key: string) => (key === 'id' ? (overrides.paramId ?? 'bm-1') : undefined)),
      query: vi.fn((key: string) => (overrides.query ?? {})[key]),
    },
    env: {
      DB: {
        prepare: vi.fn().mockReturnValue(stmt),
      },
      JWT_SECRET: 'test-secret',
    },
    json,
  } as unknown as Parameters<typeof handleChannelBookmarkUpsert>[0];
}

// ----------------------------------------------------------------
// handleChannelBookmarkUpsert
// ----------------------------------------------------------------
describe('handleChannelBookmarkUpsert', () => {
  it('returns 400 when required fields are missing', async () => {
    const ctx = makeContext({ body: { id: 'bm-1' } }); // missing channel_id, channel_name, platform
    const res = await handleChannelBookmarkUpsert(ctx);
    expect(res.status).toBe(400);
    expect((res as { body: { error: string } }).body.error).toMatch(/Missing required fields/);
  });

  it('returns 400 when platform is invalid', async () => {
    const ctx = makeContext({
      body: {
        id: 'bm-1',
        channel_id: 'UC_abc',
        channel_name: 'Test Channel',
        platform: 'invalid-platform',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    });
    const res = await handleChannelBookmarkUpsert(ctx);
    expect(res.status).toBe(400);
    expect((res as { body: { error: string } }).body.error).toMatch(/Invalid platform/);
  });

  it('upserts a youtube bookmark successfully', async () => {
    const stmt = makeStmt();
    const ctx = makeContext({
      body: {
        id: 'bm-youtube-1',
        channel_id: 'UC_abc',
        channel_name: 'Test Channel',
        platform: 'youtube',
        notes: 'My note',
        sort_order: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      dbPrepare: stmt,
    });
    const res = await handleChannelBookmarkUpsert(ctx);
    expect(res.status).toBe(200);
    expect((res as { body: { success: boolean; id: string } }).body.success).toBe(true);
    expect((res as { body: { success: boolean; id: string } }).body.id).toBe('bm-youtube-1');
    expect(stmt.run).toHaveBeenCalledOnce();
  });

  it('upserts a twitch bookmark successfully', async () => {
    const stmt = makeStmt();
    const ctx = makeContext({
      body: {
        id: 'bm-twitch-1',
        channel_id: 'streamer123',
        channel_name: 'Streamer',
        platform: 'twitch',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      dbPrepare: stmt,
    });
    const res = await handleChannelBookmarkUpsert(ctx);
    expect(res.status).toBe(200);
    expect((res as { body: { success: boolean; id: string } }).body.success).toBe(true);
    expect((res as { body: { success: boolean; id: string } }).body.id).toBe('bm-twitch-1');
  });

  it('uses empty string as default for notes when not provided', async () => {
    const stmt = makeStmt();
    const ctx = makeContext({
      body: {
        id: 'bm-2',
        channel_id: 'UC_xyz',
        channel_name: 'Channel XYZ',
        platform: 'youtube',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      dbPrepare: stmt,
    });
    await handleChannelBookmarkUpsert(ctx);
    // Verify bind was called with empty notes (6th positional argument = index 5)
    const bindArgs = stmt.bind.mock.calls[0];
    expect(bindArgs[5]).toBe(''); // notes defaults to ''
  });

  it('returns 500 on database error', async () => {
    const stmt = makeStmt({
      run: vi.fn().mockRejectedValue(new Error('DB error')),
    });
    const ctx = makeContext({
      body: {
        id: 'bm-3',
        channel_id: 'UC_abc',
        channel_name: 'Test',
        platform: 'youtube',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      dbPrepare: stmt,
    });
    const res = await handleChannelBookmarkUpsert(ctx);
    expect(res.status).toBe(500);
  });
});

// ----------------------------------------------------------------
// handleChannelBookmarkDelete
// ----------------------------------------------------------------
describe('handleChannelBookmarkDelete', () => {
  it('soft-deletes a bookmark successfully', async () => {
    const stmt = makeStmt({
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    });
    const ctx = makeContext({ paramId: 'bm-delete-1', dbPrepare: stmt });
    const res = await handleChannelBookmarkDelete(ctx);
    expect(res.status).toBe(200);
    expect((res as { body: { success: boolean; id: string } }).body.success).toBe(true);
    expect((res as { body: { success: boolean; id: string } }).body.id).toBe('bm-delete-1');
    expect(stmt.run).toHaveBeenCalledOnce();
  });

  it('returns 404 when bookmark is not found', async () => {
    const stmt = makeStmt({
      run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    });
    const ctx = makeContext({ paramId: 'nonexistent', dbPrepare: stmt });
    const res = await handleChannelBookmarkDelete(ctx);
    expect(res.status).toBe(404);
    expect((res as { body: { error: string } }).body.error).toMatch(/not found/i);
  });

  it('returns 500 on database error', async () => {
    const stmt = makeStmt({
      run: vi.fn().mockRejectedValue(new Error('DB error')),
    });
    const ctx = makeContext({ paramId: 'bm-err', dbPrepare: stmt });
    const res = await handleChannelBookmarkDelete(ctx);
    expect(res.status).toBe(500);
  });
});

// ----------------------------------------------------------------
// getSync — channel_bookmarks included in response
// ----------------------------------------------------------------
describe('getSync - channel_bookmarks', () => {
  it('includes channel_bookmarks in the sync response', async () => {
    const mockBookmarks = [
      {
        id: 'bm-1',
        user_id: 'user-1',
        channel_id: 'UC_abc',
        channel_name: 'Test Channel',
        platform: 'youtube',
        notes: '',
        sort_order: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        deleted: 0,
      },
    ];

    // Each DB.prepare call returns a different stmt depending on call order
    let callCount = 0;
    const stmts = [
      makeStmt({ all: vi.fn().mockResolvedValue({ results: [] }) }), // records
      makeStmt({ all: vi.fn().mockResolvedValue({ results: [] }) }), // folders
      makeStmt({ all: vi.fn().mockResolvedValue({ results: mockBookmarks }) }), // channel_bookmarks
    ];

    const json = vi.fn((body: unknown, status?: number) => ({ body, status: status ?? 200 }));
    const ctx = {
      get: vi.fn((key: string) => (key === 'user_id' ? 'user-1' : undefined)),
      req: {
        query: vi.fn().mockReturnValue('1970-01-01T00:00:00.000Z'),
      },
      env: {
        DB: {
          prepare: vi.fn(() => {
            const stmt = stmts[callCount] ?? makeStmt();
            callCount++;
            return stmt;
          }),
        },
        JWT_SECRET: 'test-secret',
      },
      json,
    } as unknown as Parameters<typeof getSync>[0];

    const res = await getSync(ctx);
    expect(res.status).toBe(200);
    const body = (res as { body: { records: unknown[]; folders: unknown[]; channel_bookmarks: unknown[]; synced_at: string } }).body;
    expect(body.records).toEqual([]);
    expect(body.folders).toEqual([]);
    expect(body.channel_bookmarks).toEqual(mockBookmarks);
    expect(typeof body.synced_at).toBe('string');
  });

  it('returns empty channel_bookmarks array when none exist', async () => {
    let callCount = 0;
    const stmts = [
      makeStmt({ all: vi.fn().mockResolvedValue({ results: [] }) }), // records
      makeStmt({ all: vi.fn().mockResolvedValue({ results: [] }) }), // folders
      makeStmt({ all: vi.fn().mockResolvedValue({ results: [] }) }), // channel_bookmarks
    ];

    const json = vi.fn((body: unknown, status?: number) => ({ body, status: status ?? 200 }));
    const ctx = {
      get: vi.fn((key: string) => (key === 'user_id' ? 'user-1' : undefined)),
      req: {
        query: vi.fn().mockReturnValue(undefined),
      },
      env: {
        DB: {
          prepare: vi.fn(() => {
            const stmt = stmts[callCount] ?? makeStmt();
            callCount++;
            return stmt;
          }),
        },
        JWT_SECRET: 'test-secret',
      },
      json,
    } as unknown as Parameters<typeof getSync>[0];

    const res = await getSync(ctx);
    expect(res.status).toBe(200);
    const body = (res as { body: { channel_bookmarks: unknown[] } }).body;
    expect(Array.isArray(body.channel_bookmarks)).toBe(true);
    expect(body.channel_bookmarks).toHaveLength(0);
  });
});
