# Betty's voice server

The conversation part of Betty, fast enough to feel like talking to someone (built 2026-10-19 from the Pipecat lab in
`labs/pipecat-quickstart`, which stays for experiments). Live at https://voice.forme.africa (Vultr Johannesburg).

```
phone (Daily) -> Deepgram, streamed hearing -> Claude Haiku as Betty + tools -> streamed Chirp 3 HD (her voice) -> phone
```

- `bot.py`: the pipeline. Interruption instant; VAD stop 0.2 s; prompt caching on; Haiku thinking OFF explicitly.
- `betty_voice/tools.py`: every tool, one place. SERVER tools: get_weather (Open-Meteo), travel_time (TomTom), web_search
  (Claude + search). PHONE tools (the app carries them out): weather_along_route, fuel_stations_ahead, recall_ride,
  my_notes_and_spots, maintenance_due, mark_spot, remember_note, filled_up, set_quiet, talk_again, reminder_done.
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
