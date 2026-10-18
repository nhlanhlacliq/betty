/**
 * What changed, for the rider, newest day first. Shown in Garage > What's new (and the Workshop's WHAT'S NEW).
 * Rules (owner, 2026-10-18; also in CLAUDE.md, Conventions):
 * - ONE entry per feature per day, describing how it works now. Polish of something built the same day is folded into
 *   that entry, never a new line.
 * - `new` = something he could not do before; `better` = a change to something he already had (an earlier day);
 *   `fixed` = a fix he would have noticed, to something from an earlier day. Fixes to things built the same day are
 *   not listed. Fixes do not count in the badge.
 * - A short `title` and ONE sentence of `text`; the how-to lives in Help: give `help` (a HELP_TOPICS id) when there is
 *   a topic for it.
 * - `id` is unique and never changes (read state is kept by id).
 */
export type ChangeKind = 'new' | 'better' | 'fixed';
export interface Change { id: string; kind: ChangeKind; title: string; text: string; help?: string }
export interface ChangeDay { date: string; items: Change[] }

export const CHANGELOG: ChangeDay[] = [
  {
    date: '2026-10-18',
    items: [
      { id: 'journeys-months', kind: 'better', title: 'My journeys by month.', text: 'Rides grouped by month with each month\'s numbers, a little drawing of each ride\'s road, "this month so far" with km a week, and On this day (a month, three, six and twelve months ago).', help: 'journeys' },
      { id: 'journeys-roads-records', kind: 'new', title: 'Your roads and records.', text: 'Every ride on one map with your most-ridden roads darker, your records and next milestones; on the ride Betty tells you when you pass your longest ride or a km milestone.', help: 'journeys' },
      { id: 'journeys-find', kind: 'new', title: 'Find, star, rename and delete rides.', text: 'Search by place, month or day, star favourites (☆ in the search box), rename a ride, and hold a ride (or tap the pencil) to star or delete several at once.', help: 'journeys' },
      { id: 'journeys-share-month', kind: 'new', title: 'Share a month.', text: 'A picture of the month: every road on one map, km, rides, riding time, fuel and the best thing Betty said.', help: 'journeys' },
      { id: 'horizon-ahead', kind: 'new', title: '"Anything ahead?"', text: 'Betty reads out Horizon (fuel, rain, traffic, route, sunset, maintenance, where you are) instantly, even without signal, and its top card shows on the lock screens.', help: 'ridescreen' },
      { id: 'horizon-name', kind: 'better', title: 'The island is now Horizon.', text: 'Garage > Horizon; it also shows maintenance due within 500 km or a week.', help: 'ridescreen' },
      { id: 'narration-says', kind: 'better', title: 'Narration explains itself.', text: 'Garage shows the mix it sets: how often Betty talks on her own, and how much is banter, stories and silence.', help: 'unprompted' },
    ],
  },
  {
    date: '2026-10-17',
    items: [
      { id: 'look-v3', kind: 'new', title: 'A new look.', text: 'A calm design with Betty as a little companion, a full-screen map you can drag and pinch, the ride dock, chat, swipe gestures and pull to refresh.', help: 'ridescreen' },
      { id: 'install', kind: 'new', title: 'Install Betty as an app.', text: 'Share > Add to Home Screen on iPhone (Install app on Android); it opens even without signal.', help: 'start' },
      { id: 'reminders', kind: 'new', title: 'Service reminders.', text: 'Your G 310 GS handbook schedule plus chain, tyre pressures and tyre age, counted by Betty\'s odometer; Done or Undo by tap or voice, and she mentions what is due.', help: 'reminders' },
      { id: 'fuel-range', kind: 'better', title: 'Fuel range from your bike.', text: 'Worked out from your tank and dash consumption, with the stations ahead when it gets low, a fuel check for routes and the fuel cost of every ride.', help: 'fuel' },
      { id: 'routes', kind: 'new', title: 'Routes.', text: 'Type places or paste a Google Maps link in Where to?; Betty follows along with time left, the next stop, leaving the route and arriving.', help: 'routes' },
      { id: 'island', kind: 'new', title: 'The island (now Horizon).', text: 'One card at the top of the ride map with the thing worth a glance; tap it, swipe it, use its button.', help: 'ridescreen' },
      { id: 'explore', kind: 'better', title: 'A new Explore.', text: 'One card per area, a map of your stories, Listen at home, Story of the day, Ride there and a quiet tally.', help: 'explore' },
      { id: 'journeys', kind: 'new', title: 'My journeys.', text: 'Every ride with the road you took, what she flagged and everything she said.', help: 'journeys' },
      { id: 'share-ride', kind: 'new', title: 'Share a ride.', text: 'A picture of the ride with the road, the towns along it, the weather, the numbers and her best line.', help: 'journeys' },
      { id: 'riding-time', kind: 'better', title: 'Riding time.', text: 'Rides count only the time you were moving (a Garage switch), and each shows riding and stopped time.', help: 'journeys' },
      { id: 'help', kind: 'new', title: 'Help and Garage search.', text: 'Garage > Help explains everything, every voice command included; the search at the top of Garage finds a setting fast.', help: 'start' },
      { id: 'parked', kind: 'new', title: 'Parked, and "end ride".', text: 'After 10 minutes standing still she asks once and goes quiet until you ride off; say "end ride" to finish by voice.', help: 'unprompted' },
      { id: 'search-happens', kind: 'better', title: 'Web search that happens.', text: 'Say search, Google or internet and she searches; prices, reviews and events always; common knowledge she answers herself.', help: 'questions' },
      { id: 'answers-focus', kind: 'better', title: 'Answers stick to the question.', text: 'No speed or off-route tacked on, a detour stops the off-route reminders, and no directions back (Google Maps does that).', help: 'routes' },
      { id: 'louder', kind: 'new', title: 'Louder voice.', text: 'Garage > Voice & audio, up to +16 dB for wind noise.', help: 'trouble' },
      { id: 'buttons-letgo', kind: 'better', title: 'Previous track lets go.', text: 'The mic closes and the headset buttons go back to your music; tap to give them back to Betty.', help: 'talk' },
      { id: 'talk-12s', kind: 'better', title: 'Talk for 12 seconds.', text: 'Up from 8; she still stops when you pause.', help: 'talk' },
      { id: 'filled-voice', kind: 'better', title: '"I was just filling up".', text: 'Saying it (or topped up, got petrol) counts as Filled up.', help: 'fuel' },
      { id: 'mix-voice', kind: 'new', title: 'Change her mix by voice.', text: '"Switch to stories", "banter up", "less chatty".', help: 'commands' },
      { id: 'marked-warn', kind: 'new', title: 'Marked spots warn you.', text: 'Riding towards a spot you marked, she gives you a heads-up.', help: 'commands' },
      { id: 'stories-arrive', kind: 'better', title: 'Area stories come up on their own.', text: 'Arriving somewhere new, her next remark is a story about it.', help: 'unprompted' },
      { id: 'timechecks', kind: 'better', title: 'Fresher time checks.', text: 'Each has its own angle and no reused jokes, and bumps are out of her banter.' },
      { id: 'know-me', kind: 'new', title: 'Let Betty know me.', text: 'Paste what ChatGPT or Claude knows about you; she uses it lightly.' },
      { id: 'borders', kind: 'new', title: 'Suburb borders.', text: 'Garage > The map, off by default: approximate suburb lines and names on the maps.' },
      { id: 'look-avatar', kind: 'new', title: 'Betty\'s look.', text: 'Choose your own picture or GIF for her.' },
      { id: 'backup', kind: 'new', title: 'Your data.', text: 'Export everything to one file and import it on a new phone.', help: 'privacy' },
      { id: 'gemini-steady', kind: 'better', title: 'The Gemini voice holds up.', text: 'Spaced to your paid limit and switching models when one runs out, so it no longer drops out for the whole ride; Lite is the default.' },
      { id: 'traffic-less', kind: 'better', title: 'Traffic checked less often.', text: 'Every 5 minutes, only while moving on a real ride, to save the free allowance.' },
      { id: 'end-story', kind: 'better', title: 'Ending a ride.', text: 'Its story opens straight away while she signs off.' },
      { id: 'closure-week', kind: 'fixed', title: 'No repeated closures.', text: 'The briefing no longer repeats a road closure she told you about this week.' },
      { id: 'ios-zoom', kind: 'fixed', title: 'No zooming on iPhone.', text: 'Tapping a search box or field no longer zooms the page in.' },
    ],
  },
  {
    date: '2026-10-16',
    items: [
      { id: 'web-search', kind: 'new', title: 'Web search.', text: 'She searches the web for what the ride cannot answer, places far away included; "Hang on, let me check" covers the wait.', help: 'questions' },
      { id: 'places-questions', kind: 'better', title: 'Questions about places.', text: 'She answers from her notes on them, and misheard names (Medrand, Dremiston) are taken as the nearest real place.', help: 'questions' },
      { id: 'android', kind: 'better', title: 'Android.', text: 'Headset buttons reach Betty, and a Cardo Packtalk records with "Record without call processing".' },
      { id: 'heard-nothing', kind: 'better', title: '"I didn\'t hear anything".', text: 'She says so when nothing was heard, and quieter speech is picked up.', help: 'trouble' },
      { id: 'every-question', kind: 'fixed', title: 'Every question works.', text: 'Play/pause works for every question, not just the first, and talking never hangs on the second go.' },
    ],
  },
  {
    date: '2026-10-14',
    items: [
      { id: 'push-to-talk', kind: 'new', title: 'Talk to Betty.', text: 'Press play/pause on the helmet (or TAP TO TALK on the lock screen) and ask her anything.', help: 'talk' },
      { id: 'workshop-chat', kind: 'new', title: 'Chat and voice test.', text: 'Workshop panels to type to her as if riding, and to test the headset buttons and helmet mic.' },
      { id: 'closure-known', kind: 'better', title: 'Closures once.', text: 'A road closure she has told you about is not announced again for a week.' },
      { id: 'log-latest', kind: 'better', title: 'LOG opens on the latest ride.', text: 'And any single ride or all rides can be picked.' },
    ],
  },
  {
    date: '2026-10-09',
    items: [
      { id: 'traffic', kind: 'new', title: 'Live traffic.', text: 'From TomTom: only incidents ahead of you that cost real time.' },
      { id: 'tour-guide', kind: 'better', title: 'A richer tour guide.', text: 'The best story about the biggest places nearby.' },
      { id: 'character', kind: 'fixed', title: 'Her character restored.', text: 'After the first ride log took too much of it away.' },
    ],
  },
  {
    date: '2026-10-08',
    items: [
      { id: 'first', kind: 'new', title: 'Betty, first version.', text: 'A web app that talks to you through your helmet: alerts, banter about the ride and memory of past rides.', help: 'start' },
      { id: 'fuel-sunset', kind: 'new', title: 'Fuel range, sunset and a sign-off.', text: 'Tap Filled up for a range by distance, a warning before dark, and a spoken sign-off at the end.', help: 'fuel' },
      { id: 'setup', kind: 'new', title: 'Your names, her voice, the lock screen.', text: 'Rider and bike names, a voice picker, a lock screen and the screen kept awake.' },
      { id: 'log', kind: 'new', title: 'The ride log.', text: 'Every line saved with whether it was spoken, to share after a ride.', help: 'trouble' },
      { id: 'sensors', kind: 'new', title: 'Ride sensing.', text: 'Lean, altitude, heading and hard braking from the phone.' },
    ],
  },
];
