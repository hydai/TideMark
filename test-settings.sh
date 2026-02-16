#!/bin/bash

# Task #20 Settings Verification Script
# Tests APP-014: Desktop - General, Download & Appearance Settings

echo "========================================="
echo "Task #20: Settings Verification"
echo "========================================="
echo ""

PASSED=0
FAILED=0

# Helper functions
pass() {
  echo "✓ $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "✗ $1"
  FAILED=$((FAILED + 1))
}

# Test 1: Verify AppConfig structure in frontend
echo "[Test 1] Checking frontend AppConfig interface..."
if grep -q "default_download_folder: string" src/config.ts && \
   grep -q "desktop_notifications: boolean" src/config.ts && \
   grep -q "max_concurrent_downloads: number" src/config.ts; then
  pass "Frontend AppConfig has required fields"
else
  fail "Frontend AppConfig missing required fields"
fi

# Test 2: Verify default values in frontend config
echo "[Test 2] Checking frontend default config values..."
if grep -q "max_concurrent_downloads: 3" src/config.ts && \
   grep -q "auto_retry: true" src/config.ts; then
  pass "Frontend default config values are correct"
else
  fail "Frontend default config values incorrect"
fi

# Test 3: Verify backend AppConfig structure
echo "[Test 3] Checking backend AppConfig struct..."
if grep -q "default_download_folder: String" src-tauri/src/lib.rs && \
   grep -q "max_concurrent_downloads: usize" src-tauri/src/lib.rs; then
  pass "Backend AppConfig has required fields"
else
  fail "Backend AppConfig missing required fields"
fi

# Test 4: Verify settings page sections
echo "[Test 4] Checking settings page section creation..."
if grep -q "createGeneralSection" src/pages/settings.ts && \
   grep -q "createDownloadSection" src/pages/settings.ts; then
  pass "Settings page sections defined"
else
  fail "Settings page sections missing"
fi

# Test 5: Verify folder picker functionality
echo "[Test 5] Checking folder picker implementation..."
if grep -q "createFolderPickerGroup" src/pages/settings.ts && \
   grep -q "default-download-folder-btn" src/pages/settings.ts; then
  pass "Folder picker implemented"
else
  fail "Folder picker missing"
fi

# Test 6: Verify toggle controls
echo "[Test 6] Checking toggle control implementation..."
if grep -q "createToggleGroup" src/pages/settings.ts && \
   grep -q "launch-on-startup" src/pages/settings.ts; then
  pass "Toggle controls implemented"
else
  fail "Toggle controls missing"
fi

# Test 7: Verify dropdown controls
echo "[Test 7] Checking dropdown control implementation..."
if grep -q "createDropdownGroup" src/pages/settings.ts && \
   grep -q "language" src/pages/settings.ts; then
  pass "Dropdown controls implemented"
else
  fail "Dropdown controls missing"
fi

# Test 8: Verify number input controls
echo "[Test 8] Checking number input control implementation..."
if grep -q "createNumberInputGroup" src/pages/settings.ts && \
   grep -q "max-concurrent-downloads" src/pages/settings.ts; then
  pass "Number input controls implemented"
else
  fail "Number input controls missing"
fi

# Test 9: Verify event listeners
echo "[Test 9] Checking event listener functions..."
if grep -q "attachGeneralEventListeners" src/pages/settings.ts && \
   grep -q "attachDownloadEventListeners" src/pages/settings.ts; then
  pass "Event listener functions defined"
else
  fail "Event listener functions missing"
fi

# Test 10: Verify ConfigManager integration
echo "[Test 10] Checking ConfigManager.update integration..."
if grep -q "ConfigManager.update" src/pages/settings.ts; then
  pass "ConfigManager integration implemented"
else
  fail "ConfigManager integration missing"
fi

# Test 11: Verify CSS styling
echo "[Test 11] Checking CSS styles for new UI elements..."
if grep -q ".folder-input-group" src/style.css && \
   grep -q ".toggle-button" src/style.css; then
  pass "CSS styles defined"
else
  fail "CSS styles missing"
fi

# Test 12: Build frontend
echo "[Test 12] Building frontend..."
npm run build > /tmp/build-frontend.log 2>&1
if [ $? -eq 0 ]; then
  pass "Frontend builds successfully"
else
  fail "Frontend build failed"
  cat /tmp/build-frontend.log
fi

# Test 13: Build backend
echo "[Test 13] Building backend (release mode)..."
cd src-tauri && cargo build --release > /tmp/build-backend.log 2>&1
BUILD_RESULT=$?
cd ..
if [ $BUILD_RESULT -eq 0 ]; then
  pass "Backend builds successfully"
else
  fail "Backend build failed"
  cat /tmp/build-backend.log
fi

echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed"
  exit 1
fi
