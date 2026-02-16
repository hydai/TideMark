#!/bin/bash

# Test script for Task #21: ASR API Key Management & Connection Testing

echo "=========================================="
echo "Task #21: ASR API Key Management Tests"
echo "=========================================="
echo ""

PASSED=0
FAILED=0

# Test function
test_check() {
  if [ $? -eq 0 ]; then
    echo "✓ PASSED"
    ((PASSED++))
  else
    echo "✗ FAILED"
    ((FAILED++))
  fi
  echo ""
}

# Test 1: Check ApiKeyTestResult structure exists
echo "Test 1: Check ApiKeyTestResult structure in Rust backend"
grep -q "pub struct ApiKeyTestResult" src-tauri/src/lib.rs
test_check

# Test 2: Check test_api_key command exists
echo "Test 2: Check test_api_key command implementation"
grep -q "async fn test_api_key" src-tauri/src/lib.rs
test_check

# Test 3: Check save_api_key command exists
echo "Test 3: Check save_api_key command implementation"
grep -q "async fn save_api_key" src-tauri/src/lib.rs
test_check

# Test 4: Check get_api_key command exists
echo "Test 4: Check get_api_key command implementation"
grep -q "async fn get_api_key" src-tauri/src/lib.rs
test_check

# Test 5: Check delete_api_key command exists
echo "Test 5: Check delete_api_key command implementation"
grep -q "async fn delete_api_key" src-tauri/src/lib.rs
test_check

# Test 6: Check OpenAI API test function
echo "Test 6: Check OpenAI API key testing implementation"
grep -q "async fn test_openai_api_key" src-tauri/src/lib.rs
test_check

# Test 7: Check Groq API test function
echo "Test 7: Check Groq API key testing implementation"
grep -q "async fn test_groq_api_key" src-tauri/src/lib.rs
test_check

# Test 8: Check ElevenLabs API test function
echo "Test 8: Check ElevenLabs API key testing implementation"
grep -q "async fn test_elevenlabs_api_key" src-tauri/src/lib.rs
test_check

# Test 9: Check commands are registered in invoke_handler
echo "Test 9: Check commands registered in invoke_handler"
grep -q "test_api_key," src-tauri/src/lib.rs && \
grep -q "save_api_key," src-tauri/src/lib.rs && \
grep -q "get_api_key," src-tauri/src/lib.rs && \
grep -q "delete_api_key," src-tauri/src/lib.rs
test_check

# Test 10: Check ASR API Keys section in settings frontend
echo "Test 10: Check ASR API Keys section created in settings"
grep -q "createAsrApiKeysSection" src/pages/settings.ts
test_check

# Test 11: Check API key group creation function
echo "Test 11: Check API key group creation function"
grep -q "function createApiKeyGroup" src/pages/settings.ts
test_check

# Test 12: Check ASR API keys event listeners
echo "Test 12: Check ASR API keys event listeners attached"
grep -q "attachAsrApiKeysEventListeners" src/pages/settings.ts
test_check

# Test 13: Check API key input element creation pattern
echo "Test 13: Check API key input element creation pattern"
grep -q 'input.id = `${provider}-api-key-input`' src/pages/settings.ts
test_check

# Test 14: Check API key test button creation pattern
echo "Test 14: Check API key test button creation pattern"
grep -q 'testBtn.id = `${provider}-test-btn`' src/pages/settings.ts
test_check

# Test 15: Check API key save button creation pattern
echo "Test 15: Check API key save button creation pattern"
grep -q 'saveBtn.id = `${provider}-save-btn`' src/pages/settings.ts
test_check

# Test 16: Check Records folder visibility in config
echo "Test 16: Check show_all_records_folder config field usage"
grep -q "show_all_records_folder" src/pages/records.ts
test_check

# Test 17: Check Uncategorized folder visibility in config
echo "Test 17: Check show_uncategorized_folder config field usage"
grep -q "show_uncategorized_folder" src/pages/records.ts
test_check

# Test 18: Check folder visibility filtering logic
echo "Test 18: Check folder visibility filtering logic in Records"
grep -q "const showAllRecords = config.show_all_records_folder" src/pages/records.ts && \
grep -q "const showUncategorized = config.show_uncategorized_folder" src/pages/records.ts
test_check

# Test 19: Frontend build passes
echo "Test 19: Check frontend builds successfully"
npm run build > /dev/null 2>&1
test_check

# Test 20: Backend build passes
echo "Test 20: Check backend builds successfully"
cd src-tauri && cargo build --release > /dev/null 2>&1
cd ..
test_check

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
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
