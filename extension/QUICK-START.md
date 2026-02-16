# Quick Start Guide - Tidemark Extension

## Installation (30 seconds)

1. **Build the extension**:
   ```bash
   cd extension
   npm install
   npm run build
   ```

2. **Open Chrome Extensions**:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" toggle (top right)

3. **Load Extension**:
   - Click "Load unpacked"
   - Select `extension/dist/` directory
   - Extension icon appears in toolbar

## Quick Test (2 minutes)

### YouTube Test

1. Go to any YouTube video: https://www.youtube.com/watch?v=dQw4w9WgXcQ
2. Play the video for 10-15 seconds
3. Click Tidemark extension icon
4. Verify:
   - ✅ Red theme
   - ✅ Video title shown
   - ✅ Current time shown
5. Type a topic: "Test"
6. Click "記錄當前時間"
7. Verify:
   - ✅ Record appears
   - ✅ Shows topic, time, title
   - ✅ Platform badge says "youtube"
8. Click "前往 VOD →"
9. Verify:
   - ✅ Opens video at recorded timestamp

### Twitch Test

1. Go to any Twitch stream (must be live): https://www.twitch.tv/directory
2. Find a live channel and open it
3. Click Tidemark extension icon
4. Verify:
   - ✅ Purple theme
   - ✅ Stream title shown
   - ✅ Current time shown
5. Record a time point
6. Verify:
   - ✅ Record created
   - ✅ Platform badge says "twitch"

### Error Test

1. Go to https://google.com
2. Click Tidemark extension icon
3. Verify:
   - ✅ Error: "請在 YouTube 或 Twitch 頁面使用"
   - ✅ Button disabled

## Debugging

### Check Console

**Extension Popup Console**:
- Right-click extension icon → "Inspect popup"
- Check for JavaScript errors

**Page Console**:
- F12 → Console tab
- Look for "Tidemark {platform} content script loaded"

**Background Service Worker**:
- Go to `chrome://extensions/`
- Click "Inspect views: service worker"
- Check for errors

### Common Issues

**"無法取得播放時間"**:
- Wait for video to fully load
- Refresh page and try again

**Popup doesn't show video info**:
- Check page console for content script errors
- Verify URL is YouTube or Twitch
- Refresh page

**Records not saving**:
- Check popup console for storage errors
- Clear extension data: chrome://extensions/ → Remove → Reload

## Development Workflow

```bash
# Watch TypeScript files
npm run watch

# In another terminal, rebuild after changes
npm run build

# After rebuild, refresh extension
# chrome://extensions/ → Click refresh icon on extension card
```

## Testing Checklist

Quick checklist for manual testing:

- [ ] YouTube video → Red theme → Record works
- [ ] Twitch stream → Purple theme → Record works
- [ ] Non-supported page → Error shown
- [ ] Enter key creates record
- [ ] Records persist after closing popup
- [ ] Delete button works
- [ ] VOD links work
- [ ] 500 record limit enforced
- [ ] No console errors

## Support

For detailed verification steps, see `VERIFICATION.md`.

For implementation details, see `README.md`.
