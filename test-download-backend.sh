#!/bin/bash

echo "=== Testing Download Backend Integration ==="
echo ""

# Check yt-dlp availability
if command -v yt-dlp &> /dev/null; then
    echo "✓ yt-dlp found: $(which yt-dlp)"
else
    echo "✗ yt-dlp not found - download functionality will fail"
    exit 1
fi

# Test yt-dlp with a sample video
echo ""
echo "Testing yt-dlp download capability (dry run)..."
yt-dlp --simulate --newline --progress -f best "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | head -5

echo ""
echo "✓ Backend integration test complete"
echo ""
echo "Manual Testing Required:"
echo "1. Run 'npm run tauri dev' to start the app"
echo "2. Navigate to Download tab"
echo "3. Paste a YouTube URL"
echo "4. Configure download settings"
echo "5. Start download and verify progress tracking"
echo "6. Test pause/resume/cancel functionality"
