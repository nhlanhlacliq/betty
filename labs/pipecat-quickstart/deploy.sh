#!/usr/bin/env bash
# Push the lab bot to voice.forme.africa (Vultr Johannesburg) and restart it. Keys on the server are NOT touched
# (/opt/betty/bot/.env, ANTHROPIC_API_KEY + DEEPGRAM_API_KEY only). Run from anywhere: labs/pipecat-quickstart/deploy.sh
set -euo pipefail
HOST=root@139.84.250.9
cd "$(dirname "$0")/server"
rsync -az --delete --exclude .venv --exclude .env --exclude google-service-account.json --exclude __pycache__ --exclude .ruff_cache ./ "$HOST:/opt/betty/bot/"
ssh "$HOST" 'chown -R betty:betty /opt/betty/bot && cd /opt/betty/bot && sudo -u betty -H env UV_CACHE_DIR=/opt/betty/.cache/uv /usr/local/bin/uv sync --frozen -q && systemctl restart betty-voice && sleep 20 && systemctl is-active betty-voice'
echo "Deployed: https://voice.forme.africa/client (user betty, code = VOICE_ACCESS_CODE in the repo .env)"
