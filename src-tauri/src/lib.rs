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
    pub status: String, // "queued", "downloading", "processing", "completed", "failed", "cancelled", "paused"
    pub title: String,
    pub percentage: f64,
    pub speed: String,
    pub eta: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub output_path: Option<String>,
    pub error_message: Option<String>,
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

// Download management commands
#[tauri::command]
async fn start_download(
    app: AppHandle,
    config: DownloadConfig,
    tasks: tauri::State<'_, DownloadTasks>,
) -> Result<String, String> {
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

async fn execute_download(app: AppHandle, tasks: DownloadTasks, task_id: String) {
    let config = {
        let tasks_guard = tasks.lock().unwrap();
        match tasks_guard.get(&task_id) {
            Some(task) => task.config.clone(),
            None => return,
        }
    };

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

    // Add time range if specified
    let mut download_sections = String::new();
    if let Some(ref time_range) = config.time_range {
        if let (Some(ref start), Some(ref end)) = (&time_range.start, &time_range.end) {
            download_sections = format!("*{}-{}", start, end);
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

#[tauri::command]
async fn get_download_tasks(tasks: tauri::State<'_, DownloadTasks>) -> Result<Vec<DownloadProgress>, String> {
    let tasks_guard = tasks.lock().unwrap();
    let progress_list: Vec<DownloadProgress> = tasks_guard
        .values()
        .map(|task| task.progress.clone())
        .collect();
    Ok(progress_list)
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
            pause_download,
            resume_download,
            cancel_download,
            open_file,
            show_in_folder,
            get_download_tasks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
