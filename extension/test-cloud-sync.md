# Task #7: EXT-005 - Cloud Sync Integration Test Plan

## Prerequisites
1. Cloud Sync API running at http://localhost:8787
2. Extension built and loaded in Chrome
3. Test on YouTube or Twitch page

## Test Environment Setup

### 1. Start Cloud Sync API
```bash
cd cloud-sync
npm run dev
# Server should be running on http://localhost:8787
```

### 2. Build Extension
```bash
cd extension
npm run build
```

### 3. Load Extension in Chrome
1. Open Chrome
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `extension/dist` directory

## Acceptance Criteria Testing

### AC Step 1: Login with Google
**Action**: Open extension settings, click "Login with Google"

**Expected**:
- Login button shows "登入中..." during authentication
- Google OAuth flow opens
- After successful OAuth, JWT is obtained from Cloud Sync API
- Extension shows "登入成功！" success message

**Verification**:
1. Open extension popup on YouTube/Twitch page
2. Click ⚙️ Settings button
3. Under "雲端同步" section, verify status shows "⚪ 未登入"
4. Click "🔐 使用 Google 登入" button
5. Complete Google OAuth (may need to allow popup)
6. Verify success message appears

**Chrome DevTools Console Check**:
```javascript
// Open extension popup
// Open DevTools (F12)
// Check storage:
chrome.storage.local.get(['syncState'], (result) => {
  console.log('Sync State:', result.syncState);
  // Should show: { jwt: "...", user: { id: "...", email: "..." }, ... }
});
```

---

### AC Step 2: Verify Login State
**Action**: Verify successful login with user email displayed

**Expected**:
- "登入" section is hidden
- "已登入為: user@example.com" is shown
- "登出" button is visible
- Sync status shows "🟢 已同步"

**Verification**:
1. After login, check settings section
2. Verify user email is displayed
3. Verify sync status indicator shows green/synced

---

### AC Step 3: Create Record While Logged In
**Action**: Create a new Record, verify it syncs to Cloud Sync API within 5 seconds

**Expected**:
- Record saved to local storage immediately
- Record pushed to Cloud Sync API
- Sync status briefly shows "🔵 同步中..."
- Sync status returns to "🟢 已同步" within 5 seconds

**Verification**:
1. On YouTube/Twitch page, play a video
2. Open extension popup
3. Enter topic "Test Sync Record"
4. Click "記錄當前時間"
5. Watch sync status indicator (should pulse blue briefly)
6. After ~2-3 seconds, status should be green

**API Verification**:
```bash
# Get JWT from extension storage (copy from DevTools console)
JWT="..."

# Query sync endpoint
curl -H "Authorization: Bearer $JWT" \
     "http://localhost:8787/sync?since=1970-01-01T00:00:00.000Z"

# Should return the newly created record
```

---

### AC Step 4: Create Record from Second Device
**Action**: From a second browser/device (or via API), create a Record for the same user

**Expected**:
- Record created remotely
- Polling mechanism detects the change within 3-5 seconds
- Record appears in extension automatically

**Verification Option A - Using Another Browser Profile**:
1. Open Chrome in Incognito or another profile
2. Load the same extension
3. Login with the same Google account
4. Create a record
5. Switch back to original browser
6. Wait 3-5 seconds
7. Verify record appears in list

**Verification Option B - Using API**:
```bash
# Get JWT from extension (copy from DevTools)
JWT="..."

# Create a record via API
curl -X POST http://localhost:8787/records \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "record-test-remote-'$(date +%s)'",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "live_time": "01:23:45",
    "title": "Remote Test Stream",
    "topic": "API Created Record",
    "channel_url": "https://youtube.com/watch?v=test",
    "platform": "youtube",
    "folder_id": null,
    "sort_order": 0,
    "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "updated_at": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }'

# Wait 3-5 seconds
# Check extension - new record should appear
```

---

### AC Step 5: Verify Remote Record Appears
**Action**: Wait 3-5 seconds (polling interval), verify the remote Record appears

**Expected**:
- Extension polls `/sync` endpoint every 4 seconds
- Remote record detected
- Record added to local storage
- UI updates to show new record

**Verification**:
1. After creating remote record (Step 4)
2. Keep extension popup open
3. Watch records list
4. Within 5 seconds, new record should appear
5. Click on record to verify all fields are correct

**Network Tab Check**:
1. Open DevTools Network tab
2. Filter for "sync"
3. Should see GET requests to http://localhost:8787/sync every 4 seconds
4. Response should include the remote record

---

### AC Step 6: Modify Folder While Logged In
**Action**: Modify a Folder (rename/reorder), verify the change syncs to cloud

**Expected**:
- Folder modification saved locally
- Change pushed to Cloud Sync API
- Sync status shows syncing → synced

**Verification - Rename**:
1. Create a folder "Test Folder"
2. Double-click folder name to edit
3. Rename to "Renamed Folder"
4. Press Enter
5. Watch sync status (should pulse blue)
6. Verify sync completes

**Verification - Reorder**:
1. Create two folders: "Folder A" and "Folder B"
2. Drag "Folder B" above "Folder A"
3. Watch sync status
4. Verify both folders are pushed with updated sort_order

**API Verification**:
```bash
JWT="..."
curl -H "Authorization: Bearer $JWT" \
     "http://localhost:8787/sync?since=1970-01-01T00:00:00.000Z" | \
     jq '.folders'

# Should show folders with updated names/sort_order
```

---

### AC Step 7: Offline Resilience
**Action**: Disconnect from network, create a Record, reconnect, verify it syncs

**Expected**:
- When offline, record saved locally
- Sync status shows "🔴 同步錯誤" or remains at last known state
- Record queued for later sync
- When network reconnects, queued record is pushed
- Sync status returns to "🟢 已同步"

