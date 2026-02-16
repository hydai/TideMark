# Task #5: Import/Export Verification Guide

## Prerequisites
1. Build the extension: `npm run build`
2. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `extension/dist/` directory

## Test Data Setup

### Create Test Records and Folders
1. Open YouTube (e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ)
2. Open the Tidemark extension popup
3. Create 3 folders:
   - "測試資料夾 A"
   - "測試資料夾 B"
   - "測試資料夾 C"
4. Create at least 5 records in different folders:
   - 2 records in "測試資料夾 A"
   - 2 records in "測試資料夾 B"
   - 1 record in "未分類"

## Acceptance Criteria Testing

### AC1: Create Records and Folders
- [x] Create several Records and Folders in the extension
- Verify: Records and folders created successfully

### AC2: Export Functionality
**Steps:**
1. Click the "⚙️ 設定" button at the bottom of the popup
2. The settings section should expand
3. Click "📥 匯出資料" button
4. A JSON file should download with name like `tidemark-export-2026-02-16.json`

**Verification:**
- [ ] JSON file downloaded successfully
- [ ] File name contains current date
- [ ] Open the file in a text editor

**Expected JSON Structure:**
```json
{
  "version": "1.0",
  "exportedAt": "2026-02-16T...",
  "records": [
    {
      "id": "record-...",
      "timestamp": "...",
      "liveTime": "...",
      "title": "...",
      "topic": "...",
      "folderId": "..." or null,
      "channelUrl": "...",
      "platform": "youtube" or "twitch"
    }
  ],
  "folders": [
    {
      "id": "folder-...",
      "name": "...",
      "created": "..."
    }
  ]
}
```

**Verify:**
- [ ] `version` is "1.0"
- [ ] `exportedAt` is valid ISO 8601 timestamp
- [ ] `records` array contains all your created records
- [ ] `folders` array contains all your created folders
- [ ] Each record has all required fields
- [ ] Each folder has all required fields

### AC3: Clear Local Data
**Option 1: Chrome DevTools**
1. Right-click extension icon → Inspect popup
2. In DevTools Console, run:
   ```javascript
   chrome.storage.local.clear(() => console.log('Storage cleared'))
   ```
3. Close and reopen popup
4. Verify all records and folders are gone

**Option 2: Use Different Browser Profile**
1. Create a new Chrome profile
2. Load the extension in the new profile
3. Open the extension popup
4. Verify no records or folders exist

### AC4: Import with Merge Mode
**Steps:**
1. (If you cleared data) Create 1-2 new records/folders as "existing data"
2. Click "⚙️ 設定" button
3. Click "📤 匯入資料" button
4. Select the previously exported JSON file
5. A modal should appear showing import stats

**Modal Verification:**
- [ ] Modal shows correct count: "找到 X 筆記錄與 Y 個資料夾"
- [ ] Three buttons visible: "合併 (Merge)", "覆寫 (Overwrite)", "取消"
- [ ] Help text explains the difference

**Import:**
6. Click "合併 (Merge)" button
7. Success message should appear
8. Modal closes automatically

**Verification:**
- [ ] Success message shows number of imported items
- [ ] New records appear in the list
- [ ] New folders appear in the sidebar
- [ ] Existing data (if any) is preserved
- [ ] No duplicate IDs (records with same ID are skipped)

### AC5: Import with Overwrite Mode
**Steps:**
1. Ensure you have some records/folders in storage
2. Click "⚙️ 設定" button
3. Click "📤 匯入資料" button
4. Select the exported JSON file
5. Modal appears
6. Click "覆寫 (Overwrite)" button
7. Success message should appear

**Verification:**
- [ ] All previous data is deleted
- [ ] Only imported data remains
- [ ] Record count matches exported file
- [ ] Folder count matches exported file

### AC6: Invalid JSON File
**Steps:**
1. Create a text file with invalid JSON:
   ```
   this is not valid json { } [
   ```
2. Save as `invalid.json`
3. Click "⚙️ 設定" → "📤 匯入資料"
4. Select `invalid.json`

**Verification:**
- [ ] Error message appears: "檔案格式不正確"
- [ ] No modal shown
- [ ] No data imported
- [ ] Existing data unchanged

### AC7: Incompatible Data Structure
**Test Case 1: Missing version field**
Create `incompatible1.json`:
```json
{
  "exportedAt": "2026-02-16T00:00:00.000Z",
  "records": [],
  "folders": []
}
```

**Test Case 2: Invalid records array**
Create `incompatible2.json`:
```json
{
  "version": "1.0",
  "exportedAt": "2026-02-16T00:00:00.000Z",
  "records": "not an array",
  "folders": []
}
```

