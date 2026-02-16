#!/bin/bash

# Test script for Task #22: GPU Acceleration Settings & About/Update

echo "========================================="
echo "Task #22: GPU & About Settings Verification"
echo "========================================="
echo ""

PASSED=0
FAILED=0

# Test 1: Check frontend AppConfig has GPU settings
echo "[Test 1] Checking frontend AppConfig GPU settings..."
if grep -q "enable_hardware_encoding: boolean" src/config.ts && \
   grep -q "hardware_encoder: string" src/config.ts && \
   grep -q "enable_frontend_acceleration: boolean" src/config.ts; then
    echo "✓ Frontend AppConfig has GPU settings"
    ((PASSED++))
else
    echo "✗ Frontend AppConfig missing GPU settings"
    ((FAILED++))
fi

# Test 2: Check frontend default config values
echo "[Test 2] Checking frontend GPU default values..."
if grep -q "enable_hardware_encoding: false" src/config.ts && \
   grep -q "hardware_encoder: 'auto'" src/config.ts && \
   grep -q "enable_frontend_acceleration: true" src/config.ts; then
    echo "✓ Frontend GPU default values correct"
    ((PASSED++))
else
    echo "✗ Frontend GPU default values incorrect"
    ((FAILED++))
fi

# Test 3: Check backend AppConfig GPU settings
echo "[Test 3] Checking backend AppConfig GPU settings..."
if grep -q "enable_hardware_encoding: bool" src-tauri/src/lib.rs && \
   grep -q "hardware_encoder: String" src-tauri/src/lib.rs && \
   grep -q "enable_frontend_acceleration: bool" src-tauri/src/lib.rs; then
    echo "✓ Backend AppConfig has GPU settings"
    ((PASSED++))
else
    echo "✗ Backend AppConfig missing GPU settings"
    ((FAILED++))
fi

# Test 4: Check backend default implementation
echo "[Test 4] Checking backend Default implementation..."
if grep -q "enable_hardware_encoding: false" src-tauri/src/lib.rs && \
   grep -q "hardware_encoder: default_hardware_encoder()" src-tauri/src/lib.rs && \
   grep -q "enable_frontend_acceleration: true" src-tauri/src/lib.rs; then
    echo "✓ Backend Default implementation has GPU settings"
    ((PASSED++))
else
    echo "✗ Backend Default implementation missing GPU settings"
    ((FAILED++))
fi

# Test 5: Check ToolVersions structure
echo "[Test 5] Checking ToolVersions structure..."
if grep -q "pub struct ToolVersions" src-tauri/src/lib.rs && \
   grep -q "yt_dlp_version: Option<String>" src-tauri/src/lib.rs && \
   grep -q "ffmpeg_version: Option<String>" src-tauri/src/lib.rs; then
    echo "✓ ToolVersions structure defined"
    ((PASSED++))
else
    echo "✗ ToolVersions structure not found"
    ((FAILED++))
fi

# Test 6: Check UpdateStatus structure
echo "[Test 6] Checking UpdateStatus structure..."
if grep -q "pub struct UpdateStatus" src-tauri/src/lib.rs && \
   grep -q "has_update: bool" src-tauri/src/lib.rs && \
   grep -q "current_version: String" src-tauri/src/lib.rs; then
    echo "✓ UpdateStatus structure defined"
    ((PASSED++))
else
    echo "✗ UpdateStatus structure not found"
    ((FAILED++))
fi

# Test 7: Check get_app_version command
echo "[Test 7] Checking get_app_version command..."
if grep -q "fn get_app_version() -> Result<String, String>" src-tauri/src/lib.rs; then
    echo "✓ get_app_version command implemented"
    ((PASSED++))
else
    echo "✗ get_app_version command not found"
    ((FAILED++))
fi

# Test 8: Check get_tool_versions command
echo "[Test 8] Checking get_tool_versions command..."
if grep -q "async fn get_tool_versions() -> Result<ToolVersions, String>" src-tauri/src/lib.rs; then
    echo "✓ get_tool_versions command implemented"
    ((PASSED++))
else
    echo "✗ get_tool_versions command not found"
    ((FAILED++))
fi

