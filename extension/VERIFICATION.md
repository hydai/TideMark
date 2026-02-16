# Extension Verification Checklist

## Installation Verification

- [ ] Extension loads in Chrome without errors
- [ ] Extension icon appears in Chrome toolbar
- [ ] Extension has correct name "Tidemark" and version "0.1.0"
- [ ] Extension permissions are correctly requested

## YouTube Platform Tests

### AC #2-3: YouTube Page Detection and Theme

- [ ] Navigate to any YouTube video page
- [ ] Click the Tidemark extension icon
- [ ] Popup opens successfully
- [ ] Popup displays YouTube red theme (header gradient from #ff0000 to #cc0000)
- [ ] Platform indicator shows "YouTube"
- [ ] Video title is displayed correctly
- [ ] Current playback time is shown in HH:MM:SS or MM:SS format

### AC #4-6: Record Creation on YouTube

- [ ] Play a YouTube video for a few seconds
- [ ] Open the Tidemark popup
- [ ] Type a custom topic name (e.g., "測試主題")
- [ ] Click "記錄當前時間" button
- [ ] New record appears in the list
- [ ] Record shows:
  - [ ] Topic: "測試主題"
  - [ ] Time: Correct playback time in HH:MM:SS or MM:SS
  - [ ] Title: Correct video title
  - [ ] Created: Relative timestamp (e.g., "剛剛")
  - [ ] Platform: Badge showing "youtube" in red
  - [ ] Link: "前往 VOD →" clickable link
- [ ] Click the VOD link
- [ ] New tab opens with correct youtu.be/{videoId}?t={seconds} URL
- [ ] Video starts at the recorded timestamp

### Enter Key Test

- [ ] Open popup on YouTube
- [ ] Type topic name
- [ ] Press Enter key
- [ ] Record is created (same as clicking button)

### Default Topic Test

- [ ] Open popup on YouTube
- [ ] Leave topic input empty
- [ ] Click "記錄當前時間"
- [ ] Record is created with topic "無主題"

## Twitch Platform Tests

### AC #7: Twitch Page Detection and Theme

- [ ] Navigate to any Twitch stream page (live)
- [ ] Click the Tidemark extension icon
- [ ] Popup opens successfully
- [ ] Popup displays Twitch purple theme (header gradient from #9146ff to #6441a5)
- [ ] Platform indicator shows "Twitch"
- [ ] Stream title is displayed correctly
- [ ] Current playback time is shown

### AC #8: Record Creation on Twitch

- [ ] Open popup on Twitch live stream
- [ ] Record a time point with topic "Twitch 測試"
- [ ] New record appears in the list
- [ ] Record shows:
  - [ ] Topic: "Twitch 測試"
  - [ ] Time: Correct live time
  - [ ] Title: Correct stream title
  - [ ] Platform: Badge showing "twitch" in purple
  - [ ] Link: VOD link (may point to channel videos if VOD not yet available)

### Twitch VOD Test

- [ ] Navigate to a Twitch VOD page (https://www.twitch.tv/videos/{id})
- [ ] Open popup
- [ ] Seek to a specific time in the VOD
- [ ] Record the time point
- [ ] Verify channelUrl includes correct ?t= parameter (e.g., ?t=1h23m45s)

## Error Handling Tests

### AC #9: Non-Supported Page Error

- [ ] Navigate to a non-YouTube/Twitch page (e.g., google.com)
- [ ] Click the Tidemark extension icon
- [ ] Popup opens
- [ ] Error message displayed: "請在 YouTube 或 Twitch 頁面使用"
- [ ] "記錄當前時間" button is disabled
- [ ] Video info section is hidden

### AC #10: Video Not Loaded Error

- [ ] Navigate to YouTube video page
- [ ] Immediately open popup before video loads
- [ ] If video hasn't loaded yet:
  - [ ] Error message: "無法取得播放時間,請確認影片已載入"
  - [ ] OR extension retries up to 3 times, then shows error
  - [ ] Button is disabled

### Content Script Injection Failure

- [ ] Test retry mechanism (hard to test manually, verify in code)
- [ ] After 3 failed retries, shows error: "請重新整理頁面"

## Storage Tests

### AC #11: Chrome Storage Functionality

- [ ] Create multiple records (at least 5)
- [ ] Close and reopen popup
- [ ] All records are still visible
- [ ] Record count shows correct number (e.g., "共 5 筆")

### Record Limit Test

- [ ] Create records until reaching 500
- [ ] Create 501st record
- [ ] Verify oldest record is removed
- [ ] Total count remains 500

### Record Deletion

- [ ] Click × button on a record
- [ ] Confirmation dialog appears: "確定要刪除這筆記錄嗎?"
- [ ] Click "OK"
- [ ] Record is removed from list
- [ ] Record count updates
- [ ] Reload popup, verify record is still deleted

### Empty State

- [ ] Delete all records
- [ ] Verify "尚無記錄" message appears
- [ ] Record count is empty

## Visual and UX Tests

### Button Feedback

- [ ] Click "記錄當前時間" button
- [ ] Button text changes to "✓ 已記錄"
- [ ] After 1.5 seconds, button text reverts to "記錄當前時間"

### Scrolling

- [ ] Create enough records to require scrolling (10+)
- [ ] Verify records section is scrollable
- [ ] Scrollbar appears and functions correctly

### Record Hover Effect

- [ ] Hover over a record item
- [ ] Record lifts slightly (transform: translateY(-1px))
- [ ] Box shadow increases

### Platform Theme Consistency

- [ ] On YouTube: All interactive elements use red accent
  - [ ] Input focus border: red
  - [ ] Button gradient: red
  - [ ] VOD links: red
- [ ] On Twitch: All interactive elements use purple accent
  - [ ] Input focus border: purple
  - [ ] Button gradient: purple
  - [ ] VOD links: purple

## Performance Tests

- [ ] Extension loads quickly (< 500ms)
- [ ] Popup opens instantly when clicked
- [ ] Record creation is immediate (no lag)
- [ ] List rendering is smooth with 100+ records

## Browser Console Tests

- [ ] No JavaScript errors in popup console
- [ ] No JavaScript errors in page console
- [ ] Content scripts log "Tidemark {platform} content script loaded"
- [ ] Background service worker logs "Tidemark background service worker loaded"

## Edge Cases

### URL Variations

- [ ] YouTube short URLs (youtu.be)
- [ ] YouTube live streams (/live/)
- [ ] YouTube regular videos (/watch?v=)
- [ ] Twitch channel pages (live)
- [ ] Twitch VOD pages (/videos/)

### Time Format Edge Cases

- [ ] Time < 10 minutes: Format as MM:SS (e.g., "05:23")
- [ ] Time >= 1 hour: Format as HH:MM:SS (e.g., "01:23:45")
- [ ] Time at 0:00: Should work without error

### Special Characters in Topic

- [ ] Enter topic with emojis
- [ ] Enter topic with special characters (&, <, >, ", ')
- [ ] Verify proper escaping (no XSS)
- [ ] Verify display is correct

## Cross-Browser Compatibility

- [ ] Chrome: Full functionality
- [ ] Edge: Full functionality (Chromium-based)
- [ ] Note: Firefox requires Manifest v2, not tested

## Accessibility

- [ ] Keyboard navigation works
- [ ] Enter key triggers record creation
- [ ] Tab key navigates between elements
- [ ] Button has proper focus states

## Final Checklist

All acceptance criteria from Task #2:

- [ ] AC #1: Extension installs successfully (Manifest v3)
- [ ] AC #2: Navigate to YouTube video, open popup
- [ ] AC #3: Popup displays with YouTube red theme and video title
- [ ] AC #4: Type topic name, click "Record Current Time" or press Enter
- [ ] AC #5: Record appears with timestamp, liveTime, title, topic, platform="youtube"
- [ ] AC #6: Record's channelUrl contains correct youtu.be short link
- [ ] AC #7: Navigate to Twitch stream, popup shows purple theme
- [ ] AC #8: Record time point, Record created with correct Twitch VOD link
- [ ] AC #9: Non-YouTube/Twitch page shows error "請在 YouTube 或 Twitch 頁面使用"
- [ ] AC #10: Video not loaded shows error "無法取得播放時間,請確認影片已載入"
- [ ] AC #11: Chrome Storage stores Records and respects 500 record limit

## Notes

- Manual testing required as this is a browser extension
- Testing should be done in Chrome browser (or Edge)
- Requires actual YouTube and Twitch pages to test content script injection
- Some tests (like 500 record limit) may require automation or patience
