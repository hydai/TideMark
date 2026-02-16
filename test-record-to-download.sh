#!/bin/bash

# Test script for Task #19: APP-013 - Record to Download Linkage
# This script verifies the integration between Records and Download tabs

set -e

echo "========================================"
echo "Task #19: Record to Download Linkage"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

passed=0
failed=0

# Test function
test_step() {
  local step_name=$1
  echo -e "${YELLOW}Testing:${NC} $step_name"
}

test_pass() {
  echo -e "${GREEN}✓ PASS${NC}"
  ((passed++))
  echo ""
}

test_fail() {
  local message=$1
  echo -e "${RED}✗ FAIL${NC}: $message"
  ((failed++))
  echo ""
}

# AC1: Check config structure includes offset fields
test_step "AC1: Config includes offset fields"
if grep -q "download_clip_before_offset" src/config.ts && \
   grep -q "download_clip_after_offset" src/config.ts; then
  test_pass
else
  test_fail "Config does not include offset fields"
fi

# AC2: Check default values are 10 seconds
test_step "AC2: Default offset values are 10 seconds"
if grep -q "download_clip_before_offset: 10" src/config.ts && \
   grep -q "download_clip_after_offset: 10" src/config.ts; then
  test_pass
else
  test_fail "Default offset values are not 10 seconds"
fi

# AC3: Check backend config structure
test_step "AC3: Backend config includes offset fields"
if grep -q "download_clip_before_offset: u32" src-tauri/src/lib.rs && \
   grep -q "download_clip_after_offset: u32" src-tauri/src/lib.rs; then
  test_pass
else
  test_fail "Backend config does not include offset fields"
fi

# AC4: Check backend default values
test_step "AC4: Backend default offset values are 10"
if grep -q "download_clip_before_offset: 10" src-tauri/src/lib.rs && \
   grep -q "download_clip_after_offset: 10" src-tauri/src/lib.rs; then
  test_pass
else
  test_fail "Backend default offset values are not 10"
fi

# AC5: Check navigation function exists
test_step "AC5: Navigation function exists in app.ts"
if grep -q "navigateToDownload" src/app.ts && \
   grep -q "export function navigateToDownload" src/app.ts; then
  test_pass
else
  test_fail "Navigation function not found in app.ts"
fi

# AC6: Check download page accepts navigation data
test_step "AC6: Download page accepts navigation data parameter"
if grep -q "navData?: NavigationData" src/pages/download.ts && \
   grep -q "interface NavigationData" src/pages/download.ts; then
  test_pass
else
  test_fail "Download page does not accept navigation data"
fi

# AC7: Check download page auto-fills from navigation data
test_step "AC7: Download page auto-fills URL and time range"
if grep -q "if (navData?.url)" src/pages/download.ts && \
   grep -q "urlInput.value = navData.url" src/pages/download.ts && \
   grep -q "startTimeInput.value = navData.startTime" src/pages/download.ts; then
  test_pass
else
  test_fail "Download page does not auto-fill from navigation data"
fi

# AC8: Check records page imports navigation function
test_step "AC8: Records page imports navigation function"
if grep -q "import.*navigateToDownload.*from.*app" src/pages/records.ts; then
  test_pass
else
  test_fail "Records page does not import navigation function"
fi

# AC9: Check records page imports ConfigManager
test_step "AC9: Records page imports ConfigManager"
if grep -q "import.*ConfigManager.*from.*config" src/pages/records.ts; then
  test_pass
else
  test_fail "Records page does not import ConfigManager"
fi

# AC10: Check time parsing utility functions exist
test_step "AC10: Time parsing utility functions exist"
if grep -q "function parseTimeToSeconds" src/pages/records.ts && \
   grep -q "function formatSecondsToTime" src/pages/records.ts; then
  test_pass
else
  test_fail "Time parsing utility functions not found"
fi

# AC11: Check download button handler uses config offsets
test_step "AC11: Download button handler uses config offsets"
if grep -q "const config = ConfigManager.get()" src/pages/records.ts && \
   grep -q "download_clip_before_offset" src/pages/records.ts && \
   grep -q "download_clip_after_offset" src/pages/records.ts; then
  test_pass
else
  test_fail "Download button handler does not use config offsets"
fi

# AC12: Check download button calculates time range
test_step "AC12: Download button calculates start and end times"
if grep -q "const startSeconds = Math.max(0, liveTimeSeconds - beforeOffset)" src/pages/records.ts && \
   grep -q "const endSeconds = liveTimeSeconds + afterOffset" src/pages/records.ts; then
  test_pass
else
  test_fail "Download button does not calculate time range"
fi

# AC13: Check download button calls navigateToDownload
test_step "AC13: Download button calls navigateToDownload with data"
if grep -q "navigateToDownload({" src/pages/records.ts && \
   grep -q "url: record.channel_url" src/pages/records.ts && \
   grep -q "startTime: startTime" src/pages/records.ts; then
  test_pass
else
  test_fail "Download button does not call navigateToDownload"
fi

# AC14: Check error handling for empty URL
test_step "AC14: Error handling for empty/invalid URL"
if grep -q "無法解析此記錄的連結" src/pages/records.ts; then
  test_pass
else
  test_fail "No error handling for invalid URL"
fi

# AC15: Check frontend builds successfully
test_step "AC15: Frontend builds successfully"
if npm run build > /dev/null 2>&1; then
  test_pass
else
  test_fail "Frontend build failed"
fi

# AC16: Check backend builds successfully
test_step "AC16: Backend builds successfully"
if cd src-tauri && cargo build --release > /dev/null 2>&1; then
  cd ..
  test_pass
else
  cd ..
  test_fail "Backend build failed"
fi

# Summary
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "${GREEN}Passed: $passed${NC}"
if [ $failed -gt 0 ]; then
  echo -e "${RED}Failed: $failed${NC}"
else
  echo -e "Failed: $failed"
fi
echo ""

if [ $failed -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
fi
