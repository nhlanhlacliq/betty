import { CONFIG, bettySystemPrompt, cleanRiderName, FLAVOUR_PROMPTS, SILENT_TOKEN } from '../config/betty';
import { clockNote } from './ambient';
import { BikeState, TriggerEvent } from './types';

/** What Betty will say (empty text = say nothing) and where the words came from. */
export interface Phrase {
  text: string;
  source: 'claude' | 'fallback';
  /** Why the fallback was used, or a note on the Claude reply. Empty when there is nothing to add. */
  detail: string;
  latencyMs: number;
}

type Attempt = { text: string } | { error: string };

/**
 * Turns a TriggerEvent into natural speech. Falls back to the event's canned phrase if there is
 * no API key, the call fails, or it times out, so Betty never goes silent on a critical alert.
 * NOTE: a key in the browser bundle is fine for a personal prototype only; proxy it before sharing.
 */
export class ClaudeClient {
  private spoken: string[] = [];
  /** Result of the most recent phrase() call, for the UI. */
  last: Phrase | null = null;

  constructor(private apiKey: string | undefined, private timeoutMs = 2500, private ambientTimeoutMs = 6000) {}

  async phrase(ev: TriggerEvent, state: BikeState): Promise<Phrase> {
    const t0 = Date.now();
    const r = await this.callClaude(ev, state);
    const latencyMs = Date.now() - t0;
    let out: Phrase;
    if ('text' in r) {
      const c = cleanSpoken(r.text, {
        ambient: FLAVOUR_PROMPTS[ev.id] !== undefined && ev.id !== 'ride_debrief',
        name: cleanRiderName(CONFIG.riderName), recent: this.spoken, maxSentences: CONFIG.maxSpokenSentences,
      });
      // An alert whose reply turned out unusable still has to be said: use the canned line.
      out = c.text || !ev.fallback
        ? { text: c.text, source: 'claude', detail: c.note, latencyMs }
        : { text: ev.fallback, source: 'fallback', detail: 'unusable reply', latencyMs };
    } else {
      out = { text: ev.fallback, source: 'fallback', detail: ev.fallback ? r.error : `${r.error}, staying silent`, latencyMs };
    }
    if (out.text) {
      this.spoken.push(out.text);
      this.spoken = this.spoken.slice(-10);
    }
    this.last = out;
    return out;
  }

  private async callClaude(ev: TriggerEvent, s: BikeState): Promise<Attempt> {
    if (ev.priority === 1) return { error: 'P1 never waits on the network' };
    if (!ev.context) return { error: 'nothing to go on' };
    if (!this.apiKey) return { error: 'no API key' };
    const ctrl = new AbortController();
    // Ambient lines are not urgent, so they get longer than the 3 s alert budget.
    const timer = setTimeout(() => ctrl.abort(), ev.priority === 3 ? this.ambientTimeoutMs : this.timeoutMs);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(buildClaudeRequest(ev, s, this.spoken)),
      });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const text = extractText(await res.json());
      return text ? { text } : { error: 'empty reply' };
    } catch (e) {
      return { error: (e as Error)?.name === 'AbortError' ? 'timeout' : 'network error' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Exactly what is sent to Claude for an event. Pure, so it can be tested and shown in the UI. */
export function buildClaudeRequest(ev: TriggerEvent, s: BikeState, spoken: string[]) {
  const flavour = FLAVOUR_PROMPTS[ev.id];
  const base = bettySystemPrompt();
  // Ambient flavours get no telemetry: given readings, the model recites them or comments on the riding.
  const readings = s.obd
    ? { speedKmh: s.speedKmh, rpm: s.rpm, engineTempC: s.engineTempC, fuelPct: s.fuelPct }
    : { speedKmh: s.speedKmh, engineData: 'not connected: do not mention engine temperature, revs, fuel or faults' };
  // Alerts and answers get the clock so she never has to guess the hour. Ambient flavours get the time of day
  // only as a banter topic: given it every time, every quip opened with it.
  const bike = flavour ? '' : `\nLocal time: ${clockNote(new Date(ev.createdAt))}\nBike state: ${JSON.stringify(readings)}`;
  return {
    model: CONFIG.claudeModel,
    max_tokens: 60 + 60 * Math.max(1, Math.round(CONFIG.maxSpokenSentences)), // room for the configured line length
    // Without this the model thinks first: the thinking block eats max_tokens and blows the timeout.
    thinking: { type: CONFIG.claudeThinkingOff },
    system: flavour ? `${base}\n\n${flavour}` : base,
    messages: [{
      role: 'user' as const,
      content: `Situation: ${ev.context}${bike}\nAlready said this ride: ${JSON.stringify(spoken)}`,
    }],
  };
}

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
const META = /\b(the|my) notes\b|\bnotes (only|say|give)\b|\bword limit\b|\b(two|2)[- ]sentence\b|\bmy instructions\b|\bthe situation (says|gives|only)\b|\bspoken output\b/i;
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

/** First text block of a Messages API response. content[0] is not guaranteed to be text (e.g. a thinking block). */
export function extractText(json: unknown): string | null {
  const content = (json as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) return block.text.trim();
  }
  return null;
}
