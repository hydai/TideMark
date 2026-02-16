#!/bin/bash

echo "=== Task #14: APP-008 Subtitles Page Verification ==="
echo ""

PASS=0
FAIL=0

# Test 1: Check subtitles.ts exists
echo "Test 1: Check subtitles.ts file exists..."
if [ -f "src/pages/subtitles.ts" ]; then
  echo "✓ PASS: subtitles.ts file exists"
  ((PASS++))
else
  echo "✗ FAIL: subtitles.ts file not found"
  ((FAIL++))
fi

# Test 2: Check renderSubtitlesPage function exists
echo "Test 2: Check renderSubtitlesPage function..."
if grep -q "export function renderSubtitlesPage" src/pages/subtitles.ts; then
  echo "✓ PASS: renderSubtitlesPage function exported"
  ((PASS++))
else
  echo "✗ FAIL: renderSubtitlesPage function not found"
  ((FAIL++))
fi

# Test 3: Check app.ts imports subtitles page
echo "Test 3: Check app.ts imports subtitles page..."
if grep -q "import.*renderSubtitlesPage.*from.*pages/subtitles" src/app.ts; then
  echo "✓ PASS: app.ts imports renderSubtitlesPage"
  ((PASS++))
else
  echo "✗ FAIL: app.ts doesn't import renderSubtitlesPage"
  ((FAIL++))
fi

# Test 4: Check file dropzone UI exists
echo "Test 4: Check file dropzone UI..."
if grep -q "file-dropzone" src/pages/subtitles.ts; then
  echo "✓ PASS: File dropzone UI present"
  ((PASS++))
else
  echo "✗ FAIL: File dropzone UI not found"
  ((FAIL++))
fi

# Test 5: Check ASR engine selection exists
echo "Test 5: Check ASR engine selection..."
if grep -q "Whisper" src/pages/subtitles.ts && grep -q "Qwen" src/pages/subtitles.ts; then
  echo "✓ PASS: Local ASR engines (Whisper, Qwen) present"
  ((PASS++))
else
  echo "✗ FAIL: Local ASR engines not found"
  ((FAIL++))
fi

# Test 6: Check cloud engines exist
echo "Test 6: Check cloud ASR engines..."
if grep -q "OpenAI" src/pages/subtitles.ts && grep -q "Groq" src/pages/subtitles.ts && grep -q "ElevenLabs" src/pages/subtitles.ts; then
  echo "✓ PASS: Cloud ASR engines (OpenAI, Groq, ElevenLabs) present"
  ((PASS++))
else
  echo "✗ FAIL: Cloud ASR engines not found"
  ((FAIL++))
fi

# Test 7: Check Whisper configuration options
echo "Test 7: Check Whisper configuration options..."
if grep -q "whisper-language" src/pages/subtitles.ts && \
   grep -q "whisper-model" src/pages/subtitles.ts && \
   grep -q "whisper-hardware" src/pages/subtitles.ts && \
   grep -q "whisper-vad" src/pages/subtitles.ts && \
   grep -q "whisper-demucs" src/pages/subtitles.ts; then
  echo "✓ PASS: Whisper config options (language, model, hardware, VAD, Demucs) present"
  ((PASS++))
else
  echo "✗ FAIL: Whisper config options incomplete"
  ((FAIL++))
fi

# Test 8: Check Qwen configuration options
echo "Test 8: Check Qwen configuration options..."
if grep -q "qwen-language" src/pages/subtitles.ts && \
   grep -q "qwen-model" src/pages/subtitles.ts && \
   grep -q "qwen-punctuation" src/pages/subtitles.ts && \
   grep -q "qwen-traditional" src/pages/subtitles.ts && \
   grep -q "qwen-max-seconds" src/pages/subtitles.ts && \
   grep -q "qwen-max-chars" src/pages/subtitles.ts; then
  echo "✓ PASS: Qwen config options (language, model, punctuation, traditional, max seconds, max chars) present"
  ((PASS++))
else
  echo "✗ FAIL: Qwen config options incomplete"
  ((FAIL++))
fi

# Test 9: Check ASR environment status panel exists
echo "Test 9: Check ASR environment status panel..."
if grep -q "python-status" src/pages/subtitles.ts && grep -q "gpu-status" src/pages/subtitles.ts; then
  echo "✓ PASS: ASR environment status panel present"
  ((PASS++))
else
  echo "✗ FAIL: ASR environment status panel not found"
  ((FAIL++))
fi

