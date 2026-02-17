use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio, Child};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Emitter, WindowEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use regex::Regex;
use chrono::Utc;
use uuid::Uuid;
use tokio::sync::watch;
use futures_util::{SinkExt, StreamExt};

// Global state for force quit and monitoring pause
static FORCE_QUIT: AtomicBool = AtomicBool::new(false);
static MONITORING_PAUSED: AtomicBool = AtomicBool::new(false);

// ── Twitch PubSub global state ──────────────────────────────────────────────

/// State shared between PubSub tasks and Tauri commands.
struct TwitchPubSubState {
    /// Sender half of a watch channel; send `true` to stop the connection tasks.
    shutdown_tx: Option<watch::Sender<bool>>,
    /// Channel IDs currently subscribed.
    subscribed_channels: Vec<String>,
    /// Whether at least one connection task is considered "connected".
    connected: bool,
}

impl TwitchPubSubState {
    fn new() -> Self {
        Self {
            shutdown_tx: None,
            subscribed_channels: Vec::new(),
            connected: false,
        }
    }
}

// We keep this behind a tokio Mutex so async tasks can `.await` the lock.
static PUBSUB_STATE: std::sync::OnceLock<tokio::sync::Mutex<TwitchPubSubState>> =
    std::sync::OnceLock::new();

fn pubsub_state() -> &'static tokio::sync::Mutex<TwitchPubSubState> {
    PUBSUB_STATE.get_or_init(|| tokio::sync::Mutex::new(TwitchPubSubState::new()))
}

// ── Twitch PubSub message structures ────────────────────────────────────────

/// Sent to Twitch to subscribe to topics.
#[derive(Serialize)]
struct PubSubListen {
    #[serde(rename = "type")]
    msg_type: String,
    data: PubSubListenData,
}

#[derive(Serialize)]
struct PubSubListenData {
    topics: Vec<String>,
}

/// Periodic keep-alive sent to Twitch.
#[derive(Serialize)]
struct PubSubPing {
    #[serde(rename = "type")]
    msg_type: String,
}

/// Top-level message received from Twitch PubSub.
#[derive(Deserialize)]
struct PubSubIncoming {
    #[serde(rename = "type")]
    msg_type: String,
    data: Option<PubSubIncomingData>,
}

#[derive(Deserialize)]
struct PubSubIncomingData {
    topic: Option<String>,
    message: Option<String>,
}

/// Inner JSON inside PubSubIncomingData.message for video-playback-by-id.
#[derive(Deserialize)]
struct PlaybackMessage {
    #[serde(rename = "type")]
    msg_type: String,
}

// ── PubSub connection worker ─────────────────────────────────────────────────

/// Maximum topics Twitch allows per single WebSocket connection.
const PUBSUB_MAX_TOPICS: usize = 50;

/// Run one PubSub connection covering `topics` until shutdown is signalled.
/// On disconnect, it backs off exponentially up to 120 s and retries.
async fn run_pubsub_connection(
    app: AppHandle,
    topics: Vec<String>,
    channel_map: HashMap<String, String>, // channel_id -> channel_name
    mut shutdown_rx: watch::Receiver<bool>,
) {
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    let url = "wss://pubsub-edge.twitch.tv";
    let mut backoff_secs: u64 = 1;
    // Track whether we've already sent a "disconnect" notification this outage.
    // Reset to false after a successful (re)connection.
    let mut notified_disconnect = false;

    loop {
        // Check for shutdown before each connection attempt.
        if *shutdown_rx.borrow() {
            break;
        }

        log::info!("[PubSub] Connecting to {}", url);

        let ws_result = connect_async(url).await;
        match ws_result {
            Err(e) => {
                log::warn!("[PubSub] Connection failed: {}. Retrying in {}s", e, backoff_secs);
                let _ = app.emit(
                    "twitch-pubsub-status",
                    serde_json::json!({
                        "connected": false,
                        "message": format!("Twitch 連線中斷，重試中… ({}s)", backoff_secs),
                    }),
                );
                {
                    let mut st = pubsub_state().lock().await;
                    st.connected = false;
                }
                // Send disconnect notification only on first disconnect.
                if !notified_disconnect {
                    notified_disconnect = true;
                    let app_n = app.clone();
                    tokio::spawn(async move {
                        send_scheduled_notification(
                            &app_n,
                            "連線中斷",
                            "Twitch 監聽連線中斷，重試中…",
                            "warning",
                        ).await;
                    });
                }
                let sleep = tokio::time::sleep(tokio::time::Duration::from_secs(backoff_secs));
                tokio::pin!(sleep);
                tokio::select! {
                    _ = &mut sleep => {}
                    _ = shutdown_rx.changed() => {
                        if *shutdown_rx.borrow() { break; }
                    }
                }
                backoff_secs = (backoff_secs * 2).min(120);
                continue;
            }
            Ok((ws_stream, _)) => {
                backoff_secs = 1; // reset on successful connect
                log::info!("[PubSub] Connected");

                let _ = app.emit(
                    "twitch-pubsub-status",
                    serde_json::json!({
                        "connected": true,
                        "message": format!("連線中 ({} 個頻道)", topics.len()),
                    }),
                );
                {
                    let mut st = pubsub_state().lock().await;
                    st.connected = true;
                }
                // Reset disconnect notification flag on successful (re)connection.
                notified_disconnect = false;

                let (mut writer, mut reader) = ws_stream.split();

                // Subscribe to all topics in this connection batch.
                let listen_msg = PubSubListen {
                    msg_type: "LISTEN".to_string(),
                    data: PubSubListenData { topics: topics.clone() },
                };
                if let Ok(json) = serde_json::to_string(&listen_msg) {
                    let _ = writer.send(Message::Text(json.into())).await;
                }

                // Ping every 4 minutes (240 s).
                let mut ping_interval =
                    tokio::time::interval(tokio::time::Duration::from_secs(240));
                ping_interval.tick().await; // consume the immediate first tick

                // `need_reconnect` starts as false; any disconnect path sets it
                // to true before breaking.  Using an explicit variable avoids
                // the "value assigned … never read" warning that would occur if
                // we called `break` from inside `tokio::select!` directly.
                let need_reconnect: bool = 'session: {
                    loop {
                        if *shutdown_rx.borrow() {
                            let _ = writer.close().await;
                            return; // clean exit
                        }

                        tokio::select! {
                            _ = ping_interval.tick() => {
                                let ping = PubSubPing { msg_type: "PING".to_string() };
                                if let Ok(json) = serde_json::to_string(&ping) {
                                    if writer.send(Message::Text(json.into())).await.is_err() {
                                        log::warn!("[PubSub] Failed to send PING; reconnecting");
                                        break 'session true;
                                    }
                                }
                            }

                            msg = reader.next() => {
                                match msg {
                                    None => {
                                        log::warn!("[PubSub] Stream closed; reconnecting");
                                        break 'session true;
                                    }
                                    Some(Err(e)) => {
                                        log::warn!("[PubSub] Read error: {}; reconnecting", e);
                                        break 'session true;
                                    }
                                    Some(Ok(Message::Text(txt))) => {
                                        let tasks_ref = app.state::<DownloadTasks>().inner().clone();
                                        handle_pubsub_message(
                                            &app,
                                            &txt,
                                            &channel_map,
                                            &tasks_ref,
                                        );
                                    }
                                    Some(Ok(Message::Ping(data))) => {
                                        let _ = writer.send(Message::Pong(data)).await;
                                    }
                                    Some(Ok(Message::Close(_))) => {
                                        log::info!("[PubSub] Server sent Close; reconnecting");
                                        break 'session true;
                                    }
                                    _ => {}
                                }
                            }

                            _ = shutdown_rx.changed() => {
                                if *shutdown_rx.borrow() {
                                    let _ = writer.close().await;
                                    return;
                                }
                            }
                        }
                    }
                };

                if need_reconnect {
                    {
                        let mut st = pubsub_state().lock().await;
                        st.connected = false;
                    }
                    let _ = app.emit(
                        "twitch-pubsub-status",
                        serde_json::json!({
                            "connected": false,
                            "message": format!("Twitch 連線中斷，重試中… ({}s)", backoff_secs),
                        }),
                    );
                    // Send disconnect notification only on first disconnect of this outage.
                    if !notified_disconnect {
                        notified_disconnect = true;
                        let app_n = app.clone();
                        tokio::spawn(async move {
                            send_scheduled_notification(
                                &app_n,
                                "連線中斷",
                                "Twitch 監聽連線中斷，重試中…",
                                "warning",
                            ).await;
                        });
                    }
                    let sleep =
                        tokio::time::sleep(tokio::time::Duration::from_secs(backoff_secs));
                    tokio::pin!(sleep);
                    tokio::select! {
                        _ = &mut sleep => {}
                        _ = shutdown_rx.changed() => {
                            if *shutdown_rx.borrow() { break; }
                        }
                    }
                    backoff_secs = (backoff_secs * 2).min(120);
                }
            }
        }
    }

    // Mark disconnected on clean stop.
    {
        let mut st = pubsub_state().lock().await;
        st.connected = false;
    }
    let _ = app.emit(
        "twitch-pubsub-status",
        serde_json::json!({
            "connected": false,
            "message": "已停止監聽",
        }),
    );
    log::info!("[PubSub] Connection task ended");
}

/// Parse a single text message from Twitch PubSub and emit Tauri events.
fn handle_pubsub_message(
    app: &AppHandle,
    text: &str,
    channel_map: &HashMap<String, String>,
    tasks: &DownloadTasks,
) {
    let msg: PubSubIncoming = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            log::warn!("[PubSub] Failed to parse message: {} | raw: {}", e, text);
            return;
        }
    };

    match msg.msg_type.as_str() {
        "PONG" => {
            log::debug!("[PubSub] PONG received");
        }
        "RECONNECT" => {
            log::info!("[PubSub] Server requested reconnect");
        }
        "RESPONSE" => {
            // RESPONSE to our LISTEN; error field would appear here on failure.
            log::debug!("[PubSub] LISTEN response: {}", text);
        }
        "MESSAGE" => {
            if let Some(data) = msg.data {
                let topic = data.topic.unwrap_or_default();
                let inner_json = data.message.unwrap_or_default();

                // Extract channel_id from "video-playback-by-id.<id>"
                let channel_id = topic
                    .strip_prefix("video-playback-by-id.")
                    .unwrap_or("")
                    .to_string();

                let channel_name = channel_map
                    .get(&channel_id)
                    .cloned()
                    .unwrap_or_else(|| channel_id.clone());

                let playback: PlaybackMessage = match serde_json::from_str(&inner_json) {
                    Ok(p) => p,
                    Err(_) => return,
                };

                let paused = MONITORING_PAUSED.load(Ordering::SeqCst);
                let now = Utc::now().to_rfc3339();

                match playback.msg_type.as_str() {
                    "stream-up" => {
                        log::info!(
                            "[PubSub] stream-up for channel {} ({})",
                            channel_name,
                            channel_id
                        );
                        let _ = app.emit(
                            "twitch-stream-up",
                            serde_json::json!({
                                "channel_id": channel_id,
                                "channel_name": channel_name,
                                "timestamp": now,
                                "paused": paused,
                            }),
                        );
                        // Trigger auto-download for this Twitch channel.
                        let stream_url = format!("https://www.twitch.tv/{}", channel_name.to_lowercase());
                        // Use channel_id + timestamp as stream_id fallback for Twitch.
                        let stream_id = format!("twitch_{}_{}", channel_id, now);
                        let app2 = app.clone();
                        let tasks2 = tasks.clone();
                        let ch_id = channel_id.clone();
                        let ch_name = channel_name.clone();
                        tokio::spawn(async move {
                            trigger_scheduled_download(
                                app2,
                                tasks2,
                                ch_id,
                                ch_name,
                                "twitch".to_string(),
                                stream_id,
                                stream_url,
                            ).await;
                        });
                    }
                    "stream-down" => {
                        log::info!(
                            "[PubSub] stream-down for channel {} ({})",
                            channel_name,
                            channel_id
                        );
                        let _ = app.emit(
                            "twitch-stream-down",
                            serde_json::json!({
                                "channel_id": channel_id,
                                "channel_name": channel_name,
                                "timestamp": now,
                            }),
                        );
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

// ── Tauri commands for PubSub ────────────────────────────────────────────────

#[tauri::command]
async fn start_twitch_pubsub(app: AppHandle) -> Result<(), String> {
    // Load presets and collect enabled Twitch channels.
    let presets = get_scheduled_presets(app.clone())?;
    let twitch_presets: Vec<&DownloadPreset> = presets
        .iter()
        .filter(|p| p.platform == "twitch" && p.enabled)
        .collect();

    if twitch_presets.is_empty() {
        return Err("沒有已啟用的 Twitch 頻道預設".to_string());
    }

    // Build channel_id list and channel_map.
    let channel_ids: Vec<String> = twitch_presets
        .iter()
        .map(|p| p.channel_id.clone())
        .collect();
    let channel_map: HashMap<String, String> = twitch_presets
        .iter()
        .map(|p| (p.channel_id.clone(), p.channel_name.clone()))
        .collect();

    // Stop any existing connection first.
    stop_twitch_pubsub_inner().await;

    // Create shutdown channel.
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    {
        let mut st = pubsub_state().lock().await;
        st.shutdown_tx = Some(shutdown_tx);
        st.subscribed_channels = channel_ids.clone();
        st.connected = false;
    }

    // Build topic batches of up to PUBSUB_MAX_TOPICS each.
    let topics: Vec<String> = channel_ids
        .iter()
        .map(|id| format!("video-playback-by-id.{}", id))
        .collect();

    for chunk in topics.chunks(PUBSUB_MAX_TOPICS) {
        let app_clone = app.clone();
        let chunk_topics = chunk.to_vec();
        let cm_clone = channel_map.clone();
        let rx_clone = shutdown_rx.clone();

        tokio::spawn(async move {
            run_pubsub_connection(app_clone, chunk_topics, cm_clone, rx_clone).await;
        });
    }

    log::info!(
        "[PubSub] Started monitoring {} Twitch channels",
        channel_ids.len()
    );

    Ok(())
}

/// Internal helper: send shutdown signal to any running PubSub tasks.
async fn stop_twitch_pubsub_inner() {
    let mut st = pubsub_state().lock().await;
    if let Some(tx) = st.shutdown_tx.take() {
        let _ = tx.send(true);
    }
    st.connected = false;
    st.subscribed_channels.clear();
}

#[tauri::command]
async fn stop_twitch_pubsub() -> Result<(), String> {
    stop_twitch_pubsub_inner().await;
    log::info!("[PubSub] Stopped");
    Ok(())
}

#[derive(Serialize)]
struct PubSubStatus {
    connected: bool,
    subscribed_channels: Vec<String>,
}

#[tauri::command]
async fn get_twitch_pubsub_status() -> Result<PubSubStatus, String> {
    let st = pubsub_state().lock().await;
    Ok(PubSubStatus {
        connected: st.connected,
        subscribed_channels: st.subscribed_channels.clone(),
    })
}

// ── YouTube RSS polling state ─────────────────────────────────────────────────

struct YouTubePollingState {
    active: bool,
    shutdown_tx: Option<tokio::sync::watch::Sender<bool>>,
    polling_channels: Vec<String>, // channel IDs being monitored
}

impl YouTubePollingState {
    fn new() -> Self {
        Self {
            active: false,
            shutdown_tx: None,
            polling_channels: Vec::new(),
        }
    }
}

static YOUTUBE_POLLING_STATE: std::sync::OnceLock<tokio::sync::Mutex<YouTubePollingState>> =
    std::sync::OnceLock::new();

fn youtube_polling_state() -> &'static tokio::sync::Mutex<YouTubePollingState> {
    YOUTUBE_POLLING_STATE
        .get_or_init(|| tokio::sync::Mutex::new(YouTubePollingState::new()))
}

// ── YouTube RSS XML parsing ───────────────────────────────────────────────────

/// Parse an Atom XML feed from YouTube and return the first `max_entries` video IDs.
fn parse_youtube_rss(xml: &str, max_entries: usize) -> Vec<String> {
    use quick_xml::Reader;
    use quick_xml::events::Event;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut video_ids: Vec<String> = Vec::new();
    let mut inside_video_id = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                // Match <yt:videoId>
                let local = e.local_name();
                if local.as_ref() == b"videoId" {
                    // Verify namespace prefix contains "yt"
                    let name_bytes = e.name();
                    let name_str = std::str::from_utf8(name_bytes.as_ref()).unwrap_or("");
                    if name_str.starts_with("yt:") || name_str == "videoId" {
                        inside_video_id = true;
                    }
                }
            }
            Ok(Event::Text(e)) => {
                if inside_video_id {
                    if let Ok(text) = e.unescape() {
                        let id = text.trim().to_string();
                        if !id.is_empty() && video_ids.len() < max_entries {
                            video_ids.push(id);
                        }
                    }
                    inside_video_id = false;
                }
            }
            Ok(Event::End(_)) => {
                inside_video_id = false;
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                log::warn!("[YouTube RSS] XML parse error: {}", e);
                break;
            }
            _ => {}
        }
        buf.clear();
    }

    video_ids
}

// ── YouTube live check via yt-dlp ─────────────────────────────────────────────

/// Check whether a YouTube video is currently live using yt-dlp --dump-json.
/// Returns `Ok(true)` if live, `Ok(false)` if not live, `Err(...)` on timeout/error.
async fn check_youtube_video_live(video_id: &str) -> Result<bool, String> {
    use tokio::time::{timeout, Duration};
    use tokio::process::Command as TokioCommand;

    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let fut = TokioCommand::new("yt-dlp")
        .args(["--dump-json", "--no-playlist", &url])
        .output();

    match timeout(Duration::from_secs(30), fut).await {
        Err(_) => Err(format!("yt-dlp timed out for video {}", video_id)),
        Ok(Err(e)) => Err(format!("yt-dlp spawn error: {}", e)),
        Ok(Ok(output)) => {
            if output.status.success() {
                let info: serde_json::Value =
                    serde_json::from_slice(&output.stdout).unwrap_or(serde_json::Value::Null);
                let is_live = info
                    .get("is_live")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                Ok(is_live)
            } else {
                Err(format!(
                    "yt-dlp exited with status {:?}",
                    output.status.code()
                ))
            }
        }
    }
}

// ── YouTube RSS polling loop ──────────────────────────────────────────────────

/// Maximum number of YouTube channels checked simultaneously.
const YOUTUBE_CONCURRENCY: usize = 3;

/// How many recent RSS entries to check per channel.
const YOUTUBE_RSS_ENTRIES: usize = 5;

/// Run the YouTube RSS polling loop for a list of channel presets until shutdown.
async fn run_youtube_polling(
    app: AppHandle,
    mut presets: Vec<(String, String)>, // (channel_id, channel_name)
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) {
    use tokio::sync::Semaphore;
    use std::sync::Arc;
    use tokio::time::{sleep, Instant};

    // Rate-limit state: optional until-timestamp after which to restore.
    let mut rate_limit_until: Option<Instant> = None;
    // Track whether we've already sent a rate-limit/outage notification.
    let mut notified_polling_error = false;

    // Emit initial status.
    let _ = app.emit(
        "youtube-polling-status",
        serde_json::json!({
            "active": true,
            "message": "輪詢中",
            "channels_count": presets.len(),
        }),
    );

    loop {
        // Check shutdown.
        if *shutdown_rx.borrow() {
            break;
        }

        // --- Load fresh config each cycle for dynamic interval updates ---
        let interval_secs = {
            let cfg = load_config(app.clone()).unwrap_or_default();
            cfg.youtube_polling_interval
        };

        // Determine effective interval (doubled if rate-limited).
        let effective_interval_secs = if rate_limit_until
            .map(|until| Instant::now() < until)
            .unwrap_or(false)
        {
            interval_secs * 2
        } else {
            rate_limit_until = None; // restore
            interval_secs
        };

        // Refresh preset list (handles dynamic enable/disable).
        if let Ok(fresh_presets) = get_scheduled_presets(app.clone()) {
            presets = fresh_presets
                .into_iter()
                .filter(|p| p.platform == "youtube" && p.enabled)
                .map(|p| (p.channel_id, p.channel_name))
                .collect();
        }

        if presets.is_empty() {
            log::info!("[YouTube] No enabled YouTube presets; polling idle");
            let _ = app.emit(
                "youtube-polling-status",
                serde_json::json!({
                    "active": true,
                    "message": "無啟用頻道",
                    "channels_count": 0u32,
                }),
            );
            // Wait for full interval then try again.
            let sleep_fut = sleep(tokio::time::Duration::from_secs(effective_interval_secs as u64));
            tokio::pin!(sleep_fut);
            tokio::select! {
                _ = &mut sleep_fut => {}
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() { break; }
                }
            }
            continue;
        }

        // Update polling state with current channel list.
        {
            let mut st = youtube_polling_state().lock().await;
            st.polling_channels = presets.iter().map(|(id, _)| id.clone()).collect();
        }

        log::info!(
            "[YouTube] Polling {} channels (interval {}s)",
            presets.len(),
            effective_interval_secs
        );

        let semaphore = Arc::new(Semaphore::new(YOUTUBE_CONCURRENCY));
        let mut handles = Vec::new();
        let mut got_rate_limit = false;

        for (channel_id, channel_name) in presets.clone() {
            // Check shutdown before spawning each task.
            if *shutdown_rx.borrow() {
                break;
            }

            let sem_clone = semaphore.clone();
            let ch_id = channel_id.clone();
            let ch_name = channel_name.clone();

            let handle = tokio::spawn(async move {
                let _permit = sem_clone.acquire().await.ok()?;

                // Fetch RSS feed.
                let rss_url = format!(
                    "https://www.youtube.com/feeds/videos.xml?channel_id={}",
                    ch_id
                );

                let resp = reqwest::get(&rss_url).await.ok()?;
                let status = resp.status();

                // Handle 429 Rate Limit.
                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    log::warn!("[YouTube] Rate limited for channel {}", ch_id);
                    return Some(("rate_limit", ch_id, ch_name, String::new()));
                }

                // Handle 404 Invalid Channel.
                if status == reqwest::StatusCode::NOT_FOUND {
                    log::warn!("[YouTube] Channel not found: {}", ch_id);
                    return Some(("not_found", ch_id, ch_name, String::new()));
                }

                if !status.is_success() {
                    log::warn!("[YouTube] RSS fetch failed for {} with status {}", ch_id, status);
                    return None;
                }

                let body = resp.text().await.ok()?;

                // Parse XML to extract video IDs.
                let video_ids = parse_youtube_rss(&body, YOUTUBE_RSS_ENTRIES);

                if video_ids.is_empty() {
                    log::info!("[YouTube] No entries in RSS for channel {}", ch_id);
                    // Empty RSS could mean invalid channel; treat as not_found.
                    return Some(("not_found", ch_id, ch_name, String::new()));
                }

                // Check the most recent entries for live status.
                for video_id in video_ids {
                    match check_youtube_video_live(&video_id).await {
                        Err(e) => {
                            log::warn!("[YouTube] yt-dlp check skipped ({}): {}", video_id, e);
                            // E7.3d: timeout/error → skip, retry next cycle.
                            continue;
                        }
                        Ok(true) => {
                            log::info!(
                                "[YouTube] Live stream detected: {} on {}",
                                video_id,
                                ch_id
                            );
                            return Some(("live", ch_id, ch_name, video_id));
                        }
                        Ok(false) => {
                            // Not live; continue checking next video.
                        }
                    }
                }

                None // No live stream found this cycle.
            });

            handles.push(handle);
        }

        // Collect results.
        let mut presets_to_disable: Vec<(String, String)> = Vec::new();

        for handle in handles {
            if let Ok(Some((event_type, ch_id, ch_name, payload))) = handle.await {
                match event_type {
                    "live" => {
                        let now = Utc::now().to_rfc3339();
                        let _ = app.emit(
                            "youtube-stream-live",
                            serde_json::json!({
                                "channel_id": ch_id,
                                "channel_name": ch_name,
                                "video_id": payload,
                                "timestamp": now,
                                "paused": MONITORING_PAUSED.load(Ordering::SeqCst),
                            }),
                        );
                        // Trigger auto-download for this YouTube channel.
                        let stream_url = format!("https://www.youtube.com/watch?v={}", payload);
                        let app2 = app.clone();
                        let tasks2 = app.state::<DownloadTasks>().inner().clone();
                        let ch_id2 = ch_id.clone();
                        let ch_name2 = ch_name.clone();
                        let video_id = payload.clone();
                        tokio::spawn(async move {
                            trigger_scheduled_download(
                                app2,
                                tasks2,
                                ch_id2,
                                ch_name2,
                                "youtube".to_string(),
                                video_id,
                                stream_url,
                            ).await;
                        });
                    }
                    "rate_limit" => {
                        got_rate_limit = true;
                    }
                    "not_found" => {
                        presets_to_disable.push((ch_id, ch_name));
                    }
                    _ => {}
                }
            }
        }

        // Apply rate-limit doubling for 5 minutes.
        if got_rate_limit && rate_limit_until.is_none() {
            rate_limit_until =
                Some(Instant::now() + tokio::time::Duration::from_secs(300));
            log::warn!("[YouTube] Rate limit hit; doubling interval for 5 minutes");
            // Notify user about YouTube polling disruption (only on first occurrence).
            if !notified_polling_error {
                notified_polling_error = true;
                let app_n = app.clone();
                tokio::spawn(async move {
                    send_scheduled_notification(
                        &app_n,
                        "連線中斷",
                        "YouTube 輪詢連線中斷",
                        "warning",
                    ).await;
                });
            }
        } else if !got_rate_limit && rate_limit_until.is_none() && notified_polling_error {
            // Rate limit has cleared; reset notification flag.
            notified_polling_error = false;
        }

        // Disable invalid channels.
        for (ch_id, _ch_name) in &presets_to_disable {
            // Find preset id by channel_id.
            if let Ok(all_presets) = get_scheduled_presets(app.clone()) {
                if let Some(preset) = all_presets.iter().find(|p| &p.channel_id == ch_id) {
                    let _ = toggle_preset_enabled(app.clone(), preset.id.clone(), false);
                }
            }
            let _ = app.emit(
                "youtube-channel-error",
                serde_json::json!({
                    "channel_id": ch_id,
                    "error": "頻道不存在",
                }),
            );
        }

        // Wait for the configured interval before next poll.
        let sleep_fut = sleep(tokio::time::Duration::from_secs(effective_interval_secs as u64));
        tokio::pin!(sleep_fut);
        tokio::select! {
            _ = &mut sleep_fut => {}
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() { break; }
            }
        }
    }

    // Emit stopped status.
    {
        let mut st = youtube_polling_state().lock().await;
        st.active = false;
        st.polling_channels.clear();
    }
    let _ = app.emit(
        "youtube-polling-status",
        serde_json::json!({
            "active": false,
            "message": "已停止",
            "channels_count": 0u32,
        }),
    );
    log::info!("[YouTube] Polling loop ended");
}

