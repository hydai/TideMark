/**
 * Filename Template Engine — TypeScript interface (F10.1, F10.4)
 *
 * Wraps Tauri commands for the unified filename template engine.
 * The engine supports {variable} syntax with 10 recognized variables,
 * two-phase expansion for scheduled downloads, OS-safe sanitization,
 * conflict resolution, and yt-dlp special character escaping.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * All recognized template variables with their descriptions.
 */
export const TEMPLATE_VARIABLES = [
  { key: 'title',        label: '標題',     description: '影片或直播的標題',                       example: 'Minecraft 生存挑戰 Day 1' },
  { key: 'id',           label: 'ID',       description: '平台上的影片 ID',                       example: 'abc123def' },
  { key: 'channel',      label: '頻道帳號', description: '頻道帳號名稱（username）',               example: 'example_ch' },
  { key: 'channel_name', label: '頻道名稱', description: '頻道顯示名稱',                           example: '範例頻道' },
  { key: 'platform',     label: '平台',     description: '平台（youtube / twitch）',              example: 'youtube' },
  { key: 'type',         label: '類型',     description: '內容類型（stream / video / clip）',     example: 'video' },
  { key: 'date',         label: '日期',     description: '日期（YYYY-MM-DD）',                    example: '2026-02-17' },
  { key: 'datetime',     label: '日期時間', description: '日期與時間（YYYY-MM-DD_HHmmss）',        example: '2026-02-17_143052' },
  { key: 'resolution',   label: '畫質',     description: '畫質（如 1080p）；排程下載時為延遲變數', example: '1080p' },
  { key: 'duration',     label: '時長',     description: '時長（如 02h30m15s）；排程下載時為延遲變數', example: '01h25m30s' },
] as const;

/**
 * Variables expanded in Phase 1 (immediate, available at trigger time for scheduled downloads).
 */
export const PHASE1_VARIABLE_KEYS = ['channel', 'channel_name', 'platform', 'date', 'datetime'] as const;

/**
 * Variables deferred to Phase 2 (require stream metadata).
 */
export const PHASE2_VARIABLE_KEYS = ['title', 'id', 'type', 'resolution', 'duration'] as const;

/**
 * Sample data for template preview in Settings page (F10.3).
 */
export const PREVIEW_SAMPLE_VARS: Record<string, string> = {
  title:        'Minecraft 生存挑戰 Day 1',
  id:           'abc123def',
  channel:      'example_ch',
  channel_name: '範例頻道',
  platform:     'youtube',
  type:         'video',
  date:         '2026-02-17',
  datetime:     '2026-02-17_143052',
  resolution:   '1080p',
  duration:     '01h25m30s',
};

/**
 * Validate that a filename template contains only recognized variables.
 * Throws with message "無法辨識的變數：{variable}" for unrecognized variables.
 */
export async function validateTemplate(template: string): Promise<void> {
  await invoke<void>('validate_filename_template', { template });
}

/**
 * Fully expand all variables in the template.
 * Variables with no value in `vars` map remain as `{variable}` placeholders.
 * If the result after sanitization is empty, returns a fallback `untitled_{datetime}`.
 */
export async function expandTemplate(
  template: string,
  vars: Record<string, string>
): Promise<string> {
  return await invoke<string>('expand_filename_template', {
    template,
    variables: vars,
  });
}

/**
 * Phase 1 expansion for scheduled downloads.
 * Only expands immediate variables: {channel}, {channel_name}, {platform}, {date}, {datetime}.
 * Deferred variables ({title}, {id}, {type}, {resolution}, {duration}) remain as placeholders.
 */
export async function expandTemplatePhase1(
  template: string,
  vars: Record<string, string>
): Promise<string> {
  return await invoke<string>('expand_filename_template_phase1', {
    template,
    variables: vars,
  });
}

/**
 * Apply OS-safe sanitization to a filename string.
 * - Replaces forbidden characters (/ \ : * ? " < > |) with `_`
 * - Removes control characters (ASCII 0-31, DEL 127)
 * - Strips leading/trailing spaces and dots
 * - Normalizes consecutive spaces to single space
 * - Truncates to 200 characters (excluding extension)
 * - Prefixes Windows reserved names (CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9) with `_`
 * - Returns `untitled_{datetime}` if result is empty
 */
export async function sanitizeFilename(filename: string): Promise<string> {
  return await invoke<string>('sanitize_filename', { filename });
}

/**
 * Sanitize filename and resolve conflicts in the output directory.
 * Appends " (1)", " (2)", etc. for existing files.
 * Falls back to `{filename}_{datetime}.{ext}` after 99 conflicts (E10.4c).
 * Truncates filename further if full path exceeds OS limit (E10.4b).
 * Returns the full resolved path string.
 */
export async function resolveOutputFilename(
  outputDir: string,
  filename: string,
  ext: string
): Promise<string> {
  return await invoke<string>('resolve_output_filename', {
    outputDir,
    filename,
    extension: ext,
  });
}

/**
 * Escape `%` to `%%` in an expanded filename for safe use with yt-dlp's -o parameter (E10.6b).
 */
export async function escapeFilenameForYtdlp(filename: string): Promise<string> {
  return await invoke<string>('escape_filename_for_ytdlp', { filename });
}