**Verification**:
1. Open DevTools Network tab
2. Set throttling to "Offline"
3. Create a record "Offline Record"
4. Verify record appears in local list
5. Check sync status (may show error)
6. Set throttling back to "Online"
7. Wait 5-10 seconds
8. Verify record syncs to cloud
9. Verify sync status returns to green

**DevTools Check**:
```javascript
// While offline, check queue
chrome.storage.local.get(['syncState'], (result) => {
  console.log('Queue:', result.syncState.queue);
  // Should contain queued operations
});

// After reconnect
chrome.storage.local.get(['syncState'], (result) => {
  console.log('Queue after sync:', result.syncState.queue);
  // Should be empty or smaller
});
```

---

### AC Step 8: Logout
**Action**: Log out from the extension, verify sync stops and local data remains

**Expected**:
- Sync polling stops
- JWT cleared from storage
- User info cleared
- Sync status shows "⚪ 未登入"
- Local records and folders still accessible
- No more network requests to /sync endpoint

**Verification**:
1. Open extension popup
2. Go to Settings
3. Click "登出" button
4. Verify success message "已登出"
5. Verify status shows "⚪ 未登入"
6. Verify login button is visible again
7. Close and reopen popup
8. Verify records are still visible (local data intact)
9. Open DevTools Network tab
10. Wait 10 seconds
11. Verify no /sync requests are made

**DevTools Check**:
```javascript
chrome.storage.local.get(['syncState', 'records', 'folders'], (result) => {
  console.log('After logout:');
  console.log('JWT:', result.syncState.jwt); // Should be null
  console.log('User:', result.syncState.user); // Should be null
  console.log('Records count:', result.records.length); // Should still have records
  console.log('Folders count:', result.folders.length); // Should still have folders
});
```

---

### AC Step 9: Incremental Sync Strategy
**Action**: Verify sync uses incremental strategy (updatedAt-based), not full data transfer

**Expected**:
- Each /sync request includes `?since={lastSyncedAt}` parameter
- Only records/folders modified after that timestamp are returned
- Full dataset not transferred every time

**Verification**:
1. Login to extension
2. Create several records
3. Wait for initial sync
4. Open DevTools Network tab
5. Filter for "sync"
6. Click on a /sync request
7. Check Request URL - should have `?since=` parameter
8. Check Response - should only include recent changes
9. Create one more record
10. Check next /sync request
11. Response should only include the 1 new record, not all previous records

**Network Analysis**:
```
GET /sync?since=2026-02-16T12:34:56.789Z
Response: {
  "records": [/* Only new/updated records after timestamp */],
  "folders": [/* Only new/updated folders after timestamp */],
  "synced_at": "2026-02-16T12:35:01.234Z"
}
```

**Performance Check**:
- With 0 changes: Response should be `{"records": [], "folders": [], "synced_at": "..."}`
- With 1 change: Response should contain only that 1 item
- Response size should be minimal when no changes

---

## Additional Test Cases

### Test Case A: Delete Record Sync
1. Login
2. Create a record
3. Wait for sync (5 seconds)
4. Delete the record
5. Verify DELETE request sent to API
6. Verify sync status updates

### Test Case B: Delete Folder Sync
1. Login
2. Create a folder
3. Wait for sync
4. Delete the folder
5. Verify DELETE request sent to API
6. Verify records moved to "未分類"

### Test Case C: Multiple Devices Conflict
1. Login on Device A
2. Login on Device B (same account)
3. Create "Record X" on Device A
4. Create "Record Y" on Device B
5. Wait 5-10 seconds
6. Verify both devices have both records
7. Verify last-write-wins for any conflicts

### Test Case D: Sync After Browser Restart
1. Login
2. Create records
3. Close browser completely
4. Restart browser
5. Open extension
6. Verify still logged in
7. Verify sync resumes automatically

---

## Error Cases

### E1: Invalid JWT
**Test**: Manually corrupt JWT in storage
**Expected**: API returns 401, extension shows error status

### E2: Network Timeout
**Test**: Set network throttle to "Slow 3G"
**Expected**: Sync may take longer but should eventually succeed or queue

### E3: API Server Down
**Test**: Stop cloud-sync dev server
**Expected**: Sync status shows error, operations queued, retry on server restart

---

## Performance Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Time to login | < 5 seconds | ___ |
| Time to sync 1 record | < 5 seconds | ___ |
| Polling interval | 3-5 seconds | 4 seconds |
| Sync endpoint response time | < 500ms | ___ |
| Incremental sync data size (0 changes) | < 200 bytes | ___ |
| Full sync data size (100 records) | < 50KB | ___ |

---

## Cleanup

After testing:
1. Logout from extension
2. Clear all test data
3. Stop cloud-sync dev server: `pkill -f wrangler`

---

## Test Completion Checklist

- [ ] AC1: Login with Google OAuth
- [ ] AC2: User email displayed after login
- [ ] AC3: Record syncs to cloud within 5 seconds
- [ ] AC4: Remote record created
- [ ] AC5: Remote record appears in extension
- [ ] AC6: Folder changes sync to cloud
- [ ] AC7: Offline record syncs after reconnection
- [ ] AC8: Logout clears sync state but keeps local data
- [ ] AC9: Incremental sync verified (updatedAt-based)
- [ ] Additional: Delete record syncs
- [ ] Additional: Delete folder syncs
- [ ] Additional: Multi-device sync works
- [ ] Additional: Sync resumes after browser restart

---

## Notes

- For AC1-2 (Google OAuth), you may need to set up OAuth credentials or use a mock token for testing
- The Chrome Identity API requires proper OAuth client configuration
- Local testing uses http://localhost:8787, production would use HTTPS
- JWT secrets should be different for dev vs production
