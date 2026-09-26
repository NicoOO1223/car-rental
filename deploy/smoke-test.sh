#!/usr/bin/env bash
# Proves a stack is actually serving. Used by the release pipeline after each
# deploy and by provision.ps1 after provisioning, so both apply the same bar.
#
#   deploy/smoke-test.sh <api-url> <frontend-url> [expected-business-name]
#
# Container Apps keeps a revision that fails its readiness probe out of
# traffic, so a bad deploy leaves the previous revision serving and
# `az containerapp update` still succeeds; this is what makes that visible.
set -euo pipefail

API_URL="${1:?usage: smoke-test.sh <api-url> <frontend-url> [expected-business-name]}"
FRONTEND_URL="${2:?usage: smoke-test.sh <api-url> <frontend-url> [expected-business-name]}"
EXPECTED_NAME="${3:-}"

# A scaled-to-zero app needs time to start, and a new revision needs time to
# become ready.
wait_for() {
  local url="$1"
  for attempt in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 20 "$url"; then
      echo "OK: $url"
      return 0
    fi
    echo "Waiting for $url (attempt $attempt)..."
    sleep 10
  done
  echo "FAILED: $url never became healthy"
  return 1
}

wait_for "$API_URL/ready"
wait_for "$FRONTEND_URL/login"

# The API must not expose its docs in production.
docs_status=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/docs")
if [ "$docs_status" != "404" ]; then
  echo "FAILED: $API_URL/docs returned $docs_status, expected 404"
  exit 1
fi

# Security headers are present on both sides.
curl -fsS -D - -o /dev/null "$API_URL/health" | grep -qi '^x-content-type-options: nosniff' \
  || { echo "FAILED: backend is missing security headers"; exit 1; }
curl -fsS -D - -o /dev/null "$FRONTEND_URL/login" | grep -qi '^content-security-policy-report-only' \
  || { echo "FAILED: frontend is missing its CSP header"; exit 1; }

# The frontend must be talking to THIS stack's API: its policy names it, and
# its page hands it to the browser. A stack pointing at the wrong backend
# (or at the localhost default) is the failure a shared image can produce.
api_origin=$(printf '%s' "$API_URL" | sed -E 's#^(https?://[^/]+).*#\1#')
page=$(curl -fsS "$FRONTEND_URL/login")
printf '%s' "$page" | grep -q "\"apiUrl\":\"$api_origin" \
  || { echo "FAILED: the frontend is not configured for $api_origin"; exit 1; }

# The business shown on the sign-in page is the one this stack was set up for.
if [ -n "$EXPECTED_NAME" ]; then
  branding=$(curl -fsS "$API_URL/api/branding")
  printf '%s' "$branding" | grep -q "\"business_name\":\"$EXPECTED_NAME\"" \
    || { echo "FAILED: /api/branding does not report the business name '$EXPECTED_NAME'"; exit 1; }
fi

echo "Smoke test passed for $API_URL"
