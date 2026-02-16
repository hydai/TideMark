import type { PlaybackInfo, ContentMessage } from '../types';

/**
 * Get current playback time from Twitch player
 */
async function getTwitchPlaybackInfo(): Promise<PlaybackInfo> {
  try {
    const currentUrl = window.location.href;

    // Determine if it's a live stream or VOD
    const isVOD = currentUrl.includes('/videos/');
    const isClip = currentUrl.includes('/clip/');

    if (isClip) {
      return {
        success: false,
        platform: 'twitch',
        error: 'Clip 尚未支援'
      };
    }

    let currentTime: number;
    let liveTime: string;

    if (isVOD) {
      // VOD: Get time from video element
      const videoElement = document.querySelector('video');
      if (!videoElement) {
        return {
          success: false,
          platform: 'twitch',
          error: '無法取得播放時間,請確認影片已載入'
        };
      }

      currentTime = videoElement.currentTime;
      if (isNaN(currentTime) || currentTime === 0) {
        return {
          success: false,
          platform: 'twitch',
          error: '無法取得播放時間,請確認影片已載入'
        };
      }

      liveTime = formatTime(currentTime);
    } else {
      // Live stream: Get time from live-time element
      const liveTimeElement = document.querySelector('.live-time > span[aria-hidden="true"]');
      if (!liveTimeElement) {
        return {
          success: false,
          platform: 'twitch',
          error: '無法取得播放時間,請確認影片已載入'
        };
      }

      liveTime = liveTimeElement.textContent?.trim() || '';
      if (!liveTime) {
        return {
          success: false,
          platform: 'twitch',
          error: '無法取得播放時間,請確認影片已載入'
        };
      }

      // Convert HH:MM:SS to seconds
      currentTime = parseTime(liveTime);
    }

    // Get stream/video title
    const titleElement = document.querySelector('h2[data-a-target="stream-title"]') ||
                         document.querySelector('h1');
    const title = titleElement?.textContent?.trim() || '未知標題';

    // Get channel URL with timestamp
    let channelUrl: string;

    if (isVOD) {
      // VOD: Use current URL with ?t= parameter
      const vodIdMatch = currentUrl.match(/\/videos\/(\d+)/);
      const vodId = vodIdMatch ? vodIdMatch[1] : '';
      const timeInSeconds = Math.floor(currentTime);
      channelUrl = `https://www.twitch.tv/videos/${vodId}?t=${formatTimeForUrl(timeInSeconds)}`;
    } else {
      // Live stream: Query GQL for latest VOD
      const channelName = window.location.pathname.split('/')[1];
      const vodId = await getLatestVODId(channelName);

      if (vodId) {
        const timeInSeconds = Math.floor(currentTime);
        channelUrl = `https://www.twitch.tv/videos/${vodId}?t=${formatTimeForUrl(timeInSeconds)}`;
      } else {
        // Fallback to channel videos page if no VOD found yet
        channelUrl = `https://www.twitch.tv/${channelName}/videos`;
      }
    }

    return {
      success: true,
      platform: 'twitch',
      currentTime,
      liveTime,
      title,
      channelUrl
    };
  } catch (error) {
    console.error('Twitch playback info error:', error);
    return {
      success: false,
      platform: 'twitch',
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
 * Parse HH:MM:SS or MM:SS to seconds
 */
function parseTime(timeStr: string): number {
  const parts = timeStr.split(':').map(p => parseInt(p, 10));
  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Format seconds to Twitch URL time format (1h2m3s)
 */
function formatTimeForUrl(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  let result = '';
  if (hours > 0) result += `${hours}h`;
  if (minutes > 0) result += `${minutes}m`;
  if (secs > 0) result += `${secs}s`;

  return result || '0s';
}

/**
 * Query Twitch GQL API to get the latest VOD ID for a channel
 */
async function getLatestVODId(channelName: string): Promise<string | null> {
  try {
    const clientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // Public Twitch client ID

    const query = `
      query {
        user(login: "${channelName}") {
          videos(first: 1, type: ARCHIVE, sort: TIME) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    const vodId = data?.data?.user?.videos?.edges?.[0]?.node?.id;

    return vodId || null;
  } catch (error) {
    console.error('Failed to fetch latest VOD ID:', error);
    return null;
  }
}

/**
 * Listen for messages from popup
 */
chrome.runtime.onMessage.addListener((message: ContentMessage, sender, sendResponse) => {
  if (message.type === 'GET_PLAYBACK_INFO') {
    getTwitchPlaybackInfo().then(info => {
      sendResponse(info);
    });
  }
  return true; // Keep the message channel open for async response
});

console.log('Tidemark Twitch content script loaded');
