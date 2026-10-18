import { CONFIG, bettySystemPrompt } from '../config/betty';
import { extractText } from '../core/ClaudeClient';
import { Bank, Slots, bankPrompt, needs, parseBank, take } from '../core/LineBank';
import type { TriggerId } from '../core/types';

const KEY = 'betty.linebank.v1';
/** Alerts written per request (each request is capped at 500 tokens by api/phrase). */
const BATCH = 4;

/**
 * The offline line bank on the phone (core/LineBank): her alert lines with blanks, written while there is signal and
 * used when Claude cannot be asked. Refilled at most once a day, a few alerts per request, through api/phrase.
 */
export const LineBankStore = {
  load(): Bank { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v?.lines && typeof v.lines === 'object' ? v.lines : {}; } catch { return {}; } },
  save(lines: Bank, filledAt?: number) {
    try { const old = JSON.parse(localStorage.getItem(KEY) ?? '{}'); localStorage.setItem(KEY, JSON.stringify({ lines, filledAt: filledAt ?? old?.filledAt ?? 0 })); } catch { /* full or blocked */ }
  },
  filledAt(): number { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}')?.filledAt ?? 0; } catch { return 0; } },
  /** A filled line for an alert, marked used (ClaudeClient.useBank). */
  take(id: TriggerId, slots: Slots): string | null {
    const got = take(LineBankStore.load(), id, slots);
    if (!got) return null;
    LineBankStore.save(got.bank);
    return got.text;
  },
  /** Write the missing variants (server only), at most once a day. Returns how many alerts got lines. */
  async refill(now = Date.now(), fetcher: typeof fetch = (...a) => fetch(...a)): Promise<number> {
    if (now - LineBankStore.filledAt() < 86_400_000) return 0;
    let bank = LineBankStore.load();
    const want = needs(bank);
    let got = 0;
    for (let i = 0; i < want.length; i += BATCH) {
      const ids = want.slice(i, i + BATCH);
      try {
        const res = await fetcher('/api/phrase', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          model: CONFIG.claudeModel, max_tokens: 500, thinking: { type: CONFIG.claudeThinkingOff },
          system: bettySystemPrompt(2), messages: [{ role: 'user', content: bankPrompt(ids) }],
        }) });
        if (!res.ok) continue;
        const fresh = parseBank(extractText(await res.json()) ?? '', ids);
        for (const [id, lines] of Object.entries(fresh)) { bank = { ...bank, [id]: [...(bank[id as TriggerId] ?? []), ...lines!].slice(-6) }; got++; }
      } catch { /* try again tomorrow */ }
    }
    LineBankStore.save(bank, now);
    return got;
  },
};
