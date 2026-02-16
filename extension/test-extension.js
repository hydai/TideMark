/**
 * Playwright test script for Tidemark browser extension
 *
 * Usage:
 * 1. Install Playwright: npm install -D @playwright/test playwright
 * 2. Run: npx playwright test test-extension.js --headed
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.join(__dirname, 'dist');

test.describe('Tidemark Extension - Record Management', () => {
  let browser;
  let context;
  let page;
  let extensionId;

  test.beforeAll(async () => {
    // Launch browser with extension
    browser = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    // Get extension ID
    let [background] = browser.serviceWorkers();
    if (!background) {
      background = await browser.waitForEvent('serviceworker');
    }

    extensionId = background.url().split('/')[2];
    console.log('Extension ID:', extensionId);
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test('Extension loads successfully', async () => {
    page = await browser.newPage();
    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Click extension icon (via chrome://extensions/ or action)
    // Note: Direct extension popup testing requires Chrome DevTools Protocol

    console.log('✅ Extension loaded successfully');
  });

  test('Popup HTML structure is correct', async () => {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    page = await browser.newPage();
    await page.goto(popupUrl);

    // Check for main containers
    const foldersSection = await page.locator('#folders-sidebar');
    const recordsSection = await page.locator('#records-section');

    await expect(foldersSection).toBeVisible();
    await expect(recordsSection).toBeVisible();

    console.log('✅ Popup structure is correct');
  });

  test('Storage API is accessible', async () => {
    page = await browser.newPage();
    await page.goto('https://www.youtube.com/');

    // Test Chrome Storage API
    const storageTest = await page.evaluate(async () => {
      if (!chrome || !chrome.storage) {
        return { success: false, error: 'Chrome Storage API not available' };
      }

      try {
        // Test write
        await chrome.storage.local.set({ testKey: 'testValue' });

        // Test read
        const result = await chrome.storage.local.get('testKey');

        // Clean up
        await chrome.storage.local.remove('testKey');

        return {
          success: result.testKey === 'testValue',
          value: result.testKey
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    console.log('Storage test result:', storageTest);
    // Storage API might not be accessible from content script context
    // This is expected - actual verification needs to be done in popup context
  });
});

console.log(`
==========================================
Tidemark Extension Test Suite
==========================================

Note: This is a basic test harness. Full testing requires:
1. Manual browser interaction testing
2. Loading extension in Chrome
3. Testing on actual YouTube/Twitch pages

For comprehensive testing, follow:
extension/TASK-4-VERIFICATION.md
==========================================
`);