// ── Tauri commands for YouTube polling ───────────────────────────────────────

#[tauri::command]
async fn start_youtube_polling(app: AppHandle) -> Result<(), String> {
    // Load enabled YouTube presets.
    let presets = get_scheduled_presets(app.clone())?;
    let youtube_presets: Vec<(String, String)> = presets
        .into_iter()
        .filter(|p| p.platform == "youtube" && p.enabled)
        .map(|p| (p.channel_id, p.channel_name))
        .collect();

    if youtube_presets.is_empty() {
        return Err("沒有已啟用的 YouTube 頻道預設".to_string());
    }

    // Stop any existing polling first.
    stop_youtube_polling_inner().await;

    // Create shutdown channel.
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    {
        let mut st = youtube_polling_state().lock().await;
        st.active = true;
        st.shutdown_tx = Some(shutdown_tx);
        st.polling_channels = youtube_presets.iter().map(|(id, _)| id.clone()).collect();
    }

    let app_clone = app.clone();
    tokio::spawn(async move {
        run_youtube_polling(app_clone, youtube_presets, shutdown_rx).await;
    });

    log::info!("[YouTube] Started RSS polling");
    Ok(())
}

/// Internal helper: send shutdown signal to any running YouTube polling task.
async fn stop_youtube_polling_inner() {
    let mut st = youtube_polling_state().lock().await;
    if let Some(tx) = st.shutdown_tx.take() {
        let _ = tx.send(true);
    }
    st.active = false;
    st.polling_channels.clear();
}

#[tauri::command]
async fn stop_youtube_polling() -> Result<(), String> {
    stop_youtube_polling_inner().await;
    log::info!("[YouTube] Polling stopped");
    Ok(())
}

#[derive(Serialize)]
struct YouTubePollingStatus {
    active: bool,
    polling_channels: Vec<String>,
    interval_seconds: u32,
}

#[tauri::command]
async fn get_youtube_polling_status(app: AppHandle) -> Result<YouTubePollingStatus, String> {
    let st = youtube_polling_state().lock().await;
    let cfg = load_config(app).unwrap_or_default();
    Ok(YouTubePollingStatus {
        active: st.active,
        polling_channels: st.polling_channels.clone(),
        interval_seconds: cfg.youtube_polling_interval,
    })
}

// ── Scheduled Download Trigger & Queue ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduledDownloadTask {
    pub id: String,
    pub preset_id: String,
    pub channel_name: String,
    pub platform: String,
    pub stream_id: String,
    pub stream_url: String,
    /// "queued" | "downloading" | "completed" | "failed" | "cancelled"
    pub status: String,
    pub triggered_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub error_message: Option<String>,
    /// Links to the actual DownloadTask managed in DownloadTasks state.
    pub download_task_id: Option<String>,
}

struct ScheduledDownloadState {
    /// stream_id -> trigger time (prevents duplicate triggers for same stream)
    triggered_streams: HashMap<String, std::time::Instant>,
    /// channel_id -> last trigger time (for cooldown)
    last_trigger_per_channel: HashMap<String, std::time::Instant>,
    /// All known scheduled download tasks (queue + history for this session)
    queue: Vec<ScheduledDownloadTask>,
}

impl ScheduledDownloadState {
    fn new() -> Self {
        Self {
            triggered_streams: HashMap::new(),
            last_trigger_per_channel: HashMap::new(),
            queue: Vec::new(),
        }
    }
}

static SCHEDULED_DOWNLOAD_STATE: std::sync::OnceLock<tokio::sync::Mutex<ScheduledDownloadState>> =
    std::sync::OnceLock::new();

fn scheduled_download_state() -> &'static tokio::sync::Mutex<ScheduledDownloadState> {
    SCHEDULED_DOWNLOAD_STATE.get_or_init(|| {
        tokio::sync::Mutex::new(ScheduledDownloadState::new())
    })
}

/// Map a quality string (from preset) to a yt-dlp format selector.
fn quality_to_format(quality: &str, content_type: &str) -> String {
    if content_type == "audio_only" {
        return "bestaudio".to_string();
    }
    match quality {
        "best" => "bestvideo+bestaudio/best".to_string(),
        "1080p" => "bestvideo[height<=1080]+bestaudio/best[height<=1080]".to_string(),
        "720p"  => "bestvideo[height<=720]+bestaudio/best[height<=720]".to_string(),
        "480p"  => "bestvideo[height<=480]+bestaudio/best[height<=480]".to_string(),
        "360p"  => "bestvideo[height<=360]+bestaudio/best[height<=360]".to_string(),
        _       => "bestvideo+bestaudio/best".to_string(),
    }
}

/// Expand a filename template using stream metadata.
fn expand_filename_template(template: &str, channel_name: &str, platform: &str) -> String {
    let now = Utc::now();
    let date_str = now.format("%Y%m%d").to_string();
    let datetime_str = now.format("%Y%m%d_%H%M%S").to_string();
    let stream_type = match platform {
        "youtube" => "YouTube直播",
        "twitch"  => "Twitch直播",
        _         => "直播",
    };
    template
        .replace("{channel_name}", channel_name)
        .replace("{date}", &date_str)
        .replace("{datetime}", &datetime_str)
        .replace("{type}", stream_type)
        .replace("{title}", &format!("{}_direct_stream", channel_name))
}

/// Check available disk space on the given path.
/// Returns `Ok(available_bytes)` or `Err`.
#[cfg(unix)]
fn check_disk_space(path: &str) -> Result<u64, String> {
    use std::ffi::CString;
    use std::mem;
    let cpath = CString::new(path)
        .map_err(|e| format!("Invalid path for disk check: {}", e))?;
    let mut stat: libc::statvfs = unsafe { mem::zeroed() };
    let ret = unsafe { libc::statvfs(cpath.as_ptr(), &mut stat) };
    if ret == 0 {
        // available bytes = f_bavail * f_bsize
        Ok(stat.f_bavail as u64 * stat.f_bsize as u64)
    } else {
        Err(format!("statvfs failed (code {})", ret))
    }
}

#[cfg(not(unix))]
fn check_disk_space(_path: &str) -> Result<u64, String> {
    // On non-unix platforms (Windows), skip disk space check.
    Ok(u64::MAX)
}

/// Minimum free disk space required before starting a scheduled download (500 MB).
const MIN_FREE_BYTES: u64 = 500 * 1024 * 1024;

/// Send a scheduled-download notification based on the user's preference:
/// - "os"   → OS-level system notification only
/// - "toast" → in-app toast via Tauri event only
/// - "both"  → both OS and in-app toast
/// - "none"  → no notifications
/// level: "info" | "warning" | "critical"
async fn send_scheduled_notification(app: &AppHandle, title: &str, body: &str, level: &str) {
    let mode = match load_config(app.clone()) {
        Ok(cfg) => cfg.scheduled_download_notification,
        Err(_) => "both".to_string(),
    };

    if mode == "none" {
        return;
    }

    // Send OS notification
    if mode == "os" || mode == "both" {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .unwrap_or_else(|e| {
                log::warn!("[Notification] OS notification failed: {}", e);
            });
    }

    // Send in-app toast event
    if mode == "toast" || mode == "both" {
        let _ = app.emit(
            "scheduled-notification-toast",
            serde_json::json!({
                "title": title,
                "body": body,
                "level": level,
            }),
        );
    }
}

/// Core trigger function: called when a stream-up event is received.
/// Finds a matching preset, checks duplicates/cooldown, and enqueues a download.
async fn trigger_scheduled_download(
    app: AppHandle,
    tasks: DownloadTasks,
    channel_id: String,
    channel_name: String,
    platform: String,
    stream_id: String,
    stream_url: String,
) {
    // 1. Check MONITORING_PAUSED
    if MONITORING_PAUSED.load(Ordering::SeqCst) {
        log::info!("[Trigger] Monitoring paused; skipping trigger for {}", channel_name);
        return;
    }

    // 2. Load config for cooldown and max_concurrent settings.
    let config = match load_config(app.clone()) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[Trigger] Failed to load config: {}", e);
            return;
        }
    };

    // 3. Find matching enabled preset.
    let presets = match get_scheduled_presets(app.clone()) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[Trigger] Failed to load presets: {}", e);
            return;
        }
    };
    let preset = match presets.into_iter().find(|p| {
        p.platform == platform && p.channel_id == channel_id && p.enabled
    }) {
        Some(p) => p,
        None => {
            log::debug!("[Trigger] No enabled preset for channel {} ({})", channel_name, platform);
            return;
        }
    };

    // 4–5. Check anti-duplicate and cooldown.
    {
        let mut state = scheduled_download_state().lock().await;

        // Prune stale entries (older than 24h) to prevent memory growth.
        let one_day = std::time::Duration::from_secs(86400);
        state.triggered_streams.retain(|_, t| t.elapsed() < one_day);
        state.last_trigger_per_channel.retain(|_, t| t.elapsed() < one_day);

        // Anti-duplicate: same stream_id already triggered?
        if state.triggered_streams.contains_key(&stream_id) {
            log::info!("[Trigger] Duplicate stream_id {}; skipping", stream_id);
            return;
        }

        // Cooldown: last trigger for this channel too recent?
        let cooldown = std::time::Duration::from_secs(config.trigger_cooldown as u64);
        if let Some(last) = state.last_trigger_per_channel.get(&channel_id) {
            if last.elapsed() < cooldown {
                log::info!(
                    "[Trigger] Channel {} within cooldown ({:?} remaining); skipping",
                    channel_name,
                    cooldown - last.elapsed()
                );
                return;
            }
        }

        // Mark this stream as triggered.
        state.triggered_streams.insert(stream_id.clone(), std::time::Instant::now());
        state.last_trigger_per_channel.insert(channel_id.clone(), std::time::Instant::now());
    }

    // 6. Check disk space.
    let output_dir = preset.output_dir.clone();
    let expanded_dir = if output_dir.starts_with('~') {
        if let Some(home) = std::env::var("HOME").ok()
            .or_else(|| std::env::var("USERPROFILE").ok())
        {
            output_dir.replacen('~', &home, 1)
        } else {
            output_dir.clone()
        }
    } else {
        output_dir.clone()
    };
    match check_disk_space(&expanded_dir) {
        Ok(free) if free < MIN_FREE_BYTES => {
            log::warn!("[Trigger] Insufficient disk space ({} bytes free) for {}", free, expanded_dir);
            let _ = app.emit(
                "scheduled-download-disk-full",
                serde_json::json!({
                    "channel_name": channel_name,
                    "free_bytes": free,
                    "required_bytes": MIN_FREE_BYTES,
                }),
            );
            // Notify user: disk space critically low.
            {
                let app_n = app.clone();
                tokio::spawn(async move {
                    send_scheduled_notification(
                        &app_n,
                        "磁碟空間不足",
                        "磁碟空間不足，已暫停所有排程下載",
                        "critical",
                    ).await;
                });
            }
            return;
        }
        Err(e) => {
            log::warn!("[Trigger] Disk space check failed: {}; proceeding anyway", e);
        }
        _ => {}
    }

    // 7. Build task ID and ScheduledDownloadTask.
    let task_id = Uuid::new_v4().to_string();
    let now_str = Utc::now().to_rfc3339();
    let sched_task = ScheduledDownloadTask {
        id: task_id.clone(),
        preset_id: preset.id.clone(),
        channel_name: channel_name.clone(),
        platform: platform.clone(),
        stream_id: stream_id.clone(),
        stream_url: stream_url.clone(),
        status: "queued".to_string(),
        triggered_at: now_str.clone(),
        started_at: None,
        completed_at: None,
        file_path: None,
        file_size: None,
        error_message: None,
        download_task_id: None,
    };

    // 8. Add to queue.
    {
        let mut state = scheduled_download_state().lock().await;
        state.queue.push(sched_task.clone());
    }

    log::info!(
        "[Trigger] Queued scheduled download for {} ({}) task_id={}",
        channel_name,
        platform,
        task_id
    );

    // Emit triggered event.
    let _ = app.emit(
        "scheduled-download-triggered",
        serde_json::json!({
            "task_id": task_id,
            "channel_name": channel_name,
            "platform": platform,
        }),
    );

    // Notify user: live detected and download started.
    {
        let app_n = app.clone();
        let ch_name_n = channel_name.clone();
        tokio::spawn(async move {
            send_scheduled_notification(
                &app_n,
                "直播偵測",
                &format!("{} 正在直播，已啟動自動下載", ch_name_n),
                "info",
            ).await;
        });
    }

    // 9. Update preset's last_triggered_at and trigger_count.
    {
        let preset_id = preset.id.clone();
        let app2 = app.clone();
        let now2 = now_str.clone();
        // Run preset update in a separate task to avoid holding locks.
        tokio::spawn(async move {
            if let Ok(mut presets) = get_scheduled_presets(app2.clone()) {
                if let Some(p) = presets.iter_mut().find(|p| p.id == preset_id) {
                    p.last_triggered_at = Some(now2);
                    p.trigger_count += 1;
                    let _ = save_scheduled_preset(app2, p.clone());
                }
            }
        });
    }

    // 10. Check queue capacity and try to start the download.
    process_scheduled_queue(app, tasks);
}

