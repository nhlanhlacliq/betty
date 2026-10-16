/**
 * What changed, in plain words for the rider, newest first. Shown in the WHAT'S NEW panel under LOG.
 * Add an entry with every change he would notice (CLAUDE.md, Conventions).
 */
export interface ChangeDay { date: string; items: string[] }

export const CHANGELOG: ChangeDay[] = [
  {
    date: '2026-10-16 (night)',
    items: [
      'History and culture: she now tells stories about the town and suburb you are riding through (how they got their names, gold, railways, famous people, culture), researched on the web once per area and kept on the phone. Ask her about the area too.',
      'With an accent voice, choose which Chirp voice says the alerts ("Chirp voice for alerts").',
      'Accents: pick from about 400 Gemini voices with real accents (Southern US, British, South African, Irish, Australian, New Zealand) under Accent on the main screen. They are Gemini only: choose "Gemini for everything" to hear the accent on alerts too.',
      'The cloud voice picker is grouped into female and male voices (14 and 16).',
      'More voice sounds: chuckle, snicker, phew, pff, tsk, yawn, throat-clearing and a short pause, alongside laugh and sigh. Hear them all with "Test sounds" on the main screen.',
      'Her stock phrases ("Hang on, let me check" and the like) are kept on the phone, so Gemini makes them once per voice instead of every ride.',
      'Pre-ride briefing: at the start of a ride she introduces herself and tells you the weather, rain chance, traffic, fuel range and how your rides together are going.',
      'Her Gemini voice can laugh and sigh now and then, and talks a touch quicker.',
      'Gemini voice for everything except alerts: answers are streamed so she starts talking after 2 to 3 seconds. Choose Full or Lite (a second sooner), and Chirp\'s accent for alerts (American by default, closer to Gemini). To go back, pick "Gemini for her own remarks only" under Cloud voice.',
      'Personality: Betty is now a blend of JARVIS (Iron Man) and TARS (Interstellar), with a humour dial. Set both in TUNING or by voice: "humour 60 percent", "humour up", "more TARS", "more JARVIS". Say "status" and she reads out her settings.',
      'Betty\'s server now runs in Cape Town: answers, voice and transcription are quicker.',
      'The page fits the phone screen: no more zooming out because of wide boxes, and no zooming in when you tap a box.',
      'TUNING: each trigger\'s priority and cooldown sit neatly on one line under its name. Rounded buttons and boxes.',
      'Cloud voice (Google): Chirp 3 HD for alerts and answers (fast), Gemini for her banter and stories, with the tone matched to the line. Pick the voice and test it on the main screen. The phone voice takes over when there is no signal.',
    ],
  },
  {
    date: '2026-10-16 (evening)',
    items: [
      'Commands: say "repeat that", "quiet for ten minutes" (or just "be quiet"), "talk to me", "mark this spot", "remember that...", or "forget that". They work at once, even without signal.',
      'Quiet stops banter, tour guide and time checks. Alerts and answers to your questions still come through.',
      'Notes and marked spots are kept across rides. Ask about them later ("where did I mark?", "what did I tell you about the chain?").',
      'New MEMORY panel to see and delete notes and spots, with a map link for each spot.',
      'This WHAT\'S NEW panel, with the version the page is running.',
    ],
  },
  {
    date: '2026-10-16',
    items: [
      'Android: headset buttons now reach Betty (the background track was too short for Chrome).',
      'VOICE TEST: "Record without call processing", needed for a Cardo Packtalk on Android. Betty listens the same way when it is ticked.',
      'She searches the web to answer questions she cannot answer from the ride, including places far away. "Hang on, let me check" covers the wait.',
      'Questions about places use her notes on them, and misheard names (Medrand, Dremiston) are taken as the nearest real place.',
      'Headset play/pause works for every question, not just the first (the mic now closes after each one).',
      '"I didn\'t hear anything. Try again?" when nothing was heard, and quieter speech is picked up.',
      'Talking to Betty never hangs on the second go.',
    ],
  },
  {
    date: '2026-10-14',
    items: [
      'Push-to-talk: press play/pause on the helmet (switch on the start screen) or TAP TO TALK on the lock screen, and ask her anything.',
      'Keys moved to Betty\'s server.',
      'CHAT panel to type to her as if riding, and VOICE TEST panel for headset buttons and the helmet mic.',
      'A road closure she has told you about is not announced again for a week.',
      'LOG opens on the latest ride.',
    ],
  },
  {
    date: '2026-10-09',
    items: [
      'Live traffic from TomTom, only incidents ahead of you that cost real time.',
      'Richer tour guide: the best story about the biggest places nearby.',
      'Her character restored after the first ride log.',
    ],
  },
  {
    date: '2026-10-08',
    items: [
      'Fuel range by distance (tap FILLED UP), sunset warning, and a spoken sign-off at END RIDE.',
      'Voice picker, rider and bike names, lock screen, screen-awake status.',
      'Every line saved in the LOG with whether it was spoken, to share after a ride.',
      'Lean, altitude, heading, hard braking and jolts from the phone.',
      'Banter about the ride (pace, cornering, stops) and memory of past rides.',
      'First version as a web app.',
    ],
  },
];
