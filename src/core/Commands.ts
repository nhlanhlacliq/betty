import { haversineKm } from './geo';

/**
 * Things he can tell Betty to DO, as opposed to ask her (voice stage 3). Recognised from his words before anything
 * goes to Claude, so they act at once and work without signal. A command only counts when the sentence starts with
 * it ("remember that..." is a command, "do you remember that ride..." is a question), and the short ones only when
 * the whole sentence is short, so a question that merely contains "quiet" or "repeat" still goes to her.
 */
export type Command =
  | { kind: 'repeat' }
  /** No banter, tour guide or time checks. minutes null = until he says she can talk again (or the ride ends). */
  | { kind: 'quiet'; minutes: number | null }
  | { kind: 'talk' }
  | { kind: 'mark'; note: string }
  | { kind: 'remember'; fact: string }
  | { kind: 'forget' };

const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, 'forty-five': 45, sixty: 60, ninety: 90,
  'a couple of': 2, 'a few': 5,
};

/** "ten minutes", "10 min", "half an hour", "an hour", "two hours" -> minutes; null if no length is given. */
export function minutesIn(text: string): number | null {
  const t = text.toLowerCase();
  if (/\bhalf an? hour\b/.test(t)) return 30;
  if (/\b(a )?quarter of an hour\b/.test(t)) return 15;
  const m = t.match(/\b(\d+|a couple of|a few|forty[ -]five|[a-z]+)\s+(minutes?|mins?|hours?|hrs?)\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]];
  if (!n) return null;
  return /^h/.test(m[2]) ? n * 60 : n;
}

/** Drops what people put in front of an instruction: "Hey Betty,", "okay", "please", "can you". */
function strip(said: string): string {
  let t = said.trim().replace(/^[\s,.!?]+/, '');
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(/^(hey|hi|okay|ok|right|so|um+|uh+|please|betty|pitty|bettie|can you|could you|would you|will you|just|now)\b[\s,.!?]*/i, '');
    if (t === before) break;
  }
  return t;
}
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const tail = (t: string) => t.replace(/^[\s,.:;-]+/, '').replace(/^(because|cause|as|for|it's|its|it is|note|with the note)\b[\s,:]*/i, '').replace(/[.!?\s]+$/, '').trim();

export function parseCommand(said: string): Command | null {
  const t = strip(said);
  const low = t.toLowerCase().replace(/[.!?]+$/, '');
  const n = words(low);

  // mark before remember: "remember this spot" is a place, not a fact
  const mark = t.match(/^(?:mark|save|pin|bookmark|remember|drop a pin (?:on|at)?|note)\s+(?:this|the|that|my)\s+(?:spot|place|location|point|corner|road|position|here)\b(.*)$/i)
    ?? t.match(/^(?:drop a pin|mark (?:it|here))\b(.*)$/i);
  if (mark) return { kind: 'mark', note: tail(mark[1]) };

  if (n <= 8 && /^(forget (that|it|this|the last (thing|one|note)|what i (just )?said)|scratch that|delete that)$/.test(low)) return { kind: 'forget' };

  const rem = t.match(/^(?:remember|note|make a note|take a note|don't forget)\b(?:\s+that)?[\s,:]+(.+)$/i);
  if (rem && words(rem[1]) >= 2) return { kind: 'remember', fact: tail(rem[1]) };

  if (n <= 8 && /^(repeat( that| it| yourself| the last (thing|line|one))?( again)?( please)?|say (that|it) again|say again|come again|what did you (just )?say|pardon( me)?|sorry,? what|what was that)$/.test(low)) {
    return { kind: 'repeat' };
  }

  if (n <= 12 && /^(be quiet|quiet|keep quiet|go quiet|stay quiet|shut up|hush|shh+|stop talking|stop chatting|silence|mute|mute yourself|give me (some )?(peace|quiet|silence)|no (more )?(talking|chatting|chatter|banter)|less talking|enough talking|not now)\b/.test(low)) {
    return { kind: 'quiet', minutes: minutesIn(low) };
  }

  if (n <= 8 && /^((you can |ok you can |you may )?(talk|speak|chat)( to me)?( again| now)?|unmute|carry on( talking)?|i'm back|back on|you're back|keep talking|talk to me)$/.test(low)) {
    return { kind: 'talk' };
  }
  return null;
}

/** A note he asked her to keep, kept across rides. */
export interface RiderNote { at: number; text: string }
/** A spot he marked, kept across rides. */
export interface MarkedSpot { at: number; lat: number; lon: number; note: string; near: string | null }
export interface RiderMemory { notes: RiderNote[]; marks: MarkedSpot[] }
export const EMPTY_MEMORY: RiderMemory = { notes: [], marks: [] };
const KEEP = 100;

export function addNote(m: RiderMemory, text: string, at: number): RiderMemory { return { ...m, notes: [...m.notes, { at, text }].slice(-KEEP) }; }
export function addMark(m: RiderMemory, spot: MarkedSpot): RiderMemory { return { ...m, marks: [...m.marks, spot].slice(-KEEP) }; }
/** Removes the newest note or mark, whichever came last. Returns what went, for her reply. */
export function forgetLast(m: RiderMemory): { memory: RiderMemory; gone: 'note' | 'mark' | null } {
  const n = m.notes.at(-1); const k = m.marks.at(-1);
  if (!n && !k) return { memory: m, gone: null };
  if (n && (!k || n.at >= k.at)) return { memory: { ...m, notes: m.notes.slice(0, -1) }, gone: 'note' };
  return { memory: { ...m, marks: m.marks.slice(0, -1) }, gone: 'mark' };
}

const day = (at: number, now: number) => {
  const d = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(at).toISOString().slice(0, 10);
};

/** What she knows from what he told her to keep, for her answers. Newest first, distances from where he is now. */
export function describeMemory(m: RiderMemory, here: { lat: number; lon: number } | null, now: number, max = 12): string {
  const out: string[] = [];
  if (m.notes.length) {
    out.push(`Things he asked you to remember: ${m.notes.slice(-max).reverse().map((x) => `"${x.text}" (${day(x.at, now)})`).join('; ')}.`);
  }
  if (m.marks.length) {
    out.push(`Spots he marked: ${m.marks.slice(-max).reverse().map((x) => {
      const dist = here ? `, ${Math.round(haversineKm(here, x) * 10) / 10} km from here` : '';
      return `${x.near ? `near ${x.near}` : 'a spot'} (${day(x.at, now)}${dist})${x.note ? `: "${x.note}"` : ''}`;
    }).join('; ')}.`);
  }
  return out.join(' ');
}