/// Process the scheduled download queue: start queued tasks if under the
/// `max_concurrent_downloads` limit.
/// Spawn a background task that checks the queue and starts the next download
/// if capacity allows. This is a plain function (not async) to avoid type cycles.
fn process_scheduled_queue(app: AppHandle, tasks: DownloadTasks) {
    tokio::spawn(process_scheduled_queue_inner(app, tasks));
}

async fn process_scheduled_queue_inner(app: AppHandle, tasks: DownloadTasks) {
    let config = match load_config(app.clone()) {
        Ok(c) => c,
        Err(_) => return,
    };
    let max_concurrent = config.max_concurrent_downloads;

    // Count currently active (recording/downloading) tasks.
    let active_count = {
        let tasks_guard = tasks.lock().unwrap();
        tasks_guard.values().filter(|t| {
            let s = &t.progress.status;
            s == "downloading" || s == "recording" || s == "processing"
        }).count()
    };

    if active_count >= max_concurrent {
        log::debug!(
            "[Queue] At capacity ({}/{}); not starting new scheduled download",
            active_count,
            max_concurrent
        );
        // Still emit queue update so the UI knows the position.
        emit_queue_update(&app).await;
        return;
    }

    // Find the next queued task.
    let next_task = {
        let state = scheduled_download_state().lock().await;
        state.queue.iter()
            .find(|t| t.status == "queued")
            .cloned()
    };

    if let Some(task) = next_task {
        start_scheduled_task(app, tasks, task).await;
    } else {
        emit_queue_update(&app).await;
    }
}

/// Emit the current queue state to the frontend.
async fn emit_queue_update(app: &AppHandle) {
    let queue = {
        let state = scheduled_download_state().lock().await;
        state.queue.clone()
    };
    let _ = app.emit("scheduled-download-queue-update", serde_json::json!({ "queue": queue }));
}

/// Start an actual recording for a scheduled download task.
async fn start_scheduled_task(
    app: AppHandle,
    tasks: DownloadTasks,
    sched_task: ScheduledDownloadTask,
) {
    let task_id = sched_task.id.clone();
    let stream_url = sched_task.stream_url.clone();
    let channel_name = sched_task.channel_name.clone();
    let platform = sched_task.platform.clone();

    // Load the preset to get quality/output settings.
    let preset = {
        match get_scheduled_presets(app.clone()) {
            Ok(presets) => presets.into_iter().find(|p| p.id == sched_task.preset_id),
            Err(_) => None,
        }
    };

    let preset = match preset {
        Some(p) => p,
        None => {
            // Preset was deleted; fail this task.
            mark_scheduled_task_failed(&app, &task_id, "找不到對應的預設").await;
            // Process next queued item.
            process_scheduled_queue(app.clone(), tasks.clone());
            return;
        }
    };

    // Mark as "downloading" (starting).
    let now_str = Utc::now().to_rfc3339();
    {
        let mut state = scheduled_download_state().lock().await;
        if let Some(t) = state.queue.iter_mut().find(|t| t.id == task_id) {
            t.status = "downloading".to_string();
            t.started_at = Some(now_str.clone());
        }
    }
    emit_queue_update(&app).await;

    // Build VideoInfo (minimal — is_live = true)
    let expanded_dir = {
        let d = &preset.output_dir;
        if d.starts_with('~') {
            if let Some(home) = std::env::var("HOME").ok()
                .or_else(|| std::env::var("USERPROFILE").ok())
            {
                d.replacen('~', &home, 1)
            } else {
                d.clone()
            }
        } else {
            d.clone()
        }
    };

    let video_info = VideoInfo {
        id: sched_task.stream_id.clone(),
        title: format!("{} 直播", channel_name),
        channel: channel_name.clone(),
        thumbnail: String::new(),
        duration: None,
        platform: platform.clone(),
        content_type: "stream".to_string(),
        is_live: true,
        qualities: vec![],
    };

    let format_id = quality_to_format(&preset.quality, &preset.content_type);
    let filename = expand_filename_template(
        &preset.filename_template,
        &channel_name,
        &platform,
    );
    let ext = match preset.container_format.as_str() {
        "mp4" => "mp4",
        "mkv" => "mkv",
        _     => "ts",
    };
    let output_filename = format!("{}.{}", filename, ext);

    let download_config = DownloadConfig {
        url: stream_url.clone(),
        video_info,
        format_id,
        content_type: preset.content_type.clone(),
        video_codec: None,
        audio_codec: None,
        output_filename,
        output_folder: expanded_dir,
        container_format: preset.container_format.clone(),
        time_range: None,
    };

    // Use the existing recording infrastructure by inserting a task directly
    // and spawning execute_recording.
    let dl_task_id = Uuid::new_v4().to_string();
    let progress = DownloadProgress {
        task_id: dl_task_id.clone(),
        status: "recording".to_string(),
        title: download_config.video_info.title.clone(),
        percentage: 0.0,
        speed: "0 B/s".to_string(),
        eta: "直播錄製中...".to_string(),
        downloaded_bytes: 0,
        total_bytes: 0,
        output_path: None,
        error_message: None,
        is_recording: Some(true),
        recorded_duration: Some("00:00:00".to_string()),
        bitrate: Some("N/A".to_string()),
    };

    let dl_task = DownloadTask {
        config: download_config.clone(),
        progress: progress.clone(),
        process: None,
        paused: false,
    };

    {
        let mut tasks_guard = tasks.lock().unwrap();
        tasks_guard.insert(dl_task_id.clone(), dl_task);
    }
    app.emit("download-progress", &progress).ok();

    // Link the scheduled task to the DownloadTask.
    {
        let mut state = scheduled_download_state().lock().await;
        if let Some(t) = state.queue.iter_mut().find(|t| t.id == task_id) {
            t.download_task_id = Some(dl_task_id.clone());
        }
    }
    emit_queue_update(&app).await;

    // Spawn recording and monitor for completion.
    let app2 = app.clone();
    let tasks2 = tasks.clone();
    let dl_task_id2 = dl_task_id.clone();
    let sched_task_id = task_id.clone();
    let app3 = app.clone();

    tokio::spawn(async move {
        // Run the recording.
        execute_recording(app2.clone(), tasks2.clone(), dl_task_id2.clone()).await;

        // After recording finishes, update scheduled task status.
        let final_status = {
            let tasks_guard = tasks2.lock().unwrap();
            tasks_guard.get(&dl_task_id2)
                .map(|t| (t.progress.status.clone(), t.progress.output_path.clone(), t.progress.error_message.clone()))
        };

        let completed_at = Utc::now().to_rfc3339();

        if let Some((dl_status, output_path, error_msg)) = final_status {
            let (new_status, error) = match dl_status.as_str() {
                "completed" | "stream_interrupted" => ("completed", None),
                "failed" | "cancelled" => ("failed", error_msg),
                _ => ("completed", None),
            };

            // Get file size.
            let file_size = output_path.as_ref().and_then(|p| {
                std::fs::metadata(p).ok().map(|m| m.len())
            });

            {
                let mut state = scheduled_download_state().lock().await;
                if let Some(t) = state.queue.iter_mut().find(|t| t.id == sched_task_id) {
                    t.status = new_status.to_string();
                    t.completed_at = Some(completed_at.clone());
                    t.file_path = output_path.clone();
                    t.file_size = file_size;
                    t.error_message = error.clone();
                }
            }

            let channel_name2 = {
                let state = scheduled_download_state().lock().await;
                state.queue.iter()
                    .find(|t| t.id == sched_task_id)
                    .map(|t| t.channel_name.clone())
                    .unwrap_or_default()
            };

            if new_status == "completed" {
                let _ = app2.emit(
                    "scheduled-download-complete",
                    serde_json::json!({
                        "task_id": sched_task_id,
                        "channel_name": channel_name2,
                        "file_size": file_size,
                    }),
                );
                // Notify user: download completed.
                let size_str = file_size.map(|s| format!("{:.1} MB", s as f64 / (1024.0 * 1024.0)))
                    .unwrap_or_else(|| "?".to_string());
                send_scheduled_notification(
                    &app2,
                    "排程下載完成",
                    &format!("{} 的直播錄製已完成（{}）", channel_name2, size_str),
                    "info",
                ).await;
            } else {
                let err_msg = error.unwrap_or_else(|| "錄製失敗".to_string());
                let _ = app2.emit(
                    "scheduled-download-failed",
                    serde_json::json!({
                        "task_id": sched_task_id,
                        "channel_name": channel_name2,
                        "error": err_msg.clone(),
                    }),
                );
                // Notify user: download failed.
                // Truncate error to a short summary.
                let err_summary: String = err_msg.chars().take(60).collect();
                send_scheduled_notification(
                    &app2,
                    "排程下載失敗",
                    &format!("{} 的下載失敗：{}", channel_name2, err_summary),
                    "warning",
                ).await;
            }

            emit_queue_update(&app2).await;
        }

        emit_queue_update(&app3).await;
    });
}

/// Mark a scheduled task as failed and emit events.
/// Does NOT process the queue — caller must do that.
async fn mark_scheduled_task_failed(app: &AppHandle, task_id: &str, error: &str) {
    let channel_name = {
        let mut state = scheduled_download_state().lock().await;
        let ch = state.queue.iter()
            .find(|t| t.id == task_id)
            .map(|t| t.channel_name.clone())
            .unwrap_or_default();
        if let Some(t) = state.queue.iter_mut().find(|t| t.id == task_id) {
            t.status = "failed".to_string();
            t.error_message = Some(error.to_string());
            t.completed_at = Some(Utc::now().to_rfc3339());
        }
        ch
    };
    let _ = app.emit(
        "scheduled-download-failed",
        serde_json::json!({
            "task_id": task_id,
            "channel_name": channel_name,
            "error": error,
        }),
    );
    // Notify user: task failed.
    let err_summary: String = error.chars().take(60).collect();
    send_scheduled_notification(
        app,
        "排程下載失敗",
        &format!("{} 的下載失敗：{}", channel_name, err_summary),
        "warning",
    ).await;
    emit_queue_update(app).await;
}

// ── Tauri commands for scheduled download queue ───────────────────────────────

#[tauri::command]
async fn get_scheduled_download_queue() -> Result<Vec<ScheduledDownloadTask>, String> {
    let state = scheduled_download_state().lock().await;
    Ok(state.queue.clone())
}

#[tauri::command]
async fn cancel_scheduled_download(
    app: AppHandle,
    task_id: String,
    tasks: tauri::State<'_, DownloadTasks>,
) -> Result<(), String> {
    let dl_task_id = {
        let mut state = scheduled_download_state().lock().await;
        let task = state.queue.iter_mut().find(|t| t.id == task_id)
            .ok_or_else(|| "找不到此排程任務".to_string())?;

        if task.status == "completed" || task.status == "cancelled" {
            return Err("此任務已結束，無法取消".to_string());
        }

        let dl_id = task.download_task_id.clone();
        task.status = "cancelled".to_string();
        task.completed_at = Some(Utc::now().to_rfc3339());
        dl_id
    };

    // If there's an underlying DownloadTask, cancel it too (inline logic).
    if let Some(dl_id) = dl_task_id {
        let tasks_arc = tasks.inner().clone();
        let config_opt = {
            let mut tasks_guard = tasks_arc.lock().unwrap();
            if let Some(task) = tasks_guard.get_mut(&dl_id) {
                if let Some(ref mut child) = task.process {
                    child.kill().ok();
                }
                task.progress.status = "cancelled".to_string();
                app.emit("download-progress", &task.progress).ok();
                Some(task.config.clone())
            } else {
                None
            }
        };
        if let Some(cfg) = config_opt {
            save_download_history(&app, &cfg, "", "cancelled", None).await;
        }
    }

    emit_queue_update(&app).await;
    Ok(())
}

#[tauri::command]
async fn retry_scheduled_download(
    app: AppHandle,
    task_id: String,
    tasks: tauri::State<'_, DownloadTasks>,
) -> Result<(), String> {
    let (new_task, tasks_clone) = {
        let mut state = scheduled_download_state().lock().await;
        let old = state.queue.iter_mut().find(|t| t.id == task_id)
            .ok_or_else(|| "找不到此排程任務".to_string())?;

        if old.status != "failed" && old.status != "cancelled" {
            return Err("只能重試失敗或已取消的任務".to_string());
        }

        let new_id = Uuid::new_v4().to_string();
        let new_task = ScheduledDownloadTask {
            id: new_id,
            preset_id: old.preset_id.clone(),
            channel_name: old.channel_name.clone(),
            platform: old.platform.clone(),
            stream_id: old.stream_id.clone(),
            stream_url: old.stream_url.clone(),
            status: "queued".to_string(),
            triggered_at: Utc::now().to_rfc3339(),
            started_at: None,
            completed_at: None,
            file_path: None,
            file_size: None,
            error_message: None,
            download_task_id: None,
        };
        state.queue.push(new_task.clone());
        (new_task, tasks.inner().clone())
    };

    let _ = app.emit(
        "scheduled-download-triggered",
        serde_json::json!({
            "task_id": new_task.id,
            "channel_name": new_task.channel_name,
            "platform": new_task.platform,
        }),
    );
    emit_queue_update(&app).await;

    process_scheduled_queue(app, tasks_clone);

    Ok(())
}

// Download configuration structures
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadConfig {
    pub url: String,
    pub video_info: VideoInfo,
    pub format_id: String,
    pub content_type: String, // "video+audio", "video_only", "audio_only"
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub output_filename: String,
    pub output_folder: String,
    pub container_format: String, // "auto", "mp4", "mkv"
    pub time_range: Option<TimeRange>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimeRange {
    pub start: Option<String>, // HH:MM:SS or MM:SS or seconds
    pub end: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub task_id: String,
    pub status: String, // "queued", "downloading", "recording", "processing", "completed", "failed", "cancelled", "paused", "stream_interrupted"
    pub title: String,
    pub percentage: f64,
    pub speed: String,
    pub eta: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub output_path: Option<String>,
    pub error_message: Option<String>,
    // Live recording specific fields
    pub is_recording: Option<bool>,
    pub recorded_duration: Option<String>,
    pub bitrate: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadHistoryEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: String,
    pub platform: String,
    pub content_type: String,
    pub status: String,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub resolution: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
}

struct DownloadTask {
    config: DownloadConfig,
    progress: DownloadProgress,
    process: Option<Child>,
    paused: bool,
}

type DownloadTasks = Arc<Mutex<HashMap<String, DownloadTask>>>;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    // General settings
    #[serde(default = "default_download_folder")]
    default_download_folder: String,
    #[serde(default = "default_subtitle_folder")]
    default_subtitle_folder: String,
    #[serde(default)]
    launch_on_startup: bool,
    #[serde(default = "default_true")]
    desktop_notifications: bool,
    #[serde(default = "default_language")]
    language: String,
    #[serde(default = "default_timezone")]
    timezone: String,

    // Download settings
    #[serde(default)]
    enable_transcoder: bool,
    #[serde(default = "default_video_quality")]
    default_video_quality: String,
    #[serde(default = "default_output_container")]
    output_container: String,
    #[serde(default = "default_max_concurrent_downloads")]
    max_concurrent_downloads: usize,
    #[serde(default = "default_true")]
    auto_retry: bool,
    #[serde(default = "default_max_retry_count")]
    max_retry_count: u32,
    #[serde(default)]
    download_speed_limit: u32, // MB/s, 0 = unlimited
    #[serde(default)]
    show_codec_options: bool,

    // Appearance settings
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default = "default_true")]
    animation: bool,
    #[serde(default)]
    compact: bool,

    // Records settings
    #[serde(default = "default_true")]
    show_all_records_folder: bool,
    #[serde(default = "default_true")]
    show_uncategorized_folder: bool,
    #[serde(default = "default_clip_offset")]
    download_clip_before_offset: u32,
    #[serde(default = "default_clip_offset")]
    download_clip_after_offset: u32,

    // GPU acceleration settings
    #[serde(default)]
    enable_hardware_encoding: bool,
    #[serde(default = "default_hardware_encoder")]
    hardware_encoder: String,
    #[serde(default = "default_true")]
    enable_frontend_acceleration: bool,

    // Scheduled downloads settings
    #[serde(default)]
    enable_scheduled_downloads: bool,
    #[serde(default = "default_close_behavior")]
    close_behavior: String,
    #[serde(default = "default_youtube_polling_interval")]
    youtube_polling_interval: u32,
    #[serde(default = "default_trigger_cooldown")]
    trigger_cooldown: u32,
    #[serde(default = "default_scheduled_download_notification")]
    scheduled_download_notification: String,
    #[serde(default)]
    scheduled_download_auto_transcribe: bool,
    #[serde(default = "default_true")]
    auto_start_monitoring: bool,
}

// Default value functions for serde
fn default_download_folder() -> String {
    "~/Tidemark/Downloads".to_string()
}

fn default_subtitle_folder() -> String {
    "~/Tidemark/Downloads".to_string()
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "繁體中文".to_string()
}

fn default_timezone() -> String {
    "System".to_string()
}

fn default_video_quality() -> String {
    "Highest".to_string()
}

fn default_output_container() -> String {
    "Auto".to_string()
}

fn default_max_concurrent_downloads() -> usize {
    3
}

