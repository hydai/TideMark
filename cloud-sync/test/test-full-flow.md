# Full Flow Testing Guide

This guide walks through testing all API endpoints with a complete user flow.

## Prerequisites

1. Start the local development server:
```bash
npm run dev
```

2. Set up the local D1 database:
```bash
npx wrangler d1 create tidemark
# Update wrangler.toml with the database_id
npx wrangler d1 execute tidemark --local --file=./schema.sql
```

3. Create `.dev.vars` file:
```bash
echo "JWT_SECRET=test-secret-key-for-local-dev" > .dev.vars
```

## Manual Testing with curl

### Step 1: Test Health Check

```bash
curl http://localhost:8787/health
```

Expected response:
```json
{"status":"ok"}
```

### Step 2: Test Authentication (Mock)

**Note**: For local testing without real Google OAuth, you can create a test endpoint or manually create a JWT token. For production, you'll need a valid Google OAuth token.

To test with a mock user ID, we'll manually insert a user and create a JWT token.

Insert test user into D1:
```bash
npx wrangler d1 execute tidemark --local --command="INSERT INTO users (id, email) VALUES ('test-user-123', 'test@example.com')"
```

Create a JWT token manually (using Node.js):
```bash
node -e "
const crypto = require('crypto');
const secret = 'test-secret-key-for-local-dev';
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  sub: 'test-user-123',
  email: 'test@example.com',
  iat: Math.floor(Date.now()/1000),
  exp: Math.floor(Date.now()/1000) + 86400
})).toString('base64url');
const message = header + '.' + payload;
const signature = crypto.createHmac('sha256', secret).update(message).digest('base64url');
console.log(message + '.' + signature);
"
```

Save the JWT token for the next steps.

### Step 3: Create a Folder

```bash
JWT_TOKEN="<your-jwt-token>"

curl -X POST http://localhost:8787/folders \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "folder-1",
    "name": "Test Folder",
    "sort_order": 0,
    "created_at": "2026-02-16T00:00:00.000Z",
    "updated_at": "2026-02-16T00:00:00.000Z"
  }'
```

Expected response:
```json
{"success":true,"id":"folder-1"}
```

### Step 4: Create a Record

```bash
curl -X POST http://localhost:8787/records \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "record-1",
    "folder_id": "folder-1",
    "timestamp": "2026-02-16T01:23:45.678Z",
    "live_time": "1:23:45",
    "title": "Test Stream",
    "topic": "Test Topic",
    "channel_url": "https://youtube.com/watch?v=test",
    "platform": "youtube",
    "sort_order": 0,
    "created_at": "2026-02-16T01:23:45.678Z",
    "updated_at": "2026-02-16T01:23:45.678Z"
  }'
```

Expected response:
```json
{"success":true,"id":"record-1"}
```

### Step 5: Sync (Get all data)

```bash
curl http://localhost:8787/sync \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Expected response:
```json
{
  "records": [
    {
      "id": "record-1",
      "user_id": "test-user-123",
      "folder_id": "folder-1",
      "timestamp": "2026-02-16T01:23:45.678Z",
      "live_time": "1:23:45",
      "title": "Test Stream",
      "topic": "Test Topic",
      "channel_url": "https://youtube.com/watch?v=test",
      "platform": "youtube",
      "sort_order": 0,
      "created_at": "2026-02-16T01:23:45.678Z",
      "updated_at": "2026-02-16T01:23:45.678Z",
      "deleted": 0
    }
  ],
  "folders": [
    {
      "id": "folder-1",
      "user_id": "test-user-123",
      "name": "Test Folder",
      "sort_order": 0,
      "created_at": "2026-02-16T00:00:00.000Z",
      "updated_at": "2026-02-16T00:00:00.000Z",
      "deleted": 0
    }
  ],
  "synced_at": "2026-02-16T03:00:00.000Z"
}
```

### Step 6: Incremental Sync

Wait a moment, then create another record:

```bash
curl -X POST http://localhost:8787/records \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "record-2",
    "folder_id": "folder-1",
    "timestamp": "2026-02-16T02:00:00.000Z",
    "live_time": "2:00:00",
    "title": "Test Stream 2",
    "topic": "Test Topic 2",
    "channel_url": "https://twitch.tv/test",
    "platform": "twitch",
    "sort_order": 1,
    "created_at": "2026-02-16T02:00:00.000Z",
    "updated_at": "2026-02-16T02:00:00.000Z"
  }'
```

Now sync with a timestamp after the first record:

```bash
curl "http://localhost:8787/sync?since=2026-02-16T01:30:00.000Z" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Expected response should only include record-2 (created after the `since` timestamp).

### Step 7: Soft Delete Record

```bash
curl -X DELETE http://localhost:8787/records/record-1 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Expected response:
```json
{"success":true,"id":"record-1"}
```

Verify it's soft-deleted:
```bash
curl http://localhost:8787/sync \
  -H "Authorization: Bearer $JWT_TOKEN"
```

The record-1 should now have `deleted: 1`.

### Step 8: Soft Delete Folder

```bash
curl -X DELETE http://localhost:8787/folders/folder-1 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Expected response:
```json
{"success":true,"id":"folder-1"}
```

### Step 9: Test Unauthorized Access

```bash
curl http://localhost:8787/sync
```

Expected response:
```json
{"error":"Unauthorized"}
```

Status code: 401

### Step 10: Test with Expired JWT

Create an expired JWT token (exp in the past) and test:

```bash
EXPIRED_TOKEN="<expired-jwt-token>"

curl http://localhost:8787/sync \
  -H "Authorization: Bearer $EXPIRED_TOKEN"
```

Expected response:
```json
{"error":"Invalid or expired token"}
```

Status code: 401

## Verification Checklist

- [ ] Health check returns 200
- [ ] Auth endpoint exists and validates tokens
- [ ] Creating folders works and returns success
- [ ] Creating records works and returns success
- [ ] Sync returns all data without `since` parameter
- [ ] Incremental sync with `since` parameter only returns newer data
- [ ] Soft delete sets deleted=1 and updates updated_at
- [ ] Upsert (POST same ID twice) updates the record
- [ ] Unauthorized requests return 401
- [ ] Invalid/expired JWT returns 401

## Subrequest Count Verification

Each `/sync` call should use exactly **2 subrequests**:
1. Query records table
2. Query folders table

JWT verification is done locally (no subrequest).
Total subrequests per sync: **2** (well within the 1000 limit).
