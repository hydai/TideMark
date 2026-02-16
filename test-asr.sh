#!/bin/bash
# Test script for Task #15: Local ASR Transcription Execution

echo "===== Task #15: Local ASR Transcription - Test Script ====="
echo

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

function test_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((pass_count++))
}

function test_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((fail_count++))
}

function test_info() {
    echo -e "${YELLOW}ℹ INFO${NC}: $1"
}

echo "Test 1: Check Python scripts exist"
if [ -f "scripts/asr/transcribe.py" ]; then
    test_pass "transcribe.py exists"
else
    test_fail "transcribe.py not found"
fi

if [ -f "scripts/asr/requirements.txt" ]; then
    test_pass "requirements.txt exists"
else
    test_fail "requirements.txt not found"
fi

if [ -f "scripts/asr/setup_environment.sh" ]; then
    test_pass "setup_environment.sh exists"
else
    test_fail "setup_environment.sh not found"
fi

echo
echo "Test 2: Check Python scripts are executable"
if [ -x "scripts/asr/transcribe.py" ]; then
    test_pass "transcribe.py is executable"
else
    test_fail "transcribe.py is not executable"
fi

if [ -x "scripts/asr/setup_environment.sh" ]; then
    test_pass "setup_environment.sh is executable"
else
    test_fail "setup_environment.sh is not executable"
fi

echo
echo "Test 3: Check Python 3 installation"
if command -v python3 &> /dev/null; then
    version=$(python3 --version 2>&1)
    test_pass "Python 3 is installed: $version"
else
    test_fail "Python 3 is not installed"
fi

echo
echo "Test 4: Check Rust backend compilation"
if [ -f "src-tauri/target/release/libapp.dylib" ] || \
   [ -f "src-tauri/target/release/libapp.so" ] || \
   [ -f "src-tauri/target/release/app.dll" ]; then
    test_pass "Backend compiled successfully"
else
    test_fail "Backend not compiled"
fi

echo
echo "Test 5: Check frontend build"
if [ -f "dist/index.html" ]; then
    test_pass "Frontend built successfully"
else
    test_fail "Frontend not built"
fi

echo
echo "Test 6: Verify Rust ASR commands exist in source"
if grep -q "async fn install_asr_environment" src-tauri/src/lib.rs; then
    test_pass "install_asr_environment command exists"
else
    test_fail "install_asr_environment command missing"
fi

if grep -q "async fn download_asr_model" src-tauri/src/lib.rs; then
    test_pass "download_asr_model command exists"
else
    test_fail "download_asr_model command missing"
fi

if grep -q "async fn delete_asr_model" src-tauri/src/lib.rs; then
    test_pass "delete_asr_model command exists"
else
    test_fail "delete_asr_model command missing"
fi

if grep -q "async fn start_transcription" src-tauri/src/lib.rs; then
    test_pass "start_transcription command exists"
else
    test_fail "start_transcription command missing"
fi

if grep -q "async fn check_asr_environment" src-tauri/src/lib.rs; then
    test_pass "check_asr_environment command exists"
else
    test_fail "check_asr_environment command missing"
fi

echo
echo "Test 7: Check GPU detection function"
if grep -q "fn check_gpu_availability" src-tauri/src/lib.rs; then
    test_pass "check_gpu_availability function exists"
else
    test_fail "check_gpu_availability function missing"
fi

echo
echo "Test 8: Verify Python script structure"
if grep -q "def transcribe_with_whisper" scripts/asr/transcribe.py; then
    test_pass "transcribe_with_whisper function exists"
else
    test_fail "transcribe_with_whisper function missing"
fi

if grep -q "def transcribe_with_qwen" scripts/asr/transcribe.py; then
    test_pass "transcribe_with_qwen function exists"
else
    test_fail "transcribe_with_qwen function missing"
fi

if grep -q "def send_progress" scripts/asr/transcribe.py; then
    test_pass "send_progress function exists"
