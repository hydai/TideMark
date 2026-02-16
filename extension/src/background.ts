/**
 * Background service worker for Tidemark extension
 */

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Tidemark extension installed');

  // Initialize storage if needed
  chrome.storage.local.get(['records'], (result) => {
    if (!result.records) {
      chrome.storage.local.set({ records: [] });
    }
  });
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Future: Can add background tasks here if needed
  return true;
});

console.log('Tidemark background service worker loaded');