# Test 10: Check models list exists
echo "Test 10: Check models list..."
if grep -q "models-list" src/pages/subtitles.ts; then
  echo "✓ PASS: Models list UI present"
  ((PASS++))
else
  echo "✗ FAIL: Models list UI not found"
  ((FAIL++))
fi

# Test 11: Check Tauri command check_asr_environment
echo "Test 11: Check check_asr_environment Tauri command..."
if grep -q "async fn check_asr_environment" src-tauri/src/lib.rs; then
  echo "✓ PASS: check_asr_environment command exists"
  ((PASS++))
else
  echo "✗ FAIL: check_asr_environment command not found"
  ((FAIL++))
fi

# Test 12: Check Tauri command install_asr_environment
echo "Test 12: Check install_asr_environment Tauri command..."
if grep -q "async fn install_asr_environment" src-tauri/src/lib.rs; then
  echo "✓ PASS: install_asr_environment command exists"
  ((PASS++))
else
  echo "✗ FAIL: install_asr_environment command not found"
  ((FAIL++))
fi

# Test 13: Check Tauri command download_asr_model
echo "Test 13: Check download_asr_model Tauri command..."
if grep -q "async fn download_asr_model" src-tauri/src/lib.rs; then
  echo "✓ PASS: download_asr_model command exists"
  ((PASS++))
else
  echo "✗ FAIL: download_asr_model command not found"
  ((FAIL++))
fi

# Test 14: Check Tauri command get_file_duration
echo "Test 14: Check get_file_duration Tauri command..."
if grep -q "async fn get_file_duration" src-tauri/src/lib.rs; then
  echo "✓ PASS: get_file_duration command exists"
  ((PASS++))
else
  echo "✗ FAIL: get_file_duration command not found"
  ((FAIL++))
fi

# Test 15: Check Tauri command get_file_size
echo "Test 15: Check get_file_size Tauri command..."
if grep -q "async fn get_file_size" src-tauri/src/lib.rs; then
  echo "✓ PASS: get_file_size command exists"
  ((PASS++))
else
  echo "✗ FAIL: get_file_size command not found"
  ((FAIL++))
fi

# Test 16: Check commands registered in invoke_handler
echo "Test 16: Check commands registered in invoke_handler..."
if grep -q "check_asr_environment" src-tauri/src/lib.rs | grep -q "invoke_handler"; then
  echo "✓ PASS: ASR commands registered"
  ((PASS++))
else
  echo "✗ FAIL: ASR commands not registered"
  ((FAIL++))
fi

# Test 17: Check CSS styles for subtitles page
echo "Test 17: Check CSS styles for subtitles page..."
if grep -q "subtitles-page" src/style.css && \
   grep -q "file-dropzone" src/style.css && \
   grep -q "engine-tabs" src/style.css && \
   grep -q "model-card" src/style.css; then
  echo "✓ PASS: Subtitles page CSS styles present"
  ((PASS++))
else
  echo "✗ FAIL: Subtitles page CSS styles incomplete"
  ((FAIL++))
fi

# Test 18: Check handleFileSelection function
echo "Test 18: Check handleFileSelection function..."
if grep -q "async function handleFileSelection" src/pages/subtitles.ts; then
  echo "✓ PASS: handleFileSelection function exists"
  ((PASS++))
else
  echo "✗ FAIL: handleFileSelection function not found"
  ((FAIL++))
fi

# Test 19: Check drag-and-drop event handlers
echo "Test 19: Check drag-and-drop event handlers..."
if grep -q "dragover" src/pages/subtitles.ts && \
   grep -q "dragleave" src/pages/subtitles.ts && \
   grep -q "drop" src/pages/subtitles.ts; then
  echo "✓ PASS: Drag-and-drop event handlers present"
  ((PASS++))
else
  echo "✗ FAIL: Drag-and-drop event handlers incomplete"
  ((FAIL++))
fi

# Test 20: Check start transcription button
echo "Test 20: Check start transcription button..."
if grep -q "start-transcription-btn" src/pages/subtitles.ts; then
  echo "✓ PASS: Start transcription button present"
  ((PASS++))
else
  echo "✗ FAIL: Start transcription button not found"
  ((FAIL++))
fi

echo ""
echo "=== Summary ==="
echo "PASSED: $PASS/20"
echo "FAILED: $FAIL/20"

if [ $FAIL -eq 0 ]; then
  echo "✓ All tests passed!"
  exit 0
else
  echo "✗ Some tests failed"
  exit 1
fi
