<p align="center"><img src="TideMark.png" width="400" /></p>

# Tidemark

Unified streaming content capture tool for YouTube and Twitch. Mark time points while watching streams, download videos, and transcribe content — all synced across browser extension and desktop app.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│  Browser Extension  │     │    Desktop App        │
│  (Chrome/Edge)      │     │    (Tauri)            │
│                     │     │                       │
│  - Mark timestamps  │     │  - Download videos    │
│  - Organize folders │     │  - Record live streams│
│  - Import/Export    │     │  - Transcribe (ASR)   │
│                     │     │  - Manage records     │
└────────┬────────────┘     │  - Scheduled downloads│
         │                  │  - System tray mode   │
         │                  └────────┬──────────────┘
         └──────────┬────────────────┤
                    │ JWT Auth       │
         ┌──────────▼──────────┐     │
         │   Cloud Sync API    │     ├── Twitch PubSub (WebSocket)
         │   (CF Workers + D1) │     └── YouTube RSS (HTTP polling)
         └─────────────────────┘
```

## Components

### Desktop App (`/`, `/src`, `/src-tauri`)

Tauri 2 app with TypeScript frontend and Rust backend.

- **Frontend**: Vanilla TypeScript + Vite, single-page app with tab navigation
- **Backend**: Rust with Tauri commands for download, recording, transcription, auth, scheduled downloads
- **Background Services**: Twitch PubSub WebSocket, YouTube RSS polling, system tray
- **Sidecars**: yt-dlp (download), FFmpeg/FFprobe (media processing), Python (ASR)

### Browser Extension (`/extension`)

Chrome/Edge extension (Manifest v3) for marking timestamps on YouTube and Twitch.

- Content scripts inject into YouTube/Twitch pages
- Popup UI for managing records and folders
- Background service worker for sync and messaging

### Cloud Sync API (`/cloud-sync`)

Cloudflare Workers + D1 REST API for syncing records and folders.

- Hono web framework
- Google OAuth authentication with JWT sessions
- Incremental sync via `updatedAt`-based polling

## Prerequisites

- **Node.js** >= 18
- **Rust** >= 1.77.2 (for Tauri backend)
- **yt-dlp** (video downloads)
- **FFmpeg / FFprobe** (media processing)
- **Python 3** (optional, for local ASR transcription)

## Development

### Desktop App

```bash
npm install
npm run tauri:dev
```

This starts both the Vite dev server (port 1420) and the Tauri app.

**Production build:**

```bash
npm run tauri:build
```

### Browser Extension

```bash
cd extension
npm install
npm run build
```

Load the `extension/dist/` folder as an unpacked extension in Chrome/Edge.

### Cloud Sync API

```bash
cd cloud-sync
npm install

# Set up local dev secrets
echo 'JWT_SECRET=your-dev-secret' > .dev.vars

# Initialize D1 database
npx wrangler d1 execute tidemark --local --file=schema.sql

# Start dev server
npm run dev
```

**Deploy:**

```bash
cd cloud-sync
wrangler secret put JWT_SECRET
npx wrangler d1 execute tidemark --file=schema.sql
npm run deploy
```

### Local ASR Setup (Optional)

```bash
cd scripts/asr
chmod +x setup_environment.sh
./setup_environment.sh
```

This creates a Python venv and installs Whisper/Qwen dependencies.

## Project Structure

```
Tidemark/
├── src/                    # Desktop frontend (TypeScript)
│   ├── main.ts             # Entry point
│   ├── app.ts              # Tab navigation, routing
│   ├── config.ts           # AppConfig interface & persistence
│   ├── theme.ts            # Dark/Light/System theme
│   ├── sync.ts             # Cloud sync polling service
│   ├── style.css           # Global styles
│   └── pages/
│       ├── download.ts     # Video download & live recording
│       ├── history.ts      # Download history management
│       ├── subtitles.ts    # Transcription (local + cloud ASR)
│       ├── records.ts      # Records & folders management
│       ├── scheduled-downloads.ts  # Scheduled downloads & presets
│       └── settings.ts     # All settings sections
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # All Tauri commands
│   │   └── main.rs         # App entry point
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── extension/
│   ├── src/
│   │   ├── types.ts        # Shared type definitions
│   │   ├── background.ts   # Service worker
│   │   ├── sync.ts         # Cloud sync client
│   │   └── content/        # YouTube & Twitch content scripts
│   ├── manifest.json       # Manifest v3
│   └── popup.html/css      # Extension popup UI
├── cloud-sync/
│   ├── src/
│   │   ├── index.ts        # Hono app entry
│   │   ├── auth.ts         # Google OAuth flow
│   │   ├── handlers.ts     # API route handlers
│   │   ├── middleware.ts    # JWT auth middleware
│   │   ├── jwt.ts          # JWT utilities
│   │   └── types.ts        # API types
│   ├── schema.sql          # D1 database schema
│   └── wrangler.toml       # Cloudflare config
├── scripts/asr/
│   ├── transcribe.py       # Python ASR script
│   ├── requirements.txt    # Python dependencies
│   └── setup_environment.sh
├── SPEC.md                 # Full specification
└── package.json            # Root project config
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop Frontend | TypeScript, Vite 7, HTML/CSS |
| Desktop Backend | Rust, Tauri 2 |
| Browser Extension | TypeScript, Chrome Manifest v3 |
| Cloud Sync API | TypeScript, Hono, Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Downloads | yt-dlp, FFmpeg |
| Transcription | Whisper, Qwen3-ASR, OpenAI/Groq/ElevenLabs APIs |

## License

MIT
