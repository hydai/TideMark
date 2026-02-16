import type { PlaybackInfo, ContentMessage } from '../types';

/**
 * Get current playback time from YouTube video player
 */
function getYouTubePlaybackInfo(): PlaybackInfo {
  try {
    // Find video element
    const videoElement = document.querySelector('video');
    if (!videoElement) {
      return {
        success: false,
        platform: 'youtube',
        error: '無法取得播放時間,請確認影片已載入'
      };
    }

    // Get current time in seconds
    const currentTime = videoElement.currentTime;
    if (isNaN(currentTime) || currentTime === 0) {
      return {
        success: false,
        platform: 'youtube',
        error: '無法取得播放時間,請確認影片已載入'
      };
    }

    // Format time as HH:MM:SS or MM:SS
    const liveTime = formatTime(currentTime);

    // Get video title
    const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string');
    const title = titleElement?.textContent?.trim() || '未知標題';

    // Get video ID from meta tag
    const videoIdMeta = document.querySelector('meta[itemprop="videoId"]') as HTMLMetaElement;
    const videoId = videoIdMeta?.content || '';

    if (!videoId) {
      return {
        success: false,
        platform: 'youtube',
        error: '無法取得影片 ID'
      };
    }

    // Build youtu.be short link with timestamp
    const timeInSeconds = Math.floor(currentTime);
    const channelUrl = `https://youtu.be/${videoId}?t=${timeInSeconds}`;

    return {
      success: true,
      platform: 'youtube',
      currentTime,
      liveTime,
      title,
      videoId,
      channelUrl
    };
  } catch (error) {
    console.error('YouTube playback info error:', error);
    return {
      success: false,
      platform: 'youtube',
      error: '無法取得播放時間,請確認影片已載入'
    };
  }
}

/**
 * Format seconds to HH:MM:SS or MM:SS
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

/**
 * Listen for messages from popup
 */
chrome.runtime.onMessage.addListener((message: ContentMessage, sender, sendResponse) => {
  if (message.type === 'GET_PLAYBACK_INFO') {
    const info = getYouTubePlaybackInfo();
    sendResponse(info);
  }
  return true; // Keep the message channel open for async response
});

console.log('Tidemark YouTube content script loaded');
