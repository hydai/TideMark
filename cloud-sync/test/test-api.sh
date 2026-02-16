#!/bin/bash

# Test script for Tidemark Cloud Sync API
# Requires the API to be running (npm run dev)

API_URL="${API_URL:-http://localhost:8787}"

echo "Testing Tidemark Cloud Sync API at $API_URL"
echo "=============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test counter
PASS=0
FAIL=0

# Helper function to test endpoint
test_endpoint() {
  local name=$1
  local method=$2
  local path=$3
  local data=$4
  local expected_status=$5
  local headers=$6

  echo "Test: $name"

  if [ -n "$headers" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$path" \
      -H "Content-Type: application/json" \
      -H "$headers" \
      -d "$data" 2>&1)
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$path" \
      -H "Content-Type: application/json" \
      -d "$data" 2>&1)
  fi

  status_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$status_code" = "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Status: $status_code"
    echo "Response: $body"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗ FAIL${NC} - Expected: $expected_status, Got: $status_code"
    echo "Response: $body"
    FAIL=$((FAIL + 1))
  fi
  echo ""

  # Return the response body for further processing
  echo "$body"
}

# Test 1: Health check
echo "--- Test 1: Health Check ---"
test_endpoint "Health check" "GET" "/health" "" "200"

# Test 2: Auth without token (should fail)
echo "--- Test 2: Auth without token ---"
test_endpoint "Auth without token" "POST" "/auth/google" '{}' "400"

# Test 3: Auth with invalid token (should fail)
echo "--- Test 3: Auth with invalid token ---"
test_endpoint "Auth with invalid token" "POST" "/auth/google" '{"token":"invalid"}' "401"

# Test 4: Sync without JWT (should fail)
echo "--- Test 4: Sync without JWT ---"
test_endpoint "Sync without JWT" "GET" "/sync" "" "401"

# Test 5: Create record without JWT (should fail)
echo "--- Test 5: Create record without JWT ---"
test_endpoint "Create record without JWT" "POST" "/records" '{}' "401"

# Test 6: Invalid endpoint
echo "--- Test 6: Invalid endpoint ---"
test_endpoint "Invalid endpoint" "GET" "/invalid" "" "404"

# Summary
echo "=============================================="
echo "Test Summary:"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
fi
