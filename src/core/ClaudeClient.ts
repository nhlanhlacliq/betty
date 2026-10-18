import { CONFIG, bettySystemPrompt, cleanRiderName, FLAVOUR_PROMPTS, SILENT_TOKEN, VOICE_TAGS, sentencesFor } from '../config/betty';
import { clockNote } from './ambient';
import { BikeState, TriggerEvent, UNPROMPTED_IDS } from './types';
import { profileNote } from './Profile';
import { putsOff, wantsSearch } from './Heard';

/** What Betty will say (empty text = say nothing) and where the words came from. */
export interface Phrase {
  text: string;
  /** claude; bank = one of her own lines written earlier, filled with live values (no signal, or a P1 alert); fallback = canned */
  source: 'claude' | 'bank' | 'fallback';
  /** Why the fallback was used, or a note on the Claude reply. Empty when there is nothing to add. */
  detail: string;
  latencyMs: number;
  /** Exactly what was (or, without a key, would have been) sent to Claude: shown by the chat panel's Show prompt */
  request: ClaudeRequest;
}

export type ClaudeRequest = ReturnType<typeof buildClaudeRequest>;
/** One exchange of the conversation with the rider. */
export interface Turn { said: string; answer: string }
/** How many earlier exchanges she remembers, so a follow-up ("and after that?") makes sense. */
export const TALK_MEMORY = 6;

type Attempt = { text: string; searched: boolean } | { error: string };

/**
 * Turns a TriggerEvent into natural speech. Falls back to the event's canned phrase if there is
 * no API key, the call fails, or it times out, so Betty never goes silent on a critical alert.
 * NOTE: a key in the browser bundle is fine for a personal prototype only; proxy it before sharing.
 */
export class ClaudeClient {
  private spoken: string[] = [];
  private talk: Turn[] = [];
  /** Her lines this ride per kind (time checks, banter), so the next one of that kind does not reuse their jokes. */
  private byKind = new Map<string, string[]>();
  /** The offline line bank (adapters/LineBankStore): her own alert lines for when Claude cannot be asked. */
  private bank: { take(id: TriggerEvent['id'], slots: Record<string, string>): string | null } | null = null;
  useBank(b: { take(id: TriggerEvent['id'], slots: Record<string, string>): string | null } | null) { this.bank = b; }
  /** Result of the most recent phrase() call, for the UI. */
  last: Phrase | null = null;

  /**
   * With a key, calls Anthropic straight from the page (local development). Without one, and with proxyUrl set,
   * posts the same request to Betty's server, which adds the key (the deployed app). With neither, it falls back.
   */
  constructor(
    private apiKey: string | undefined, private timeoutMs = 2500, private ambientTimeoutMs = 6000, private proxyUrl?: string,
    /** Extra headers for the server (the native app sends `x-betty-origin`, having no page origin). */
    private proxyHeaders: Record<string, string> = {},
  ) {}

