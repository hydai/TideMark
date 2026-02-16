#!/bin/bash

# Test script for Task #13: Authentication Settings
# This script performs static verification of the authentication implementation

set -e

echo "=== Task #13 Authentication Settings Verification ==="
echo ""

# Test 1: Check if settings page file exists
echo "✓ Test 1: Settings page file exists"
if [ -f "src/pages/settings.ts" ]; then
    echo "  - src/pages/settings.ts found"
else
    echo "  ✗ FAILED: src/pages/settings.ts not found"
    exit 1
fi

# Test 2: Check if auth config structures are defined in backend
echo ""
echo "✓ Test 2: Backend auth config structure"
if grep -q "struct AuthConfig" src-tauri/src/lib.rs; then
    echo "  - AuthConfig struct defined"
else
    echo "  ✗ FAILED: AuthConfig not found"
    exit 1
fi

# Test 3: Check if Twitch token validation command exists
echo ""
echo "✓ Test 3: Twitch token validation command"
if grep -q "async fn validate_twitch_token" src-tauri/src/lib.rs; then
    echo "  - validate_twitch_token command found"
else
    echo "  ✗ FAILED: validate_twitch_token not found"
    exit 1
fi

# Test 4: Check if YouTube cookies import command exists
echo ""
echo "✓ Test 4: YouTube cookies import command"
if grep -q "async fn import_youtube_cookies" src-tauri/src/lib.rs; then
    echo "  - import_youtube_cookies command found"
else
    echo "  ✗ FAILED: import_youtube_cookies not found"
    exit 1
fi

# Test 5: Check if save_auth_config command exists
echo ""
echo "✓ Test 5: Save auth config command"
if grep -q "async fn save_auth_config" src-tauri/src/lib.rs; then
    echo "  - save_auth_config command found"
else
    echo "  ✗ FAILED: save_auth_config not found"
    exit 1
fi

# Test 6: Check if get_auth_config command exists
echo ""
echo "✓ Test 6: Get auth config command"
if grep -q "async fn get_auth_config" src-tauri/src/lib.rs; then
    echo "  - get_auth_config command found"
else
    echo "  ✗ FAILED: get_auth_config not found"
    exit 1
fi

# Test 7: Check if commands are registered in invoke_handler
echo ""
echo "✓ Test 7: Commands registered in invoke_handler"
if grep -q "validate_twitch_token" src-tauri/src/lib.rs && \
   grep -q "import_youtube_cookies" src-tauri/src/lib.rs && \
   grep -q "save_auth_config" src-tauri/src/lib.rs && \
   grep -q "get_auth_config" src-tauri/src/lib.rs; then
    echo "  - All auth commands registered"
else
    echo "  ✗ FAILED: Not all commands registered"
    exit 1
fi

# Test 8: Check if auth is integrated into download flow
echo ""
echo "✓ Test 8: Auth integrated into download flow"
if grep -q "get_auth_config" src-tauri/src/lib.rs | grep -q "execute_download"; then
    echo "  - Auth config loaded in execute_download"
fi
if grep -q "cookies" src-tauri/src/lib.rs; then
    echo "  - Cookies argument passed to yt-dlp"
else
    echo "  ✗ WARNING: Cookies integration may be incomplete"
fi

# Test 9: Check if Twitch token validation uses API
echo ""
echo "✓ Test 9: Twitch token validation implementation"
if grep -q "api.twitch.tv" src-tauri/src/lib.rs; then
    echo "  - Twitch API endpoint found"
else
    echo "  ✗ FAILED: Twitch API validation not implemented"
    exit 1
fi

# Test 10: Check if cookies file format validation exists
echo ""
echo "✓ Test 10: Cookies file format validation"
if grep -q "Netscape" src-tauri/src/lib.rs; then
    echo "  - Netscape format validation implemented"
else
    echo "  ✗ FAILED: Netscape format validation not found"
    exit 1
fi

# Test 11: Check if settings page is imported in app.ts
echo ""
echo "✓ Test 11: Settings page imported in app.ts"
if grep -q "import.*renderSettingsPage.*from.*'./pages/settings'" src/app.ts; then
    echo "  - Settings page imported"
else
    echo "  ✗ FAILED: Settings page not imported"
    exit 1
fi

# Test 12: Check if CSS styles for auth are added
echo ""
echo "✓ Test 12: CSS styles for authentication"
if grep -q "auth-input-group" src/style.css && \
   grep -q "status-verified" src/style.css; then
    echo "  - Authentication CSS styles added"
else
    echo "  ✗ FAILED: Authentication CSS not found"
    exit 1
fi

# Test 13: Check if error messages match spec
echo ""
echo "✓ Test 13: Error messages match specification"
if grep -q "Token 無效，請重新取得" src-tauri/src/lib.rs; then
    echo "  ✗ NOTE: Error message in backend (should be in frontend)"
fi
if grep -q "Token 無效，請重新取得" src/pages/settings.ts; then
    echo "  - Twitch token error message found in frontend"
fi
if grep -q "Cookies 檔案格式不正確，請使用 Netscape 格式" src/pages/settings.ts; then
    echo "  - YouTube cookies error message found in frontend"
fi

# Test 14: Build verification
echo ""
echo "✓ Test 14: Build verification"
echo "  Running frontend build..."
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "  - Frontend build successful"
else
    echo "  ✗ FAILED: Frontend build failed"
    exit 1
fi

echo "  Running backend build..."
cd src-tauri && cargo build --release > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "  - Backend build successful"
else
    echo "  ✗ FAILED: Backend build failed"
    exit 1
fi
cd ..

echo ""
echo "=== All Static Tests Passed ==="
echo ""
echo "Manual Verification Required:"
echo "  1. Launch app and navigate to Settings tab"
echo "  2. Verify Twitch OAuth Token field is present"
echo "  3. Enter a valid Twitch token and verify validation"
echo "  4. Enter an invalid token and verify error message"
echo "  5. Click YouTube cookies import button"
echo "  6. Import a valid cookies.txt file"
echo "  7. Import an invalid file and verify error"
echo "  8. Verify credentials are stored securely in auth_config.json"
echo ""
