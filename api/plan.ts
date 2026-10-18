import { env, fromBetty, json } from './_shared.js';

/**
 * POST /api/plan {ask, from?: {lat, lon}, area?: string, known?: string[]} -> {name, stops, thrilling, why}
 * Plan a ride with Betty (owner's backlog, 2026-10-18: "a breakfast run, two hours, twisty roads"): Claude (with web
 * search for good stops) turns what he asks into an ordered list of real places; the page then routes them with
 * api/route as usual. "HOME" as the last stop means back to where he starts. Haiku, max 3 searches, JSON out.
 */
const MODEL = 'claude-haiku-5-5';
const MAX_ASK = 400;

export const planPrompt = (ask: string, area: string, known: string[]) => `You plan motorcycle day rides in South Africa for a rider on a BMW G 310 GS who starts near ${area || 'Johannesburg, Gauteng'}.
He asks: "${ask}"
Plan an ordered list of 1 to 6 stops: real towns, villages or specific places (a named cafe, a pass, a dam), spelled as on a map, that a route planner can find, in South Africa. Make the riding time what he asked for: first work out the total distance it allows (about 60 km/h average on twisty roads, 80 on open ones; time at a breakfast or coffee stop does not count), and keep the WHOLE ride within it, including the way back home; two hours of riding is about 120 to 160 km in total, so the furthest stop is at most about half that away. If he wants to come back home (a run, a loop, "back by lunch"), end with exactly HOME. Use web search when it helps to pick good places (breakfast, coffee, views, twisty roads). ${known.length ? `Places he has ridden before (vary from them unless he asks for the usual): ${known.slice(0, 20).join(', ')}.` : ''}
Reply with ONLY JSON, no other words: {"name": "a short name for the ride", "stops": ["Place", "Place", "HOME"], "thrilling": true if he wants twisty or scenic roads else false, "why": "one sentence on why these stops"}`;

/** The plan in a reply: the first JSON object, checked. */
export function parsePlan(text: string): { name: string; stops: string[]; thrilling: boolean; why: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const stops = Array.isArray(j.stops) ? j.stops.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 8) : [];
    if (!stops.length) return null;
    return { name: String(j.name ?? 'A ride with Betty').slice(0, 60), stops, thrilling: !!j.thrilling, why: String(j.why ?? '').slice(0, 240) };
  } catch { return null; }
}

export async function POST(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'server has no ANTHROPIC_API_KEY' }, 503);
  const body: any = await req.json().catch(() => null);
  const ask = String(body?.ask ?? '').trim().slice(0, MAX_ASK);
  if (ask.length < 4) return json({ error: 'Tell Betty what kind of ride you want.' }, 400);
  const known = Array.isArray(body?.known) ? body.known.map((x: unknown) => String(x).slice(0, 40)).slice(0, 20) : [];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 900, thinking: { type: 'disabled' },
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', region: 'Gauteng', country: 'ZA', timezone: 'Africa/Johannesburg' } }],
      messages: [{ role: 'user', content: planPrompt(ask, String(body?.area ?? '').slice(0, 80), known) }],
    }),
  });
  if (!res.ok) return json({ error: `Claude said HTTP ${res.status}` }, 502);
  const out: any = await res.json().catch(() => ({}));
  const blocks: any[] = out?.content ?? [];
  const last = blocks.map((b) => b?.type).lastIndexOf('web_search_tool_result');
  const text = blocks.slice(last + 1).filter((b) => b?.type === 'text').map((b) => b.text).join('');
  const plan = parsePlan(text);
  if (!plan) return json({ error: 'Betty could not settle on a plan. Try saying it another way.' }, 502);
  return json(plan);
}
