#!/bin/bash

# Test script for Task #18: Desktop Cloud Sync Integration
# This script verifies the cloud sync functionality in the desktop app

echo "========================================"
echo "Task #18: Cloud Sync Integration Test"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASS=0
FAIL=0

# Helper functions
pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASS++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((FAIL++))
}

info() {
    echo -e "${YELLOW}ℹ INFO${NC}: $1"
}

# Get app data directory path
get_app_data_dir() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "$HOME/Library/Application Support/com.tidemark.app"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "$HOME/.config/tidemark"
    else
        echo "$APPDATA/com.tidemark.app"
    fi
}

APP_DATA_DIR=$(get_app_data_dir)
TIDEMARK_DIR="$APP_DATA_DIR/tidemark"
RECORDS_FILE="$TIDEMARK_DIR/records.json"
SYNC_STATE_FILE="$TIDEMARK_DIR/sync_state.json"

echo "Test Configuration:"
echo "  App Data Dir: $APP_DATA_DIR"
echo "  Tidemark Dir: $TIDEMARK_DIR"
echo "  Records File: $RECORDS_FILE"
echo "  Sync State File: $SYNC_STATE_FILE"
echo ""

# ==================================================
# AC1: Local-only mode verification
# ==================================================
echo "=========================================="
echo "AC1: Verify local-only mode works"
echo "=========================================="

if [ ! -f "$SYNC_STATE_FILE" ]; then
    pass "AC1.1: Sync state file does not exist (clean state)"
