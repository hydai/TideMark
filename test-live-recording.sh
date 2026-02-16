#!/bin/bash

# Test Live Stream Recording Implementation
# This script performs static verification of the live recording feature

echo "=== Task #11: Live Stream Recording - Static Verification ==="
echo ""

# Test 1: Check if yt-dlp supports live recording
echo "[Test 1] Checking yt-dlp --live-from-start support..."
if yt-dlp --help | grep -q "live-from-start"; then
    echo "✓ yt-dlp supports --live-from-start"
else
    echo "✗ yt-dlp does not support --live-from-start"
    exit 1
fi

# Test 2: Check frontend has record button
echo ""
echo "[Test 2] Checking frontend for 'Record Stream' button..."
if grep -q "record-stream-btn" src/pages/download.ts; then
    echo "✓ Frontend has record-stream-btn element"
else
    echo "✗ Frontend missing record-stream-btn"
    exit 1
fi

# Test 3: Check frontend has start_recording invoke
echo ""
echo "[Test 3] Checking frontend invokes start_recording..."
if grep -q "start_recording" src/pages/download.ts; then
    echo "✓ Frontend calls start_recording"
else
    echo "✗ Frontend missing start_recording call"
    exit 1
fi

# Test 4: Check backend has start_recording command
echo ""
echo "[Test 4] Checking backend for start_recording command..."
if grep -q "async fn start_recording" src-tauri/src/lib.rs; then
    echo "✓ Backend has start_recording command"
else
    echo "✗ Backend missing start_recording command"
    exit 1
fi

# Test 5: Check backend has stop_recording command
echo ""
echo "[Test 5] Checking backend for stop_recording command..."
if grep -q "async fn stop_recording" src-tauri/src/lib.rs; then
    echo "✓ Backend has stop_recording command"
else
    echo "✗ Backend missing stop_recording command"
    exit 1
fi

# Test 6: Check backend has execute_recording function
echo ""
echo "[Test 6] Checking backend for execute_recording function..."
if grep -q "async fn execute_recording" src-tauri/src/lib.rs; then
    echo "✓ Backend has execute_recording function"
else
    echo "✗ Backend missing execute_recording function"
    exit 1
fi

# Test 7: Check for recording status
echo ""
echo "[Test 7] Checking for 'recording' status..."
if grep -q '"recording"' src-tauri/src/lib.rs; then
    echo "✓ Backend supports 'recording' status"
else
    echo "✗ Backend missing 'recording' status"
    exit 1
fi

# Test 8: Check for stream_interrupted status
echo ""
echo "[Test 8] Checking for 'stream_interrupted' status..."
if grep -q '"stream_interrupted"' src-tauri/src/lib.rs; then
    echo "✓ Backend supports 'stream_interrupted' status"
else
    echo "✗ Backend missing 'stream_interrupted' status"
    exit 1
fi

# Test 9: Check for recording progress fields
echo ""
echo "[Test 9] Checking for recording-specific progress fields..."
if grep -q "recorded_duration" src-tauri/src/lib.rs; then
    echo "✓ Backend has recorded_duration field"
else
    echo "✗ Backend missing recorded_duration field"
    exit 1
fi

if grep -q "is_recording" src-tauri/src/lib.rs; then
    echo "✓ Backend has is_recording field"
else
    echo "✗ Backend missing is_recording field"
    exit 1
fi

# Test 10: Check CSS for recording UI
echo ""
echo "[Test 10] Checking CSS for recording styles..."
if grep -q "recording-info" src/style.css; then
    echo "✓ CSS has recording-info styles"
else
    echo "✗ CSS missing recording-info styles"
    exit 1
fi

if grep -q "stop-recording-btn" src/style.css; then
    echo "✓ CSS has stop-recording-btn styles"
else
    echo "✗ CSS missing stop-recording-btn styles"
    exit 1
fi

# Test 11: Check for live badge visibility toggle
echo ""
echo "[Test 11] Checking for live badge visibility logic..."
if grep -q "recordStreamBtn.classList.remove('hidden')" src/pages/download.ts; then
    echo "✓ Frontend shows record button for live streams"
else
    echo "✗ Frontend missing live stream button logic"
    exit 1
fi

# Test 12: Check for post-processing
echo ""
echo "[Test 12] Checking for post-processing function..."
if grep -q "post_process_recording" src-tauri/src/lib.rs; then
    echo "✓ Backend has post_process_recording function"
else
    echo "✗ Backend missing post_process_recording function"
    exit 1
fi

# Test 13: Check frontend builds
echo ""
echo "[Test 13] Building frontend..."
if npm run build > /dev/null 2>&1; then
    echo "✓ Frontend builds successfully"
else
    echo "✗ Frontend build failed"
    exit 1
fi

# Test 14: Check backend compiles
echo ""
echo "[Test 14] Building backend..."
if cd src-tauri && cargo build --release > /dev/null 2>&1; then
    echo "✓ Backend compiles successfully"
    cd ..
else
    echo "✗ Backend compilation failed"
    cd ..
    exit 1
fi

echo ""
echo "=== All static checks passed! ==="
echo ""
echo "Next steps for full verification:"
echo "1. Run the app: npm run tauri dev"
echo "2. Paste a live YouTube stream URL"
echo "3. Verify 'Live' badge and 'Record Stream' button appear"
echo "4. Click 'Record Stream' and verify recording starts"
echo "5. Verify progress shows: duration, file size, bitrate"
echo "6. Click 'Stop Recording' and verify post-processing"
echo "7. Open the recorded file and verify playback"
echo "8. Test with a Twitch live stream"
echo ""
