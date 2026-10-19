#!/usr/bin/env bash
# Push Betty's voice server to voice.forme.africa (Vultr Johannesburg) and restart it. The server's keys and the Google
# service-account file (/opt/betty/bot) are left alone. Run from anywhere: voice/deploy.sh
set -euo pipefail
HOST=root@139.84.250.9
cd "$(dirname "$0")"
./export_prompt.sh >/dev/null
rsync -az --delete --exclude .venv --exclude .env --exclude google-service-account.json --exclude __pycache__ \
  --exclude evals/results --exclude .ruff_cache ./ "$HOST:/opt/betty/bot/"
ssh "$HOST" 'chown -R betty:betty /opt/betty/bot && cd /opt/betty/bot && sudo -u betty -H env UV_CACHE_DIR=/opt/betty/.cache/uv /usr/local/bin/uv sync --frozen -q && systemctl restart betty-voice && sleep 20 && systemctl is-active betty-voice'
echo "Deployed: https://voice.forme.africa/client (pick Daily next to Connect)"