fn default_max_retry_count() -> u32 {
    3
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_clip_offset() -> u32 {
    10
}

fn default_hardware_encoder() -> String {
    "auto".to_string()
}

fn default_close_behavior() -> String {
    "minimize_to_tray".to_string()
}

fn default_youtube_polling_interval() -> u32 {
    90
}

fn default_trigger_cooldown() -> u32 {
    300
}

fn default_scheduled_download_notification() -> String {
    "both".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthConfig {
    pub twitch_token: Option<String>,
    pub youtube_cookies_path: Option<String>,
    pub openai_api_key: Option<String>,
    pub groq_api_key: Option<String>,
    pub elevenlabs_api_key: Option<String>,
}

// Records management structures
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Record {
    pub id: String,
    pub timestamp: String,
    pub live_time: String,
    pub title: String,
    pub topic: String,
    pub folder_id: Option<String>,
    pub channel_url: String,
    pub platform: String,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created: String,
    #[serde(default)]
    pub sort_order: i32,
}

// Version and update structures
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolVersions {
    pub yt_dlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub ffprobe_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateStatus {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_notes: Option<String>,
    pub download_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordsData {
    pub records: Vec<Record>,
    pub folders: Vec<Folder>,
    pub folder_order: Vec<String>,
}

// Cloud Sync structures
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncState {
    pub jwt: Option<String>,
    pub user: Option<SyncUser>,
    pub last_synced_at: String,
    pub status: String, // "offline", "syncing", "synced", "error"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncUser {
    pub id: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct APIRecord {
    pub id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub timestamp: String,
    pub live_time: String,
    pub title: String,
    pub topic: String,
    pub channel_url: String,
    pub platform: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
    pub deleted: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct APIFolder {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
    pub deleted: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncResponse {
    pub records: Vec<APIRecord>,
    pub folders: Vec<APIFolder>,
    pub synced_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleAuthRequest {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoogleAuthResponse {
    pub token: String,
}

// Scheduled downloads structures
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadPreset {
    pub id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub platform: String,        // "twitch" | "youtube"
    pub enabled: bool,
    pub quality: String,          // "best", "1080p", "720p", etc.
    pub content_type: String,     // "video+audio" | "audio_only"
    pub output_dir: String,
    pub filename_template: String,
    pub container_format: String, // "auto" | "mp4" | "mkv"
    pub created_at: String,       // ISO 8601
    pub last_triggered_at: Option<String>,
    pub trigger_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChannelInfo {
    pub channel_id: String,
    pub channel_name: String,
    pub platform: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            default_download_folder: default_download_folder(),
            default_subtitle_folder: default_subtitle_folder(),
            launch_on_startup: false,
            desktop_notifications: true,
            language: default_language(),
            timezone: default_timezone(),
            enable_transcoder: false,
            default_video_quality: default_video_quality(),
            output_container: default_output_container(),
            max_concurrent_downloads: default_max_concurrent_downloads(),
            auto_retry: true,
            max_retry_count: default_max_retry_count(),
            download_speed_limit: 0,
            show_codec_options: false,
            theme: default_theme(),
            animation: true,
            compact: false,
            show_all_records_folder: true,
            show_uncategorized_folder: true,
            download_clip_before_offset: default_clip_offset(),
            download_clip_after_offset: default_clip_offset(),
            enable_hardware_encoding: false,
            hardware_encoder: default_hardware_encoder(),
            enable_frontend_acceleration: true,
            enable_scheduled_downloads: false,
            close_behavior: default_close_behavior(),
            youtube_polling_interval: default_youtube_polling_interval(),
            trigger_cooldown: default_trigger_cooldown(),
            scheduled_download_notification: default_scheduled_download_notification(),
            scheduled_download_auto_transcribe: false,
            auto_start_monitoring: true,
        }
    }
}

fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join("config.json"))
}

fn get_auth_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let tidemark_dir = app_data_dir.join("tidemark");
    fs::create_dir_all(&tidemark_dir)
        .map_err(|e| format!("Failed to create tidemark dir: {}", e))?;

    Ok(tidemark_dir.join("auth_config.json"))
}

fn get_records_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let tidemark_dir = app_data_dir.join("tidemark");
    fs::create_dir_all(&tidemark_dir)
        .map_err(|e| format!("Failed to create tidemark dir: {}", e))?;

    Ok(tidemark_dir.join("records.json"))
}

fn get_sync_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let tidemark_dir = app_data_dir.join("tidemark");
    fs::create_dir_all(&tidemark_dir)
        .map_err(|e| format!("Failed to create tidemark dir: {}", e))?;

    Ok(tidemark_dir.join("sync_state.json"))
}

fn get_scheduled_presets_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let tidemark_dir = app_data_dir.join("tidemark");
    fs::create_dir_all(&tidemark_dir)
        .map_err(|e| format!("Failed to create tidemark dir: {}", e))?;

    Ok(tidemark_dir.join("scheduled_presets.json"))
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    let config_path = get_config_path(&app)?;

    if !config_path.exists() {
        return Ok(AppConfig::default());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let config_path = get_config_path(&app)?;

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

// Video info structures
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoQuality {
    pub format_id: String,
    pub quality: String,
    pub ext: String,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    pub duration: Option<i64>,
    pub platform: String,
    pub content_type: String,
    pub is_live: bool,
    pub qualities: Vec<VideoQuality>,
}

#[derive(Debug, Clone)]
pub enum Platform {
    YouTube,
    Twitch,
}

#[derive(Debug, Clone)]
pub enum ContentType {
    Video,
    Stream,
    Clip,
}

pub struct ParsedUrl {
    pub platform: Platform,
    pub content_type: ContentType,
    pub id: String,
}

fn parse_url(url: &str) -> Result<ParsedUrl, String> {
    let url = url.trim();

    // YouTube patterns
    let youtube_watch = Regex::new(r"(?:youtube\.com|youtu\.be)/watch\?v=([a-zA-Z0-9_-]{11})").unwrap();
    let youtube_short = Regex::new(r"youtu\.be/([a-zA-Z0-9_-]{11})").unwrap();
    let youtube_live = Regex::new(r"youtube\.com/live/([a-zA-Z0-9_-]{11})").unwrap();

    // Twitch patterns
    let twitch_video = Regex::new(r"twitch\.tv/videos/(\d+)").unwrap();
    let twitch_clip = Regex::new(r"(?:twitch\.tv/[^/]+/clip/([a-zA-Z0-9_-]+)|clips\.twitch\.tv/([a-zA-Z0-9_-]+))").unwrap();
    let twitch_channel = Regex::new(r"twitch\.tv/([a-zA-Z0-9_-]+)(?:/|$)").unwrap();

    // Check YouTube
    if let Some(caps) = youtube_watch.captures(url).or_else(|| youtube_short.captures(url)) {
        return Ok(ParsedUrl {
            platform: Platform::YouTube,
            content_type: ContentType::Video,
            id: caps[1].to_string(),
        });
    }

    if let Some(caps) = youtube_live.captures(url) {
        return Ok(ParsedUrl {
            platform: Platform::YouTube,
            content_type: ContentType::Stream,
            id: caps[1].to_string(),
        });
    }

    // Check Twitch
    if let Some(caps) = twitch_video.captures(url) {
        return Ok(ParsedUrl {
            platform: Platform::Twitch,
            content_type: ContentType::Video,
            id: caps[1].to_string(),
        });
    }

    if let Some(caps) = twitch_clip.captures(url) {
        let clip_id = caps.get(1).or_else(|| caps.get(2)).unwrap().as_str();
        return Ok(ParsedUrl {
            platform: Platform::Twitch,
            content_type: ContentType::Clip,
            id: clip_id.to_string(),
        });
    }

    if let Some(caps) = twitch_channel.captures(url) {
        return Ok(ParsedUrl {
            platform: Platform::Twitch,
            content_type: ContentType::Stream,
            id: caps[1].to_string(),
        });
    }

    Err("不支援的連結格式".to_string())
}

async fn fetch_youtube_info(video_id: &str) -> Result<VideoInfo, String> {
    // Try to use yt-dlp to fetch metadata
    let output = Command::new("yt-dlp")
        .args([
            "--dump-json",
            "--no-playlist",
            &format!("https://www.youtube.com/watch?v={}", video_id),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(result) => {
            if !result.status.success() {
                let stderr = String::from_utf8_lossy(&result.stderr);
                if stderr.contains("Video unavailable") || stderr.contains("Private video") {
                    return Err("找不到該影片".to_string());
                }
                return Err(format!("yt-dlp error: {}", stderr));
            }

            let json_str = String::from_utf8_lossy(&result.stdout);
            let json: serde_json::Value = serde_json::from_str(&json_str)
                .map_err(|e| format!("Failed to parse yt-dlp output: {}", e))?;

            let is_live = json.get("is_live")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let mut qualities = Vec::new();
            if let Some(formats) = json.get("formats").and_then(|v| v.as_array()) {
                for format in formats {
                    if let (Some(format_id), Some(ext)) = (
                        format.get("format_id").and_then(|v| v.as_str()),
                        format.get("ext").and_then(|v| v.as_str()),
                    ) {
                        let quality = format.get("format_note")
                            .and_then(|v| v.as_str())
                            .or_else(|| format.get("height").and_then(|v| v.as_i64()).map(|h| {
                                if h >= 2160 { "4K" }
                                else if h >= 1440 { "1440p" }
                                else if h >= 1080 { "1080p" }
                                else if h >= 720 { "720p" }
                                else if h >= 480 { "480p" }
                                else { "360p" }
                            }))
                            .unwrap_or("audio only");

                        qualities.push(VideoQuality {
                            format_id: format_id.to_string(),
                            quality: quality.to_string(),
                            ext: ext.to_string(),
                            vcodec: format.get("vcodec").and_then(|v| v.as_str()).map(String::from),
                            acodec: format.get("acodec").and_then(|v| v.as_str()).map(String::from),
                            filesize: format.get("filesize").and_then(|v| v.as_i64()),
                        });
                    }
                }
            }

            Ok(VideoInfo {
                id: video_id.to_string(),
                title: json.get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                channel: json.get("uploader")
                    .or_else(|| json.get("channel"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                thumbnail: json.get("thumbnail")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                duration: json.get("duration").and_then(|v| v.as_i64()),
                platform: "youtube".to_string(),
                content_type: if is_live { "stream" } else { "video" }.to_string(),
                is_live,
                qualities,
            })
        }
        Err(_) => {
            Err("找不到 yt-dlp，請安裝後再試".to_string())
        }
    }
}

async fn fetch_twitch_info(content_type: &ContentType, id: &str) -> Result<VideoInfo, String> {
    // For MVP, we'll use a simplified Twitch GQL approach
    // In production, this would need proper OAuth and GQL queries

    match content_type {
        ContentType::Video => {
            // VOD
            Ok(VideoInfo {
                id: id.to_string(),
                title: format!("Twitch VOD {}", id),
                channel: "Unknown Channel".to_string(),
                thumbnail: "".to_string(),
                duration: None,
                platform: "twitch".to_string(),
                content_type: "video".to_string(),
                is_live: false,
                qualities: vec![
                    VideoQuality {
                        format_id: "source".to_string(),
                        quality: "Source".to_string(),
                        ext: "mp4".to_string(),
                        vcodec: Some("h264".to_string()),
                        acodec: Some("aac".to_string()),
                        filesize: None,
                    },
                    VideoQuality {
                        format_id: "720p60".to_string(),
                        quality: "720p60".to_string(),
                        ext: "mp4".to_string(),
                        vcodec: Some("h264".to_string()),
                        acodec: Some("aac".to_string()),
                        filesize: None,
                    },
                ],
            })
        }
        ContentType::Clip => {
            Ok(VideoInfo {
                id: id.to_string(),
                title: format!("Twitch Clip {}", id),
                channel: "Unknown Channel".to_string(),
                thumbnail: "".to_string(),
                duration: None,
                platform: "twitch".to_string(),
                content_type: "clip".to_string(),
                is_live: false,
                qualities: vec![
                    VideoQuality {
                        format_id: "source".to_string(),
                        quality: "Source".to_string(),
                        ext: "mp4".to_string(),
                        vcodec: Some("h264".to_string()),
                        acodec: Some("aac".to_string()),
                        filesize: None,
                    },
                ],
            })
        }
        ContentType::Stream => {
            Ok(VideoInfo {
                id: id.to_string(),
                title: format!("直播：{}", id),
                channel: id.to_string(),
                thumbnail: "".to_string(),
                duration: None,
                platform: "twitch".to_string(),
                content_type: "stream".to_string(),
                is_live: true,
                qualities: vec![
                    VideoQuality {
                        format_id: "source".to_string(),
                        quality: "Source".to_string(),
                        ext: "mp4".to_string(),
                        vcodec: Some("h264".to_string()),
                        acodec: Some("aac".to_string()),
                        filesize: None,
                    },
                ],
            })
        }
    }
}

#[tauri::command]
async fn fetch_video_info(url: String) -> Result<VideoInfo, String> {
    let parsed = parse_url(&url)?;

    match parsed.platform {
        Platform::YouTube => fetch_youtube_info(&parsed.id).await,
        Platform::Twitch => fetch_twitch_info(&parsed.content_type, &parsed.id).await,
    }
}

// Time range validation functions
fn parse_time_to_seconds(time: &str) -> Result<i64, String> {
    let time = time.trim();

    // Pure seconds
    if let Ok(seconds) = time.parse::<i64>() {
        return Ok(seconds);
    }

    // HH:MM:SS or MM:SS
    let parts: Vec<&str> = time.split(':').collect();

    match parts.len() {
        2 => {
            // MM:SS
            let minutes = parts[0].parse::<i64>().map_err(|_| "無效的時間格式".to_string())?;
            let seconds = parts[1].parse::<i64>().map_err(|_| "無效的時間格式".to_string())?;
            Ok(minutes * 60 + seconds)
        }
        3 => {
            // HH:MM:SS
            let hours = parts[0].parse::<i64>().map_err(|_| "無效的時間格式".to_string())?;
            let minutes = parts[1].parse::<i64>().map_err(|_| "無效的時間格式".to_string())?;
            let seconds = parts[2].parse::<i64>().map_err(|_| "無效的時間格式".to_string())?;
            Ok(hours * 3600 + minutes * 60 + seconds)
        }
        _ => Err("請輸入有效時間格式".to_string()),
    }
}

fn normalize_time_to_hhmmss(seconds: i64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    format!("{:02}:{:02}:{:02}", hours, minutes, secs)
}

fn validate_time_range(config: &DownloadConfig) -> Result<(), String> {
    if let Some(ref time_range) = config.time_range {
        let start_seconds = if let Some(ref start) = time_range.start {
            Some(parse_time_to_seconds(start)?)
        } else {
            None
        };

        let end_seconds = if let Some(ref end) = time_range.end {
            Some(parse_time_to_seconds(end)?)
        } else {
            None
        };

        // Validate end > start
        if let (Some(start), Some(end)) = (start_seconds, end_seconds) {
            if end <= start {
                return Err("結束時間必須晚於開始時間".to_string());
            }

            // Validate against video duration if available
            if let Some(duration) = config.video_info.duration {
                if start > duration {
                    return Err("時間超出影片長度".to_string());
                }
                if end > duration {
                    return Err("時間超出影片長度".to_string());
                }
            }
        }
    }

    Ok(())
}

// Download management commands
#[tauri::command]
async fn start_download(
    app: AppHandle,
    config: DownloadConfig,
    tasks: tauri::State<'_, DownloadTasks>,
) -> Result<String, String> {
    // Validate time range
    validate_time_range(&config)?;
    let task_id = Uuid::new_v4().to_string();

    let progress = DownloadProgress {
        task_id: task_id.clone(),
        status: "queued".to_string(),
        title: config.video_info.title.clone(),
        percentage: 0.0,
        speed: "0 B/s".to_string(),
        eta: "計算中...".to_string(),
        downloaded_bytes: 0,
        total_bytes: 0,
        output_path: None,
        error_message: None,
        is_recording: None,
        recorded_duration: None,
        bitrate: None,
    };

    let task = DownloadTask {
        config: config.clone(),
        progress: progress.clone(),
        process: None,
        paused: false,
    };

    {
        let mut tasks_guard = tasks.lock().unwrap();
        tasks_guard.insert(task_id.clone(), task);
    }

    // Emit initial progress
    app.emit("download-progress", &progress).ok();

    // Start download in background
    let app_clone = app.clone();
    let tasks_clone = tasks.inner().clone();
    let task_id_clone = task_id.clone();

    tokio::spawn(async move {
        execute_download(app_clone, tasks_clone, task_id_clone).await;
    });

    Ok(task_id)
}

#[tauri::command]
async fn start_recording(
    app: AppHandle,
    config: DownloadConfig,
    tasks: tauri::State<'_, DownloadTasks>,
) -> Result<String, String> {
    if !config.video_info.is_live {
        return Err("此影片不是直播".to_string());
    }

    let task_id = Uuid::new_v4().to_string();

    let progress = DownloadProgress {
        task_id: task_id.clone(),
        status: "recording".to_string(),
        title: config.video_info.title.clone(),
        percentage: 0.0,
        speed: "0 B/s".to_string(),
        eta: "直播錄製中...".to_string(),
        downloaded_bytes: 0,
        total_bytes: 0,
        output_path: None,
        error_message: None,
        is_recording: Some(true),
        recorded_duration: Some("00:00:00".to_string()),
        bitrate: Some("N/A".to_string()),
    };

    let task = DownloadTask {
        config: config.clone(),
        progress: progress.clone(),
        process: None,
        paused: false,
    };

    {
        let mut tasks_guard = tasks.lock().unwrap();
        tasks_guard.insert(task_id.clone(), task);
    }

    // Emit initial progress
    app.emit("download-progress", &progress).ok();

    // Start recording in background
    let app_clone = app.clone();
    let tasks_clone = tasks.inner().clone();
    let task_id_clone = task_id.clone();

    tokio::spawn(async move {
        execute_recording(app_clone, tasks_clone, task_id_clone).await;
    });

    Ok(task_id)
}

async fn execute_download(app: AppHandle, tasks: DownloadTasks, task_id: String) {
    let config = {
        let tasks_guard = tasks.lock().unwrap();
        match tasks_guard.get(&task_id) {
            Some(task) => task.config.clone(),
            None => return,
        }
    };

    // Load auth config
    let auth_config = get_auth_config(app.clone()).await.ok();

    // Update status to downloading
    {
        let mut tasks_guard = tasks.lock().unwrap();
        if let Some(task) = tasks_guard.get_mut(&task_id) {
            task.progress.status = "downloading".to_string();
            app.emit("download-progress", &task.progress).ok();
        }
    }

    // Build yt-dlp command
    let output_path = PathBuf::from(&config.output_folder).join(&config.output_filename);
    let output_template = output_path.to_str().unwrap();

    let mut args = vec![
        "--newline",
        "--progress",
        "-f", &config.format_id,
        "-o", output_template,
    ];

    // Add authentication arguments
    let cookies_path_storage;
    if let Some(ref auth) = auth_config {
        // YouTube cookies
        if config.video_info.platform == "youtube" {
            if let Some(ref cookies_path) = auth.youtube_cookies_path {
                cookies_path_storage = cookies_path.clone();
                args.push("--cookies");
                args.push(&cookies_path_storage);
            }
        }

        // Twitch token (would be used if yt-dlp supports it via config)
        // For now, yt-dlp handles Twitch auth differently
        // We may need to set environment variables or use streamlink instead
    }

    // Add time range if specified
    let download_sections = config.time_range.as_ref().and_then(|time_range| {
        match (&time_range.start, &time_range.end) {
            (Some(start), Some(end)) => {
                let start_seconds = parse_time_to_seconds(start).unwrap_or(0);
                let end_seconds = parse_time_to_seconds(end).unwrap_or(0);
                let start_normalized = normalize_time_to_hhmmss(start_seconds);
                let end_normalized = normalize_time_to_hhmmss(end_seconds);
                Some(format!("*{}-{}", start_normalized, end_normalized))
            }
            _ => None,
        }
    });
    if let Some(ref sections) = download_sections {
        args.push("--download-sections");
        args.push(sections);
    }

    // Add container format
    if config.container_format != "auto" {
        args.push("--remux-video");
        args.push(&config.container_format);
    }

    args.push(&config.url);

    // Spawn yt-dlp process
    let mut child = match Command::new("yt-dlp")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            update_download_error(&app, &tasks, &task_id, &format!("無法啟動 yt-dlp: {}", e)).await;
            return;
        }
    };

    // Read stdout for progress (before storing process)
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            update_download_error(&app, &tasks, &task_id, "無法讀取 yt-dlp 輸出").await;
            return;
        }
    };

    // Store process handle
    {
        let mut tasks_guard = tasks.lock().unwrap();
        if let Some(task) = tasks_guard.get_mut(&task_id) {
            task.process = Some(child);
        }
    }

    use std::io::{BufRead, BufReader};
    let reader = BufReader::new(stdout);

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        // Parse progress line
        if let Some(progress_info) = parse_ytdlp_progress(&line) {
            let mut tasks_guard = tasks.lock().unwrap();
            if let Some(task) = tasks_guard.get_mut(&task_id) {
                task.progress.percentage = progress_info.0;
                task.progress.speed = progress_info.1;
                task.progress.eta = progress_info.2;
                app.emit("download-progress", &task.progress).ok();
            }
        }
    }

    // Wait for process to complete
    let mut child = {
        let mut tasks_guard = tasks.lock().unwrap();
        match tasks_guard.get_mut(&task_id) {
            Some(task) => task.process.take(),
            None => return,
        }
    };

    if let Some(ref mut child) = child {
        match child.wait() {
            Ok(status) => {
                if status.success() {
                    // Download completed successfully
                    let output_path_str = output_path.to_str().unwrap().to_string();

                    {
                        let mut tasks_guard = tasks.lock().unwrap();
                        if let Some(task) = tasks_guard.get_mut(&task_id) {
                            task.progress.status = "completed".to_string();
                            task.progress.percentage = 100.0;
                            task.progress.output_path = Some(output_path_str.clone());
                            app.emit("download-progress", &task.progress).ok();
                        }
                    }

                    // Save to history
                    save_download_history(&app, &config, &output_path_str, "completed", None).await;
                } else {
                    update_download_error(&app, &tasks, &task_id, "下載失敗").await;
                }
            }
            Err(e) => {
                update_download_error(&app, &tasks, &task_id, &format!("程序錯誤: {}", e)).await;
            }
        }
    }
}

async fn execute_recording(app: AppHandle, tasks: DownloadTasks, task_id: String) {
    let config = {
        let tasks_guard = tasks.lock().unwrap();
        match tasks_guard.get(&task_id) {
            Some(task) => task.config.clone(),
            None => return,
        }
    };

    // Load auth config
    let auth_config = get_auth_config(app.clone()).await.ok();

    // Build output path
    let output_path = PathBuf::from(&config.output_folder).join(&config.output_filename);
    let output_template = output_path.to_str().unwrap();

    // Build yt-dlp command for live recording
    let mut args = vec![
        "--newline",
        "--progress",
        "-f", &config.format_id,
        "-o", output_template,
        "--live-from-start",  // Try to record from the start of the stream
    ];

    // Add authentication arguments
    let cookies_path_storage;
    if let Some(ref auth) = auth_config {
        // YouTube cookies
        if config.video_info.platform == "youtube" {
            if let Some(ref cookies_path) = auth.youtube_cookies_path {
                cookies_path_storage = cookies_path.clone();
                args.push("--cookies");
                args.push(&cookies_path_storage);
            }
        }
    }

    // Add container format
    if config.container_format != "auto" {
        args.push("--remux-video");
        args.push(&config.container_format);
    }

    args.push(&config.url);

    // Spawn yt-dlp process
    let mut child = match Command::new("yt-dlp")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            update_download_error(&app, &tasks, &task_id, &format!("無法啟動 yt-dlp: {}", e)).await;
            return;
        }
    };

    // Read stdout for progress
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            update_download_error(&app, &tasks, &task_id, "無法讀取 yt-dlp 輸出").await;
            return;
        }
    };

    // Store process handle
    {
        let mut tasks_guard = tasks.lock().unwrap();
        if let Some(task) = tasks_guard.get_mut(&task_id) {
            task.process = Some(child);
        }
    }

    use std::io::{BufRead, BufReader};
    use std::time::Instant;
    let reader = BufReader::new(stdout);
    let start_time = Instant::now();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        // Parse recording progress
        if let Some(recording_info) = parse_recording_progress(&line) {
            let elapsed = start_time.elapsed();
            let duration_str = format_duration_hhmmss(elapsed.as_secs());

            let mut tasks_guard = tasks.lock().unwrap();
            if let Some(task) = tasks_guard.get_mut(&task_id) {
                task.progress.downloaded_bytes = recording_info.0;
                task.progress.bitrate = Some(recording_info.1);
                task.progress.recorded_duration = Some(duration_str);
                app.emit("download-progress", &task.progress).ok();
            }
        } else if let Some(progress_info) = parse_ytdlp_progress(&line) {
            // Fallback to standard progress parsing
            let elapsed = start_time.elapsed();
            let duration_str = format_duration_hhmmss(elapsed.as_secs());

            let mut tasks_guard = tasks.lock().unwrap();
            if let Some(task) = tasks_guard.get_mut(&task_id) {
                task.progress.speed = progress_info.1.clone();
                task.progress.recorded_duration = Some(duration_str);
                app.emit("download-progress", &task.progress).ok();
            }
        }
    }

    // Wait for process to complete
    let mut child = {
        let mut tasks_guard = tasks.lock().unwrap();
        match tasks_guard.get_mut(&task_id) {
            Some(task) => task.process.take(),
            None => return,
        }
    };

    if let Some(ref mut child) = child {
        match child.wait() {
            Ok(status) => {
                if status.success() {
                    // Recording completed - run post-processing
                    {
                        let mut tasks_guard = tasks.lock().unwrap();
                        if let Some(task) = tasks_guard.get_mut(&task_id) {
                            task.progress.status = "processing".to_string();
                            app.emit("download-progress", &task.progress).ok();
                        }
                    }

                    // Run FFmpeg remux if needed
                    let final_path = post_process_recording(&output_path).await;
                    let output_path_str = final_path.unwrap_or_else(|| output_path.to_str().unwrap().to_string());

                    {
                        let mut tasks_guard = tasks.lock().unwrap();
                        if let Some(task) = tasks_guard.get_mut(&task_id) {
                            task.progress.status = "completed".to_string();
                            task.progress.percentage = 100.0;
                            task.progress.output_path = Some(output_path_str.clone());
                            task.progress.is_recording = Some(false);
                            app.emit("download-progress", &task.progress).ok();
                        }
                    }

                    // Save to history
                    save_download_history(&app, &config, &output_path_str, "completed", None).await;
                } else {
                    // Check if stream was interrupted (exit code may vary)
                    let stderr_output = child.stderr.as_mut()
                        .and_then(|stderr| {
                            use std::io::Read;
                            let mut buf = String::new();
                            stderr.read_to_string(&mut buf).ok()?;
                            Some(buf)
                        });

                    let is_interrupted = stderr_output
                        .as_ref()
                        .map(|s| s.contains("Stream ended") || s.contains("connection") || s.contains("interrupt"))
                        .unwrap_or(false);

                    if is_interrupted {
                        // Stream interrupted - preserve recorded content
                        let output_path_str = output_path.to_str().unwrap().to_string();

                        {
                            let mut tasks_guard = tasks.lock().unwrap();
                            if let Some(task) = tasks_guard.get_mut(&task_id) {
                                task.progress.status = "stream_interrupted".to_string();
                                task.progress.output_path = Some(output_path_str.clone());
                                task.progress.is_recording = Some(false);
                                task.progress.error_message = Some("串流中斷".to_string());
                                app.emit("download-progress", &task.progress).ok();
                            }
                        }

                        save_download_history(&app, &config, &output_path_str, "stream_interrupted", Some("串流中斷")).await;
                    } else {
                        update_download_error(&app, &tasks, &task_id, "錄製失敗").await;
                    }
                }
            }
            Err(e) => {
                update_download_error(&app, &tasks, &task_id, &format!("程序錯誤: {}", e)).await;
            }
        }
    }
}

