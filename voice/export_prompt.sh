#!/usr/bin/env bash
# Export Betty's prompt (default settings) from the app's single source, src/config/betty.ts, for the server's fallback
# and the evals. The app sends its own (with the rider's settings) when it connects. Voice tags off: Chirp would read
# "<laugh>" out loud. Run from anywhere: voice/export_prompt.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx -e "
import { CONFIG, bettySystemPrompt, FLAVOUR_PROMPTS } from './src/config/betty';
import { writeFileSync } from 'fs';
CONFIG.cloudVoice = 'chirp';
writeFileSync('voice/betty_prompt.txt', bettySystemPrompt(2) + '\n\n' + (FLAVOUR_PROMPTS as any).rider_query);
"
echo "voice/betty_prompt.txt: $(wc -c < voice/betty_prompt.txt) characters"
