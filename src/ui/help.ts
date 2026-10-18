import type { Command } from '../core/Commands';

/**
 * Help (owner, 2026-10-17: "a help section ... voice commands listing all of them, and whatever else is needed to
 * help the user operate and understand Betty"). Plain data, so the Garage search can find it and a test can check
 * that every voice command listed here really is understood (tests/core.test.ts runs each example through
 * parseCommand). Add a command to core/Commands.ts -> add it here.
 */
export interface VoiceCommand {
  /** What to say; the first is shown largest. Each must parse to `kind`. */
  say: string[];
  does: string;
  kind: Command['kind'];
}
export interface CommandGroup { title: string; items: VoiceCommand[] }

export const VOICE_COMMANDS: CommandGroup[] = [
  { title: 'On the ride', items: [
    { say: ['Repeat that', 'Say that again', 'What did you say?'], does: 'Her last line again. Next track on the headset does the same.', kind: 'repeat' },
    { say: ['Quiet for ten minutes', 'Be quiet', 'Give me some peace for an hour'], does: 'No banter, stories or time checks for that long (or until you say "talk to me"). Alerts and answers still come through.', kind: 'quiet' },
    { say: ['Talk to me', 'You can talk again', "I'm back"], does: 'Ends the quiet.', kind: 'talk' },
    { say: ['Anything ahead?', "What's on the horizon?", 'Horizon check'], does: 'She reads out Horizon: fuel, rain, traffic, your route, sunset, maintenance, where you are. Handy with the phone in your pocket.', kind: 'ahead' },
    { say: ['End ride', "We're done for today"], does: 'Ends the ride like the End ride button: she signs off and the ride\'s story opens.', kind: 'end' },
  ] },
  { title: 'Remembering things', items: [
    { say: ['Mark this spot', 'Mark this spot, pothole in the left lane', 'Remember this place because the coffee is good'], does: 'Saves where you are, with a note. She warns you when you come up on it again, and it shows in Explore.', kind: 'mark' },
    { say: ['Remember that the coffee at Clarens is the best', 'Make a note: tyres at 2.2 bar'], does: 'Keeps a note. She does not remind you of it by herself: ask about it any time, and it shows in Explore. For maintenance, use Reminders.', kind: 'remember' },
    { say: ['Forget that', 'Scratch that'], does: 'Removes the newest note or marked spot.', kind: 'forget' },
  ] },
  { title: 'Her personality', items: [
    { say: ['Status', 'What are your settings?'], does: 'She reads out her humour, the JARVIS/TARS blend, how chatty she is and any quiet time.', kind: 'settings' },
    { say: ['Humour 60 percent', 'Humour up', 'Less jokes'], does: 'How dry and how often she jokes (alerts are always straight).', kind: 'humour' },
    { say: ['More TARS', 'More JARVIS', 'Full TARS', 'TARS 70 percent'], does: 'Blunt and deadpan (TARS) or polished and courteous (JARVIS).', kind: 'persona' },
    { say: ['Switch to stories', 'Minimal', 'Balanced'], does: 'The talk presets from Garage: mostly stories, mostly quiet, or a mix.', kind: 'preset' },
    { say: ['More banter', 'Fewer stories', 'Less chatty', 'Talk more'], does: 'Nudges the mix of banter, stories and silence, or how often she speaks.', kind: 'mix' },
    { say: ['Banter 70 percent', 'Set stories to 50 percent', 'Silence 30 percent'], does: 'Sets that part of the mix exactly; the other two share the rest as before.', kind: 'mixset' },
    { say: ['Shorter answers', 'Longer answers'], does: 'How many sentences she uses a line (1 to 5).', kind: 'length' },
    { say: ['Save this as weekend mode', 'Switch to weekend mode', 'What mode are you in?'], does: 'Your own modes: the mix, how often she talks, line length and personality, kept under a name (also in Garage > Narration).', kind: 'mode' },
  ] },
  { title: 'Maintenance', items: [
    { say: ['Chain done', 'I lubed the chain', 'Changed the oil', 'The bike was serviced', 'Checked the tyre pressures', 'Brake fluid done'], does: 'Marks a reminder done (Garage > Reminders) and tells you when the next one is due.', kind: 'done' },
    { say: ['Chain not done', 'Undo the oil'], does: 'Takes back the last Done of that reminder, if it was a mistake.', kind: 'undone' },
  ] },
  { title: 'Fuel', items: [
    { say: ['Consumption 4.6', 'My average consumption is 4.8'], does: 'Your dash average in L/100 km: her fuel range is worked out from it.', kind: 'fuelset' },
    { say: ['Petrol price 31.20', 'Petrol is R31.20 a litre'], does: 'The price per litre for ride costs (until the next monthly price change).', kind: 'fuelset' },
  ] },
];

