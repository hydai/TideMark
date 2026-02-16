# Task #3 Verification Guide - Folder Management

## Overview
This document provides step-by-step instructions to verify all acceptance criteria for Task #3: EXT-002 - Browser Extension - Folder Management.

## Prerequisites
1. Build the extension: `cd extension && npm run build`
2. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select: `extension/dist/`

## Test Environment
- Test on YouTube: https://www.youtube.com/watch?v=dQw4w9WgXcQ
- Test on Twitch: https://www.twitch.tv/directory (any live stream)

## Acceptance Criteria Verification

### Step 1: Open Extension Popup on Supported Page

**Action**: Navigate to a YouTube video or Twitch stream, then click the Tidemark extension icon.

**Expected Result**:
- Popup opens with width ~600px
- Left sidebar shows "資料夾" header with "未分類" folder
- Right panel shows "記錄列表"
- Two-panel layout is visible

**Verification**: ✅ / ❌

---

### Step 2: Create New Folder

**Action**:
1. In the left sidebar, locate the folder input field (placeholder: "新增資料夾...")
2. Type a folder name (e.g., "測試資料夾1")
3. Press Enter (or click the "+" button)

**Expected Result**:
- New folder appears in the left sidebar below "未分類"
- Folder has correct name "測試資料夾1"
- Input field is cleared

**Verification**: ✅ / ❌

---

### Step 3: Verify Folder Data Structure

**Action**: Open Chrome DevTools Console and run:
```javascript
chrome.storage.local.get(['folders'], (result) => {
  console.log('Folders:', result.folders);
});
```

**Expected Result**:
```json
[
  {
    "id": "folder-1234567890",
    "name": "測試資料夾1",
    "created": "2026-02-16T..."
  }
]
```

**Verification**: ✅ / ❌

---

### Step 4: Rename Folder

**Action**:
1. Double-click on the folder name "測試資料夾1"
2. Input field appears with current name selected
3. Type new name "重新命名資料夾"
4. Press Enter (or click away)

**Expected Result**:
- Folder name changes to "重新命名資料夾"
- Close and reopen popup - name persists

**Verification**: ✅ / ❌

---

### Step 5: Create Record in Folder

**Action**:
1. Select the renamed folder by clicking on it (should highlight)
2. In the record form, enter a topic name (e.g., "測試記錄")
3. Click "記錄當前時間" button

**Expected Result**:
- Record is created and appears in the right panel
- Record shows in the selected folder context

**Verification**: ✅ / ❌

---

### Step 6: Delete Folder with Records

**Action**:
1. Hover over the folder with records
2. Click the "×" delete button that appears
3. Confirm deletion in the dialog

**Expected Result**:
- Confirmation dialog appears: "確定要刪除此資料夾嗎？資料夾內的記錄將移至「未分類」"
- After confirming:
  - Folder is removed from sidebar
  - Records move to "未分類" folder
  - Select "未分類" to verify records are there

**Verification**: ✅ / ❌

---

### Step 7: Verify "Uncategorized" Folder Restrictions

**Action**:
1. Try to double-click "未分類" folder name
2. Try to delete "未分類" folder (hover to check for delete button)
3. Try to drag "未分類" folder

**Expected Result**:
- Double-click does nothing (no rename)
- No delete button appears on hover
- Folder is not draggable (no visual feedback on drag attempt)

**Verification**: ✅ / ❌

---

### Step 8: Create Multiple Folders and Reorder

**Action**:
1. Create 3 folders:
   - "資料夾A"
   - "資料夾B"
   - "資料夾C"
2. Drag "資料夾C" above "資料夾A"
3. Release the drag

**Expected Result**:
- Order changes to:
  1. 未分類
  2. 資料夾C
  3. 資料夾A
  4. 資料夾B
- Close and reopen popup - order persists

**Verification**: ✅ / ❌

---

### Step 9: Attempt Blank Folder Name

**Action**:
1. Click on the folder input field
2. Leave it blank (or enter only spaces)
3. Press Enter or click "+" button

**Expected Result**:
- Nothing happens (no folder created)
- No error message displayed
- Input field remains focused

**Verification**: ✅ / ❌

---

## Additional UI Verification

