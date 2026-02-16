use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio, Child};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Emitter};
use regex::Regex;
use chrono::Utc;
use uuid::Uuid;

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
    theme: String,
    animation: bool,
    compact: bool,
    max_concurrent_downloads: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthConfig {
    pub twitch_token: Option<String>,
    pub youtube_cookies_path: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            animation: true,
            compact: false,
            max_concurrent_downloads: 3,
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
    let mut download_sections = String::new();
    if let Some(ref time_range) = config.time_range {
        if let (Some(ref start), Some(ref end)) = (&time_range.start, &time_range.end) {
            // Normalize time to HH:MM:SS format for yt-dlp
            let start_seconds = parse_time_to_seconds(start).unwrap_or(0);
            let end_seconds = parse_time_to_seconds(end).unwrap_or(0);
            let start_normalized = normalize_time_to_hhmmss(start_seconds);
            let end_normalized = normalize_time_to_hhmmss(end_seconds);

            download_sections = format!("*{}-{}", start_normalized, end_normalized);
            args.push("--download-sections");
            args.push(&download_sections);
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

async fn post_process_recording(input_path: &PathBuf) -> Option<String> {
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

    let config = AuthConfig {
        twitch_token,
        youtube_cookies_path,
    };

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
        });
    }

    let content = fs::read_to_string(&auth_config_path)
        .map_err(|e| format!("Failed to read auth config: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse auth config: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let download_tasks: DownloadTasks = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
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
            get_auth_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