else
    test_fail "send_progress function missing"
fi

if grep -q "def send_complete" scripts/asr/transcribe.py; then
    test_pass "send_complete function exists"
else
    test_fail "send_complete function missing"
fi

if grep -q "def send_error" scripts/asr/transcribe.py; then
    test_pass "send_error function exists"
else
    test_fail "send_error function missing"
fi

echo
echo "Test 9: Check frontend progress tracking"
if grep -q "transcription-progress" src/pages/subtitles.ts; then
    test_pass "Progress event listener exists"
else
    test_fail "Progress event listener missing"
fi

if grep -q "transcription-complete" src/pages/subtitles.ts; then
    test_pass "Complete event listener exists"
else
    test_fail "Complete event listener missing"
fi

if grep -q "transcription-error" src/pages/subtitles.ts; then
    test_pass "Error event listener exists"
else
    test_fail "Error event listener missing"
fi

echo
echo "Test 10: Check progress UI elements"
if grep -q "transcription-progress-section" src/pages/subtitles.ts; then
    test_pass "Progress section exists in UI"
else
    test_fail "Progress section missing from UI"
fi

if grep -q "transcription-result-section" src/pages/subtitles.ts; then
    test_pass "Result section exists in UI"
else
    test_fail "Result section missing from UI"
fi

echo
echo "Test 11: Check CSS styles"
if grep -q "\.transcription-progress-section" src/style.css; then
    test_pass "Progress section CSS exists"
else
    test_fail "Progress section CSS missing"
fi

if grep -q "\.transcription-result-section" src/style.css; then
    test_pass "Result section CSS exists"
else
    test_fail "Result section CSS missing"
fi

echo
echo "Test 12: Verify JSON protocol implementation"
if grep -q '"type": "progress"' scripts/asr/transcribe.py; then
    test_pass "Progress JSON message format correct"
else
    test_fail "Progress JSON message format missing"
fi

if grep -q '"type": "complete"' scripts/asr/transcribe.py; then
    test_pass "Complete JSON message format correct"
else
    test_fail "Complete JSON message format missing"
fi

if grep -q '"type": "error"' scripts/asr/transcribe.py; then
    test_pass "Error JSON message format correct"
else
    test_fail "Error JSON message format missing"
fi

echo
echo "Test 13: Check error handling"
if grep -q "記憶體不足，請嘗試較小的模型" scripts/asr/transcribe.py; then
    test_pass "Memory error message exists"
else
    test_fail "Memory error message missing"
fi

if grep -q "GPU 不可用，已自動切換至 CPU 模式" scripts/asr/transcribe.py; then
    test_pass "GPU downgrade message exists"
else
    test_fail "GPU downgrade message missing"
fi

echo
echo "Test 14: Verify model status checking"
if grep -q "\.cache/whisper" src-tauri/src/lib.rs; then
    test_pass "Whisper cache path checking implemented"
else
    test_fail "Whisper cache path checking missing"
fi

if grep -q "\.cache/modelscope" src-tauri/src/lib.rs; then
    test_pass "Qwen cache path checking implemented"
else
    test_fail "Qwen cache path checking missing"
fi

echo
echo "Test 15: Check requirements.txt content"
if grep -q "openai-whisper" scripts/asr/requirements.txt; then
    test_pass "Whisper dependency listed"
else
    test_fail "Whisper dependency missing"
fi

if grep -q "funasr" scripts/asr/requirements.txt; then
    test_pass "FunASR dependency listed"
else
    test_fail "FunASR dependency missing"
fi

if grep -q "torch" scripts/asr/requirements.txt; then
    test_pass "PyTorch dependency listed"
else
    test_fail "PyTorch dependency missing"
fi

echo
echo "======================================"
echo "Test Summary:"
echo -e "${GREEN}Passed: $pass_count${NC}"
echo -e "${RED}Failed: $fail_count${NC}"
echo "Total: $((pass_count + fail_count))"
echo "======================================"

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