/** Not commands, just things she is good at answering (they go to her, with signal). */
export const GOOD_QUESTIONS = [
  'How are we doing? / How far have we come?',
  'Is it going to rain before I get home?',
  'Any traffic on my way?',
  'How much fuel have I got? / Where can I fill up?',
  'How far to go? / What\'s the next stop?',
  'Where am I? / Tell me about this area.',
  'What\'s that building on the left? (she searches)',
  'Search the web for the CFMoto 450MT price.',
  'Where was that pothole I marked?',
  'What did we talk about on Saturday? / What did you tell me about Sandton last time?',
  'Have I ridden this road before?',
  'What did I ask you to remember?',
];

export interface HelpTopic { id: string; title: string; html: string; keywords: string }

const li = (items: string[]) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;

export const HELP_TOPICS: HelpTopic[] = [
  { id: 'start', title: 'Getting started', keywords: 'begin first ride setup install home screen app',
    html: `<p>Betty is a co-pilot who talks to you through your helmet while you ride: alerts that matter, stories about where you are, a bit of banter, and answers when you ask.</p>${li([
      '<b>Install it:</b> in Safari, Share &gt; Add to Home Screen. It then opens like an app, even without signal.',
      '<b>Before the first ride:</b> in Garage, set what she calls you and the bike, your fuel figures, and switch on <i>Headset buttons</i> if you want to talk to her from the helmet.',
      '<b>Ride:</b> on the Ride tab tap <i>Let\'s ride</i>. Allow location, motion and the microphone when the phone asks. Tap <i>Filled up</i> after every fill-up so the fuel range is right.',
      '<b>What changed:</b> Garage &gt; What\'s new lists each day\'s updates as New, Better and Fixed, with <i>How it works</i> to the matching Help; the number on the Garage tab counts what you have not seen.',
      '<b>End:</b> <i>End ride</i> (or say "end ride"). She signs off and the ride\'s story opens in My journeys.',
    ])}` },
  { id: 'talk', title: 'Talking to Betty', keywords: 'headset buttons microphone mic push to talk tap play pause next previous track call mode chat type',
    html: `${li([
      '<b>Headset buttons</b> (Garage &gt; Talking to Betty): <i>play/pause</i> = talk to her (a tone, then speak; she stops listening when you pause, or after 12 seconds), <i>next track</i> = repeat her last line, <i>previous track</i> = let go: the mic closes and the buttons go back to your music. Tap <i>Give Betty the headset buttons back</i> on the ride screen to take them again.',
      'Holding the buttons pauses music from other apps: that is how the phone gives the buttons to Betty.',
      '<b>No buttons?</b> Tap the microphone on the ride screen, or <i>TAP TO TALK</i> on the lock screen.',
      '<b>Typing:</b> the speech bubble on the ride screen opens a chat; at home, the Workshop chat lets you try her out at the desk.',
      'Speak after the tone. If she says "I didn\'t hear anything", try again a bit louder; the helmet mic is picked automatically when it is connected.',
    ])}` },
  { id: 'commands', title: 'Voice commands', keywords: 'commands say phrases list voice', html: '' },
  { id: 'questions', title: 'Things to ask her', keywords: 'questions ask answer search web google',
    html: `${li(GOOD_QUESTIONS)}<p>Anything current (prices, reviews, events, news) she looks up on the web; say "search" if you want her to look something up. Common knowledge she answers herself. For better searched answers (sums, comparisons), switch on Garage &gt; Talking to Betty &gt; <i>Smarter web answers</i>: a stronger model, about 2 seconds slower and a few cents more a question.</p>` },
  { id: 'unprompted', title: 'What she tells you on her own', keywords: 'alerts warnings banter stories time checks rain traffic fuel sunset parked briefing sign off',
    html: `${li([
      '<b>Briefing</b> when you set off: weather, rain, traffic, fuel, anything worth knowing.',
      '<b>Alerts</b>, always straight: rain coming, traffic on your way, fuel getting low (with the stations ahead), sunset within 45 minutes, a spot you marked coming up, leaving your planned route, the next stop and arriving.',
      '<b>Company</b>, now and then: stories about the area (researched the first time you ride through), places nearby, banter about the ride, and time checks.',
      '<b>New roads:</b> when the last couple of kilometres are all new to her, she may remark on it ("a new one for us"). She keeps a light map of where you have ridden (about 200 m squares, on this phone), so she can also tell you how often you have ridden a road.',
      '<b>Rough patches:</b> every ride notes where you braked hard or hit a big bump (amber dots on the ride\'s map). A spot where you hit a bump on two rides, or braked hard on three, gets a heads-up as you come up on it, like a spot you marked.',
      '<b>Looking after you:</b> after two hours riding without a real break (15 minutes stopped), one hour late at night, she suggests a stop, naming the next one on your route; again every hour you ride on. Strong crosswind gusts (40 km/h and up across the bike) get a heads-up, and once a ride she mentions it when the wind chill at your speed makes it feel 5 °C or colder.',
      '<b>Parked:</b> after 10 minutes standing still she asks once whether you have parked, then keeps quiet until you ride off.',
      '<b>Sign-off</b> when you end the ride.',
      '<b>Narration</b> (Garage &gt; Betty\'s personality) sets how often she talks on her own and what about: Minimal (banter 20, stories 20, silence 60, a remark every 4 minutes), Balanced (40 / 40 / 20, every 2 minutes) or Storyteller (25 / 60 / 15, every 2 minutes). Alerts, answers, the briefing and the sign-off are not affected; time checks have their own interval. "Less chatty", "more stories" or "quiet for twenty minutes" change the same mix.',
      '<b>Stories</b>: the facts about an area are researched once and kept, but each time one comes up she tells it fresh, in her own words, with your humour and JARVIS/TARS settings. Listen in Explore reads the note as it is.',
    ])}` },
  { id: 'ridescreen', title: 'The ride screen', keywords: 'horizon island card glance map lock screen now playing quiet orb dock slim panel zoom pan',
    html: `${li([
      '<b>Horizon</b> (the dark card at the top of the map; it used to be called the island): the one thing worth a glance. Tap to open it, swipe sideways for the others (rain, route, fuel, sunset, maintenance due within 500 km or a week, the area), and use its button (Filled up, Tell me a story, Up ahead...). Garage &gt; Horizon.',
      '<b>Phone in your pocket?</b> Say "anything ahead?" and she reads Horizon out. Its top card also shows on Betty\'s Lock screen, and on the phone\'s own lock screen (Now Playing) while she has the headset buttons; switch that off in Garage &gt; Horizon &gt; On the lock screen.',
      '<b>Betty\'s orb:</b> tap the small orb to hear her last line again.',
      '<b>Quiet</b> (the headset icon): she stops chatting until you tap it again; alerts still come.',
      '<b>Lock</b> covers the screen so a glove or rain cannot press anything; hold the unlock button for a second to get out.',
      '<b>The panel</b> slides down to a slim bar (swipe down) and back (swipe up).',
      '<b>The map:</b> drag, pinch or double tap to zoom; the target button follows you again.',
    ])}` },
  { id: 'fuel', title: 'Fuel range and costs', keywords: 'fuel petrol range reserve tank consumption price cost filled up station',
    html: `${li([
      'There is no fuel sensor: Betty works the range out from the distance since you last tapped <i>Filled up</i>, your tank (11 L, 1 L reserve) and your dash average (L/100 km). Set them in Garage &gt; In your garage.',
      'Tap <i>Filled up</i> (or say "I just filled up") after every fill-up. Keep the consumption close to your dash: say "consumption 4.6" when it changes.',
      'When fuel gets low she names the stations ahead, and planning a route tells you whether it fits in a tank.',
      'Each ride keeps what it cost in petrol; My journeys shows the month. The price is looked up each month; a price you type or say counts until the next change.',
    ])}` },
  { id: 'reminders', title: 'Service reminders', keywords: 'reminders maintenance service schedule handbook bmw oil chain lube tyres tires pressures brake fluid valves air filter spark plug fork odometer due',
    html: `${li([
      '<b>The schedule:</b> Garage &gt; Reminders follows the BMW G 310 GS handbook (page 140): the standard BMW service every year; engine oil and filter every 10,000 km or yearly; air filter, spark plug, valve clearance check and fork oil every 20,000 km; fuel filters and hoses, and the intake hoses and tank vent valve, every 40,000 km or 4 years; brake fluid every 2 years.',
      '<b>Rider care</b> on top: chain clean and lube (600 km, common guidance), tyre pressures (2 weeks) and a tyre age check (5 years).',
      '<b>Set the odometer first</b> to the reading on your dash. The handbook items then line up with its milestones: at 23,450 km the oil counts as last done at 20,000, so it is due at 30,000. Betty adds every km you ride with her after that.',
      '<b>"Last done: a guess"</b> means Betty assumed it. Tap the reminder to set when it was really done (km ago and date), or tap Done if you have just done it.',
      '<b>Done:</b> tap Done, or say "chain done", "changed the oil", "the bike was serviced". It counts again from there.',
      '<b>Not done after all:</b> right after tapping Done the button reads <i>Undo</i>. Later, tap the reminder and choose <i>Mark as not done</i>, which puts it back to how it was before the last Done (for a handbook item with nothing to go back to, it returns to the handbook\'s milestone, e.g. oil last done at 20,000 km). Or say "chain not done".',
      'Tap any reminder to change its interval, rename it or delete it; <i>Add a reminder</i> makes your own (by km, by time, or both).',
      'On the ride, Horizon shows a reminder that is overdue or due within 500 km or a week ("Engine oil in 416 km").',
      'She mentions anything due or coming up in the briefing and the sign-off, and the Details sheet on the Ride tab shows the most pressing one. Ask "what\'s due?" any time. The list shows the most pressing five; Show all opens the rest.',
    ])}` },
  { id: 'routes', title: 'Planning a route', keywords: 'route where to google maps link plan twisty thrilling stops off route detour weather ahead rain arrival stay breakfast save saved ride again stories',
    html: `${li([
      'On the Ride tab, open <i>How are we riding?</i> and use <i>Where to?</i>: type places ("Heidelberg, Villiers, Clarens") or paste a directions link shared from Google Maps. Tick <i>Twisty roads</i> for a thrilling route. Tap Plan.',
      'Google Maps still gives you the turns (Open in Google Maps). Betty follows along: distance and time left, the next stop, leaving the route, fuel.',
      'Taking another way? Tell her "I\'m on a detour" and the off-route reminders stop until you are back on it.',
      '<b>Let Betty plan it:</b> describe the ride in the Where to? box ("a two-hour breakfast run, twisty roads, back by lunch") and tap <i>Or describe it and let Betty plan it</i>. She picks the stops (searching for good breakfast, coffee and roads, and varying from where you usually ride), says why, and the route is planned through them.',
      '<b>What is ahead:</b> once planned, Where to? lists each stop with the time you would get there leaving now, the weather there at that time, and how many stories Betty has ready for it (towns on the route are researched before you arrive). On the ride, <i>Up ahead</i> shows the same for the rest of the route, and Betty warns you when rain is likely somewhere ahead within two hours.',
      '<b>Stops:</b> for a breakfast or fuel stop, pick how long you will stay (10 to 90 minutes) beside it; arrival times and the time left count it.',
      '<b>Save a route</b> to ride it again: saved routes are listed above the box in Where to?; tap one to use it, × to remove it. <b>Ride this again</b> on a ride\'s page in My journeys plans that ride\'s road as a route.',
    ])}` },
  { id: 'journeys', title: 'My journeys and sharing', keywords: 'journeys rides story share card riding time stopped log export month map roads records milestones longest streak highest drawings search find star favourite rename on this day recap weeks delete remove scroll name select several short',
    html: `${li([
      'Every ride of 3 minutes or 1 km and up is kept (the last 500): the map of the road, the moments, everything she said, riding and stopped time, and the fuel cost.',
      '<b>By month:</b> this month is open; older months fold into one line with their rides, km, riding time and fuel. Tap a month to open or close it. Each ride shows a little drawing of its road (Garage &gt; In your garage &gt; Road drawings in My journeys turns them off).',
      '<b>Your roads:</b> every ride you have kept on one map; the roads you ride most come out darker. Drag and pinch to look around, tap a road to open that ride.',
      '<b>This month so far:</b> km, rides, riding time and fuel, how that compares with last month at the same point, and bars of km a week for the last 8 weeks.',
      '<b>On this day:</b> rides on today\'s date a month, three months, six months and a year ago, at the top when there are any.',
      '<b>Find a ride:</b> the search box takes a place, a month or a day ("Clarens", "October", "Saturday"); the ☆ in the search box shows only your starred rides. On a ride\'s page, <i>Star</i> keeps it as a favourite and <i>Rename</i> gives it your own name (leave it empty to go back to the automatic one).',
      '<b>Share a month:</b> <i>Share October</i> (on the month card, or at the bottom of an opened month) makes a picture of the month: every road on one map, km, rides, riding time, fuel, the places and the best thing Betty said.',
      '<b>Long names:</b> a ride name too long for the row fades at the right edge; swipe it left to read the rest. Tapping the row still opens the ride.',
      '<b>Delete a ride:</b> at the bottom of a ride\'s page, <i>Delete this ride</i>, then <i>Delete</i> to confirm. Its map, numbers and everything Betty said on it go from the phone; your fuel count and odometer stay as they are. A ride still running cannot be deleted.',
      '<b>Several at once:</b> hold a ride for half a second (or tap the pencil at the top right, which takes you down to the rides), tick rides (or <i>Select all</i> on a month, or <i>Short rides</i>: every ride under 5 minutes or 2 km, in any month, the leftovers of quick tests and restarts), then <i>★ Star</i> (or <i>☆ Unstar</i> when they are all starred) or <i>Delete</i> in the bar at the bottom; Delete asks first. <i>Done</i>, in the same bar, leaves select mode.',
      '<b>Starred only:</b> the ☆ at the end of the search box; filled ★ while it is on.',
      '<b>Records:</b> longest ride, longest in the saddle, furthest from where you set off, highest point, best month and weeks in a row, plus your next milestones: "229 of 250 km with Betty, 21 km to go" (the bar runs from the last milestone you passed to the next, marked under each end: 100, 250, 500, 1,000, 2,500 km...) and "12 rides so far, 13 more to your 25th". They count the rides kept in My journeys, so deleting rides lowers them. Tap a record to open its ride. On the ride she tells you when you pass your longest ride or a km milestone (not while you have asked for quiet). Speed is never a record.',
      '<b>Share this ride</b> makes a picture card (map, numbers, her best line). <i>Hide where I start and finish</i> keeps home off it.',
      'Ride times count only riding by default (Garage &gt; Count riding time only).',
    ])}` },
  { id: 'explore', title: 'Explore', keywords: 'explore stories areas map listen story of the day spots notes ride there',
    html: `${li([
      'Every area she has researched, with the stories you have and have not heard. Tap <i>Map</i> to see them as dots.',
      '<b>Listen</b> plays a story at home; heard to the end, she will not tell it on a ride.',
      '<b>Ride there</b> puts the place in Where to?.',
      'Your marked spots and notes are here too, with Forget.',
    ])}` },
  { id: 'trouble', title: 'Troubleshooting', keywords: 'problem not working cannot hear sound quiet volume buttons stopped mic signal offline locked wrong',
    html: `${li([
      '<b>Can\'t hear her over the wind:</b> Garage &gt; Voice &amp; audio &gt; Louder voice. Check the helmet is connected before you start the ride.',
      '<b>The headset buttons stopped working:</b> another app may have started playing (it takes the buttons), or you pressed previous track. Tap <i>Give Betty the headset buttons back</i> on the ride screen.',
      '<b>She didn\'t hear you:</b> wait for the tone, then speak. In strong wind say it a little louder; she stops after a pause or 12 seconds.',
      '<b>No signal:</b> the app still opens, commands still work and she keeps the GPS and fuel count. Alerts use lines she wrote earlier in her own words (refreshed once a day while you have signal), and area stories are read as written; answers and the cloud voice need signal, so she falls back to the phone\'s voice.',
      '<b>Screen locked:</b> with headset buttons on, she keeps working with the screen off. Without them, the phone may pause her: use Lock instead of the side button.',
      '<b>Fuel range looks wrong:</b> tap Filled up after each fill and keep the consumption up to date.',
      '<b>She got something wrong:</b> she can be. Workshop &gt; Log &gt; Share sends the ride\'s log, which shows what she was told and why.',
      '<b>Something looks old:</b> pull down at the top of a screen to refresh.',
    ])}` },
  { id: 'privacy', title: 'Your data and privacy', keywords: 'privacy data backup export import new phone location',
    html: `${li([
      'Rides, logs, notes, stories and settings stay on this phone. Garage &gt; Your data exports one file to move to a new phone.',
      '<b>Share with a friend\'s Betty:</b> on a ride\'s page, <i>Send it to a friend\'s Betty</i>, or in Explore, <i>Share your spots and stories</i>, makes a small file to send (WhatsApp, AirDrop...). Your friend opens Garage &gt; Your data &gt; Import a backup and picks it: Betty asks, then ADDS it (a ride arrives as a route to ride, spots are marked "from" you, stories she did not have are added). Nothing of theirs is replaced, and your rides do not mix into their journeys.',
      'To answer you she sends what is needed to the services she uses: your words and the ride situation to Claude, your voice to the transcription service (Whisper), her lines to Google\'s voices, your rounded position (about 1 km) for weather, traffic, places and petrol stations.',
    ])}` },
];

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const commandsHtml = (groups = VOICE_COMMANDS) => groups.map((g) => `<h3>${esc(g.title)}</h3><ul class="commands">${g.items.map((c) =>
  `<li><b>"${esc(c.say[0])}"</b>${c.say.length > 1 ? `<span class="also">${c.say.slice(1).map((s) => `"${esc(s)}"`).join(' · ')}</span>` : ''}<small>${esc(c.does)}</small></li>`).join('')}</ul>`).join('')
  + '<p class="sub">Commands work at the start of what you say ("hey Betty, quiet for ten minutes" is fine), even without signal.</p>';

/** Text of a topic, for searching. */
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const commandText = VOICE_COMMANDS.flatMap((g) => g.items.map((c) => `${g.title} ${c.say.join(' ')} ${c.does}`)).join(' ');

/** Topics that match every word of the search, best first (title, then keywords, then body). */
export function searchHelp(q: string): HelpTopic[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const score = (t: HelpTopic) => {
    const title = t.title.toLowerCase(), keys = t.keywords.toLowerCase(), body = (t.id === 'commands' ? commandText : plain(t.html)).toLowerCase();
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 3; else if (keys.includes(w)) s += 2; else if (body.includes(w)) s += 1; else return 0;
    }
    return s;
  };
  return HELP_TOPICS.map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.t);
}

/** The help screen's content: every topic folded, the voice commands written out from VOICE_COMMANDS. */
export function helpHtml(): string {
  return HELP_TOPICS.map((t) => `<details class="help-topic" id="help-${t.id}"><summary>${esc(t.title)}</summary><div class="help-body">${t.id === 'commands' ? commandsHtml() : t.html}</div></details>`).join('');
}
