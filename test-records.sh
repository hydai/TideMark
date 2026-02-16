#!/bin/bash

# Test script for Records Management (Task #17)
# This script verifies all acceptance criteria for APP-011

set -e

echo "=== Task #17: Records Management Test Suite ==="
echo ""

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Helper functions
pass() {
    echo "✅ PASS: $1"
    ((PASSED_TESTS++))
    ((TOTAL_TESTS++))
}

fail() {
    echo "❌ FAIL: $1"
    ((FAILED_TESTS++))
    ((TOTAL_TESTS++))
}

check_file() {
    if [ -f "$1" ]; then
        pass "File exists: $1"
    else
        fail "File missing: $1"
    fi
}

check_string_in_file() {
    if grep -q "$2" "$1"; then
        pass "Found '$2' in $1"
    else
        fail "Missing '$2' in $1"
    fi
}

echo "--- Phase 1: File Existence Checks ---"
echo ""

# Check backend files
check_file "src-tauri/src/lib.rs"

# Check frontend files
check_file "src/pages/records.ts"
check_file "src/app.ts"
check_file "src/style.css"

echo ""
echo "--- Phase 2: Backend Implementation Checks ---"
echo ""

# Check data structures
check_string_in_file "src-tauri/src/lib.rs" "pub struct Record"
check_string_in_file "src-tauri/src/lib.rs" "pub struct Folder"
check_string_in_file "src-tauri/src/lib.rs" "pub struct RecordsData"

# Check Tauri commands
check_string_in_file "src-tauri/src/lib.rs" "fn get_local_records"
check_string_in_file "src-tauri/src/lib.rs" "fn save_local_records"
check_string_in_file "src-tauri/src/lib.rs" "fn create_folder"
check_string_in_file "src-tauri/src/lib.rs" "fn update_folder"
check_string_in_file "src-tauri/src/lib.rs" "fn delete_folder"
check_string_in_file "src-tauri/src/lib.rs" "fn update_record"
check_string_in_file "src-tauri/src/lib.rs" "fn delete_record"
check_string_in_file "src-tauri/src/lib.rs" "fn search_records"
check_string_in_file "src-tauri/src/lib.rs" "fn reorder_folders"

# Check command registration
check_string_in_file "src-tauri/src/lib.rs" "get_local_records,"
check_string_in_file "src-tauri/src/lib.rs" "save_local_records,"
check_string_in_file "src-tauri/src/lib.rs" "create_folder,"
check_string_in_file "src-tauri/src/lib.rs" "update_folder,"
check_string_in_file "src-tauri/src/lib.rs" "delete_folder,"
check_string_in_file "src-tauri/src/lib.rs" "update_record,"
check_string_in_file "src-tauri/src/lib.rs" "delete_record,"
check_string_in_file "src-tauri/src/lib.rs" "search_records,"
check_string_in_file "src-tauri/src/lib.rs" "reorder_folders"

# Check records file path helper
check_string_in_file "src-tauri/src/lib.rs" "fn get_records_path"
check_string_in_file "src-tauri/src/lib.rs" "records.json"

echo ""
echo "--- Phase 3: Frontend Implementation Checks ---"
echo ""

# Check interfaces
check_string_in_file "src/pages/records.ts" "interface Record"
check_string_in_file "src/pages/records.ts" "interface Folder"
check_string_in_file "src/pages/records.ts" "interface RecordsData"
check_string_in_file "src/pages/records.ts" "interface RecordGroup"

# Check main functions
check_string_in_file "src/pages/records.ts" "export function renderRecordsPage"
check_string_in_file "src/pages/records.ts" "function loadRecords"
check_string_in_file "src/pages/records.ts" "function createSidebar"
check_string_in_file "src/pages/records.ts" "function createMainContent"
check_string_in_file "src/pages/records.ts" "function createFolderItem"
check_string_in_file "src/pages/records.ts" "function createRecordGroup"
check_string_in_file "src/pages/records.ts" "function createRecordElement"

# Check virtual folders
check_string_in_file "src/pages/records.ts" "ALL_RECORDS_ID"
check_string_in_file "src/pages/records.ts" "UNCATEGORIZED_ID"

