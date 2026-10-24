# Betty's voice server

The conversation part of Betty, fast enough to feel like talking to someone (built 2026-10-19 from the Pipecat lab in
`labs/pipecat-quickstart`, which stays for experiments). Live at https://voice.forme.africa (Vultr Johannesburg).

```
phone (Daily) -> Deepgram, streamed hearing -> Claude Haiku as Betty + tools -> streamed Chirp 3 HD (her voice) -> phone
```

- `bot.py`: the pipeline. Interruption instant; VAD stop 0.2 s; prompt caching on; Haiku thinking OFF explicitly.
- `betty_voice/tools.py`: every tool, one place. SERVER tools: get_weather (Open-Meteo), travel_time (TomTom), web_search
  (Claude + search). PHONE tools (the app carries them out): weather_along_route, fuel_stations_ahead, recall_ride,
  my_notes_and_spots, maintenance_due, mark_spot, remember_note, filled_up, set_quiet, talk_again, reminder_done,
  end_ride (2026-10-24: the phone says the sign-off and closes the ride; she was saying "ending the ride now" with no
  tool behind it). Eval cases end-ride and coffee-stop-not-end added, NOT RUN yet (evals are parked).
  Rule: small always-relevant facts come in the situation with each question; tools are for bigger or occasional
  lookups and for actions (each call costs ~1 s).
- `betty_voice/phone.py`: the message protocol with the app (Pipecat RTVI over Daily):
  server -> phone `{"t":"tool","id","name","args"}`; phone -> server client-messages `tool-result {id,result}`,
  `situation {text,lat,lon}` before each question, `setup {system, greet}` once (the app's prompt with the rider's
  settings). A phone tool with no answer in 4 s returns an error she says plainly (the browser playground has no phone).
- `betty_voice/situation.py`: the situation goes on the NEWEST question only, after the cached prompt (never breaks the
  cache); older questions lose theirs.
- `betty_voice/prompt.py`: the app's prompt (`betty_prompt.txt`, exported from `src/config/betty.ts` by
  `export_prompt.sh`, voice tags off) + the voice rules (tools, actions, no preface before a tool, answer only what was
  asked, distances from him).
- `betty_voice/chirp.py`: leading-silence trimming for any TTS, and the API-key Chirp fallback.
  `betty_voice/fillers.py`: "Let me check." when a slow tool starts, then one of 12 hmm/uhh lines after 3 s.
- `deploy.sh`: exports the prompt, pushes to the server, restarts `betty-voice`. Server keys (`/opt/betty/bot/.env`:
  ANTHROPIC, DEEPGRAM, DAILY, GOOGLE_TTS, TOMTOM) and `google-service-account.json` are never touched or committed.

## Evals

`uv run evals/run.py` (or `uv run evals/run.py <case ids>`). 22 cases in `evals/cases.json`: a ride situation, what he
said, which tools must (or must not) be used, argument checks, must / must-not phrases, and the facts of a correct
answer. Tools return the case's fixtures (repeatable, no outside services). Scored by RULES (tools, arguments, at most 3
sentences, never-say list: miles, "I'll search", sources, reading the situation out, offering navigation, markdown)
and a JUDGE (Claude Sonnet: correct from the facts, nothing invented, short enough for a bike, in character, actions
confirmed). Results: `evals/results/latest.json` (git-ignored). A few cents a run.

First runs, 2026-10-19: 17/22 -> 19/22 after three prompt fixes (answer only what was asked, never claim an action
without its tool, distances "from you") and two test fixes (the talk-again case lacked the quiet state; the station
tool now returns km_from_you). Lessons: (1) the evals caught her saying "Range reset." WITHOUT calling the tool, which
example phrases in the prompt caused; (2) answers vary run to run, so one run is not proof: next, run each case N times
and report a pass rate; (3) the judge is sometimes stricter than wanted ("keep an eye out on the way back" counted as
invented): calibrate it on cases the owner agrees with. Add a case for every bad answer found in a ride log.

Open: "Shell 5.1 km further on" (reads as beyond the first station) still slips through; travel_time matched
Edenvale -> "Cullinan" as 88 km (check which place TomTom picked); auth for the app (the server still has the browser
login only).

Phone session 2026-10-19 (first app conversation; release build, no Metro): worked end to end with the real situation
(altitude, rain) and a web search with both fillers. Fixed from it: half sentences ("No. I think I") -> the app's
BUTTON now decides the turn (body.ptt; press = ProposedUserStartedSpeakingFrame, release = ProposedUserStoppedSpeaking
Frame, ExternalUserTurnStrategies waits for the final transcript); reading the situation out / "my notes" / "not
connected", offering a lookup instead of doing it, commenting on her own answer -> prompt + never-say list + 2 cases.
`--repeat N` added: old vs new prompt both 55/72 (76%): the new one fixed reading-out and the Gautrain case but cost
rain-on-route's tool call (3/3 -> 1/3) and once called talk_again after set_quiet. Haiku-limited failures in both:
invented facts for "tell me something interesting" (0/3), padding in small talk and stories. Next candidates: one
targeted rule for weather_along_route; an eval run with Sonnet answering to see how much is the model.

OPEN MIC with the "Betty" wake word (2026-10-23; body.mode == "open"; NOT YET TRIED ON THE BIKE). Turn rules in
`open_mic_strategies` (bot.py), all Pipecat 1.12 built-ins: `WakePhraseUserTurnStartStrategy` (WAKE_PHRASES: betty and
Deepgram's mishearings, e.g. "Pitty"; awake for FOLLOW_UP_SECS 8 after activity, so follow-ups need no name; other
speech is dropped from the context), then `MinWordsUserTurnStartStrategy` (INTERRUPT_WORDS 3 while she speaks: turns
start on words, never on sound, so wind cannot cut her off), stop = `SpeechTimeoutUserTurnStopStrategy`
(OPEN_MIC_PAUSE_SECS 1.0; 0.2 s gave half sentences). Deepgram gets keyterm "Betty". The ptt message is ignored in this
mode. Test: `uv run python tests/test_open_mic.py` (the real aggregator: no name = no turn, "Betty"/"Pitty" = a turn
with the whole sentence, a follow-up in the window). Tune the four constants from the bike logs
(`journalctl -u betty-voice | grep "open mic"`).
