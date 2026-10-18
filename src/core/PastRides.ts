import type { LogEntry } from './LineLog';
import type { RideRecord } from './RideMemory';

/**
 * Memory across rides (owner's backlog, 2026-10-18: "what did we talk about on Saturday?"): when his question reaches
 * back to an earlier ride, find it (a day, "yesterday", "last ride", "last week", a place) and give her what was said
 * on it, so she answers from the saved log instead of guessing. Pure, so it is tested.
 */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Words that mean he is asking about an earlier ride. */
export const PAST_CUE = new RegExp(`\\b(yesterday|last (ride|time|week|weekend|night|month)|the other day|remember|did we|we talked|we spoke|you (said|told|mentioned)|that ride|ago|${DAYS.join('|')}|\\d{1,2}(st|nd|rd|th)? (of )?(${MONTHS.join('|')}))\\b`, 'i');

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const DAY = 86_400_000;

/** The earlier rides his words point at (newest first, at most 3), or [] when they point at none. */
export function pickRides(rides: RideRecord[], said: string, now: number): RideRecord[] {
  const low = said.toLowerCase();
  const past = rides.filter((r) => r.startedAt < now - 10 * 60_000).sort((a, b) => b.startedAt - a.startedAt);
  if (!past.length || !PAST_CUE.test(low)) return [];
  const today = new Date(now);
  let hit: RideRecord[] = [];
  if (/\byesterday\b/.test(low)) hit = past.filter((r) => sameDay(r.startedAt, now - DAY));
  else if (/\blast week(end)?\b/.test(low)) hit = past.filter((r) => r.startedAt >= now - 8 * DAY && !sameDay(r.startedAt, now));
  else if (/\blast month\b/.test(low)) hit = past.filter((r) => new Date(r.startedAt).getMonth() === (today.getMonth() + 11) % 12);
  else {
    const day = DAYS.findIndex((d) => low.includes(d));
    const date = low.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTHS.join('|')})\\b`));
    if (day >= 0) {
      // The most recent such day before today (a week at most), all rides that day.
      const back = ((today.getDay() - day + 7) % 7) || 7;
      hit = past.filter((r) => sameDay(r.startedAt, now - back * DAY));
    } else if (date) {
      hit = past.filter((r) => { const d = new Date(r.startedAt); return d.getDate() === Number(date[1]) && d.getMonth() === MONTHS.indexOf(date[2]); });
    }
  }
  // A place he names narrows it (or finds it): rides that talked about it.
  const placed = past.filter((r) => r.places.some((p) => p.length >= 4 && low.includes(p.toLowerCase())));
  if (placed.length) hit = hit.length ? hit.filter((r) => placed.includes(r)) : placed;
  if (!hit.length && /\b(last (ride|time)|that ride|remember|did we|we talked|you (said|told|mentioned))\b/.test(low)) hit = past.slice(0, 1);
  return hit.slice(0, 3);
}

const clean = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
/** What a ride was like, from its record and log: when, how far, where, the best of what she said, what he asked. */
export function recallRide(r: RideRecord, entries: LogEntry[]): string {
  const lines = entries.filter((e) => e.rideId === r.startedAt);
  const hers = lines.filter((e) => /^\[P\d\] (area_story|local_fact|rider_query|ambient_banter|ride_debrief|ride_record|new_road)/.test(e.head) && e.text && !e.text.startsWith('('))
    .map((e) => clean(e.text)).filter((t) => t.length > 20);
  const his = lines.map((e) => e.text.match(/^heard "(.+)" in \d+ ms/)?.[1]).filter((x): x is string => !!x && x.split(' ').length >= 3);
  const when = new Date(r.startedAt).toLocaleString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const pick = (xs: string[], n: number) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]));
  return `${when}: ${r.distanceKm} km${r.places.length ? `, through ${r.places.slice(0, 6).join(', ')}` : ''}.`
    + (his.length ? ` He asked you: ${pick(his, 5).map((x) => `"${x}"`).join('; ')}.` : '')
    + (hers.length ? ` You said: ${pick(hers, 8).map((x) => `"${x.slice(0, 220)}"`).join(' ')}` : ' No lines of yours were saved for it.');
}

/** For her answer: the rides his words point at, recalled; '' when the question is not about an earlier ride. */
export function pastRecall(rides: RideRecord[], entries: LogEntry[], said: string, now: number): string {
  const hit = pickRides(rides, said, now);
  return hit.length ? `From your saved log of earlier rides (answer from this; if it does not say, tell him you do not remember that part): ${hit.map((r) => recallRide(r, entries)).join(' | ')}` : '';
}
