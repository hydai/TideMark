/**
 * Local Direct Connection (Interface 7)
 *
 * Probes the Tidemark desktop app's local HTTP server and pushes
 * data directly when available, bypassing Cloud Sync.
 *
 * - probeDesktop(): GET /ping with 3s timeout → boolean
 * - startProbing(): poll every 10s, immediate first probe
 * - pushToDesktop(endpoint, body): POST with 5s timeout
 * - bufferItem(): add to localDirectBuffer in Chrome Storage
 * - replayBuffer(): on reconnect, replay buffered items in order
 * - Buffer cap: 100 items, FIFO eviction when full (E-I7b)
 */

import {
  LOCAL_DIRECT_URL,
  LOCAL_DIRECT_PROBE_INTERVAL,
  LOCAL_DIRECT_BUFFER_MAX,
  type DirectBufferItem,
  type SyncState,
} from './types';

/** Whether the desktop app is currently reachable. */
let desktopAvailable = false;

/** Interval ID for probing. */
let probeInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Probe the desktop app by hitting GET /ping with a 3s timeout.
 * Returns true if the desktop app responded successfully.
 */
export async function probeDesktop(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${LOCAL_DIRECT_URL}/ping`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (data.app === 'tidemark') {
        if (!desktopAvailable) {
          desktopAvailable = true;
          console.log('[direct-connect] Desktop app detected');
          // Replay buffered items on reconnect
          replayBuffer();
        }
        return true;
      }
    }
  } catch {
    // Desktop not available (timeout, connection refused, etc.)
  }

  if (desktopAvailable) {
    desktopAvailable = false;
    console.log('[direct-connect] Desktop app disconnected');
  }
  return false;
}

/**
 * Start periodic probing. Runs an immediate probe, then every 10s.
 * Safe to call multiple times (no-op if already probing).
 */
export function startProbing(): void {
  if (probeInterval !== null) return;

  // Immediate first probe
  probeDesktop();

  probeInterval = setInterval(() => {
    probeDesktop();
  }, LOCAL_DIRECT_PROBE_INTERVAL);

  console.log('[direct-connect] Probing started');
}

/**
 * Stop periodic probing.
 */
export function stopProbing(): void {
  if (probeInterval !== null) {
    clearInterval(probeInterval);
    probeInterval = null;
    console.log('[direct-connect] Probing stopped');
  }
}

/**
 * Check if the desktop app is currently available.
 */
export function isDesktopAvailable(): boolean {
  return desktopAvailable;
}

/**
 * Push data to the desktop app via POST with a 5s timeout.
 * Returns true on success, false on failure.
 */
export async function pushToDesktop(
  endpoint: string,
  body: any
): Promise<boolean> {
  if (!desktopAvailable) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${LOCAL_DIRECT_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return response.ok;
  } catch {
    // Connection failed — mark as unavailable
    desktopAvailable = false;
    return false;
  }
}

/**
 * Buffer an item in Chrome Storage for later replay.
 * Enforces a FIFO cap of LOCAL_DIRECT_BUFFER_MAX items (E-I7b).
 */
export async function bufferItem(
  endpoint: string,
  body: any
): Promise<void> {
  const result = await chrome.storage.local.get(['syncState']) as { syncState?: SyncState };
  const syncState: SyncState = result.syncState || { jwt: null, user: null, lastSyncedAt: '', queue: [], status: 'offline' };
  const buffer: DirectBufferItem[] = syncState.localDirectBuffer || [];

  buffer.push({
    endpoint,
    body,
    timestamp: new Date().toISOString(),
  });

  // FIFO eviction
  while (buffer.length > LOCAL_DIRECT_BUFFER_MAX) {
    buffer.shift();
  }

  syncState.localDirectBuffer = buffer;
  await chrome.storage.local.set({ syncState });
}

/**
 * Replay buffered items in order when the desktop reconnects.
 * Successfully pushed items are removed from the buffer.
 */
async function replayBuffer(): Promise<void> {
  const result = await chrome.storage.local.get(['syncState']) as { syncState?: SyncState };
  const syncState: SyncState = result.syncState || { jwt: null, user: null, lastSyncedAt: '', queue: [], status: 'offline' };
  const buffer: DirectBufferItem[] = syncState.localDirectBuffer || [];

  if (buffer.length === 0) return;

  console.log(`[direct-connect] Replaying ${buffer.length} buffered items`);

  const remaining: DirectBufferItem[] = [];

  for (const item of buffer) {
    const ok = await pushToDesktop(item.endpoint, item.body);
    if (!ok) {
      // Stop replaying if desktop becomes unavailable
      remaining.push(item);
      // Push remaining items that haven't been tried yet
      const idx = buffer.indexOf(item);
      remaining.push(...buffer.slice(idx + 1));
      break;
    }
  }

  syncState.localDirectBuffer = remaining;
  await chrome.storage.local.set({ syncState });
}

/**
 * Try to push data directly to desktop. On failure, buffer the item
 * and return false so the caller can fall back to Cloud Sync.
 */
export async function tryDirectPush(
  endpoint: string,
  body: any
): Promise<boolean> {
  if (!desktopAvailable) {
    await bufferItem(endpoint, body);
    return false;
  }

  const ok = await pushToDesktop(endpoint, body);
  if (!ok) {
    await bufferItem(endpoint, body);
    return false;
  }

  return true;
}