async fn post_process_recording(input_path: &Path) -> Option<String> {
    // Run FFmpeg remux to ensure the file is properly formatted
    // For MVP, we'll just verify the file exists
    if input_path.exists() {
        Some(input_path.to_str().unwrap().to_string())
    } else {
        None
    }
}

fn parse_recording_progress(line: &str) -> Option<(u64, String)> {
    // Parse yt-dlp live stream progress
    // Example: [download]  1.23MiB at 256.00KiB/s
    let re = Regex::new(r"\[download\]\s+([0-9.]+)([KMG]iB)\s+at\s+([0-9.]+)([KMG]iB/s)").ok()?;
    let caps = re.captures(line)?;

    let size_value: f64 = caps.get(1)?.as_str().parse().ok()?;
    let size_unit = caps.get(2)?.as_str();
    let bitrate_value = caps.get(3)?.as_str();
    let bitrate_unit = caps.get(4)?.as_str();

    // Convert to bytes
    let multiplier = match size_unit {
        "KiB" => 1024,
        "MiB" => 1024 * 1024,
        "GiB" => 1024 * 1024 * 1024,
        _ => 1,
    };

    let bytes = (size_value * multiplier as f64) as u64;
    let bitrate = format!("{}{}", bitrate_value, bitrate_unit);

    Some((bytes, bitrate))
}

fn format_duration_hhmmss(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    format!("{:02}:{:02}:{:02}", hours, minutes, secs)
}

fn parse_ytdlp_progress(line: &str) -> Option<(f64, String, String)> {
    // Parse yt-dlp progress lines like:
    // [download]  45.2% of 123.45MiB at 2.34MiB/s ETA 00:23

    let re = Regex::new(r"\[download\]\s+(\d+\.?\d*)%.*?at\s+([^\s]+)\s+ETA\s+(.+)").ok()?;
    let caps = re.captures(line)?;

    let percentage: f64 = caps.get(1)?.as_str().parse().ok()?;
    let speed = caps.get(2)?.as_str().to_string();
    let eta = caps.get(3)?.as_str().to_string();

    Some((percentage, speed, eta))
}

async fn update_download_error(app: &AppHandle, tasks: &DownloadTasks, task_id: &str, error: &str) {
    let config = {
        let mut tasks_guard = tasks.lock().unwrap();
        if let Some(task) = tasks_guard.get_mut(task_id) {
            task.progress.status = "failed".to_string();
            task.progress.error_message = Some(error.to_string());
            app.emit("download-progress", &task.progress).ok();

            // Clone config before dropping guard
            Some(task.config.clone())
        } else {
            None
        }
    };

    // Save to history after dropping mutex
    if let Some(cfg) = config {
        save_download_history(app, &cfg, "", "failed", Some(error)).await;
    }
}

async fn save_download_history(
    app: &AppHandle,
    config: &DownloadConfig,
    output_path: &str,
    status: &str,
    error: Option<&str>,
) {
    let history_path = match app.path().app_data_dir() {
        Ok(dir) => {
            fs::create_dir_all(&dir).ok();
            dir.join("tidemark").join("history.json")
        }
        Err(_) => return,
    };

    fs::create_dir_all(history_path.parent().unwrap()).ok();

    // Load existing history
    let mut history: Vec<DownloadHistoryEntry> = if history_path.exists() {
        fs::read_to_string(&history_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    // Get file size if completed
    let file_size = if status == "completed" {
        fs::metadata(output_path).ok().map(|m| m.len())
    } else {
        None
    };

    let entry = DownloadHistoryEntry {
        id: Uuid::new_v4().to_string(),
        url: config.url.clone(),
        title: config.video_info.title.clone(),
        channel: config.video_info.channel.clone(),
        platform: config.video_info.platform.clone(),
        content_type: config.video_info.content_type.clone(),
        status: status.to_string(),
        file_path: if status == "completed" { Some(output_path.to_string()) } else { None },
        file_size,
        resolution: Some(config.format_id.clone()),
        started_at: Utc::now().to_rfc3339(),
        completed_at: if status == "completed" { Some(Utc::now().to_rfc3339()) } else { None },
        error_message: error.map(String::from),
    };

    history.push(entry);

    // Save history
    if let Ok(content) = serde_json::to_string_pretty(&history) {
        fs::write(&history_path, content).ok();
    }
}

#[tauri::command]
async fn pause_download(task_id: String, tasks: tauri::State<'_, DownloadTasks>) -> Result<(), String> {
    let mut tasks_guard = tasks.lock().unwrap();
    if let Some(task) = tasks_guard.get_mut(&task_id) {
        if let Some(ref mut child) = task.process {
            // Kill the process
            child.kill().map_err(|e| format!("無法暫停下載: {}", e))?;
            task.paused = true;
            task.progress.status = "paused".to_string();
        }
        Ok(())
    } else {
        Err("找不到下載任務".to_string())
    }
}

#[tauri::command]
async fn resume_download(
    app: AppHandle,
    task_id: String,
    tasks: tauri::State<'_, DownloadTasks>,
) -> Result<(), String> {
    // For MVP, we'll restart the download with --continue flag
    // In production, this would need proper resume support

    let mut tasks_guard = tasks.lock().unwrap();
    if let Some(task) = tasks_guard.get_mut(&task_id) {
        task.paused = false;
        task.progress.status = "downloading".to_string();

        // Re-spawn download in background
        let app_clone = app.clone();
        let tasks_clone = tasks.inner().clone();
        let task_id_clone = task_id.clone();

        drop(tasks_guard);

        tokio::spawn(async move {
            execute_download(app_clone, tasks_clone, task_id_clone).await;
        });

        Ok(())
    } else {
        Err("找不到下載任務".to_string())
    }
}

#[tauri::command]
async fn cancel_download(
    app: AppHandle,
    task_id: String,
    tasks: tauri::State<'_, DownloadTasks>,
) -> Result<(), String> {
    let config = {
        let mut tasks_guard = tasks.lock().unwrap();
        if let Some(task) = tasks_guard.get_mut(&task_id) {
            if let Some(ref mut child) = task.process {
                child.kill().ok();
            }
            task.progress.status = "cancelled".to_string();
            app.emit("download-progress", &task.progress).ok();

            // Clone config before dropping guard
            Some(task.config.clone())
        } else {
            None
        }
    };

    match config {
        Some(cfg) => {
            // Save to history after dropping mutex
            save_download_history(&app, &cfg, "", "cancelled", None).await;
            Ok(())
        }
        None => Err("找不到下載任務".to_string()),
    }
}

#[tauri::command]
async fn stop_recording(
    app: AppHandle,
    task_id: String,
    tasks: tauri::State<'_, DownloadTasks>,
) -> Result<(), String> {
    {
        let mut tasks_guard = tasks.lock().unwrap();
        if let Some(task) = tasks_guard.get_mut(&task_id) {
            if let Some(ref mut child) = task.process {
                // Send SIGTERM for graceful shutdown (allows yt-dlp to finalize the file)
                #[cfg(unix)]
                {
                    // On Unix, we can send SIGTERM which yt-dlp handles gracefully
                    unsafe {
                        libc::kill(child.id() as i32, libc::SIGTERM);
                    }
                }

                #[cfg(not(unix))]
                {
                    // On Windows, just kill the process
                    child.kill().ok();
                }
            }

            task.progress.status = "processing".to_string();
            task.progress.is_recording = Some(false);
            app.emit("download-progress", &task.progress).ok();
        }
    }

    // The execute_recording function will handle the completion when the process exits
    Ok(())
}

#[tauri::command]
async fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("無法開啟檔案: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("無法開啟檔案: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("無法開啟檔案: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn show_in_folder(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    let folder = path_buf.parent().ok_or("無效的檔案路徑")?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(folder)
            .spawn()
            .map_err(|e| format!("無法開啟資料夾: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("無法開啟資料夾: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .map_err(|e| format!("無法開啟資料夾: {}", e))?;
    }

    Ok(())
}

fn get_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("無法取得應用程式資料目錄: {}", e))?;

    let history_dir = app_data_dir.join("tidemark");
    fs::create_dir_all(&history_dir)
        .map_err(|e| format!("無法建立歷程目錄: {}", e))?;

    Ok(history_dir.join("history.json"))
}

#[tauri::command]
async fn get_download_history(app: AppHandle) -> Result<Vec<DownloadHistoryEntry>, String> {
    let history_path = get_history_path(&app)?;

    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&history_path)
        .map_err(|e| format!("無法讀取歷程檔案: {}", e))?;

    let history: Vec<DownloadHistoryEntry> = serde_json::from_str(&content)
        .map_err(|e| format!("無法解析歷程資料: {}", e))?;

    Ok(history)
}

#[tauri::command]
async fn delete_history_entry(app: AppHandle, id: String) -> Result<(), String> {
    let history_path = get_history_path(&app)?;

    if !history_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&history_path)
        .map_err(|e| format!("無法讀取歷程檔案: {}", e))?;

    let mut history: Vec<DownloadHistoryEntry> = serde_json::from_str(&content)
        .map_err(|e| format!("無法解析歷程資料: {}", e))?;

    // Remove entry with matching id
    history.retain(|entry| entry.id != id);

    // Save updated history
    let content = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("無法序列化歷程資料: {}", e))?;

    fs::write(&history_path, content)
        .map_err(|e| format!("無法儲存歷程檔案: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn clear_all_history(app: AppHandle) -> Result<(), String> {
    let history_path = get_history_path(&app)?;

    // Write empty array
    fs::write(&history_path, "[]")
        .map_err(|e| format!("無法清空歷程: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn check_file_exists(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(&path).exists())
}

#[tauri::command]
async fn get_download_tasks(tasks: tauri::State<'_, DownloadTasks>) -> Result<Vec<DownloadProgress>, String> {
    let tasks_guard = tasks.lock().unwrap();
    let progress_list: Vec<DownloadProgress> = tasks_guard
        .values()
        .map(|task| task.progress.clone())
        .collect();
    Ok(progress_list)
}

// Authentication commands

#[tauri::command]
async fn validate_twitch_token(token: String) -> Result<bool, String> {
    // Validate Twitch OAuth token by making a test API call
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.twitch.tv/helix/users")
        .header("Authorization", format!("Bearer {}", token))
        .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko") // Public Twitch client ID
        .send()
        .await;

    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok(true)
            } else {
                Ok(false)
            }
        }
        Err(_) => Ok(false),
    }
}

