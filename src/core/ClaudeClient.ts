import { BETTY_SYSTEM_PROMPT, CONFIG } from '../config/betty';
import { BikeState, TriggerEvent } from './types';

/**
 * Turns a TriggerEvent into natural speech. Falls back to the event's canned phrase if there is
 * no API key, the call fails, or it times out, so Betty never goes silent on a critical alert.
 * NOTE: a key in the browser bundle is fine for a personal prototype only; proxy it before sharing.
 */
export class ClaudeClient {
  private spoken: string[] = [];
  constructor(private apiKey: string | undefined, private timeoutMs = 2500) {}

  async phrase(ev: TriggerEvent, state: BikeState): Promise<string> {
    const text = (await this.callClaude(ev, state)) ?? ev.fallback;
    this.spoken.push(text);
    this.spoken = this.spoken.slice(-10);
    return text;
  }

  private async callClaude(ev: TriggerEvent, s: BikeState): Promise<string | null> {
    if (!this.apiKey || ev.priority === 1) return null; // P1: never wait on the network
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
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
        body: JSON.stringify({
          model: CONFIG.claudeModel,
          max_tokens: 120,
          system: BETTY_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: `Situation: ${ev.context}\nBike state: ${JSON.stringify({
              speedKmh: s.speedKmh, rpm: s.rpm, engineTempC: s.engineTempC, fuelPct: s.fuelPct,
            })}\nAlready said this ride: ${JSON.stringify(this.spoken)}`,
          }],
        }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const out = json?.content?.[0]?.text?.trim();
      return out || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
