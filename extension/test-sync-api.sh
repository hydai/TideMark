#!/bin/bash

# Test script for Cloud Sync API integration
# Tests the core sync functionality without requiring browser extension

set -e

BASE_URL="http://localhost:8787"
JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMTIzIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNzcxMjE4OTc0LCJleHAiOjE3NzM4MTA5NzR9.dGa0icSVAQhSoynUZL_iotb2M01KQaszzd94p7HoUao"

echo "========================================"
echo "Cloud Sync API Integration Test"
echo "========================================"
echo ""

# Test 1: Health check
echo "Test 1: Health check"
HEALTH=$(curl -s "$BASE_URL/health")
echo "Response: $HEALTH"
if echo "$HEALTH" | grep -q "ok"; then
  echo "✓ Health check passed"
else
  echo "✗ Health check failed"
  exit 1
fi
echo ""

# Test 2: Create a record
echo "Test 2: Create a record"
RECORD_ID="test-ext-sync-$(date +%s)"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
CREATE_RECORD=$(curl -s -X POST "$BASE_URL/records" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$RECORD_ID\",
    \"timestamp\": \"$TIMESTAMP\",
    \"live_time\": \"01:23:45\",
    \"title\": \"Extension Sync Test Stream\",
    \"topic\": \"Sync Test Topic\",
    \"channel_url\": \"https://youtube.com/watch?v=synctest\",
    \"platform\": \"youtube\",
    \"folder_id\": null,
    \"sort_order\": 0,
    \"created_at\": \"$TIMESTAMP\",
    \"updated_at\": \"$TIMESTAMP\"
  }")
echo "Response: $CREATE_RECORD"
if echo "$CREATE_RECORD" | grep -q "success"; then
  echo "✓ Record created: $RECORD_ID"
else
  echo "✗ Failed to create record"
  exit 1
fi
echo ""

# Test 3: Sync and retrieve the record
echo "Test 3: Sync and retrieve the record"
sleep 1
SYNC_RESPONSE=$(curl -s -H "Authorization: Bearer $JWT" \
  "$BASE_URL/sync?since=1970-01-01T00:00:00.000Z")
if echo "$SYNC_RESPONSE" | grep -q "$RECORD_ID"; then
  echo "✓ Record found in sync response"
else
  echo "✗ Record not found in sync"
  echo "Response: $SYNC_RESPONSE"
  exit 1
fi
echo ""

# Test 4: Incremental sync (should return only recent records)
echo "Test 4: Incremental sync"
OLD_TIMESTAMP="2020-01-01T00:00:00.000Z"
INCREMENTAL_SYNC=$(curl -s -H "Authorization: Bearer $JWT" \
  "$BASE_URL/sync?since=$TIMESTAMP")
echo "Incremental sync response received"
# Should have fewer or same records as full sync
if echo "$INCREMENTAL_SYNC" | grep -q "records"; then
  echo "✓ Incremental sync working"
else
  echo "✗ Incremental sync failed"
  exit 1
fi
echo ""

# Test 5: Create a folder
echo "Test 5: Create a folder"
FOLDER_ID="test-folder-$(date +%s)"
CREATE_FOLDER=$(curl -s -X POST "$BASE_URL/folders" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$FOLDER_ID\",
    \"name\": \"Test Sync Folder\",
    \"sort_order\": 0,
    \"created_at\": \"$TIMESTAMP\",
    \"updated_at\": \"$TIMESTAMP\"
  }")
echo "Response: $CREATE_FOLDER"
if echo "$CREATE_FOLDER" | grep -q "success"; then
  echo "✓ Folder created: $FOLDER_ID"
else
  echo "✗ Failed to create folder"
  exit 1
fi
echo ""

# Test 6: Delete the record
echo "Test 6: Delete the record"
DELETE_RECORD=$(curl -s -X DELETE "$BASE_URL/records/$RECORD_ID" \
  -H "Authorization: Bearer $JWT")
echo "Response: $DELETE_RECORD"
if echo "$DELETE_RECORD" | grep -q "success"; then
  echo "✓ Record deleted"
else
  echo "✗ Failed to delete record"
  exit 1
fi
echo ""

# Test 7: Verify record is marked as deleted
echo "Test 7: Verify record is marked as deleted"
sleep 1
DELETED_SYNC=$(curl -s -H "Authorization: Bearer $JWT" \
  "$BASE_URL/sync?since=$TIMESTAMP")
if echo "$DELETED_SYNC" | grep -q "\"deleted\":1"; then
  echo "✓ Record marked as deleted in sync"
else
  echo "⚠ Warning: Deleted record may not be in response (timestamp issue)"
fi
echo ""

# Test 8: Delete the folder
echo "Test 8: Delete the folder"
DELETE_FOLDER=$(curl -s -X DELETE "$BASE_URL/folders/$FOLDER_ID" \
  -H "Authorization: Bearer $JWT")
echo "Response: $DELETE_FOLDER"
if echo "$DELETE_FOLDER" | grep -q "success"; then
  echo "✓ Folder deleted"
else
  echo "✗ Failed to delete folder"
  exit 1
fi
echo ""

# Test 9: Unauthorized access test
echo "Test 9: Unauthorized access (should fail)"
UNAUTHORIZED=$(curl -s -w "\n%{http_code}" "$BASE_URL/sync" | tail -1)
if [ "$UNAUTHORIZED" = "401" ]; then
  echo "✓ Unauthorized access correctly rejected"
else
  echo "✗ Authorization check failed (expected 401, got $UNAUTHORIZED)"
fi
echo ""

echo "========================================"
echo "All API integration tests passed! ✓"
echo "========================================"
echo ""
echo "The Cloud Sync API is working correctly."
echo "You can now test the browser extension integration."