# Test 9: Check check_for_updates command
echo "[Test 9] Checking check_for_updates command..."
if grep -q "async fn check_for_updates() -> Result<UpdateStatus, String>" src-tauri/src/lib.rs; then
    echo "✓ check_for_updates command implemented"
    ((PASSED++))
else
    echo "✗ check_for_updates command not found"
    ((FAILED++))
fi

# Test 10: Check get_available_hardware_encoders command
echo "[Test 10] Checking get_available_hardware_encoders command..."
if grep -q "fn get_available_hardware_encoders() -> Result<Vec<String>, String>" src-tauri/src/lib.rs; then
    echo "✓ get_available_hardware_encoders command implemented"
    ((PASSED++))
else
    echo "✗ get_available_hardware_encoders command not found"
    ((FAILED++))
fi

# Test 11: Check commands registered in invoke_handler
echo "[Test 11] Checking commands registered..."
if grep -q "get_app_version," src-tauri/src/lib.rs && \
   grep -q "get_tool_versions," src-tauri/src/lib.rs && \
   grep -q "check_for_updates," src-tauri/src/lib.rs && \
   grep -q "get_available_hardware_encoders" src-tauri/src/lib.rs; then
    echo "✓ New commands registered in invoke_handler"
    ((PASSED++))
else
    echo "✗ Commands not registered properly"
    ((FAILED++))
fi

# Test 12: Check GPU section in settings.ts
echo "[Test 12] Checking GPU section creation..."
if grep -q "function createGpuSection()" src/pages/settings.ts && \
   grep -q "GPU 加速設定" src/pages/settings.ts; then
    echo "✓ GPU section created"
    ((PASSED++))
else
    echo "✗ GPU section not found"
    ((FAILED++))
fi

# Test 13: Check About section in settings.ts
echo "[Test 13] Checking About section creation..."
if grep -q "function createAboutSection()" src/pages/settings.ts && \
   grep -q "關於 Tidemark" src/pages/settings.ts; then
    echo "✓ About section created"
    ((PASSED++))
else
    echo "✗ About section not found"
    ((FAILED++))
fi

# Test 14: Check GPU event listeners
echo "[Test 14] Checking GPU event listeners..."
if grep -q "function attachGpuEventListeners" src/pages/settings.ts; then
    echo "✓ GPU event listeners implemented"
    ((PASSED++))
else
    echo "✗ GPU event listeners not found"
    ((FAILED++))
fi

# Test 15: Check About event listeners
echo "[Test 15] Checking About event listeners..."
if grep -q "function attachAboutEventListeners" src/pages/settings.ts; then
    echo "✓ About event listeners implemented"
    ((PASSED++))
else
    echo "✗ About event listeners not found"
    ((FAILED++))
fi

# Test 16: Check sections added to render function
echo "[Test 16] Checking sections added to render..."
if grep -q "const gpuSection = createGpuSection()" src/pages/settings.ts && \
   grep -q "const aboutSection = createAboutSection()" src/pages/settings.ts; then
    echo "✓ Sections added to render function"
    ((PASSED++))
else
    echo "✗ Sections not added to render"
    ((FAILED++))
fi

# Test 17: Check event listeners attached
echo "[Test 17] Checking event listeners attached..."
if grep -q "attachGpuEventListeners(container)" src/pages/settings.ts && \
   grep -q "attachAboutEventListeners(container)" src/pages/settings.ts; then
    echo "✓ Event listeners attached"
    ((PASSED++))
else
    echo "✗ Event listeners not attached"
    ((FAILED++))
fi

# Test 18: Build frontend
echo "[Test 18] Building frontend..."
if npm run build > /dev/null 2>&1; then
    echo "✓ Frontend builds successfully"
    ((PASSED++))
else
    echo "✗ Frontend build failed"
    ((FAILED++))
fi

# Test 19: Build backend (release mode)
echo "[Test 19] Building backend (release mode)..."
if cd src-tauri && cargo build --release > /dev/null 2>&1; then
    echo "✓ Backend builds successfully"
    ((PASSED++))
else
    echo "✗ Backend build failed"
    ((FAILED++))
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
    echo "✗ Some tests failed!"
    exit 1
fi
