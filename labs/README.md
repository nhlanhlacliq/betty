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
question (2,225 tokens). Driven end to end the same day (owner allowed mic access; questions typed into the playground, since the automated
browser's fake mic sends no audio): question -> Claude first words 0.81-0.88 s (cache read ~2,100 tokens) -> Deepgram
voice first audio 0.38-0.45 s over Pipecat's socket -> she speaks ~1.5-1.6 s after the question (Betty today: ~5-7 s
including transcription). Streaming hearing adds roughly 0.2-0.5 s after he stops talking (not measured here). Her
prompt is exported with voice tags OFF (Deepgram would read <laugh> out loud). Known gap: no web search wired in, so
she says she will "look it up" and cannot: adding it as a Pipecat function call is a good first exercise.

## The server: voice.forme.africa (2026-10-19)

The same bot, live at **https://voice.forme.africa/client** (browser login: user `betty`, password = `VOICE_ACCESS_CODE`
in the repo `.env`). Measured there: question -> her voice ~1.55 s (Claude ~0.9 s, Deepgram voice ~0.4 s).

- Vultr, Johannesburg, Regular Performance 1 GB / 1 vCPU / 25 GB (~$5-6 a month), Ubuntu 26.04, IP 139.84.250.9.
  DNS: A record `voice` -> that IP at Namecheap (forme.africa's DNS is at Namecheap; the main site is on Vercel).
- Access: root over SSH with the Mac's ed25519 key, AND root password login KEPT ON (owner's choice); fail2ban guards
  SSH. ufw allows 22, 80, 443 and UDP 32768-60999 (WebRTC media: aiortc uses the kernel's ephemeral ports). 2 GB
  swap (the 1 GB of RAM is tight with Pipecat ~880 MB installed). Unattended security upgrades on.
- Caddy 2.6 (Ubuntu package: the directive is `basicauth`, not `basic_auth`) does HTTPS (Let's Encrypt, automatic)
  and the login, and proxies to the bot on 127.0.0.1:7860.
- The bot runs as the `betty` system user from `/opt/betty/bot`, systemd unit `betty-voice` (restarts itself; logs:
  `journalctl -u betty-voice -f`). Keys in `/opt/betty/bot/.env` (mode 600): only ANTHROPIC_API_KEY and DEEPGRAM_API_KEY.
- Redeploy after changing the bot or her prompt: `labs/pipecat-quickstart/deploy.sh`.
- No TURN relay yet: the server has a public IP, so phones behind carrier NAT should still connect directly. If a
  phone on mobile data connects but hears nothing, add coturn on this server.

Phone test, same day: patchy audio and "stops, then carries on with the old sentence" on the phone (Wi-Fi and mobile),
seamless from the Mac's browser. Not CPU (~10% during a conversation, no steal) and not NAT (it connected): the log
showed "user started speaking" every few seconds while she spoke = her own voice from the phone's loudspeaker coming
back through the mic (echo), each one an interruption; with no words to answer, the audio already sent played on.
Fix deployed: interruptions need WORDS (`MinWordsUserTurnStartStrategy(min_words=2)` while she speaks, 1 when quiet),
also right for wind/engine noise on the bike. If it is still patchy on the loudspeaker, test with earphones; then
Daily's transport (better echo cancellation and mobile resilience, recommended by Pipecat for production) is the
next lever.

Switched back the same day (owner): instant interruption on any speech (~0.3 s); he tests with earphones, where there
is no echo. The 2-word rule took ~1.5-2 s to stop her. Native app: pick by audio route (loudspeaker = words, earphones /
helmet = instant); Krisp "interruption prediction" (paid) is the smarter option for both.

Web search (same day): `web_search` Pipecat function -> Claude Haiku with web search (Gauteng, km, rand), "Let me
check." spoken when it starts; VAD stop 0.4 s (was 0.2) so a pause mid-sentence does not hand her a fragment. Live:
Cullinan weather answered correctly, BUT slow: search ~7.5 s on the server (3.3 s from the Mac), and "Let me check"
only started after ~3.5 s (Deepgram TTS held it). Next: a pre-made "let me check" clip (instant), and fast specific
tools before web search (weather from Open-Meteo ~0.3 s, as the app does; places; route), web search as the fallback.

Daily transport (same day): scratches and skipped words remained on SmallWebRTC; a Deepgram TTS websocket then dropped on a
"keepalive ping timeout" = the Python event loop stalling on the 1 shared core (the same stalls drop audio packets).
Fix: Daily WebRTC (audio sent by daily-python native code; better AEC/mobile handling). DAILY_API_KEY in the repo .env
and the server .env; the runner serves both transports: pick "Daily" in the playground dropdown next to Connect.
Cost (daily.co video-sdk pricing): 10,000 participant-minutes free a month, then audio-only $0.00099/participant-min;
bot + rider = 2 participant-minutes a minute. Joining a room takes ~2.7 s per session. Also added: get_weather tool
(Open-Meteo, places cached, one kept-open session), "Let me check." pre-made clip sent straight to the output.
