use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};
use regex::Regex;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    theme: String,
    animation: bool,
    compact: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            animation: true,
            compact: false,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![load_config, save_config, fetch_video_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