**Test Case 3: Missing required record fields**
Create `incompatible3.json`:
```json
{
  "version": "1.0",
  "exportedAt": "2026-02-16T00:00:00.000Z",
  "records": [
    {
      "id": "test",
      "title": "test"
    }
  ],
  "folders": []
}
```

**For each test case:**
1. Click "⚙️ 設定" → "📤 匯入資料"
2. Select the incompatible JSON file

**Verification:**
- [ ] Error message appears: "無法匯入：資料版本不相容"
- [ ] No modal shown
- [ ] No data imported
- [ ] Existing data unchanged

## Additional Verification

### Edge Cases

**Empty Export:**
1. Clear all data
2. Export data
3. Verify JSON has empty arrays: `"records": []`, `"folders": []`
4. Import this file → should work without errors

**Large Export (MAX_RECORDS limit):**
1. Create exactly 500 records (max limit)
2. Export → verify all 500 are in JSON
3. Import with merge → verify limit is enforced

**Special Characters:**
1. Create records with special characters in topic: `"测试 🎉 <>&'"`
2. Export → verify JSON escapes correctly
3. Import → verify characters preserved

**Cross-Platform:**
1. Export from YouTube page
2. Import while on Twitch page
3. Verify platform theme doesn't affect import

### UI/UX Verification

- [ ] Settings toggle button works (expand/collapse)
- [ ] Export button shows "匯出中..." during export
- [ ] Import button triggers file picker
- [ ] Modal backdrop prevents interaction with popup
- [ ] Modal "取消" button closes without importing
- [ ] Success messages auto-dismiss after 3 seconds
- [ ] Error messages persist until next action
- [ ] File input resets after import (can import again)

### Build Verification

```bash
npm run build
npm run validate
```

- [ ] Build succeeds without errors
- [ ] All validation checks pass
- [ ] popup.js compiles correctly
- [ ] popup.css includes new styles
- [ ] popup.html includes new elements

## Test Results Template

```markdown
## Test Execution Results

Date: YYYY-MM-DD
Tester: [Your Name]

### AC1: Create Records and Folders
- Status: [ ] PASS / [ ] FAIL
- Notes:

### AC2: Export Functionality
- Status: [ ] PASS / [ ] FAIL
- JSON file downloaded: [ ] Yes / [ ] No
- Structure valid: [ ] Yes / [ ] No
- Notes:

### AC3: Clear Local Data
- Status: [ ] PASS / [ ] FAIL
- Method used: [ ] DevTools / [ ] New Profile
- Notes:

### AC4: Import with Merge Mode
- Status: [ ] PASS / [ ] FAIL
- Records merged: [ ] Correct / [ ] Incorrect
- Duplicates handled: [ ] Yes / [ ] No
- Notes:

### AC5: Import with Overwrite Mode
- Status: [ ] PASS / [ ] FAIL
- Previous data cleared: [ ] Yes / [ ] No
- Notes:

### AC6: Invalid JSON File
- Status: [ ] PASS / [ ] FAIL
- Error message correct: [ ] Yes / [ ] No
- Notes:

### AC7: Incompatible Data Structure
- Status: [ ] PASS / [ ] FAIL
- Error message correct: [ ] Yes / [ ] No
- All test cases: [ ] Pass / [ ] Fail
- Notes:

### Overall Result
- [ ] ALL TESTS PASSED
- [ ] SOME TESTS FAILED (see notes above)

### Issues Found
1.
2.
3.

### Screenshots
- Export: [path]
- Import Modal: [path]
- Success Message: [path]
- Error Messages: [path]
```

## Troubleshooting

### Export button does nothing
- Check browser console for errors
- Verify `handleExport` function is called
- Check Chrome permissions (downloads permission)

### Import file picker doesn't open
- Verify file input element exists
- Check event listener attached
- Verify button click triggers file picker

### Modal doesn't appear
- Check `pendingImportData` is set
- Verify modal element exists in DOM
- Check modal CSS (should not be `display: none`)

### Data not imported
- Check Chrome storage in DevTools:
  ```javascript
  chrome.storage.local.get(['records', 'folders'], console.log)
  ```
- Verify import function completed
- Check for JavaScript errors in console

## Success Criteria Summary

All 9 acceptance criteria must pass:
- [x] AC1: Create test data
- [ ] AC2: Export downloads valid JSON
- [ ] AC3: Clear data successfully
- [ ] AC4: Import merge mode works
- [ ] AC5: Import overwrite mode works
- [ ] AC6: Invalid JSON error shown
- [ ] AC7: Incompatible structure error shown
- [ ] Build succeeds
- [ ] No console errors
