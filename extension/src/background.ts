/**
 * Background service worker for Tidemark extension
 */

import { initSyncState, isLoggedIn, startSyncPolling, pullRemoteChanges } from './sync';
import { startProbing } from './direct-connect';

// Listen for extension installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Tidemark extension installed');

  // Initialize storage if needed
  chrome.storage.local.get(['records', 'folders'], (result) => {
    if (!result.records) {
      chrome.storage.local.set({ records: [] });
    }
    if (!result.folders) {
      chrome.storage.local.set({ folders: [] });
    }
  });

  // Initialize sync state
  await initSyncState();

  // Start local direct connection probing (Interface 7)
  startProbing();
});

// Listen for extension startup (browser restart)
chrome.runtime.onStartup.addListener(async () => {
  console.log('Tidemark extension started');

  // Initialize sync state
  await initSyncState();

  // Start local direct connection probing (Interface 7)
  startProbing();

  // Resume sync polling if user is logged in
  const loggedIn = await isLoggedIn();
  if (loggedIn) {
    startSyncPolling();
    // Initial pull
    await pullRemoteChanges();
  }
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Future: Can add background tasks here if needed
  return true;
});

console.log('Tidemark background service worker loaded');
