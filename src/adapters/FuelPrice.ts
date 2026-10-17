import { CONFIG } from '../config/betty';
import { extractText, WEB_SEARCH } from '../core/ClaudeClient';
import { parsePrice, priceDue } from '../core/Fuel';

/**
 * The petrol price, looked up once a month (owner, 2026-10-17: search by default, his own figure wins when he enters
 * one). South Africa's prices change on the first Wednesday; after that change a price set earlier, his included, is
 * looked up again: Claude with a forced web search for the regulated inland ULP 95 price (Gauteng is inland).
 * Returns the new price, or null if nothing was due or the lookup failed (the old price stays).
 */
export async function refreshFuelPrice(now = Date.now(), fetcher: typeof fetch = (...a) => fetch(...a)): Promise<number | null> {
  if (!priceDue(CONFIG.fuel, now)) return null;
  const month = new Date(now).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const body = {
    model: CONFIG.claudeModel, max_tokens: 300, thinking: { type: CONFIG.claudeThinkingOff },
    tools: [WEB_SEARCH], tool_choice: { type: 'tool', name: 'web_search' },
    system: 'You report South African fuel prices. Reply with only the price in rand per litre as a number with two decimals, like 23.45, and nothing else.',
    messages: [{ role: 'user', content: `The regulated retail price of 95 octane unleaded petrol (ULP 95) at inland stations (Gauteng) in South Africa for ${month}, in rand per litre.` }],
  };
  try {
    const res = await fetcher('/api/phrase', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    const price = parsePrice(extractText(await res.json()) ?? '');
    if (price === null) return null;
    CONFIG.fuel.pricePerL = price; CONFIG.fuel.priceSource = 'auto'; CONFIG.fuel.priceAt = now;
    return price;
  } catch { return null; }
}
