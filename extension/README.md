# Tidemark Browser Extension

Chrome Extension (Manifest v3) for recording playback time on YouTube and Twitch.

## Features

- Record current playback time with optional topic name
- Platform-aware theming (YouTube red, Twitch purple)
- Display video/stream title and current time
- Store up to 500 records locally in Chrome Storage
- View and manage recorded time points
- Direct links to VOD with timestamps

## Development

### Prerequisites

- Node.js 18+
- npm

### Build

```bash
npm install
npm run build
```

The built extension will be in the `dist/` directory.

### Install in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `dist/` directory

### Development Workflow

```bash
# Watch TypeScript files for changes
npm run watch

# In another terminal, rebuild after changes
npm run build
```

After rebuilding, click the refresh icon on the extension card in `chrome://extensions/`.

## Structure

```
extension/
├── src/
│   ├── types.ts           # Shared type definitions
│   ├── background.ts      # Background service worker
│   ├── content/
│   │   ├── youtube.ts     # YouTube content script
│   │   └── twitch.ts      # Twitch content script
│   └── popup/
│       └── popup.ts       # Popup UI logic
├── popup.html             # Popup HTML
├── popup.css              # Popup styles
├── manifest.json          # Extension manifest
└── dist/                  # Built extension (git ignored)
```

## Platform Support

- **YouTube**: Videos, live streams
- **Twitch**: Live streams, VODs

## Storage

Records are stored in Chrome Storage Local with a 500 record limit. The storage structure:

```typescript
{
  records: Array<{
    id: string;
    timestamp: string;      // ISO 8601
    liveTime: string;       // HH:MM:SS or MM:SS
    title: string;
    topic: string;          // default "無主題"
    folderId: string | null;
    channelUrl: string;     // VOD link with ?t= parameter
    platform: string;       // "youtube" or "twitch"
  }>
}
```

## Error Handling

- **Non-YouTube/Twitch page**: "請在 YouTube 或 Twitch 頁面使用"
- **Video not loaded**: "無法取得播放時間,請確認影片已載入"
- **Content script injection failure**: Retries up to 3 times, then "請重新整理頁面"
- **Storage write failure**: "儲存失敗,請稍後重試"
