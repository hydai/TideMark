# Task #4 Verification Guide: EXT-003 - Record Management

## Overview
This guide provides step-by-step instructions to verify all acceptance criteria for Task #4: Browser Extension - Record Management.

## Prerequisites
1. Extension built successfully: `cd extension && npm run build`
2. Extension loaded in Chrome: `chrome://extensions/` → Load unpacked → `extension/dist/`
3. Access to YouTube and/or Twitch pages with video content

## Feature Summary
- **Group by stream title**: Records grouped by title with collapsible headers
- **Edit topic**: Double-click topic name to edit inline
- **Copy time**: Button to copy liveTime to clipboard
- **Go to VOD**: Link opens channelUrl in new tab
- **Delete record**: Button to remove record
- **Drag within group**: Reorder records in same title group
- **Drag to folder**: Move record to different folder
- **Drag group**: Reorder entire title groups
- **Twitch VOD fallback**: Link to channel videos if VOD not available

---

## Acceptance Criteria Verification

### Step 1: Create several Records across different live streams/videos

**Action:**
1. Open Chrome and navigate to a YouTube video (e.g., https://youtube.com/watch?v=dQw4w9WgXcQ)
2. Play the video for a few seconds
3. Click the Tidemark extension icon
4. Enter a topic name: "Test YouTube Record 1"
5. Click "記錄當前時間" button
6. Navigate to a different YouTube video
7. Create another record: "Test YouTube Record 2"
8. Navigate to a Twitch stream (e.g., https://twitch.tv/shroud)
9. Create a record: "Test Twitch Record 1"
10. If possible, navigate to a different Twitch stream or VOD
11. Create another record: "Test Twitch Record 2"

**Expected Result:**
- ✅ At least 4 records created across 2+ different video/stream titles
- ✅ Records display in the popup's record list
- ✅ Each record shows: topic, time, platform badge

**Status:** ⬜ Pass / ⬜ Fail

**Notes:**
_______________________________________________________

---

### Step 2: Records grouped by stream title with collapsible sections

**Action:**
1. Click on a folder in the left sidebar (e.g., "未分類")
2. Observe the records list in the right panel

**Expected Result:**
- ✅ Records are grouped by their stream title
- ✅ Each group has a header showing:
  - Collapse icon (▼ when expanded, ▶ when collapsed)
  - Stream title
  - Record count badge
- ✅ Groups are visually separated
- ✅ Records with the same title are in the same group
- ✅ Groups appear in order (most recent first by default)

**Action (Collapse/Expand):**
1. Click on a group header

**Expected Result:**
- ✅ Group collapses (icon changes to ▶, records hidden)
- ✅ Click again → group expands (icon changes to ▼, records visible)
- ✅ Collapse state persists when switching folders and returning

**Status:** ⬜ Pass / ⬜ Fail

**Screenshot Path:** `.screenshots/step2-grouping.png`

**Notes:**
_______________________________________________________

---

### Step 3: Double-click topic name to edit

**Action:**
1. Find a record in the list
2. Double-click on the topic name (e.g., "Test YouTube Record 1")
3. Input field should appear with current topic text selected
4. Type a new topic name: "Edited Topic Name"
5. Press Enter (or click outside the input)

**Expected Result:**
- ✅ Double-click triggers inline edit mode
- ✅ Current topic text is selected/highlighted
- ✅ Input field has focus
- ✅ After Enter/blur, topic updates immediately
- ✅ New topic name displays in the record
- ✅ Change persists (close and reopen popup)

**Action (Blank topic):**
1. Double-click a topic
2. Delete all text
3. Press Enter

**Expected Result:**
- ✅ Topic reverts to "無主題" (default)

**Status:** ⬜ Pass / ⬜ Fail

**Screenshot Path:** `.screenshots/step3-edit-topic.png`

**Notes:**
_______________________________________________________

---

### Step 4: Copy button copies time to clipboard

**Action:**
1. Find a record with a time value (e.g., "01:23:45")
2. Locate the 📋 copy button next to the time
3. Click the copy button
4. Open a text editor (Notepad, TextEdit, VS Code, etc.)
5. Paste (Ctrl+V or Cmd+V)

**Expected Result:**
- ✅ Copy button is visible next to time value
- ✅ On click, button shows visual feedback (checkmark ✓, color change)
- ✅ Time value (e.g., "01:23:45") is pasted correctly in text editor
- ✅ Button returns to original state after ~1.5 seconds

**Status:** ⬜ Pass / ⬜ Fail

**Pasted Value:** `_______________________`

**Notes:**
_______________________________________________________

---

### Step 5: "Go to VOD" link opens correct URL with time parameter

**Action:**
1. Find a YouTube record
2. Click the "前往 VOD →" link at the bottom of the record

**Expected Result:**
- ✅ New tab opens
- ✅ URL contains the video ID
- ✅ URL contains `?t=` or `&t=` time parameter
- ✅ Video player jumps to the correct timestamp

**Example URLs:**
- YouTube: `https://youtu.be/VIDEO_ID?t=123` or `https://youtube.com/watch?v=VIDEO_ID&t=123`
- Twitch VOD: `https://www.twitch.tv/videos/VOD_ID?t=1h2m3s`

**Action (Twitch):**
1. Find a Twitch record
2. Click the "前往 VOD →" link

**Expected Result:**
- ✅ Opens Twitch VOD URL with `?t=` parameter
- ✅ OR opens channel videos page if VOD not yet generated (see Step 10)

**Status:** ⬜ Pass / ⬜ Fail

**Example URL:** `_______________________________________________________`

**Notes:**
_______________________________________________________

---

### Step 6: Delete record removes it from the list

**Action:**
1. Find a record you want to delete
2. Hover over the record (delete button should appear in top-right)
3. Click the × delete button
4. Confirm deletion in the dialog

**Expected Result:**
- ✅ Confirmation dialog appears: "確定要刪除這筆記錄嗎?"
- ✅ After confirming, record is removed from the list
- ✅ Record count updates
- ✅ Record does not reappear after closing and reopening popup

**Action (Cancel deletion):**
1. Click delete button
2. Click "Cancel" in the confirmation dialog

**Expected Result:**
- ✅ Record remains in the list (not deleted)

**Status:** ⬜ Pass / ⬜ Fail

**Notes:**
_______________________________________________________

---

### Step 7: Drag record within same group to reorder

**Prerequisites:**
- At least 2 records in the same title group (same stream/video)

**Action:**
1. Find a group with multiple records
2. Expand the group if collapsed
3. Click and hold on a record item
4. Drag it above or below another record **in the same group**
5. Release the mouse button
6. Close and reopen the popup

**Expected Result:**
- ✅ While dragging:
  - Dragged record becomes semi-transparent
  - Drop target shows visual indicator (border)
- ✅ After drop:
  - Record moves to new position within the group
  - Order updates immediately
- ✅ Order persists after closing/reopening popup
- ✅ Cannot drag record to different group (only within same title)

**Status:** ⬜ Pass / ⬜ Fail

**Screenshot Path:** `.screenshots/step7-drag-record.png`

**Notes:**
_______________________________________________________

---

### Step 8: Drag record to another folder

**Prerequisites:**
- At least 2 folders created
- At least 1 record in a folder

**Action:**
1. Select a folder with records (e.g., "Folder A")
2. Click and hold on a record in the right panel
3. Drag it to a different folder in the left sidebar (e.g., "Folder B")
4. Release the mouse button
5. Click on "Folder B" to view its records
6. Verify the record is now in "Folder B"
7. Click on "Folder A" to verify it's no longer there

**Expected Result:**
- ✅ While dragging:
  - Folders in sidebar highlight when hovered (drag-over state)
  - Visual feedback (background color change, border)
- ✅ After drop:
  - Record moves to target folder
  - Record disappears from source folder
  - Record appears in target folder
- ✅ Move persists after popup close/reopen

**Action (Drag to Uncategorized):**
1. Drag a record from a folder to "未分類"

**Expected Result:**
- ✅ Record moves to "未分類" folder
- ✅ Record's `folderId` becomes `null`

**Status:** ⬜ Pass / ⬜ Fail

**Screenshot Path:** `.screenshots/step8-drag-to-folder.png`

**Notes:**
_______________________________________________________

---

### Step 9: Drag entire group header to reorder groups

**Prerequisites:**
- At least 2 groups (records from 2+ different streams/videos)

**Action:**
1. Select a folder with multiple groups
2. Click and hold on a **group header** (the bar with title and count)
3. Drag it above or below another group header
4. Release the mouse button
5. Close and reopen popup

**Expected Result:**
- ✅ While dragging:
  - Dragged group becomes semi-transparent
  - Drop target group shows visual indicator
- ✅ After drop:
  - Entire group (header + all records) moves to new position
  - Group order updates immediately
  - All records within the group stay together
- ✅ Order persists after closing/reopening popup

**Status:** ⬜ Pass / ⬜ Fail

**Screenshot Path:** `.screenshots/step9-drag-group.png`

**Notes:**
_______________________________________________________

---

### Step 10: Twitch VOD fallback for unavailable VOD

**Prerequisites:**
- A Twitch live stream that has not ended yet (VOD not generated)
- OR simulate by checking the URL pattern

**Action:**
1. Create a record on a Twitch live stream
2. Check the record's "前往 VOD →" link

**Expected Result (E1.3a):**
- ✅ If VOD has been generated:
  - Link goes to `https://www.twitch.tv/videos/{VOD_ID}?t={time}`
- ✅ If VOD has NOT been generated:
  - Link goes to `https://www.twitch.tv/{channel_name}/videos`
  - This is the channel's videos list page

**How to Verify:**
- Right-click the "前往 VOD →" link
- Select "Copy link address"
- Paste into a text editor
- Check the URL format

**Status:** ⬜ Pass / ⬜ Fail

**Example Fallback URL:** `_______________________________________________________`

**Notes:**
_______________________________________________________

---

## UI/UX Checks

### Platform Theming

**YouTube Page:**
- ✅ Group headers use red accent for drag-over state
- ✅ Copy button hover matches YouTube theme
- ✅ Edit input border is red when focused

**Twitch Page:**
- ✅ Group headers use purple accent for drag-over state
- ✅ Copy button hover matches Twitch theme
- ✅ Edit input border is purple when focused

**Status:** ⬜ Pass / ⬜ Fail

---

### Visual Consistency

- ✅ Group headers are visually distinct from records
- ✅ Collapse icons (▶/▼) are clear and consistent
- ✅ Record count badges are readable
- ✅ Drag-and-drop visual feedback is clear (opacity, borders)
- ✅ Copy button is easily discoverable
- ✅ Platform badges (YouTube/Twitch) are visible

**Status:** ⬜ Pass / ⬜ Fail

---

## Code Quality Checks

### Type Safety
- ✅ `RecordGroup` interface defined in `types.ts`
- ✅ `sortOrder` field added to `Record` interface (optional)
- ✅ All functions have proper type annotations
- ✅ No TypeScript compilation errors

### Security
- ✅ All DOM manipulation uses safe methods (createElement, textContent)
- ✅ No innerHTML with user input
- ✅ Clipboard API used correctly (navigator.clipboard.writeText)

### Backward Compatibility
- ✅ `sortOrder` is optional (existing records without it still work)
- ✅ Existing records display correctly
- ✅ Grouped rendering handles records with/without sortOrder

---

## Build Verification

```bash
cd extension
npm run build
npm run validate
```

**Expected Output:**
```
✅ Manifest v3 confirmed
✅ All required permissions present
✅ Content script found: content/youtube.js
✅ Content script found: content/twitch.js
✅ Background service worker found
✅ Popup HTML found
✅ Icons configured
✅ popup.css found
✅ popup/popup.js found
✨ All checks passed! Extension is ready to load.
```

**Status:** ⬜ Pass / ⬜ Fail

---

## Final Checklist

- ⬜ All 10 acceptance criteria verified
- ⬜ Extension builds without errors
- ⬜ No console errors in popup
- ⬜ No console errors in background script
- ⬜ Platform theming works correctly
- ⬜ Drag-and-drop feels smooth and responsive
- ⬜ All features work on both YouTube and Twitch
- ⬜ Data persists across popup close/reopen
- ⬜ Screenshots captured for key features

---

## Known Limitations

1. **Drag-and-drop**: Mouse-only (no keyboard alternative)
2. **Group order persistence**: Based on sortOrder field in records
3. **Twitch VOD detection**: Relies on GQL API response
4. **Copy to clipboard**: Requires HTTPS or localhost (Chrome security)

---

## Troubleshooting

### Records not grouping
- Check that records have `title` field populated
- Verify `groupRecordsByTitle()` function is called

### Copy button not working
- Extension must be loaded from `chrome-extension://` protocol
- Clipboard API requires user gesture (click event)
- Check browser console for errors

### Drag-and-drop not working
- Verify `draggable="true"` attribute on elements
- Check event listeners are attached
- Verify drag-over state classes are applied

### Twitch VOD not found
- VOD may not be generated yet (normal for recent streams)
- Check that GQL API call succeeds
- Fallback to channel videos page is expected behavior

---

## Testing Completion

**Tester Name:** _______________________

**Date:** _______________________

**Overall Status:** ⬜ All Pass / ⬜ Issues Found

**Issues Summary:**
_______________________________________________________
_______________________________________________________
_______________________________________________________
