import { BETTY_SYSTEM_PROMPT, CONFIG, FLAVOUR_PROMPTS, SILENT_TOKEN } from '../config/betty';
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
      const silent = isSilent(r.text);
      out = { text: silent ? '' : r.text, source: 'claude', detail: silent ? 'chose silence' : '', latencyMs };
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
  // Ambient flavours get no telemetry: given readings, the model recites them or comments on the riding.
  const readings = s.obd
    ? { speedKmh: s.speedKmh, rpm: s.rpm, engineTempC: s.engineTempC, fuelPct: s.fuelPct }
    : { speedKmh: s.speedKmh, engineData: 'not connected: do not mention engine temperature, revs, fuel or faults' };
  const bike = flavour ? '' : `\nBike state: ${JSON.stringify(readings)}`;
  return {
    model: CONFIG.claudeModel,
    max_tokens: 120,
    // Without this the model thinks first: the thinking block eats max_tokens and blows the timeout.
    thinking: { type: CONFIG.claudeThinkingOff },
    system: flavour ? `${BETTY_SYSTEM_PROMPT}\n\n${flavour}` : BETTY_SYSTEM_PROMPT,
    messages: [{
      role: 'user' as const,
      content: `Situation: ${ev.context}${bike}\nAlready said this ride: ${JSON.stringify(spoken)}`,
    }],
  };
}

const isSilent = (text: string) => text.replace(/[^a-z]/gi, '').toUpperCase() === SILENT_TOKEN;

/** First text block of a Messages API response. content[0] is not guaranteed to be text (e.g. a thinking block). */
export function extractText(json: unknown): string | null {
  const content = (json as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) return block.text.trim();
  }
  return null;
}
