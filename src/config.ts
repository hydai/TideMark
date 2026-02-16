import { invoke } from '@tauri-apps/api/core';

export interface AppConfig {
  // General settings
  default_download_folder: string;
  default_subtitle_folder: string;
  launch_on_startup: boolean;
  desktop_notifications: boolean;
  language: string;
  timezone: string;

  // Download settings
  enable_transcoder: boolean;
  default_video_quality: string;
  output_container: string;
  max_concurrent_downloads: number;
  auto_retry: boolean;
  max_retry_count: number;
  download_speed_limit: number; // MB/s, 0 = unlimited
  show_codec_options: boolean;

  // Appearance settings
  theme: 'dark' | 'light' | 'system';
  animation: boolean;
  compact: boolean;

  // Records settings
  show_all_records_folder: boolean;
  show_uncategorized_folder: boolean;
  download_clip_before_offset: number;
  download_clip_after_offset: number;

  // GPU acceleration settings
  enable_hardware_encoding: boolean;
  hardware_encoder: string; // 'auto', 'h264_nvenc', 'hevc_nvenc', 'h264_amf', 'hevc_amf', etc.
  enable_frontend_acceleration: boolean;
}

const defaultConfig: AppConfig = {
  default_download_folder: '~/Tidemark/Downloads',
  default_subtitle_folder: '~/Tidemark/Downloads',
  launch_on_startup: false,
  desktop_notifications: true,
  language: '繁體中文',
  timezone: 'System',
  enable_transcoder: false,
  default_video_quality: 'Highest',
  output_container: 'Auto',
  max_concurrent_downloads: 3,
  auto_retry: true,
  max_retry_count: 3,
  download_speed_limit: 0,
  show_codec_options: false,
  theme: 'system',
  animation: true,
  compact: false,
  show_all_records_folder: true,
  show_uncategorized_folder: true,
  download_clip_before_offset: 10,
  download_clip_after_offset: 10,
  enable_hardware_encoding: false,
  hardware_encoder: 'auto',
  enable_frontend_acceleration: true,
};

export class ConfigManager {
  private static config: AppConfig = { ...defaultConfig };

  static async init() {
    try {
      const savedConfig = await invoke<AppConfig>('load_config');
      this.config = { ...defaultConfig, ...savedConfig };
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
      this.config = { ...defaultConfig };
    }
  }

  static get(): AppConfig {
    return { ...this.config };
  }

  static async update(updates: Partial<AppConfig>) {
    this.config = { ...this.config, ...updates };
    try {
      await invoke('save_config', { config: this.config });
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  static async set(key: keyof AppConfig, value: any) {
    await this.update({ [key]: value });
  }
}