### Visual Layout Checks

**Left Sidebar**:
- Width: ~200px
- Background: white
- Border-right: 1px solid gray
- Contains:
  - Header: "資料夾"
  - Input + button for creating folders
  - Scrollable folder list

**Right Panel**:
- Flex: 1 (takes remaining space)
- Background: light gray (#fafafa)
- Contains:
  - Header: "記錄列表" with count
  - Scrollable records list

**Folder Items**:
- Padding: 8px 12px
- Hover: light gray background
- Active: platform color (red/purple) with white text
- Delete button appears on hover (except "未分類")

**Drag and Drop**:
- Dragging: item becomes semi-transparent
- Drag over: visual indicator (border-top)
- Cannot drag "未分類"

### Platform Theming

**YouTube Page**:
- Header: red gradient
- Folder input focus: red border
- Add button: red background
- Active folder: red background

**Twitch Page**:
- Header: purple gradient
- Folder input focus: purple border
- Add button: purple background
- Active folder: purple background

---

## Error Scenarios

### E1.2a: Blank Folder Name

**Test**: Enter empty string or spaces in folder input, then press Enter.

**Expected**: No folder created, no error shown.

**Result**: ✅ / ❌

---

### E1.2b: Storage Write Failure

**Test**: (Difficult to simulate - requires storage quota limit or API failure)

**Expected**: "操作失敗" error message displayed.

**Manual Override**: Not testable without API mocking. ⚠️

---

## Code Quality Checks

### Type Safety
- ✅ All TypeScript types defined for Folder interface
- ✅ StorageData updated to include folders array
- ✅ Constants defined for UNCATEGORIZED_ID and UNCATEGORIZED_NAME

### Security
- ✅ All DOM manipulation uses safe methods (createElement, textContent)
- ✅ No innerHTML with user input
- ✅ Proper event listener cleanup

### Backward Compatibility
- ✅ Existing Record structure unchanged
- ✅ Records without folderId are treated as uncategorized
- ✅ Extension works even if folders array is empty/missing

---

## Build and Validation

```bash
cd extension
npm run build
npm run validate
```

**Expected Output**:
```
✅ All checks passed! Extension is ready to load.
```

**Result**: ✅ / ❌

---

## Summary Checklist

- [ ] Step 1: Open extension popup on supported page
- [ ] Step 2: Create new folder
- [ ] Step 3: Verify folder data structure (id, name, created)
- [ ] Step 4: Rename folder (double-click)
- [ ] Step 5: Create record assigned to folder
- [ ] Step 6: Delete folder, verify records move to "Uncategorized"
- [ ] Step 7: Verify "Uncategorized" restrictions (no delete, rename, reorder)
- [ ] Step 8: Create 3+ folders and drag to reorder
- [ ] Step 9: Attempt blank folder name (silently rejected)
- [ ] Visual: Two-panel layout correct
- [ ] Visual: Platform theming correct (YouTube red, Twitch purple)
- [ ] Visual: Drag-and-drop visual feedback
- [ ] Build: Extension builds without errors
- [ ] Validation: All validation checks pass

---

## Notes for Manual Tester

1. **Storage Inspection**: Use Chrome DevTools to inspect chrome.storage.local at any time:
   ```javascript
   chrome.storage.local.get(null, (data) => console.log(data));
   ```

2. **Clear Storage**: To reset for testing:
   ```javascript
   chrome.storage.local.clear(() => console.log('Storage cleared'));
   ```

3. **Screenshot Locations**: Save screenshots to `.screenshots/` folder:
   - `folder-create.png` - Creating a folder
   - `folder-rename.png` - Renaming a folder
   - `folder-delete.png` - Delete confirmation dialog
   - `folder-reorder.png` - Drag-and-drop in action
   - `uncategorized-restrictions.png` - Showing "Uncategorized" cannot be modified

4. **Known Limitations**:
   - Drag-and-drop requires holding and dragging (not click-to-select)
   - "Uncategorized" is always first and cannot be moved
   - Maximum 50 characters for folder names (maxlength attribute)

---

## Verification Complete

**Date**: __________

**Tester**: __________

**All Tests Passed**: ✅ / ❌

**Issues Found**: (List any issues below)