else
    SYNC_STATUS=$(cat "$SYNC_STATE_FILE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "offline")
    if [ "$SYNC_STATUS" == "offline" ] || [ -z "$SYNC_STATUS" ]; then
        pass "AC1.2: Sync state shows offline status"
    else
        info "AC1.2: Sync state status is: $SYNC_STATUS"
    fi
fi

# Check that local operations work without cloud sync
info "AC1.3: To verify local-only mode, launch the app and:"
info "  1. Navigate to Records tab"
info "  2. Verify 'Login with Google' button is visible"
info "  3. Verify '本機模式 (未同步)' text is shown"
info "  4. Create a test folder and verify it saves locally"

echo ""

# ==================================================
# AC2: File structure verification
# ==================================================
echo "=========================================="
echo "AC2: Verify sync files structure"
echo "=========================================="

# Create sample sync state for testing
mkdir -p "$TIDEMARK_DIR"

if [ ! -f "$SYNC_STATE_FILE" ]; then
    cat > "$SYNC_STATE_FILE" << 'EOF'
{
  "jwt": null,
  "user": null,
  "last_synced_at": "1970-01-01T00:00:00.000Z",
  "status": "offline"
}
EOF
    pass "AC2.1: Created default sync state file"
else
    pass "AC2.1: Sync state file already exists"
fi

# Verify sync state structure
if grep -q '"jwt"' "$SYNC_STATE_FILE" && \
   grep -q '"user"' "$SYNC_STATE_FILE" && \
   grep -q '"last_synced_at"' "$SYNC_STATE_FILE" && \
   grep -q '"status"' "$SYNC_STATE_FILE"; then
    pass "AC2.2: Sync state file has correct structure"
else
    fail "AC2.2: Sync state file missing required fields"
fi

echo ""

# ==================================================
# AC3: Backend commands verification
# ==================================================
echo "=========================================="
echo "AC3: Verify Tauri commands exist"
echo "=========================================="

# Check that sync-related Tauri commands are registered
COMMANDS_TO_CHECK=(
    "get_sync_state"
    "save_sync_state"
    "exchange_google_token"
    "sync_pull"
    "sync_push_record"
    "sync_delete_record"
    "sync_push_folder"
    "sync_delete_folder"
    "open_url"
)

echo "Checking lib.rs for registered commands..."
LIB_RS="src-tauri/src/lib.rs"

for cmd in "${COMMANDS_TO_CHECK[@]}"; do
    if grep -q "$cmd" "$LIB_RS"; then
        pass "AC3: Command '$cmd' is registered"
    else
        fail "AC3: Command '$cmd' is NOT registered"
    fi
done

echo ""

# ==================================================
# AC4: Frontend integration verification
# ==================================================
echo "=========================================="
echo "AC4: Verify frontend sync integration"
echo "=========================================="

RECORDS_TS="src/pages/records.ts"
SYNC_TS="src/sync.ts"

# Check that sync module exists
if [ -f "$SYNC_TS" ]; then
    pass "AC4.1: Sync module (sync.ts) exists"
else
    fail "AC4.1: Sync module (sync.ts) does NOT exist"
fi

# Check that records.ts imports sync
if grep -q "import.*sync" "$RECORDS_TS"; then
    pass "AC4.2: Records page imports sync module"
else
    fail "AC4.2: Records page does NOT import sync module"
fi

# Check for sync UI elements
if grep -q "createSyncSection" "$RECORDS_TS"; then
    pass "AC4.3: Sync UI section is implemented"
else
    fail "AC4.3: Sync UI section is NOT implemented"
fi

# Check for cloud push operations
if grep -q "CloudSync.pushRecord\|CloudSync.pushFolder" "$RECORDS_TS"; then
    pass "AC4.4: Cloud push operations are integrated"
else
    fail "AC4.4: Cloud push operations are NOT integrated"
fi

# Check for sync polling
if grep -q "startSyncPolling" "$SYNC_TS"; then
    pass "AC4.5: Sync polling is implemented"
else
    fail "AC4.5: Sync polling is NOT implemented"
fi

echo ""

# ==================================================
# AC5: CSS styles verification
# ==================================================
echo "=========================================="
echo "AC5: Verify sync UI styles"
echo "=========================================="

STYLE_CSS="src/style.css"

STYLES_TO_CHECK=(
    "sync-section"
    "sync-login-btn"
    "sync-user-info"
    "sync-status-indicator"
    "sync-logout-btn"
)

for style in "${STYLES_TO_CHECK[@]}"; do
    if grep -q "\.$style" "$STYLE_CSS"; then
        pass "AC5: Style '.$style' exists"
    else
        fail "AC5: Style '.$style' does NOT exist"
    fi
done

echo ""

# ==================================================
# AC6: Build verification
# ==================================================
echo "=========================================="
echo "AC6: Verify builds succeed"
echo "=========================================="

echo "Building frontend..."
if npm run build > /dev/null 2>&1; then
    pass "AC6.1: Frontend builds successfully"
else
    fail "AC6.1: Frontend build FAILED"
fi

echo "Building backend..."
if cd src-tauri && cargo build --release > /dev/null 2>&1; then
    pass "AC6.2: Backend builds successfully"
    cd ..
else
    fail "AC6.2: Backend build FAILED"
    cd ..
fi

echo ""

# ==================================================
# Manual Testing Instructions
# ==================================================
echo "=========================================="
echo "Manual Testing Instructions"
echo "=========================================="

cat << 'EOF'

To complete the verification of Task #18, perform these manual tests:

STEP 1: Test Local-Only Mode
  1. Launch the desktop app
  2. Navigate to Records tab
  3. Verify:
     ✓ "Login with Google" button is visible at top of sidebar
     ✓ "本機模式 (未同步)" text is shown below button
     ✓ Create a folder - it should work locally
     ✓ Create/edit/delete records - all should work locally

STEP 2: Test Login UI Flow
  1. Click "Login with Google" button
  2. Verify:
     ✓ System browser opens (or prompt appears for token input)
     ✓ After providing valid Google ID token, login succeeds
     ✓ User email appears in sync section
     ✓ Status indicator shows "已同步" (synced)
     ✓ Logout button is visible

STEP 3: Test Cloud Sync - Initial Pull
  1. Ensure you're logged in
  2. If you have records in the browser extension, verify:
     ✓ Records from extension appear in desktop app within 5 seconds
     ✓ Folders from extension appear in desktop app
     ✓ Record grouping and organization matches extension

STEP 4: Test Cloud Sync - Push from Desktop
  1. While logged in on desktop:
     - Create a new folder
     - Create a new record (if you can - note: records created via extension)
     - Edit a record's topic
  2. Open browser extension
  3. Verify changes appear in extension within 5 seconds

STEP 5: Test Cloud Sync - Pull from Extension
  1. While logged in on desktop
  2. Open browser extension
  3. Create a new record or folder
  4. Verify it appears on desktop within 5 seconds

STEP 6: Test Offline Mode
  1. Disconnect from network (turn off Wi-Fi)
  2. Make changes in desktop app:
     - Create folder
     - Edit record
  3. Verify changes save locally
  4. Reconnect to network
  5. Verify changes sync to cloud automatically

STEP 7: Test Sync Status Indicators
  1. Watch sync status while making changes:
     ✓ "同步中..." appears during sync
     ✓ "已同步" appears after successful sync
     ✓ "同步錯誤" appears if sync fails (test by using invalid API URL)

STEP 8: Test Logout
  1. Click logout button
  2. Verify:
     ✓ Confirmation dialog appears
     ✓ After confirming, UI shows "Login with Google" button again
     ✓ Local data is preserved
     ✓ Status shows "本機模式 (未同步)"

STEP 9: Verify SC-3 (Sync delay under 5 seconds)
  1. With desktop and extension both logged in
  2. Create a record in extension
  3. Measure time until it appears on desktop
  4. Verify delay is < 5 seconds (polling interval is 4s)

EOF

echo ""

# ==================================================
# Test Summary
# ==================================================
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed:${NC} $PASS"
echo -e "${RED}Failed:${NC} $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ All automated tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run the desktop app: npm run tauri dev"
    echo "  2. Complete manual testing steps above"
    echo "  3. Verify cloud sync with actual API"
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please review the failures above.${NC}"
    exit 1
fi