# Check features
check_string_in_file "src/pages/records.ts" "create_folder"
check_string_in_file "src/pages/records.ts" "update_folder"
check_string_in_file "src/pages/records.ts" "delete_folder"
check_string_in_file "src/pages/records.ts" "update_record"
check_string_in_file "src/pages/records.ts" "delete_record"
check_string_in_file "src/pages/records.ts" "search_records"
check_string_in_file "src/pages/records.ts" "reorder_folders"

# Check event listeners
check_string_in_file "src/pages/records.ts" "addEventListener('dblclick'"
check_string_in_file "src/pages/records.ts" "addEventListener('dragstart'"
check_string_in_file "src/pages/records.ts" "addEventListener('drop'"

echo ""
echo "--- Phase 4: App Integration Checks ---"
echo ""

# Check app.ts imports records page
check_string_in_file "src/app.ts" "import.*renderRecordsPage.*from.*records"
check_string_in_file "src/app.ts" "case 'records':"

echo ""
echo "--- Phase 5: CSS Styling Checks ---"
echo ""

# Check records page styles
check_string_in_file "src/style.css" ".records-page"
check_string_in_file "src/style.css" ".records-container"
check_string_in_file "src/style.css" ".folders-sidebar"
check_string_in_file "src/style.css" ".folder-list"
check_string_in_file "src/style.css" ".folder-item"
check_string_in_file "src/style.css" ".records-main"
check_string_in_file "src/style.css" ".records-header"
check_string_in_file "src/style.css" ".search-box"
check_string_in_file "src/style.css" ".record-group"
check_string_in_file "src/style.css" ".record-item"
check_string_in_file "src/style.css" ".platform-badge"
check_string_in_file "src/style.css" ".record-actions"

# Check drag and drop styles
check_string_in_file "src/style.css" ".dragging"
check_string_in_file "src/style.css" ".drag-over"

echo ""
echo "--- Phase 6: Feature Coverage Checks ---"
echo ""

# Check folder management features
if grep -q "建立資料夾失敗" "src/pages/records.ts"; then
    pass "Create folder error handling"
else
    fail "Create folder error handling"
fi

if grep -q "重新命名資料夾失敗" "src/pages/records.ts"; then
    pass "Rename folder error handling"
else
    fail "Rename folder error handling"
fi

if grep -q "確定要刪除資料夾" "src/pages/records.ts"; then
    pass "Delete folder confirmation"
else
    fail "Delete folder confirmation"
fi

if grep -q "未分類" "src/pages/records.ts"; then
    pass "Uncategorized folder handling"
else
    fail "Uncategorized folder handling"
fi

# Check record management features
if grep -q "確定要刪除記錄" "src/pages/records.ts"; then
    pass "Delete record confirmation"
else
    fail "Delete record confirmation"
fi

if grep -q "更新記錄失敗" "src/pages/records.ts"; then
    pass "Update record error handling"
else
    fail "Update record error handling"
fi

# Check search functionality
if grep -q "searchQuery" "src/pages/records.ts" && grep -q "getFilteredRecords" "src/pages/records.ts"; then
    pass "Search functionality implemented"
else
    fail "Search functionality implemented"
fi

# Check grouping functionality
if grep -q "groupRecordsByTitle" "src/pages/records.ts"; then
    pass "Record grouping by title"
else
    fail "Record grouping by title"
fi

# Check drag and drop
if grep -q "draggedFolderId" "src/pages/records.ts" && grep -q "reorder_folders" "src/pages/records.ts"; then
    pass "Folder drag-and-drop reordering"
else
    fail "Folder drag-and-drop reordering"
fi

echo ""
echo "--- Phase 7: Build Verification ---"
echo ""

# Check if frontend builds
echo "Building frontend..."
if npm run build > /dev/null 2>&1; then
    pass "Frontend builds successfully"
else
    fail "Frontend build failed"
fi

# Check if backend compiles
echo "Building backend (release mode)..."
if cd src-tauri && cargo build --release > /dev/null 2>&1; then
    pass "Backend compiles successfully (release mode)"
else
    fail "Backend compilation failed"
fi
cd ..

echo ""
echo "=== Test Summary ==="
echo "Total tests: $TOTAL_TESTS"
echo "Passed: $PASSED_TESTS"
echo "Failed: $FAILED_TESTS"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo "🎉 All tests passed!"
    exit 0
else
    echo "⚠️  Some tests failed. Please review the output above."
    exit 1
fi
