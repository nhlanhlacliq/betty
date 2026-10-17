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
  ] },
  { title: 'Maintenance', items: [
    { say: ['Chain done', 'I lubed the chain', 'The bike was serviced', 'Checked the tyre pressures'], does: 'Marks a reminder done (Garage > Reminders) and tells you when the next one is due.', kind: 'done' },
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
    html: `${li(GOOD_QUESTIONS)}<p>Anything current (prices, reviews, events, news) she looks up on the web; say "search" if you want her to look something up. Common knowledge she answers herself.</p>` },
  { id: 'unprompted', title: 'What she tells you on her own', keywords: 'alerts warnings banter stories time checks rain traffic fuel sunset parked briefing sign off',
    html: `${li([
      '<b>Briefing</b> when you set off: weather, rain, traffic, fuel, anything worth knowing.',
      '<b>Alerts</b>, always straight: rain coming, traffic on your way, fuel getting low (with the stations ahead), sunset within 45 minutes, a spot you marked coming up, leaving your planned route, the next stop and arriving.',
      '<b>Company</b>, now and then: stories about the area (researched the first time you ride through), places nearby, banter about the ride, and time checks.',
      '<b>Parked:</b> after 10 minutes standing still she asks once whether you have parked, then keeps quiet until you ride off.',
      '<b>Sign-off</b> when you end the ride.',
      'How often she talks: Garage &gt; Betty\'s personality, or say "less chatty", "minimal", "quiet for twenty minutes".',
    ])}` },
  { id: 'ridescreen', title: 'The ride screen', keywords: 'island map lock quiet orb dock slim panel zoom pan',
    html: `${li([
      '<b>The island</b> (the dark card on the map): the one thing worth a glance. Tap to open it, swipe sideways for the others (rain, route, fuel, sunset, the area), and use its button (Filled up, Tell me a story, Up ahead...). Garage &gt; The island.',
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
  { id: 'reminders', title: 'Service reminders', keywords: 'reminders maintenance service chain lube tyres tires pressures odometer due',
    html: `${li([
      'Garage &gt; Reminders: chain clean and lube (every 600 km), tyre pressures (every 2 weeks), service (every 10,000 km or a year) and a tyre age check (5 years) to start with. Check the service interval against your service book; tap a reminder to change it, or add your own.',
      '<b>Odometer:</b> Betty counts every km you ride with her. Set it to the bike\'s reading once so the numbers match your dash.',
      '<b>Done:</b> tap Done, or say "chain done" / "the bike was serviced". It counts again from there.',
      'She mentions anything due or coming up in the briefing when you set off and in the sign-off, and the Details sheet on the Ride tab shows the most pressing one. Ask "what\'s due?" any time.',
      'The starting set counts from the day you first opened Reminders: if the chain was done a while ago, tap it and set Last done.',
    ])}` },
  { id: 'routes', title: 'Planning a route', keywords: 'route where to google maps link plan twisty thrilling stops off route detour',
    html: `${li([
      'On the Ride tab, open <i>How are we riding?</i> and use <i>Where to?</i>: type places ("Heidelberg, Villiers, Clarens") or paste a directions link shared from Google Maps. Tick <i>Twisty roads</i> for a thrilling route. Tap Plan.',
      'Google Maps still gives you the turns (Open in Google Maps). Betty follows along: distance and time left, the next stop, leaving the route, fuel.',
      'Taking another way? Tell her "I\'m on a detour" and the off-route reminders stop until you are back on it.',
    ])}` },
  { id: 'journeys', title: 'My journeys and sharing', keywords: 'journeys rides story share card riding time stopped log export',
    html: `${li([
      'Every ride of 3 minutes or 1 km and up is kept: the map of the road, the moments, everything she said, riding and stopped time, and the fuel cost.',
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
      '<b>No signal:</b> the app still opens, commands still work and she keeps the GPS and fuel count; answers, stories and the cloud voice need signal, so she falls back to the phone\'s voice.',
      '<b>Screen locked:</b> with headset buttons on, she keeps working with the screen off. Without them, the phone may pause her: use Lock instead of the side button.',
      '<b>Fuel range looks wrong:</b> tap Filled up after each fill and keep the consumption up to date.',
      '<b>She got something wrong:</b> she can be. Workshop &gt; Log &gt; Share sends the ride\'s log, which shows what she was told and why.',
      '<b>Something looks old:</b> pull down at the top of a screen to refresh.',
    ])}` },
  { id: 'privacy', title: 'Your data and privacy', keywords: 'privacy data backup export import new phone location',
    html: `${li([
      'Rides, logs, notes, stories and settings stay on this phone. Garage &gt; Your data exports one file to move to a new phone.',
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
