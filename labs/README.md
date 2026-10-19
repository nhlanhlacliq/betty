# Labs

Experiments that are NOT part of the Betty apps (not deployed: `.vercelignore` excludes `labs/`).

## pipecat-quickstart (2026-10-19)

Pipecat's official quickstart (`pipecat init quickstart`), rewired so the owner can feel a streamed voice pipeline
before deciding whether Pipecat earns a place in Betty (CLAUDE.md backlog "0b", realtime pipeline / Pipecat).

- Hearing: Deepgram Nova-3, streaming (`DEEPGRAM_API_KEY`)
- Brain: Claude Haiku 5.5 as Betty (`betty_prompt.txt`, exported from `src/config/betty.ts`), prompt caching on,
  thinking OFF explicitly (Haiku 5.5 thinks by default; Pipecat 1.12 only turns it off for Sonnet)
- Voice: Deepgram Aura 2 (`aura-2-helena-en`; set `BETTY_VOICE` to try another). Chirp 3 HD needs a Google
  service-account JSON (`GOOGLE_APPLICATION_CREDENTIALS`), not the API key Betty uses.
- Keys come from the repo root `.env` (git-ignored); nothing is copied into labs.

Run it (Mac, Python 3.11+, uv):

```
cd labs/pipecat-quickstart/server
uv sync
uv run bot.py
```

Open http://localhost:7860/client, allow the microphone, click Connect, talk. The Metrics tab shows time to first
byte per service. To try it from the phone on the same Wi-Fi, the page needs HTTPS for the mic (localhost is exempt):
easiest is the Mac browser first.

Re-export her prompt after changing it:
`npx tsx -e "import {bettySystemPrompt,FLAVOUR_PROMPTS} from './src/config/betty'; ..."` (see git history of this
README's commit for the exact one-liner).

Checked 2026-10-19 (from the Mac, keys live): Deepgram heard a recorded question word for word; Aura voice first
byte ~1.2 s over plain HTTP (Pipecat streams over a socket); Claude first words ~1.0 s, cache read from the second
question (2,225 tokens). The browser playground itself was not driven end to end (automated Chromium never finished
its device setup); run it by hand. Known gap: no web search wired in, so she promises to "search" and cannot: adding
it as a Pipecat function call is a good first exercise.