  async phrase(ev: TriggerEvent, state: BikeState): Promise<Phrase> {
    const t0 = Date.now();
    const same = this.byKind.get(ev.id) ?? [];
    // He asked for a search, or for something only a search gets right (a price, reviews, events): search, always.
    const force = !!ev.riderSaid && wantsSearch(ev.riderSaid);
    let request = buildClaudeRequest(ev, state, this.spoken, this.talk, { forceSearch: force, same });
    let r = await this.callClaude(ev, request);
    let retried = false;
    // An answer that promised to look it up, or said she does not know, without searching: ask again, searching.
    // (Ride of 2026-10-17: "I shall search that speed now" seven times, and not one search.)
    if (ev.riderSaid && !force && 'text' in r && !r.searched && putsOff(r.text)) {
      request = buildClaudeRequest(ev, state, this.spoken, this.talk, { forceSearch: true, same });
      const again = await this.callClaude(ev, request);
      if ('text' in again) { r = again; retried = true; }
    }
    const latencyMs = Date.now() - t0;
    let out: Phrase;
    if ('text' in r) {
      const c = cleanSpoken(r.text, {
        ambient: UNPROMPTED_IDS.includes(ev.id),
        name: cleanRiderName(CONFIG.riderName), recent: this.spoken, maxSentences: sentencesFor(ev.id),
      });
      if (retried) c.note = c.note ? `${c.note}; searched on the second go` : 'searched on the second go';
      else if (r.searched) c.note = c.note ? `${c.note}; searched` : 'searched';
      // An alert whose reply turned out unusable still has to be said: use the canned line. A line she chose to keep
      // to herself (an ambient SILENT) stays silent, even when it has a fallback.
      out = c.text || !ev.fallback || UNPROMPTED_IDS.includes(ev.id)
        ? { text: c.text, source: 'claude', detail: c.note, latencyMs, request }
        : { text: ev.fallback, source: 'fallback', detail: 'unusable reply', latencyMs, request };
    } else {
      // No Claude (no signal, a timeout, or a P1 that never waits): one of her banked lines if there is one for it.
      const banked = ev.slots && ev.context ? this.bank?.take(ev.id, ev.slots) ?? null : null;
      out = banked
        ? { text: banked, source: 'bank', detail: `${r.error}, a line she wrote earlier`, latencyMs, request }
        : { text: ev.fallback, source: 'fallback', detail: ev.fallback ? r.error : `${r.error}, staying silent`, latencyMs, request };
    }
    if (ev.riderSaid && out.source === 'claude' && out.text) {
      this.talk = [...this.talk, { said: ev.riderSaid, answer: out.text }].slice(-TALK_MEMORY);
    }
    if (out.text) {
      if (UNPROMPTED_IDS.includes(ev.id)) this.byKind.set(ev.id, [...same, out.text].slice(-6));
      this.spoken.push(out.text);
      this.spoken = this.spoken.slice(-10);
    }
    this.last = out;
    return out;
  }

  /** Forget the conversation (a new ride). */
  forgetTalk() { this.talk = []; this.byKind.clear(); }

