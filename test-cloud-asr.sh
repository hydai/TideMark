#!/bin/bash

# Test script for Cloud ASR (BYOK) Transcription - Task #16

set -e

echo "========================================="
echo "Cloud ASR (BYOK) Transcription Tests"
echo "Task #16: APP-010"
echo "========================================="
echo ""

PASS=0
FAIL=0
TOTAL=0

# Test function
test_case() {
    TOTAL=$((TOTAL + 1))
    echo "Test $TOTAL: $1"
    if eval "$2"; then
        echo "✓ PASS"
        PASS=$((PASS + 1))
        echo ""
        return 0
    else
        echo "✗ FAIL"
        FAIL=$((FAIL + 1))
        echo ""
        return 1
    fi
}

echo "=== File Existence Checks ==="

test_case "Cargo.toml has multipart feature" \
    "grep -q 'reqwest.*multipart' src-tauri/Cargo.toml"

test_case "lib.rs contains start_cloud_transcription command" \
    "grep -q 'async fn start_cloud_transcription' src-tauri/src/lib.rs"

test_case "lib.rs contains split_audio_for_cloud function" \
    "grep -q 'async fn split_audio_for_cloud' src-tauri/src/lib.rs"

test_case "lib.rs contains upload_to_openai function" \
    "grep -q 'async fn upload_to_openai' src-tauri/src/lib.rs"

test_case "lib.rs contains upload_to_groq function" \
    "grep -q 'async fn upload_to_groq' src-tauri/src/lib.rs"

test_case "lib.rs contains upload_to_elevenlabs function" \
    "grep -q 'async fn upload_to_elevenlabs' src-tauri/src/lib.rs"

test_case "lib.rs contains generate_srt_from_openai function" \
    "grep -q 'fn generate_srt_from_openai' src-tauri/src/lib.rs"

test_case "lib.rs contains generate_srt_from_elevenlabs function" \
    "grep -q 'fn generate_srt_from_elevenlabs' src-tauri/src/lib.rs"

test_case "lib.rs contains merge_transcriptions_with_offset function" \
    "grep -q 'fn merge_transcriptions_with_offset' src-tauri/src/lib.rs"

echo "=== API Key Management ==="

test_case "AuthConfig has openai_api_key field" \
    "grep -A 5 'pub struct AuthConfig' src-tauri/src/lib.rs | grep -q 'openai_api_key'"

test_case "AuthConfig has groq_api_key field" \
    "grep -A 5 'pub struct AuthConfig' src-tauri/src/lib.rs | grep -q 'groq_api_key'"

test_case "AuthConfig has elevenlabs_api_key field" \
    "grep -A 5 'pub struct AuthConfig' src-tauri/src/lib.rs | grep -q 'elevenlabs_api_key'"

test_case "save_api_keys command exists" \
    "grep -q 'async fn save_api_keys' src-tauri/src/lib.rs"

test_case "save_api_keys registered in invoke_handler" \
    "grep -A 30 'invoke_handler' src-tauri/src/lib.rs | grep -q 'save_api_keys'"

echo "=== Frontend Integration ==="

test_case "subtitles.ts has checkCloudApiKey function" \
    "grep -q 'async function checkCloudApiKey' src/pages/subtitles.ts"

test_case "subtitles.ts has updateCloudTranscriptionProgress function" \
    "grep -q 'function updateCloudTranscriptionProgress' src/pages/subtitles.ts"

test_case "subtitles.ts listens to cloud-transcription-progress event" \
    "grep -q 'cloud-transcription-progress' src/pages/subtitles.ts"

test_case "Cloud engine radio buttons exist in HTML" \
    "grep -q 'name=\"cloud-engine\"' src/pages/subtitles.ts"

test_case "OpenAI engine option exists" \
    "grep -q 'value=\"openai\"' src/pages/subtitles.ts"

test_case "Groq engine option exists" \
    "grep -q 'value=\"groq\"' src/pages/subtitles.ts"

test_case "ElevenLabs engine option exists" \
    "grep -q 'value=\"elevenlabs\"' src/pages/subtitles.ts"

echo "=== Error Handling ==="

test_case "Checks for API key existence" \
    "grep -q '請先在設定中輸入.*API Key' src-tauri/src/lib.rs"

test_case "Handles invalid API key error (401)" \
    "grep -q 'API Key 無效' src-tauri/src/lib.rs"

test_case "Handles quota exceeded error (429)" \
    "grep -q 'API 額度已用盡' src-tauri/src/lib.rs"

test_case "Handles file too large error" \
    "grep -q '檔案過大' src-tauri/src/lib.rs"

echo "=== Provider Configurations ==="

test_case "OpenAI uses correct endpoint" \
    "grep -q 'api.openai.com/v1/audio/transcriptions' src-tauri/src/lib.rs"

test_case "Groq uses correct endpoint" \
    "grep -q 'api.groq.com/openai/v1/audio/transcriptions' src-tauri/src/lib.rs"

test_case "ElevenLabs uses correct endpoint" \
    "grep -q 'api.elevenlabs.io/v1/audio-to-text' src-tauri/src/lib.rs"

test_case "OpenAI uses whisper-1 model" \
    "grep -q 'whisper-1' src-tauri/src/lib.rs"

test_case "Groq uses whisper-large-v3 model" \
    "grep -q 'whisper-large-v3' src-tauri/src/lib.rs"

test_case "ElevenLabs uses scribe_v2 model" \
    "grep -q 'scribe_v2' src-tauri/src/lib.rs"

echo "=== File Segmentation ==="

test_case "Split function uses FFmpeg" \
    "grep -A 80 'async fn split_audio_for_cloud' src-tauri/src/lib.rs | grep -q 'ffmpeg'"

test_case "Split function uses ffprobe for duration" \
    "grep -A 80 'async fn split_audio_for_cloud' src-tauri/src/lib.rs | grep -q 'ffprobe'"

test_case "Checks file size before splitting" \
    "grep -A 80 'async fn split_audio_for_cloud' src-tauri/src/lib.rs | grep -q 'file_size_mb'"

test_case "Returns single file if under limit" \
    "grep -A 80 'async fn split_audio_for_cloud' src-tauri/src/lib.rs | grep -q 'File is small enough'"

echo "=== Progress Tracking ==="

test_case "CloudSegmentProgress struct exists" \
    "grep -q 'pub struct CloudSegmentProgress' src-tauri/src/lib.rs"

test_case "Emits cloud-transcription-progress event" \
    "grep -q 'cloud-transcription-progress' src-tauri/src/lib.rs"

test_case "Progress includes current_segment" \
    "grep -A 5 'CloudSegmentProgress' src-tauri/src/lib.rs | grep -q 'current_segment'"

test_case "Progress includes total_segments" \
    "grep -A 5 'CloudSegmentProgress' src-tauri/src/lib.rs | grep -q 'total_segments'"

echo "=== Build Verification ==="

test_case "Frontend builds successfully" \
    "npm run build > /dev/null 2>&1"

test_case "Backend builds successfully (release mode)" \
    "(cd src-tauri && cargo build --release > /dev/null 2>&1)"

echo "=== Command Registration ==="

test_case "start_cloud_transcription registered in invoke_handler" \
    "grep -A 30 'invoke_handler' src-tauri/src/lib.rs | grep -q 'start_cloud_transcription'"

test_case "start_transcription routes cloud engines" \
    "grep -A 10 'async fn start_transcription' src-tauri/src/lib.rs | grep -q 'start_cloud_transcription'"

echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "Total Tests: $TOTAL"
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "✓ All tests passed!"
    exit 0
else
    echo "✗ Some tests failed"
    exit 1
fi
