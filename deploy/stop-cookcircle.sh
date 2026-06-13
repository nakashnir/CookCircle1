#!/usr/bin/env bash
# Stop the CookCircle web (frees port 8080)
if pkill -f 'api-server/dist/index.mjs'; then
  echo "Stopping CookCircle..."
else
  echo "CookCircle was not running."
fi
sleep 1
if ss -ltn 2>/dev/null | grep -q ':8080'; then
  echo "WARNING: something is still on port 8080."
else
  echo "Done - port 8080 is OFF."
fi