  private async callClaude(ev: TriggerEvent, request: ClaudeRequest): Promise<Attempt> {
    if (ev.priority === 1) return { error: 'P1 never waits on the network' };
    if (!ev.context) return { error: 'nothing to go on' };
    if (!this.apiKey && !this.proxyUrl) return { error: 'no API key' };
    const ctrl = new AbortController();
    // Ambient lines are not urgent, so they get longer than the 3 s alert budget.
    // The briefing and sign-off are longer and nobody is in a hurry: on 2026-10-16 the briefing timed out at 2.5 s.
    const slow = ev.id === 'startup' || ev.id === 'ride_debrief';
    const timer = setTimeout(() => ctrl.abort(), ev.riderSaid ? Math.max(this.timeoutMs, RIDER_TIMEOUT_MS) : slow ? BRIEFING_TIMEOUT_MS : ev.priority === 3 ? this.ambientTimeoutMs : this.timeoutMs);
    try {
      const res = this.apiKey
        ? await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(request),
        })
        : await fetch(this.proxyUrl!, {
          method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', ...this.proxyHeaders }, body: JSON.stringify(request),
        });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const json = await res.json();
      const text = extractText(json);
      return text ? { text, searched: searchedIn(json) } : { error: 'empty reply' };
    } catch (e) {
      return { error: (e as Error)?.name === 'AbortError' ? 'timeout' : 'network error' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Exactly what is sent to Claude for an event. Pure, so it can be tested and shown in the UI. */
/**
 * Claude's own web search, for his questions only: she can look up anything the ride data and place notes do not
 * cover, places far away included (owner, 2026-10-16). Haiku takes the basic tool version. Each search costs
 * about $0.01, and adds a few seconds, so she says "hang on" if an answer is slow (main.ts).
 */
export const WEB_SEARCH = {
  type: 'web_search_20250305', name: 'web_search', max_uses: 2,
  user_location: { type: 'approximate', region: 'Gauteng', country: 'ZA', timezone: 'Africa/Johannesburg' },
} as const;
/** An answer may need a search or two; a line she makes up herself never does. */
export const RIDER_TIMEOUT_MS = 15000;
export const BRIEFING_TIMEOUT_MS = 8000;

/**
 * Voice tags (<laugh>, <sigh>): kept for Gemini, which performs them; removed for any other voice and on screen.
 * keep=true still removes tags Gemini does not know, so a made-up <chuckle> is never read out.
 */
export function voiceTags(text: string, keep: boolean): string {
  const out = text.replace(/\s*<\s*([a-z -]+?)\s*>\s*/gi, (m, tag: string) => (keep && VOICE_TAGS.includes(tag.toLowerCase()) ? ` <${tag.toLowerCase()}> ` : ' '));
  return out.replace(/\s+([.,!?;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** Whether a reply ran a web search. */
export const searchedIn = (json: unknown) => Array.isArray((json as any)?.content) && (json as any).content.some((b: any) => b?.type === 'web_search_tool_result');

export interface RequestOptions {
  /** Make the answer search (he asked for one, or a price/review/event question) */
  forceSearch?: boolean;
  /** Her earlier lines of the same kind this ride (time checks, banter) */
  same?: string[];
}

export function buildClaudeRequest(ev: TriggerEvent, s: BikeState, spoken: string[], talk: Turn[] = [], o: RequestOptions = {}) {
  const flavour = FLAVOUR_PROMPTS[ev.id];
  const base = bettySystemPrompt(sentencesFor(ev.id));
  const readings = s.obd
    ? { speedKmh: s.speedKmh, rpm: s.rpm, engineTempC: s.engineTempC, fuelPct: s.fuelPct }
    : { speedKmh: s.speedKmh, engineData: 'not connected: do not mention engine temperature, revs, fuel or faults' };
  // Alerts and answers get the clock and the readings. Lines she makes up on her own get neither: given readings,
  // the model recites them; given the clock, every quip opened with the time.
  const unprompted = UNPROMPTED_IDS.includes(ev.id) || ev.id === 'ride_debrief';
  const bike = unprompted ? '' : `\nLocal time: ${clockNote(new Date(ev.createdAt))}\nBike state: ${JSON.stringify(readings)}`;
  // Earlier exchanges come first as real turns, so a follow-up question reads naturally.
  const history = (ev.riderSaid ? talk : []).flatMap((t) => [
    { role: 'user' as const, content: `He said: "${t.said}"` },
    { role: 'assistant' as const, content: t.answer },
  ]);
  // A searched answer on Sonnet when he chose smarter web answers: no forced tool (Sonnet refuses it), asked in words.
  const smart = !!ev.riderSaid && !!o.forceSearch && CONFIG.smartSearch;
  return {
    model: smart ? 'claude-sonnet-5-5' : CONFIG.claudeModel,
    // Room for the configured line length, plus a few words she may say before searching.
    max_tokens: Math.min(500, 60 + 60 * sentencesFor(ev.id) + (ev.riderSaid ? 100 : 0) + (smart ? 120 : 0)), // api/phrase allows 500
    ...(ev.riderSaid ? { tools: [WEB_SEARCH] } : {}),
    ...(ev.riderSaid && o.forceSearch && !smart ? { tool_choice: { type: 'tool' as const, name: 'web_search' as const } } : {}),
    // Without this the model thinks first: the thinking block eats max_tokens and blows the timeout.
    thinking: { type: smart ? 'between_tools' : CONFIG.claudeThinkingOff },
    system: `${flavour ? `${base}\n\n${flavour}` : base}${smart ? '\n\nHe wants this looked up: search the web before you answer, then give the result in your own words.' : ''}`,
    messages: [...history, {
      role: 'user' as const,
      content: `Situation: ${ev.context}${bike}${ev.profile ? `\n${profileNote(ev.profile)}` : ''}\nAlready said this ride: ${JSON.stringify(spoken)}${sameKind(o.same)}`,
    }],
  };
}

/** Her earlier lines of this kind: the next one needs its own joke, not theirs (18 time checks that all "suspected"). */
const sameKind = (same?: string[]) => same?.length
  ? `\nYour earlier lines of this same kind this ride: ${JSON.stringify(same)}. Make this one different from all of them: a new joke or angle, a different opening, and none of their phrases or comparisons.`
  : '';

const escapeRegExp = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface CleanOptions {
  /** Ambient lines may be dropped altogether; an alert is never silenced by this. */
  ambient: boolean;
  name: string;
  /** Lines already spoken this ride, oldest first */
  recent: string[];
  maxSentences: number;
}

/** Talk about the prompt instead of to the rider: "the notes only say...", "that breaks the word limit". */
const META = /\b(the|my) notes\b|\bnotes (only|say|give)\b|\bword limit\b|\b(two|2)[- ]sentence\b|\bmy instructions\b|\bthe situation (says|gives|only)\b|\bspoken output\b|\bsince he asked\b|\bhe (asked|wants|is asking)\b|\bi'?ll say so plainly\b|\bmake up a story\b|\bthe best story\b|\bso i'?ll keep it (short|brief)\b|\balready said this ride\b|\bto tie (it )?back to\b|\bnothing to call back\b|\bhaving already\b|\bnot repeating it\b|\bi shall say nothing (further|more)\b|\bi have not forgotten\b|\bnot mention the (hour|time)\b|\bthe only thing i can tie\b|\bno earlier (warnings|alerts)\b|\bthe (search|searches|results?|sources?) (give|gives|gave|show|shows|showed|turned up|only|were|are|say|says|did)\b|\bi searched\b|\bi'?ll answer from\b|\bfrom the situation\b/i;
/** The start of a second thought: everything from here on is the model talking to itself. */
const SECOND_THOUGHT = /\n\s*\n|\n?\s*(Wait,|Correction:|Corrected:|Revised:|Actually, let me|Let me rephrase)/;

/**
 * Makes a model reply safe to say out loud. On a real ride (2026-10-08) the model twice spoke its own reasoning:
 * a line, then "Wait, that breaks the two-sentence and word limits... Corrected:" and a second attempt.
 * Keeps only the first thought, drops talk about the prompt, honours a SILENT anywhere in the reply, caps the
 * length, and stops every line opening with the rider's name.
 */
export function cleanSpoken(raw: string, o: CleanOptions): { text: string; note: string } {
  const silentAnywhere = new RegExp(`\\b${SILENT_TOKEN}\\b`).test(raw);
  if (o.ambient && silentAnywhere) return { text: '', note: 'chose silence' };
  const cut = raw.search(SECOND_THOUGHT);
  let text = (cut > 0 ? raw.slice(0, cut) : raw).replace(new RegExp(`\\b${SILENT_TOKEN}\\b\\.?`, 'g'), '').replace(/\s+/g, ' ').trim();
  let note = cut > 0 ? 'cut off where it started talking to itself' : '';
  if (META.test(text)) {
    if (o.ambient) return { text: '', note: 'talked about its instructions, dropped' };
    const kept = text.split(/(?<=[.!?])\s+/).filter((s) => !META.test(s)).join(' ');
    if (kept) { text = kept; note = 'removed talk about its instructions'; }
  }
  const sentences = text.split(/(?<=[.!?])\s+/);
  if (sentences.length > o.maxSentences) { text = sentences.slice(0, o.maxSentences).join(' '); note ||= 'shortened'; }
  // "sir" in line after line wears thin fast (the prompt's "one line in five" is not obeyed). If either of the
  // last two lines used his name, take it out of this one: at the head ("Sir, ...") or as an aside (", sir,").
  const n = escapeRegExp(o.name);
  if (o.recent.slice(-2).some((l) => new RegExp(`\\b${n}\\b`, 'i').test(l))) {
    text = text.replace(new RegExp(`^${n},\\s+`, 'i'), '').replace(new RegExp(`,\\s*${n}(?=[,.!?])`, 'gi'), '');
    if (text) text = text[0].toUpperCase() + text.slice(1);
  }
  if (!text) return { text: '', note: o.ambient ? 'chose silence' : 'empty reply' };
  return { text, note };
}

/**
 * What to say from a Messages API response. content[0] is not guaranteed to be text (e.g. a thinking block).
 * After a web search the answer is the text AFTER the last search result, often split into several blocks around
 * its citations; anything before it is her saying she will look ("Let me check").
 */
export function extractText(json: unknown): string | null {
  const content = (json as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  const lastSearch = content.map((b: any) => b?.type).lastIndexOf('web_search_tool_result');
  if (lastSearch >= 0) {
    const after = content.slice(lastSearch + 1).filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('').trim();
    if (after) return after;
  }
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) return block.text.trim();
  }
  return null;
}