#[tauri::command]
async fn import_youtube_cookies(path: String) -> Result<bool, String> {
    // Validate cookies.txt format (Netscape format)
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("無法讀取檔案: {}", e))?;

    // Check for Netscape cookies.txt format
    // Should start with "# Netscape HTTP Cookie File" or have tab-separated cookie lines
    let lines: Vec<&str> = content.lines().collect();

    if lines.is_empty() {
        return Ok(false);
    }

    // Look for Netscape header or valid cookie lines
    let has_netscape_header = lines.iter().any(|line|
        line.starts_with("# Netscape HTTP Cookie File") ||
        line.starts_with("# HTTP Cookie File")
    );

    // Check if at least one line looks like a cookie (7 tab-separated fields)
    let has_cookie_lines = lines.iter().any(|line| {
        if line.starts_with('#') || line.trim().is_empty() {
            return false;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        parts.len() >= 6 // Netscape format has at least 6-7 fields
    });

    if has_netscape_header || has_cookie_lines {
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn save_auth_config(
    app: AppHandle,
    twitch_token: Option<String>,
    youtube_cookies_path: Option<String>,
) -> Result<(), String> {
    let auth_config_path = get_auth_config_path(&app)?;

    // Load existing config to preserve API keys
    let mut config = if auth_config_path.exists() {
        let content = fs::read_to_string(&auth_config_path)
            .map_err(|e| format!("Failed to read auth config: {}", e))?;
        serde_json::from_str::<AuthConfig>(&content)
            .unwrap_or(AuthConfig {
                twitch_token: None,
                youtube_cookies_path: None,
                openai_api_key: None,
                groq_api_key: None,
                elevenlabs_api_key: None,
            })
    } else {
        AuthConfig {
            twitch_token: None,
            youtube_cookies_path: None,
            openai_api_key: None,
            groq_api_key: None,
            elevenlabs_api_key: None,
        }
    };

    // Update fields
    config.twitch_token = twitch_token;
    config.youtube_cookies_path = youtube_cookies_path;

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize auth config: {}", e))?;

    fs::write(&auth_config_path, content)
        .map_err(|e| format!("Failed to write auth config: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn save_api_keys(
    app: AppHandle,
    openai_api_key: Option<String>,
    groq_api_key: Option<String>,
    elevenlabs_api_key: Option<String>,
) -> Result<(), String> {
    let auth_config_path = get_auth_config_path(&app)?;

    // Load existing config to preserve Twitch/YouTube auth
    let mut config = if auth_config_path.exists() {
        let content = fs::read_to_string(&auth_config_path)
            .map_err(|e| format!("Failed to read auth config: {}", e))?;
        serde_json::from_str::<AuthConfig>(&content)
            .unwrap_or(AuthConfig {
                twitch_token: None,
                youtube_cookies_path: None,
                openai_api_key: None,
                groq_api_key: None,
                elevenlabs_api_key: None,
            })
    } else {
        AuthConfig {
            twitch_token: None,
            youtube_cookies_path: None,
            openai_api_key: None,
            groq_api_key: None,
            elevenlabs_api_key: None,
        }
    };

    // Update API keys
    config.openai_api_key = openai_api_key;
    config.groq_api_key = groq_api_key;
    config.elevenlabs_api_key = elevenlabs_api_key;

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize auth config: {}", e))?;

    fs::write(&auth_config_path, content)
        .map_err(|e| format!("Failed to write auth config: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_auth_config(app: AppHandle) -> Result<AuthConfig, String> {
    let auth_config_path = get_auth_config_path(&app)?;

    if !auth_config_path.exists() {
        return Ok(AuthConfig {
            twitch_token: None,
            youtube_cookies_path: None,
            openai_api_key: None,
            groq_api_key: None,
            elevenlabs_api_key: None,
        });
    }

    let content = fs::read_to_string(&auth_config_path)
        .map_err(|e| format!("Failed to read auth config: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse auth config: {}", e))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiKeyTestResult {
    pub success: bool,
    pub message: String,
    pub quota_info: Option<String>,
}

#[tauri::command]
async fn test_api_key(
    provider: String,
    api_key: String,
) -> Result<ApiKeyTestResult, String> {
    match provider.as_str() {
        "openai" => test_openai_api_key(api_key).await,
        "groq" => test_groq_api_key(api_key).await,
        "elevenlabs" => test_elevenlabs_api_key(api_key).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

async fn test_openai_api_key(api_key: String) -> Result<ApiKeyTestResult, String> {
    let client = reqwest::Client::new();

    match client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                Ok(ApiKeyTestResult {
                    success: true,
                    message: "連線成功".to_string(),
                    quota_info: None,
                })
            } else {
                Ok(ApiKeyTestResult {
                    success: false,
                    message: "API Key 無效".to_string(),
                    quota_info: None,
                })
            }
        }
        Err(e) => Ok(ApiKeyTestResult {
            success: false,
            message: format!("連線失敗: {}", e),
            quota_info: None,
        }),
    }
}

async fn test_groq_api_key(api_key: String) -> Result<ApiKeyTestResult, String> {
    let client = reqwest::Client::new();

    match client
        .get("https://api.groq.com/openai/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                Ok(ApiKeyTestResult {
                    success: true,
                    message: "連線成功".to_string(),
                    quota_info: None,
                })
            } else {
                Ok(ApiKeyTestResult {
                    success: false,
                    message: "API Key 無效".to_string(),
                    quota_info: None,
                })
            }
        }
        Err(e) => Ok(ApiKeyTestResult {
            success: false,
            message: format!("連線失敗: {}", e),
            quota_info: None,
        }),
    }
}

async fn test_elevenlabs_api_key(api_key: String) -> Result<ApiKeyTestResult, String> {
    let client = reqwest::Client::new();

    match client
        .get("https://api.elevenlabs.io/v1/user")
        .header("xi-api-key", api_key)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                // Try to parse quota info if available
                let quota_info = response.json::<serde_json::Value>().await.ok()
                    .and_then(|user_info| user_info.get("subscription").cloned())
                    .and_then(|subscription| {
                        let count = subscription.get("character_count")?;
                        let limit = subscription.get("character_limit")?;
                        Some(format!("已用 {} / {}", count, limit))
                    });

                Ok(ApiKeyTestResult {
                    success: true,
                    message: "連線成功".to_string(),
                    quota_info,
                })
            } else {
                Ok(ApiKeyTestResult {
                    success: false,
                    message: "API Key 無效".to_string(),
                    quota_info: None,
                })
            }
        }
        Err(e) => Ok(ApiKeyTestResult {
            success: false,
            message: format!("連線失敗: {}", e),
            quota_info: None,
        }),
    }
}

