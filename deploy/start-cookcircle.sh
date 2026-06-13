#!/usr/bin/env bash
set -e
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
APP="$HOME/apps/cookcircle"
if ss -ltn 2>/dev/null | grep -q ':8080'; then
  echo "CookCircle is already running: http://vmedu470.mtacloud.co.il:8080"; exit 0
fi
set -a; source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$APP/.env"); set +a
nohup node --enable-source-maps "$APP/artifacts/api-server/dist/index.mjs" > "$HOME/cookcircle-server.log" 2>&1 &
sleep 3
if curl -s --max-time 5 http://127.0.0.1:8080/api/healthz | grep -q '"status":"ok"'; then
  echo "CookCircle started. Open: http://vmedu470.mtacloud.co.il:8080"
else
  echo "Start may have failed - check ~/cookcircle-server.log"
fi
