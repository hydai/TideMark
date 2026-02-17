# Tidemark - Project Instructions

## Build & Dev Commands

### Desktop App (root)
- `npm run tauri:dev` — Start development (Vite + Tauri)
- `npm run tauri:build` — Production build
- `npm run dev` — Vite dev server only (no Tauri)
- `npm run build` — Vite build only
- `cargo build --release` — Rust backend only (from `src-tauri/`)

### Browser Extension
- `cd extension && npm run build` — Build extension to `dist/`
- TypeScript compiled via `tsc`, then `build.js` copies assets

### Cloud Sync API
- `cd cloud-sync && npm run dev` — Local dev server (Wrangler)
- `cd cloud-sync && npm run deploy` — Deploy to Cloudflare
- `cd cloud-sync && npm test` — Run tests (Vitest)

## Architecture

### Desktop App
- **Frontend**: Vanilla TypeScript, no framework. DOM manipulation via `document.createElement`.
- **Backend**: Single `src-tauri/src/lib.rs` with all Tauri commands. No module splitting.
- **IPC**: Tauri `invoke()` for commands, `emit()`/`listen()` for events (progress, downloads).
- **Config**: Persisted to `{appDataDir}/tidemark/config.json`. Interface in `src/config.ts`.
- **Auth config**: Separate file at `{appDataDir}/tidemark/auth_config.json`.
- **Scheduled presets**: Persisted to `{appDataDir}/tidemark/scheduled_presets.json`.
- **System tray**: App minimizes to tray when scheduled downloads are active. Tray menu provides monitoring control.
- **Background services**: Twitch PubSub WebSocket and YouTube RSS polling run as tokio tasks for live stream detection.

### Frontend Pages
Each page in `src/pages/*.ts` exports a `render*Page(container)` function that builds the entire page DOM. Pages are mounted/unmounted by `src/app.ts` on tab switch. The "Scheduled Downloads" tab is conditionally rendered based on `enable_scheduled_downloads` config.

### Cloud Sync
- Polling-based sync (3-5s intervals) using `updatedAt` timestamps.
- Soft-delete pattern: `deleted=1` flag, never hard-delete during sync.
- JWT auth with Google OAuth. Secrets via `wrangler secret put`.

## Conventions

- **Language**: UI text is in Traditional Chinese (繁體中文).
- **Commit style**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- **No framework**: Desktop frontend is vanilla TS. Do not introduce React/Vue/Svelte.
- **Single lib.rs**: All Tauri commands live in `src-tauri/src/lib.rs`. Keep it as one file.
- **Type safety**: TypeScript strict mode. Rust types mirror TS interfaces for IPC.

## Key Patterns

### Tauri Command Registration
Commands are registered in `lib.rs` via `tauri::generate_handler![...]` in the `run()` function. When adding a new command:
1. Define the `#[tauri::command]` function
2. Add it to the `generate_handler!` macro invocation

### Config System
`src/config.ts` has `loadConfig()` and `saveConfig()` that read/write via Tauri commands. Add new settings by:
1. Adding the field to `AppConfig` interface
2. Adding a default value in `defaultConfig`
3. Adding UI controls in `src/pages/settings.ts`

### Event-Based Progress
Long-running operations (downloads, recordings, transcription) emit Tauri events:
- `download-progress`, `download-complete`, `download-error`
- `recording-progress`, `recording-stopped`
- `transcription-progress`, `transcription-complete`
- `twitch-stream-up`, `twitch-stream-down`, `twitch-pubsub-status`
- `youtube-stream-live`, `youtube-polling-status`, `youtube-channel-error`
- `scheduled-download-triggered`, `scheduled-download-complete`, `scheduled-download-failed`
- `scheduled-download-queue-update`, `scheduled-download-disk-full`
- `scheduled-notification-toast`

### Cloud Sync Flow
Extension and Desktop both sync through the same API:
- `POST /api/sync/push` — Push local changes
- `POST /api/sync/pull` — Pull remote changes since timestamp
- Records and folders sync independently with `updatedAt` tracking

## External Tools

- **yt-dlp**: Called via `Command::new("yt-dlp")` for downloads and metadata.
- **FFmpeg/FFprobe**: Called for media processing, format detection, GPU encoder detection.
- **Python sidecar**: `scripts/asr/transcribe.py` uses JSON-line protocol over stdout.

## Testing

- Cloud sync: `cd cloud-sync && npm test` (Vitest)
- Extension: Manual testing via Chrome unpacked extension
- Desktop: Manual testing via `npm run tauri:dev`
- Run `lineguard <files>` before committing