#[tauri::command]
async fn save_api_key(
    app: AppHandle,
    provider: String,
    api_key: String,
) -> Result<(), String> {
    let auth_config_path = get_auth_config_path(&app)?;

    // Load existing config
    let mut config = if auth_config_path.exists() {
        let content = fs::read_to_string(&auth_config_path)
            .map_err(|e| format!("Failed to read auth config: {}", e))?;
        serde_json::from_str::<AuthConfig>(&content)
            .unwrap_or(AuthConfig {
                twitch_token: None,
                youtube_cookies_path: None,
                openai_api_key: None,
                groq_api_key: None,
                elevenlabs_api_key: None,
            })
    } else {
        AuthConfig {
            twitch_token: None,
            youtube_cookies_path: None,
            openai_api_key: None,
            groq_api_key: None,
            elevenlabs_api_key: None,
        }
    };

    // Update the specific API key
    let key_value = if api_key.is_empty() { None } else { Some(api_key) };
    match provider.as_str() {
        "openai" => config.openai_api_key = key_value,
        "groq" => config.groq_api_key = key_value,
        "elevenlabs" => config.elevenlabs_api_key = key_value,
        _ => return Err(format!("Unknown provider: {}", provider)),
    }

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize auth config: {}", e))?;

    fs::write(&auth_config_path, content)
        .map_err(|e| format!("Failed to write auth config: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_api_key(
    app: AppHandle,
    provider: String,
) -> Result<Option<String>, String> {
    let config = get_auth_config(app).await?;

    let key = match provider.as_str() {
        "openai" => config.openai_api_key,
        "groq" => config.groq_api_key,
        "elevenlabs" => config.elevenlabs_api_key,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    Ok(key)
}

#[tauri::command]
async fn delete_api_key(
    app: AppHandle,
    provider: String,
) -> Result<(), String> {
    save_api_key(app, provider, String::new()).await
}

// ASR-related structures
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AsrModel {
    pub engine: String,
    pub model_id: String,
    pub display_name: String,
    pub size: String,
    pub installed: bool,
    pub downloading: bool,
    pub download_progress: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AsrEnvironmentStatus {
    pub python_installed: bool,
    pub python_version: Option<String>,
    pub gpu_available: bool,
    pub gpu_name: Option<String>,
    pub installed_models: Vec<AsrModel>,
    pub environment_ready: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptionConfig {
    pub input_file: String,
    pub engine: String,
    pub language: String,
    pub model: String,
    pub output_format: String,
    pub hardware_mode: String,
    pub vad_enabled: bool,
    pub demucs_enabled: bool,
    pub enable_punctuation: bool,
    pub max_seconds: i32,
    pub max_chars: i32,
    pub traditional_chinese: bool,
    pub auto_segment: bool,
}

fn check_gpu_availability() -> (bool, Option<String>) {
    // Check for NVIDIA GPU (CUDA)
    if let Ok(output) = Command::new("nvidia-smi")
        .arg("--query-gpu=name")
        .arg("--format=csv,noheader")
        .output()
    {
        if output.status.success() {
            let gpu_name = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if !gpu_name.is_empty() {
                return (true, Some(gpu_name));
            }
        }
    }

    // Check for AMD GPU (ROCm)
    if let Ok(output) = Command::new("rocm-smi")
        .arg("--showproductname")
        .output()
    {
        if output.status.success() {
            return (true, Some("AMD GPU (ROCm)".to_string()));
        }
    }

    // Check for Apple Silicon
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("sysctl")
            .arg("-n")
            .arg("machdep.cpu.brand_string")
            .output()
        {
            if output.status.success() {
                let cpu_info = String::from_utf8_lossy(&output.stdout);
                if cpu_info.contains("Apple") {
                    return (true, Some("Apple Silicon (Metal)".to_string()));
                }
            }
        }
    }

    (false, None)
}

#[tauri::command]
async fn check_asr_environment() -> Result<AsrEnvironmentStatus, String> {
    // Check Python installation
    let python_check = Command::new("python3")
        .arg("--version")
        .output();

    let (python_installed, python_version) = match python_check {
        Ok(output) => {
            let version_str = String::from_utf8_lossy(&output.stdout);
            let version = version_str.trim().replace("Python ", "");
            (true, Some(version))
        }
        Err(_) => (false, None),
    };

    // Check GPU availability
    use std::env;
    let (gpu_available, gpu_name) = check_gpu_availability();

    // Check for installed models
    let home_dir = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .unwrap_or_else(|_| String::from("."));

    let home_path = PathBuf::from(&home_dir);
    let whisper_cache = home_path.join(".cache/whisper");

    // Define available models
    let model_specs = [
        ("whisper", "tiny", "Whisper Tiny", "75 MB"),
        ("whisper", "base", "Whisper Base", "145 MB"),
        ("whisper", "small", "Whisper Small", "466 MB"),
        ("whisper", "medium", "Whisper Medium", "1.5 GB"),
        ("whisper", "large", "Whisper Large", "3.1 GB"),
        ("qwen", "qwen3-asr-base", "Qwen3-ASR-Base", "500 MB"),
        ("qwen", "qwen3-asr-large", "Qwen3-ASR-Large", "1.2 GB"),
    ];

    let installed_models: Vec<AsrModel> = model_specs
        .iter()
        .map(|(engine, model_id, display_name, size)| {
            let installed = match *engine {
                "whisper" => whisper_cache.join(format!("{}.pt", model_id)).exists(),
                "qwen" => {
                    // Check if FunASR models are available
                    home_path.join(".cache/modelscope/hub/iic").exists()
                }
                _ => false,
            };

            AsrModel {
                engine: engine.to_string(),
                model_id: model_id.to_string(),
                display_name: display_name.to_string(),
                size: size.to_string(),
                installed,
                downloading: false,
                download_progress: 0.0,
            }
        })
        .collect();

    Ok(AsrEnvironmentStatus {
        python_installed,
        python_version,
        gpu_available,
        gpu_name,
        installed_models,
        environment_ready: python_installed,
    })
}

#[tauri::command]
async fn install_asr_environment() -> Result<(), String> {
    use std::env;

    // Get the scripts/asr directory
    let exe_dir = env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;
    let exe_parent = exe_dir.parent()
        .ok_or("Failed to get executable parent directory")?;

    // Try multiple possible locations for the scripts directory
    let possible_paths = [
        exe_parent.join("../scripts/asr"),
        exe_parent.join("../../scripts/asr"),
        exe_parent.join("../../../scripts/asr"),
        PathBuf::from("./scripts/asr"),
        PathBuf::from("../scripts/asr"),
    ];

    let script_dir = possible_paths.iter()
        .find(|p| p.join("setup_environment.sh").exists())
        .ok_or("Could not find scripts/asr directory")?;

    let setup_script = script_dir.join("setup_environment.sh");

    // Make script executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&setup_script)
            .map_err(|e| format!("Failed to get script permissions: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&setup_script, perms)
            .map_err(|e| format!("Failed to set script permissions: {}", e))?;
    }

    // Execute setup script
    let output = Command::new("bash")
        .arg(&setup_script)
        .current_dir(script_dir)
        .output()
        .map_err(|e| format!("Failed to execute setup script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Environment setup failed: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
async fn list_asr_models() -> Result<Vec<AsrModel>, String> {
    // Return available models
    check_asr_environment()
        .await
        .map(|status| status.installed_models)
}

#[tauri::command]
async fn download_asr_model(engine: String, model: String) -> Result<(), String> {
    use std::env;

    // Get the scripts/asr directory
    let exe_dir = env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;
    let exe_parent = exe_dir.parent()
        .ok_or("Failed to get executable parent directory")?;

    let possible_paths = [
        exe_parent.join("../scripts/asr"),
        exe_parent.join("../../scripts/asr"),
        exe_parent.join("../../../scripts/asr"),
        PathBuf::from("./scripts/asr"),
        PathBuf::from("../scripts/asr"),
    ];

    let script_dir = possible_paths.iter()
        .find(|p| p.exists())
        .ok_or("Could not find scripts/asr directory")?;

    let venv_python = script_dir.join("venv/bin/python3");
    let python_cmd = if venv_python.exists() {
        venv_python.to_str().unwrap_or("python3")
    } else {
        "python3"
    };

    // Download model using Python
    let download_script = match engine.as_str() {
        "whisper" => {
            // Whisper models are downloaded automatically on first use
            format!(
                r#"import whisper; whisper.load_model('{}'); print('Model {} downloaded successfully')"#,
                model, model
            )
        }
        "qwen" => {
            // Qwen models from FunASR
            let model_name = match model.as_str() {
                "qwen3-asr-base" => "iic/Qwen2Audio-7B-Instruct",
                "qwen3-asr-large" => "iic/Qwen2Audio-7B-Instruct",
                _ => return Err(format!("Unknown Qwen model: {}", model)),
            };
            format!(
                r#"from funasr import AutoModel; AutoModel(model='{}', disable_update=True); print('Model downloaded successfully')"#,
                model_name
            )
        }
        _ => return Err(format!("Unknown engine: {}", engine)),
    };

    let output = Command::new(python_cmd)
        .arg("-c")
        .arg(&download_script)
        .output()
        .map_err(|e| format!("Failed to execute Python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Model download failed: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
async fn delete_asr_model(engine: String, model: String) -> Result<(), String> {
    use std::env;

    // Get user's home directory for model cache
    let home_dir = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map_err(|_| "Could not determine home directory".to_string())?;

    let home_path = PathBuf::from(home_dir);

    // Whisper models are stored in ~/.cache/whisper/
    // Qwen/FunASR models are stored in ~/.cache/modelscope/ or similar
    let model_path = match engine.as_str() {
        "whisper" => {
            home_path.join(".cache/whisper").join(format!("{}.pt", model))
        }
        "qwen" => {
            // FunASR/modelscope cache location
            home_path.join(".cache/modelscope/hub")
        }
        _ => return Err(format!("Unknown engine: {}", engine)),
    };

    if !model_path.exists() {
        return Err(format!("Model not found: {}", model_path.display()));
    }

    fs::remove_file(&model_path)
        .or_else(|_| fs::remove_dir_all(&model_path))
        .map_err(|e| format!("Failed to delete model: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_file_duration(path: String) -> Result<f64, String> {
    // Use ffprobe to get file duration
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &path
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    if !output.status.success() {
        return Err("Failed to get file duration".to_string());
    }

    let duration_str = String::from_utf8_lossy(&output.stdout);
    let duration: f64 = duration_str
        .trim()
        .parse()
        .map_err(|e| format!("Failed to parse duration: {}", e))?;

    Ok(duration)
}

#[tauri::command]
async fn get_file_size(path: String) -> Result<u64, String> {
    let metadata = fs::metadata(&path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;

    Ok(metadata.len())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudSegmentProgress {
    pub current_segment: usize,
    pub total_segments: usize,
    pub percentage: f64,
}

async fn split_audio_for_cloud(input_path: &str, max_size_mb: u64) -> Result<Vec<String>, String> {
    // Get file size
    let metadata = fs::metadata(input_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    let file_size_mb = metadata.len() / (1024 * 1024);

    if file_size_mb <= max_size_mb {
        // File is small enough, no need to split
        return Ok(vec![input_path.to_string()]);
    }

    // Split file using FFmpeg
    let input_pathbuf = PathBuf::from(input_path);
    let parent_dir = input_pathbuf.parent()
        .ok_or("Invalid input path")?;
    let file_stem = input_pathbuf.file_stem()
        .ok_or("Invalid file name")?
        .to_string_lossy();

    // Calculate segment duration (aim for max_size_mb - 1 MB buffer)
    let target_size_mb = max_size_mb - 1;
    let total_segments = ((file_size_mb as f64) / (target_size_mb as f64)).ceil() as usize;

    // Get file duration
    let duration_output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            input_path
        ])
        .output()
        .map_err(|e| format!("Failed to run ffprobe: {}", e))?;

    let duration_str = String::from_utf8_lossy(&duration_output.stdout);
    let total_duration: f64 = duration_str.trim().parse()
        .map_err(|e| format!("Failed to parse duration: {}", e))?;

    let segment_duration = total_duration / (total_segments as f64);

    // Split file into segments
    let mut segment_paths = Vec::new();
    for i in 0..total_segments {
        let start_time = i as f64 * segment_duration;
        let segment_path = parent_dir.join(format!("{}_segment_{:03}.mp3", file_stem, i));

        let output = Command::new("ffmpeg")
            .args([
                "-i", input_path,
                "-ss", &format!("{:.2}", start_time),
                "-t", &format!("{:.2}", segment_duration),
                "-c:a", "libmp3lame",
                "-b:a", "128k",
                "-y",
                segment_path.to_str().ok_or("Invalid segment path")?
            ])
            .output()
            .map_err(|e| format!("Failed to split audio: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg split failed: {}", stderr));
        }

        segment_paths.push(segment_path.to_string_lossy().to_string());
    }

    Ok(segment_paths)
}

async fn upload_to_openai(
    api_key: &str,
    file_path: &str,
    language: &str,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();

    let file_bytes = fs::read(file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let file_name = PathBuf::from(file_path)
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();

    let file_part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str("audio/mpeg")
        .map_err(|e| format!("Failed to create file part: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", "whisper-1")
        .text("response_format", "verbose_json");

    if language != "auto" {
        form = form.text("language", language.to_string());
    }

    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    let status = response.status();
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("API Key 無效，請檢查後重試".to_string());
        } else if status.as_u16() == 429 {
            return Err("API 額度已用盡，請檢查帳戶餘額".to_string());
        } else {
            return Err(format!("API 請求失敗: {} - {}", status, response_text));
        }
    }

    serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {}", e))
}

async fn upload_to_groq(
    api_key: &str,
    file_path: &str,
    language: &str,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();

    let file_bytes = fs::read(file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let file_name = PathBuf::from(file_path)
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();

    let file_part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str("audio/mpeg")
        .map_err(|e| format!("Failed to create file part: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .text("model", "whisper-large-v3")
        .text("response_format", "verbose_json");

    if language != "auto" {
        form = form.text("language", language.to_string());
    }

    let response = client
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    let status = response.status();
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("API Key 無效，請檢查後重試".to_string());
        } else if status.as_u16() == 429 {
            return Err("API 額度已用盡，請檢查帳戶餘額".to_string());
        } else {
            return Err(format!("API 請求失敗: {} - {}", status, response_text));
        }
    }

    serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {}", e))
}

async fn upload_to_elevenlabs(
    api_key: &str,
    file_path: &str,
    language: &str,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();

    let file_bytes = fs::read(file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let file_name = PathBuf::from(file_path)
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();

    let file_part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str("audio/mpeg")
        .map_err(|e| format!("Failed to create file part: {}", e))?;

    let mut form = reqwest::multipart::Form::new()
        .part("audio", file_part)
        .text("model_id", "scribe_v2");

    if language != "auto" {
        form = form.text("language", language.to_string());
    }

    let response = client
        .post("https://api.elevenlabs.io/v1/audio-to-text")
        .header("xi-api-key", api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    let status = response.status();
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("API Key 無效，請檢查後重試".to_string());
        } else if status.as_u16() == 429 {
            return Err("API 額度已用盡，請檢查帳戶餘額".to_string());
        } else {
            return Err(format!("API 請求失敗: {} - {}", status, response_text));
        }
    }

    serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {}", e))
}

fn generate_srt_from_openai(response: &serde_json::Value) -> Result<String, String> {
    let segments = response.get("segments")
        .and_then(|v| v.as_array())
        .ok_or("No segments in response")?;

    let mut srt = String::new();
    for (i, segment) in segments.iter().enumerate() {
        let start = segment.get("start")
            .and_then(|v| v.as_f64())
            .ok_or("Missing start time")?;
        let end = segment.get("end")
            .and_then(|v| v.as_f64())
            .ok_or("Missing end time")?;
        let text = segment.get("text")
            .and_then(|v| v.as_str())
            .ok_or("Missing text")?;

        srt.push_str(&format!("{}\n", i + 1));
        srt.push_str(&format!("{} --> {}\n", format_srt_time(start), format_srt_time(end)));
        srt.push_str(&format!("{}\n\n", text.trim()));
    }

    Ok(srt)
}

fn generate_srt_from_elevenlabs(response: &serde_json::Value) -> Result<String, String> {
    let words = response.get("words")
        .and_then(|v| v.as_array())
        .ok_or("No words in response")?;

    // Group words into subtitle segments (every 10 words or at punctuation)
    let mut srt = String::new();
    let mut current_segment = Vec::new();
    let mut segment_index = 1;

    for word_obj in words {
        let word = word_obj.get("text")
            .and_then(|v| v.as_str())
            .ok_or("Missing word text")?;
        let start = word_obj.get("start")
            .and_then(|v| v.as_f64())
            .ok_or("Missing start time")?;
        let end = word_obj.get("end")
            .and_then(|v| v.as_f64())
            .ok_or("Missing end time")?;

        current_segment.push((word, start, end));

        // End segment at punctuation or after 10 words
        let should_end = word.ends_with('.') || word.ends_with('?') || word.ends_with('!') ||
                         word.ends_with('。') || word.ends_with('？') || word.ends_with('！') ||
                         current_segment.len() >= 10;

        if should_end && !current_segment.is_empty() {
            let first_start = current_segment[0].1;
            let last_end = current_segment[current_segment.len() - 1].2;
            let text: String = current_segment.iter()
                .map(|(w, _, _)| *w)
                .collect::<Vec<_>>()
                .join(" ");

            srt.push_str(&format!("{}\n", segment_index));
            srt.push_str(&format!("{} --> {}\n", format_srt_time(first_start), format_srt_time(last_end)));
            srt.push_str(&format!("{}\n\n", text.trim()));

            segment_index += 1;
            current_segment.clear();
        }
    }

    // Handle remaining words
    if !current_segment.is_empty() {
        let first_start = current_segment[0].1;
        let last_end = current_segment[current_segment.len() - 1].2;
        let text: String = current_segment.iter()
            .map(|(w, _, _)| *w)
            .collect::<Vec<_>>()
            .join(" ");

        srt.push_str(&format!("{}\n", segment_index));
        srt.push_str(&format!("{} --> {}\n", format_srt_time(first_start), format_srt_time(last_end)));
        srt.push_str(&format!("{}\n\n", text.trim()));
    }

    Ok(srt)
}

fn format_srt_time(seconds: f64) -> String {
    let total_seconds = seconds as u64;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let secs = total_seconds % 60;
    let millis = ((seconds - total_seconds as f64) * 1000.0) as u64;

    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, secs, millis)
}

fn merge_transcriptions_with_offset(
    segments: &[serde_json::Value],
    segment_durations: &[f64]
) -> Result<serde_json::Value, String> {
    let mut merged_segments = Vec::new();
    let mut time_offset = 0.0;

    for (i, response) in segments.iter().enumerate() {
        if let Some(segs) = response.get("segments").and_then(|v| v.as_array()) {
            for seg in segs {
                let mut new_seg = seg.clone();
                if let Some(obj) = new_seg.as_object_mut() {
                    // Adjust timestamps
                    if let Some(start) = obj.get("start").and_then(|v| v.as_f64()) {
                        obj.insert("start".to_string(), serde_json::Value::from(start + time_offset));
                    }
                    if let Some(end) = obj.get("end").and_then(|v| v.as_f64()) {
                        obj.insert("end".to_string(), serde_json::Value::from(end + time_offset));
                    }
                }
                merged_segments.push(new_seg);
            }
        }

        if i < segment_durations.len() {
            time_offset += segment_durations[i];
        }
    }

    Ok(serde_json::json!({
        "segments": merged_segments,
        "text": merged_segments.iter()
            .filter_map(|s| s.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join(" ")
    }))
}

#[tauri::command]
async fn start_cloud_transcription(config: TranscriptionConfig, app: AppHandle) -> Result<(), String> {
    // Validate engine
    let provider = match config.engine.as_str() {
        "openai" | "groq" | "elevenlabs" => config.engine.clone(),
        _ => return Err(format!("Unsupported cloud engine: {}", config.engine))
    };

    // Get API key from auth config
    let auth_config = get_auth_config(app.clone()).await?;

    let api_key = match provider.as_str() {
        "openai" => auth_config.openai_api_key
            .ok_or("請先在設定中輸入 OpenAI API Key")?,
        "groq" => auth_config.groq_api_key
            .ok_or("請先在設定中輸入 Groq API Key")?,
        "elevenlabs" => auth_config.elevenlabs_api_key
            .ok_or("請先在設定中輸入 ElevenLabs API Key")?,
        _ => unreachable!()
    };

    // Determine file size limit based on provider
    let max_size_mb = match provider.as_str() {
        "openai" | "groq" => 25,
        "elevenlabs" => 1024, // 1 GB
        _ => unreachable!()
    };

    // Split file if needed
    let segment_paths = if config.auto_segment {
        split_audio_for_cloud(&config.input_file, max_size_mb).await?
    } else {
        // Check file size
        let metadata = fs::metadata(&config.input_file)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?;
        let file_size_mb = metadata.len() / (1024 * 1024);

        if file_size_mb > max_size_mb {
            return Err("檔案過大，請啟用自動分段或嘗試使用本地引擎".to_string());
        }

        vec![config.input_file.clone()]
    };

    let total_segments = segment_paths.len();
    let mut transcription_results = Vec::new();
    let mut segment_durations = Vec::new();

    // Process each segment
    for (i, segment_path) in segment_paths.iter().enumerate() {
        // Emit progress
        let progress = CloudSegmentProgress {
            current_segment: i + 1,
            total_segments,
            percentage: ((i as f64) / (total_segments as f64)) * 100.0,
        };
        let _ = app.emit("cloud-transcription-progress", &progress);

        // Get segment duration for offset calculation
        let duration_output = Command::new("ffprobe")
            .args([
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                segment_path
            ])
            .output()
            .map_err(|e| format!("Failed to get segment duration: {}", e))?;

        let duration_str = String::from_utf8_lossy(&duration_output.stdout);
        let duration: f64 = duration_str.trim().parse()
            .unwrap_or(0.0);
        segment_durations.push(duration);

        // Upload to API
        let result = match provider.as_str() {
            "openai" => upload_to_openai(&api_key, segment_path, &config.language).await,
            "groq" => upload_to_groq(&api_key, segment_path, &config.language).await,
            "elevenlabs" => upload_to_elevenlabs(&api_key, segment_path, &config.language).await,
            _ => unreachable!()
        };

        match result {
            Ok(response) => {
                transcription_results.push(response);
            }
            Err(e) => {
                // Clean up temporary segments
                if total_segments > 1 {
                    for path in &segment_paths {
                        if path != &config.input_file {
                            let _ = fs::remove_file(path);
                        }
                    }
                }

                // Emit error event
                let error_payload = serde_json::json!({
                    "message": format!("Segment {} failed: {}", i + 1, e)
                });
                let _ = app.emit("transcription-error", &error_payload);

                return Err(format!("Segment {} transcription failed: {}", i + 1, e));
            }
        }
    }

    // Merge results if multiple segments
    let final_result = if transcription_results.len() > 1 {
        merge_transcriptions_with_offset(&transcription_results, &segment_durations)?
    } else {
        transcription_results.into_iter().next()
            .ok_or("No transcription result")?
    };

    // Generate output files
    let input_pathbuf = PathBuf::from(&config.input_file);
    let parent_dir = input_pathbuf.parent()
        .ok_or("Invalid input path")?;
    let file_stem = input_pathbuf.file_stem()
        .ok_or("Invalid file name")?
        .to_string_lossy();

    let mut output_paths = Vec::new();

    // Generate SRT
    if config.output_format == "srt" || config.output_format == "both" {
        let srt_content = match provider.as_str() {
            "openai" | "groq" => generate_srt_from_openai(&final_result)?,
            "elevenlabs" => generate_srt_from_elevenlabs(&final_result)?,
            _ => unreachable!()
        };

        let srt_path = parent_dir.join(format!("{}.srt", file_stem));
        fs::write(&srt_path, srt_content)
            .map_err(|e| format!("Failed to write SRT file: {}", e))?;
        output_paths.push(srt_path.to_string_lossy().to_string());
    }

    // Generate TXT
    if config.output_format == "txt" || config.output_format == "both" {
        let text = final_result.get("text")
            .and_then(|v| v.as_str())
            .ok_or("No text in response")?;

        let txt_path = parent_dir.join(format!("{}.txt", file_stem));
        fs::write(&txt_path, text)
            .map_err(|e| format!("Failed to write TXT file: {}", e))?;
        output_paths.push(txt_path.to_string_lossy().to_string());
    }

    // Clean up temporary segments
    if segment_paths.len() > 1 {
        for path in &segment_paths {
            if path != &config.input_file {
                let _ = fs::remove_file(path);
            }
        }
    }

    // Emit completion event
    let complete_payload = serde_json::json!({
        "output_path": output_paths.join(", ")
    });
    let _ = app.emit("transcription-complete", &complete_payload);

    Ok(())
}

#[tauri::command]
async fn start_transcription(
    config: TranscriptionConfig,
    app: AppHandle,
) -> Result<(), String> {
    // Route to cloud transcription if using cloud engine
    if config.engine == "openai" || config.engine == "groq" || config.engine == "elevenlabs" {
        return start_cloud_transcription(config, app).await;
    }

    use std::env;
    use std::io::{BufRead, BufReader};

    // Get the scripts/asr directory
    let exe_dir = env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;
    let exe_parent = exe_dir.parent()
        .ok_or("Failed to get executable parent directory")?;

    let possible_paths = [
        exe_parent.join("../scripts/asr"),
        exe_parent.join("../../scripts/asr"),
        exe_parent.join("../../../scripts/asr"),
        PathBuf::from("./scripts/asr"),
        PathBuf::from("../scripts/asr"),
    ];

    let script_dir = possible_paths.iter()
        .find(|p| p.exists())
        .ok_or("Could not find scripts/asr directory")?;

    let transcribe_script = script_dir.join("transcribe.py");
    if !transcribe_script.exists() {
        return Err("Transcription script not found".to_string());
    }

    let venv_python = script_dir.join("venv/bin/python3");
    let python_cmd = if venv_python.exists() {
        venv_python
    } else {
        PathBuf::from("python3")
    };

    // Prepare configuration with output directory
    let mut exec_config = serde_json::to_value(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Add output directory based on settings or input file location
    if let Some(obj) = exec_config.as_object_mut() {
        if !obj.contains_key("output_dir") {
            let input_path = PathBuf::from(&config.input_file);
            if let Some(parent) = input_path.parent() {
                obj.insert(
                    "output_dir".to_string(),
                    serde_json::Value::String(parent.to_string_lossy().to_string())
                );
            }
        }
    }

    let config_json = serde_json::to_string(&exec_config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    // Start Python process
    let mut child = Command::new(&python_cmd)
        .arg(&transcribe_script)
        .arg("--config")
        .arg(&config_json)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start transcription process: {}", e))?;

    // Get stdout for reading progress
    let stdout = child.stdout.take()
        .ok_or("Failed to capture stdout".to_string())?;

    let reader = BufReader::new(stdout);

    // Read progress updates line by line
    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read output: {}", e))?;

        // Parse JSON line
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            let msg_type = json.get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match msg_type {
                "progress" => {
                    // Emit progress event to frontend
                    let _ = app.emit("transcription-progress", &json);
                }
                "complete" => {
                    // Emit completion event
                    let _ = app.emit("transcription-complete", &json);
                }
                "error" => {
                    let message = json.get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error")
                        .to_string();

                    // Emit error event
                    let _ = app.emit("transcription-error", &json);

                    return Err(message);
                }
                _ => {}
            }
        }
    }

    // Wait for process to complete
    let status = child.wait()
        .map_err(|e| format!("Failed to wait for process: {}", e))?;

    if !status.success() {
        return Err("Transcription process failed".to_string());
    }

    Ok(())
}

// Records management commands
#[tauri::command]
fn get_local_records(app: AppHandle) -> Result<RecordsData, String> {
    let records_path = get_records_path(&app)?;

    if !records_path.exists() {
        // Return empty data if file doesn't exist
        return Ok(RecordsData {
            records: Vec::new(),
            folders: Vec::new(),
            folder_order: Vec::new(),
        });
    }

    let content = fs::read_to_string(&records_path)
        .map_err(|e| format!("Failed to read records file: {}", e))?;

    let data: RecordsData = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse records file: {}", e))?;

    Ok(data)
}

#[tauri::command]
fn save_local_records(app: AppHandle, data: RecordsData) -> Result<(), String> {
    let records_path = get_records_path(&app)?;

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize records: {}", e))?;

    fs::write(&records_path, content)
        .map_err(|e| format!("Failed to write records file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn create_folder(app: AppHandle, name: String) -> Result<Folder, String> {
    if name.trim().is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }

    let mut data = get_local_records(app.clone())?;

    let folder = Folder {
        id: format!("folder-{}", Utc::now().timestamp_millis()),
        name,
        created: Utc::now().to_rfc3339(),
        sort_order: data.folders.len() as i32,
    };

    data.folders.push(folder.clone());
    data.folder_order.push(folder.id.clone());

    save_local_records(app, data)?;

    Ok(folder)
}

#[tauri::command]
fn update_folder(app: AppHandle, folder: Folder) -> Result<(), String> {
    let mut data = get_local_records(app.clone())?;

    if let Some(pos) = data.folders.iter().position(|f| f.id == folder.id) {
        data.folders[pos] = folder;
        save_local_records(app, data)?;
        Ok(())
    } else {
        Err("Folder not found".to_string())
    }
}

#[tauri::command]
fn delete_folder(app: AppHandle, id: String) -> Result<(), String> {
    let mut data = get_local_records(app.clone())?;

    // Move all records in this folder to uncategorized
    for record in &mut data.records {
        if record.folder_id.as_ref() == Some(&id) {
            record.folder_id = None;
        }
    }

    // Remove folder
    data.folders.retain(|f| f.id != id);
    data.folder_order.retain(|fid| fid != &id);

    save_local_records(app, data)?;

    Ok(())
}

#[tauri::command]
fn update_record(app: AppHandle, record: Record) -> Result<(), String> {
    let mut data = get_local_records(app.clone())?;

    if let Some(pos) = data.records.iter().position(|r| r.id == record.id) {
        data.records[pos] = record;
        save_local_records(app, data)?;
        Ok(())
    } else {
        Err("Record not found".to_string())
    }
}

#[tauri::command]
fn delete_record(app: AppHandle, id: String) -> Result<(), String> {
    let mut data = get_local_records(app.clone())?;

    data.records.retain(|r| r.id != id);

    save_local_records(app, data)?;

    Ok(())
}

#[tauri::command]
fn search_records(app: AppHandle, query: String) -> Result<Vec<Record>, String> {
    let data = get_local_records(app)?;

    if query.trim().is_empty() {
        return Ok(data.records);
    }

    let query_lower = query.to_lowercase();
    let filtered: Vec<Record> = data.records
        .into_iter()
        .filter(|r| {
            r.title.to_lowercase().contains(&query_lower)
                || r.topic.to_lowercase().contains(&query_lower)
                || r.channel_url.to_lowercase().contains(&query_lower)
        })
        .collect();

    Ok(filtered)
}

#[tauri::command]
fn reorder_folders(app: AppHandle, folder_order: Vec<String>) -> Result<(), String> {
    let mut data = get_local_records(app.clone())?;

    data.folder_order = folder_order;

    // Update sort_order based on position in folder_order
    for (index, folder_id) in data.folder_order.iter().enumerate() {
        if let Some(folder) = data.folders.iter_mut().find(|f| &f.id == folder_id) {
            folder.sort_order = index as i32;
        }
    }

    save_local_records(app, data)?;

    Ok(())
}

// Scheduled Downloads commands
#[tauri::command]
fn get_scheduled_presets(app: AppHandle) -> Result<Vec<DownloadPreset>, String> {
    let presets_path = get_scheduled_presets_path(&app)?;

    if !presets_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&presets_path)
        .map_err(|e| format!("Failed to read presets file: {}", e))?;

    let presets: Vec<DownloadPreset> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse presets file: {}", e))?;

    Ok(presets)
}

#[tauri::command]
fn save_scheduled_preset(app: AppHandle, preset: DownloadPreset) -> Result<(), String> {
    let mut presets = get_scheduled_presets(app.clone())?;

    // Validate output directory exists
    if !preset.output_dir.is_empty() {
        let expanded = if preset.output_dir.starts_with('~') {
            if let Some(home) = std::env::var("HOME").ok()
                .or_else(|| std::env::var("USERPROFILE").ok()) {
                preset.output_dir.replacen('~', &home, 1)
            } else {
                preset.output_dir.clone()
            }
        } else {
            preset.output_dir.clone()
        };
        let output_path = Path::new(&expanded);
        if !output_path.exists() {
            return Err("輸出資料夾無效".to_string());
        }
    }

    // Upsert: replace existing or push new
    if let Some(pos) = presets.iter().position(|p| p.id == preset.id) {
        presets[pos] = preset;
    } else {
        presets.push(preset);
    }

    let presets_path = get_scheduled_presets_path(&app)?;
    let content = serde_json::to_string_pretty(&presets)
        .map_err(|e| format!("Failed to serialize presets: {}", e))?;

    fs::write(&presets_path, content)
        .map_err(|e| format!("Failed to write presets file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn delete_scheduled_preset(app: AppHandle, id: String) -> Result<(), String> {
    let mut presets = get_scheduled_presets(app.clone())?;
    presets.retain(|p| p.id != id);

    let presets_path = get_scheduled_presets_path(&app)?;
    let content = serde_json::to_string_pretty(&presets)
        .map_err(|e| format!("Failed to serialize presets: {}", e))?;

    fs::write(&presets_path, content)
        .map_err(|e| format!("Failed to write presets file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn toggle_preset_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let mut presets = get_scheduled_presets(app.clone())?;

    if let Some(preset) = presets.iter_mut().find(|p| p.id == id) {
        preset.enabled = enabled;
    } else {
        return Err("找不到此預設".to_string());
    }

    let presets_path = get_scheduled_presets_path(&app)?;
    let content = serde_json::to_string_pretty(&presets)
        .map_err(|e| format!("Failed to serialize presets: {}", e))?;

    fs::write(&presets_path, content)
        .map_err(|e| format!("Failed to write presets file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn resolve_channel_info(url: String) -> Result<ChannelInfo, String> {
    let url = url.trim();

    // YouTube channel patterns
    let yt_channel_id = Regex::new(r"youtube\.com/channel/([a-zA-Z0-9_-]+)").unwrap();
    let yt_handle = Regex::new(r"youtube\.com/@([a-zA-Z0-9_.-]+)").unwrap();
    let yt_user = Regex::new(r"youtube\.com/user/([a-zA-Z0-9_-]+)").unwrap();
    // Twitch channel pattern
    let twitch_ch = Regex::new(r"(?:https?://)?(?:www\.)?twitch\.tv/([a-zA-Z0-9_]+)(?:/|$)?").unwrap();

    // Determine platform and build canonical URL for yt-dlp
    let (platform, canonical_url) = if yt_channel_id.is_match(url)
        || yt_handle.is_match(url)
        || yt_user.is_match(url)
        || url.contains("youtube.com")
    {
        ("youtube", url.to_string())
    } else if twitch_ch.is_match(url) || url.contains("twitch.tv") {
        ("twitch", url.to_string())
    } else {
        return Err("無法辨識此頻道".to_string());
    };

    // Use yt-dlp to get channel metadata
    // Pass --playlist-items 1 to limit data fetched; use --dump-single-json for channel pages
    let output = Command::new("yt-dlp")
        .args([
            "--dump-single-json",
            "--flat-playlist",
            "--playlist-items",
            "1",
            "--no-warnings",
            &canonical_url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(result) => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);

            if !result.status.success() || stdout.trim().is_empty() {
                // Try fallback: maybe the URL points to a single video/stream
                // Extract channel info from stderr hints or URL itself
                let _ = stderr; // acknowledge

                // For Twitch, extract login from URL directly
                if platform == "twitch" {
                    if let Some(caps) = twitch_ch.captures(url) {
                        let login = caps[1].to_string();
                        return Ok(ChannelInfo {
                            channel_id: login.clone(),
                            channel_name: login,
                            platform: "twitch".to_string(),
                        });
                    }
                }
                return Err("無法辨識此頻道".to_string());
            }

            let json_str = stdout.trim();
            // Handle multiple JSON objects (newline-delimited); take first
            let first_line = json_str.lines().next().unwrap_or(json_str);
            let json: serde_json::Value = serde_json::from_str(first_line)
                .map_err(|_| "無法辨識此頻道".to_string())?;

            if platform == "youtube" {
                // For channel pages, uploader_id or channel_id field holds the ID
                let channel_id = json.get("channel_id")
                    .or_else(|| json.get("uploader_id"))
                    .or_else(|| json.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let channel_name = json.get("channel")
                    .or_else(|| json.get("uploader"))
                    .or_else(|| json.get("title"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown")
                    .to_string();

                if channel_id.is_empty() {
                    return Err("無法辨識此頻道".to_string());
                }

                Ok(ChannelInfo {
                    channel_id,
                    channel_name,
                    platform: "youtube".to_string(),
                })
            } else {
                // Twitch
                let channel_id = json.get("channel_id")
                    .or_else(|| json.get("uploader_id"))
                    .or_else(|| json.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                // Extract fallback login from URL first
                let url_login = twitch_ch.captures(url)
                    .map(|caps| caps[1].to_string());

                let channel_name = json.get("channel")
                    .or_else(|| json.get("uploader"))
                    .or_else(|| json.get("title"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| url_login.clone())
                    .unwrap_or_else(|| "Unknown".to_string());

                let final_channel_id = if channel_id.is_empty() {
                    if let Some(login) = url_login {
                        login
                    } else {
                        return Err("無法辨識此頻道".to_string());
                    }
                } else {
                    channel_id
                };

                Ok(ChannelInfo {
                    channel_id: final_channel_id,
                    channel_name,
                    platform: "twitch".to_string(),
                })
            }
        }
        Err(_) => Err("找不到 yt-dlp，請安裝後再試".to_string()),
    }
}

// Cloud Sync commands
#[tauri::command]
fn get_sync_state(app: AppHandle) -> Result<SyncState, String> {
    let sync_state_path = get_sync_state_path(&app)?;

    if !sync_state_path.exists() {
        // Return default state if file doesn't exist
        return Ok(SyncState {
            jwt: None,
            user: None,
            last_synced_at: "1970-01-01T00:00:00.000Z".to_string(),
            status: "offline".to_string(),
        });
    }

    let content = fs::read_to_string(&sync_state_path)
        .map_err(|e| format!("Failed to read sync state file: {}", e))?;

    let state: SyncState = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse sync state file: {}", e))?;

    Ok(state)
}

#[tauri::command]
fn save_sync_state(app: AppHandle, state: SyncState) -> Result<(), String> {
    let sync_state_path = get_sync_state_path(&app)?;

    let content = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize sync state: {}", e))?;

    fs::write(&sync_state_path, content)
        .map_err(|e| format!("Failed to write sync state file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn exchange_google_token(google_token: String) -> Result<GoogleAuthResponse, String> {
    // Get API URL from environment or use default
    // In production, this should be configured via .env file or app config
    let api_url = std::env::var("CLOUD_SYNC_API_URL")
        .unwrap_or_else(|_| "https://tidemark-sync.hydai.workers.dev".to_string());

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/auth/google", api_url))
        .json(&GoogleAuthRequest { token: google_token })
        .send()
        .await
        .map_err(|e| format!("Failed to exchange Google token: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned error: {}", response.status()));
    }

    let auth_response: GoogleAuthResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(auth_response)
}

#[tauri::command]
async fn sync_pull(app: AppHandle) -> Result<SyncResponse, String> {
    let state = get_sync_state(app.clone())?;

    if state.jwt.is_none() || state.user.is_none() {
        return Err("Not logged in".to_string());
    }

    let jwt = state.jwt.unwrap();
    let since = state.last_synced_at;

    // Get API URL from environment or use default
    // In production, this should be configured via .env file or app config
    let api_url = std::env::var("CLOUD_SYNC_API_URL")
        .unwrap_or_else(|_| "https://tidemark-sync.hydai.workers.dev".to_string());

    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/sync?since={}", api_url, urlencoding::encode(&since)))
        .header("Authorization", format!("Bearer {}", jwt))
        .send()
        .await
        .map_err(|e| format!("Failed to pull sync data: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned error: {}", response.status()));
    }

    let sync_response: SyncResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse sync response: {}", e))?;

    Ok(sync_response)
}

#[tauri::command]
async fn sync_push_record(app: AppHandle, record: Record) -> Result<(), String> {
    let state = get_sync_state(app.clone())?;

    if state.jwt.is_none() || state.user.is_none() {
        return Err("Not logged in".to_string());
    }

    let jwt = state.jwt.unwrap();
    let user = state.user.unwrap();

    let now = Utc::now().to_rfc3339();
    let api_record = APIRecord {
        id: record.id,
        user_id: user.id,
        folder_id: record.folder_id,
        timestamp: record.timestamp.clone(),
        live_time: record.live_time,
        title: record.title,
        topic: record.topic,
        channel_url: record.channel_url,
        platform: record.platform,
        sort_order: record.sort_order,
        created_at: record.timestamp,
        updated_at: now,
        deleted: 0,
    };

    // Get API URL from environment or use default
    // In production, this should be configured via .env file or app config
    let api_url = std::env::var("CLOUD_SYNC_API_URL")
        .unwrap_or_else(|_| "https://tidemark-sync.hydai.workers.dev".to_string());

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/records", api_url))
        .header("Authorization", format!("Bearer {}", jwt))
        .json(&api_record)
        .send()
        .await
        .map_err(|e| format!("Failed to push record: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned error: {}", response.status()));
    }

    Ok(())
}

#[tauri::command]
async fn sync_delete_record(app: AppHandle, record_id: String) -> Result<(), String> {
    let state = get_sync_state(app.clone())?;

    if state.jwt.is_none() {
        return Err("Not logged in".to_string());
    }

    let jwt = state.jwt.unwrap();

    // Get API URL from environment or use default
    // In production, this should be configured via .env file or app config
    let api_url = std::env::var("CLOUD_SYNC_API_URL")
        .unwrap_or_else(|_| "https://tidemark-sync.hydai.workers.dev".to_string());

    let client = reqwest::Client::new();
    let response = client
        .delete(format!("{}/records/{}", api_url, record_id))
        .header("Authorization", format!("Bearer {}", jwt))
        .send()
        .await
        .map_err(|e| format!("Failed to delete record: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned error: {}", response.status()));
    }

    Ok(())
}

#[tauri::command]
async fn sync_push_folder(app: AppHandle, folder: Folder) -> Result<(), String> {
    let state = get_sync_state(app.clone())?;

    if state.jwt.is_none() || state.user.is_none() {
        return Err("Not logged in".to_string());
    }

    let jwt = state.jwt.unwrap();
    let user = state.user.unwrap();

    let now = Utc::now().to_rfc3339();
    let api_folder = APIFolder {
        id: folder.id,
        user_id: user.id,
        name: folder.name,
        sort_order: folder.sort_order,
        created_at: folder.created.clone(),
        updated_at: now,
        deleted: 0,
    };

    // Get API URL from environment or use default
    // In production, this should be configured via .env file or app config
    let api_url = std::env::var("CLOUD_SYNC_API_URL")
        .unwrap_or_else(|_| "https://tidemark-sync.hydai.workers.dev".to_string());

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/folders", api_url))
        .header("Authorization", format!("Bearer {}", jwt))
        .json(&api_folder)
        .send()
        .await
        .map_err(|e| format!("Failed to push folder: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned error: {}", response.status()));
    }

    Ok(())
}

#[tauri::command]
async fn sync_delete_folder(app: AppHandle, folder_id: String) -> Result<(), String> {
    let state = get_sync_state(app.clone())?;

    if state.jwt.is_none() {
        return Err("Not logged in".to_string());
    }

    let jwt = state.jwt.unwrap();

    // Get API URL from environment or use default
    // In production, this should be configured via .env file or app config
    let api_url = std::env::var("CLOUD_SYNC_API_URL")
        .unwrap_or_else(|_| "https://tidemark-sync.hydai.workers.dev".to_string());

    let client = reqwest::Client::new();
    let response = client
        .delete(format!("{}/folders/{}", api_url, folder_id))
        .header("Authorization", format!("Bearer {}", jwt))
        .send()
        .await
        .map_err(|e| format!("Failed to delete folder: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API returned error: {}", response.status()));
    }

    Ok(())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(&["/C", "start", &url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn get_app_version() -> Result<String, String> {
    // Get version from Cargo.toml
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
async fn get_tool_versions() -> Result<ToolVersions, String> {
    let mut versions = ToolVersions {
        yt_dlp_version: None,
        ffmpeg_version: None,
        ffprobe_version: None,
    };

    // Get yt-dlp version
    if let Ok(output) = Command::new("yt-dlp")
        .arg("--version")
        .output()
    {
        if output.status.success() {
            if let Ok(version) = String::from_utf8(output.stdout) {
                versions.yt_dlp_version = Some(version.trim().to_string());
            }
        }
    }

    // Get FFmpeg version
    if let Ok(output) = Command::new("ffmpeg")
        .arg("-version")
        .output()
    {
        if output.status.success() {
            if let Ok(version_output) = String::from_utf8(output.stdout) {
                // Extract version from first line (e.g., "ffmpeg version 5.1.2")
                if let Some(first_line) = version_output.lines().next() {
                    if let Some(version_str) = first_line.split_whitespace().nth(2) {
                        versions.ffmpeg_version = Some(version_str.to_string());
                    }
                }
            }
        }
    }

    // Get FFprobe version
    if let Ok(output) = Command::new("ffprobe")
        .arg("-version")
        .output()
    {
        if output.status.success() {
            if let Ok(version_output) = String::from_utf8(output.stdout) {
                // Extract version from first line
                if let Some(first_line) = version_output.lines().next() {
                    if let Some(version_str) = first_line.split_whitespace().nth(2) {
                        versions.ffprobe_version = Some(version_str.to_string());
                    }
                }
            }
        }
    }

    Ok(versions)
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateStatus, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    // For now, we'll implement a simple GitHub API check
    // In production, this should check GitHub releases API
    let client = reqwest::Client::new();

    // Try to fetch latest release from GitHub
    // Note: Replace with actual repository URL when available
    let github_api_url = "https://api.github.com/repos/tidemark/tidemark/releases/latest";

    match client
        .get(github_api_url)
        .header("User-Agent", "Tidemark")
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                if let Ok(json) = response.json::<serde_json::Value>().await {
                    let latest_version = json["tag_name"]
                        .as_str()
                        .unwrap_or(&current_version)
                        .trim_start_matches('v')
                        .to_string();

                    let release_notes = json["body"]
                        .as_str()
                        .map(|s| s.to_string());

                    let download_url = json["html_url"]
                        .as_str()
                        .map(|s| s.to_string());

                    let has_update = latest_version != current_version;

                    return Ok(UpdateStatus {
                        has_update,
                        current_version,
                        latest_version: Some(latest_version),
                        release_notes,
                        download_url,
                    });
                }
            }

            // If GitHub check fails, return no update available
            Ok(UpdateStatus {
                has_update: false,
                current_version: current_version.clone(),
                latest_version: Some(current_version),
                release_notes: None,
                download_url: None,
            })
        }
        Err(_) => {
            // If network error, return current version only
            Ok(UpdateStatus {
                has_update: false,
                current_version: current_version.clone(),
                latest_version: None,
                release_notes: None,
                download_url: None,
            })
        }
    }
}

#[tauri::command]
fn get_available_hardware_encoders() -> Result<Vec<String>, String> {
    // Check for available hardware encoders via ffmpeg
    let mut encoders = vec!["auto".to_string()];

    if let Ok(output) = Command::new("ffmpeg")
        .arg("-encoders")
        .output()
    {
        if output.status.success() {
            if let Ok(encoders_output) = String::from_utf8(output.stdout) {
                // Check for NVIDIA encoders
                if encoders_output.contains("h264_nvenc") {
                    encoders.push("h264_nvenc".to_string());
                }
                if encoders_output.contains("hevc_nvenc") {
                    encoders.push("hevc_nvenc".to_string());
                }

                // Check for AMD encoders
                if encoders_output.contains("h264_amf") {
                    encoders.push("h264_amf".to_string());
                }
                if encoders_output.contains("hevc_amf") {
                    encoders.push("hevc_amf".to_string());
                }

                // Check for Intel Quick Sync
                if encoders_output.contains("h264_qsv") {
                    encoders.push("h264_qsv".to_string());
                }
                if encoders_output.contains("hevc_qsv") {
                    encoders.push("hevc_qsv".to_string());
                }

                // Check for Apple VideoToolbox
                if encoders_output.contains("h264_videotoolbox") {
                    encoders.push("h264_videotoolbox".to_string());
                }
                if encoders_output.contains("hevc_videotoolbox") {
                    encoders.push("hevc_videotoolbox".to_string());
                }
            }
        }
    }

    Ok(encoders)
}

// System tray / background mode commands

#[tauri::command]
fn check_has_enabled_presets(app: AppHandle) -> Result<bool, String> {
    let presets = get_scheduled_presets(app)?;
    Ok(presets.iter().any(|p| p.enabled))
}

/// Check whether OS notifications are available/permitted.
/// Returns "granted", "denied", or "unknown".
#[tauri::command]
fn check_notification_permission(app: AppHandle) -> String {
    use tauri_plugin_notification::NotificationExt;
    match app.notification().permission_state() {
        Ok(state) => format!("{:?}", state).to_lowercase(),
        Err(_) => "unknown".to_string(),
    }
}

#[tauri::command]
fn force_quit(app: AppHandle) {
    FORCE_QUIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn get_monitoring_paused() -> bool {
    MONITORING_PAUSED.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_monitoring_paused(paused: bool) {
    MONITORING_PAUSED.store(paused, Ordering::SeqCst);
}

/// Update tray menu item text for pause/resume state.
/// Returns ("暫停所有監聽", false) when monitoring is active,
/// or ("恢復所有監聽", false) when monitoring is paused.
fn update_pause_menu_item(pause_item: &MenuItem<tauri::Wry>) {
    let paused = MONITORING_PAUSED.load(Ordering::SeqCst);
    let label = if paused { "恢復所有監聽" } else { "暫停所有監聽" };
    let _ = pause_item.set_text(label);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let download_tasks: DownloadTasks = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(download_tasks)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Build tray context menu
            let show_item = MenuItem::with_id(app, "show", "顯示主視窗", true, None::<&str>)?;
            let status_item = MenuItem::with_id(app, "status", "監聽狀態：未啟動", false, None::<&str>)?;
            let pause_item = MenuItem::with_id(app, "pause", "暫停所有監聽", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "結束", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let tray_menu = Menu::with_items(
                app,
                &[&show_item, &status_item, &sep1, &pause_item, &sep2, &quit_item],
            )?;

            let tray_app = app.handle().clone();
            let pause_item_clone = pause_item.clone();

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("Tidemark")
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "pause" => {
                            let current = MONITORING_PAUSED.load(Ordering::SeqCst);
                            MONITORING_PAUSED.store(!current, Ordering::SeqCst);
                            update_pause_menu_item(&pause_item_clone);
                        }
                        "quit" => {
                            FORCE_QUIT.store(true, Ordering::SeqCst);
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |_tray, event| {
                    // On macOS: single left click shows window
                    // On Windows: double-click shows window, single click also acceptable
                    let should_show = match &event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => true,
                        TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } => true,
                        _ => false,
                    };
                    if should_show {
                        if let Some(win) = tray_app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Intercept window close event
            let win_app = app.handle().clone();
            if let Some(main_window) = app.get_webview_window("main") {
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // If force quit is set, allow the close
                        if FORCE_QUIT.load(Ordering::SeqCst) {
                            return;
                        }

                        // Check if there are enabled scheduled presets
                        let has_enabled = get_scheduled_presets(win_app.clone())
                            .map(|presets| presets.iter().any(|p| p.enabled))
                            .unwrap_or(false);

                        let should_minimize = if has_enabled {
                            // Always minimize to tray if there are enabled presets
                            true
                        } else {
                            // Follow the close_behavior config setting
                            let cfg = load_config(win_app.clone()).unwrap_or_default();
                            cfg.close_behavior == "minimize_to_tray"
                        };

                        if should_minimize {
                            api.prevent_close();
                            if let Some(win) = win_app.get_webview_window("main") {
                                let _ = win.hide();
                            }
                        }
                        // If should_minimize is false, allow the close to proceed normally
                    }
                });
            }

            // Auto-start Twitch PubSub and YouTube RSS monitoring if configured.
            {
                let auto_app = app.handle().clone();
                tokio::spawn(async move {
                    let config = load_config(auto_app.clone()).unwrap_or_default();
                    if config.auto_start_monitoring {
                        let _ = start_twitch_pubsub(auto_app.clone()).await;
                        let _ = start_youtube_polling(auto_app).await;
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            fetch_video_info,
            start_download,
            start_recording,
            pause_download,
            resume_download,
            cancel_download,
            stop_recording,
            open_file,
            show_in_folder,
            get_download_tasks,
            get_download_history,
            delete_history_entry,
            clear_all_history,
            check_file_exists,
            validate_twitch_token,
            import_youtube_cookies,
            save_auth_config,
            save_api_keys,
            get_auth_config,
            test_api_key,
            save_api_key,
            get_api_key,
            delete_api_key,
            check_asr_environment,
            install_asr_environment,
            list_asr_models,
            download_asr_model,
            delete_asr_model,
            get_file_duration,
            get_file_size,
            start_transcription,
            start_cloud_transcription,
            get_local_records,
            save_local_records,
            create_folder,
            update_folder,
            delete_folder,
            update_record,
            delete_record,
            search_records,
            reorder_folders,
            get_sync_state,
            save_sync_state,
            exchange_google_token,
            sync_pull,
            sync_push_record,
            sync_delete_record,
            sync_push_folder,
            sync_delete_folder,
            open_url,
            get_app_version,
            get_tool_versions,
            check_for_updates,
            get_available_hardware_encoders,
            get_scheduled_presets,
            save_scheduled_preset,
            delete_scheduled_preset,
            toggle_preset_enabled,
            resolve_channel_info,
            check_has_enabled_presets,
            force_quit,
            get_monitoring_paused,
            set_monitoring_paused,
            start_twitch_pubsub,
            stop_twitch_pubsub,
            get_twitch_pubsub_status,
            start_youtube_polling,
            stop_youtube_polling,
            get_youtube_polling_status,
            get_scheduled_download_queue,
            cancel_scheduled_download,
            retry_scheduled_download,
            check_notification_permission
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
