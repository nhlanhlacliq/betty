import { env, fromBetty, json } from './_shared.js';

/**
 * POST /api/story {area, region, exclude?: string[]} -> {notes: [{topic, text, source}]}
 * Researches the history and culture of one area with Claude's web search, ONCE: the page keeps the notes on the
 * phone, so riding through again costs nothing. A few searches and their reading, roughly 5 cents per new area.
 * The notes are the only source Betty may use for an area story, so they must hold only what the search found.
 */
const MODEL = 'claude-haiku-5-5';
const MAX_NOTES = 6;

export const storyPrompt = (area: string, region: string, exclude: string[]) => `Research the history and culture of ${area}${region ? `, ${region}` : ''} for a motorcycle co-pilot who tells a rider short stories about the places he rides through.
Use web search. Write up to ${MAX_NOTES} notes, each one story about ${area} itself: the origin of its name, how and when it began, a notable event, a notable person, a landmark and what happened there, or its culture (languages, food, music, sport, festivals, local sayings).
Each note: two or three plain spoken sentences with the specifics (names, years) that make it interesting. Only facts your search results state; leave out anything you cannot confirm. Every note must be about ${area} itself: never about another town, the city or the province, and never about your search (no \"I could not find\", no \"search results\"). Different parts of ${area} are welcome (a street, a park, a building, a person from there). If the results say little about ${area}, write fewer notes.${exclude.length ? `\nAlready told on his rides here and nearby, never tell these again, find different stories: ${exclude.join('; ')}.` : ''}
Reply with ONLY this JSON and nothing else: {"notes":[{"topic":"a few words","text":"the note","source":"website name"}]}`;

/** A landmark he is about to pass (kind "landmark"): what it is and its story, fewer notes. */
export const landmarkPrompt = (name: string, about: string, near: string) => `Research ${name}${about ? ` (${about})` : ''}${near ? `, near ${near}` : ''} for a motorcycle co-pilot who tells a rider what he is riding past.
Use web search. Write up to 3 notes about ${name} itself: what it is and what it does, how and when it came to be, and a notable event, record or oddity.
Each note: two or three plain spoken sentences with the specifics (names, years, sizes) that make it interesting. Only facts your search results state about this very place; leave out anything you cannot confirm.
Reply with ONLY this JSON and nothing else: {"notes":[{"topic":"a few words","text":"the note","source":"website name"}]}`;

/** The notes from Claude's reply: the JSON in the text after the last search result. */
export function parseNotes(reply: any): Array<{ topic: string; text: string; source: string }> {
  const blocks: any[] = Array.isArray(reply?.content) ? reply.content : [];
  const lastSearch = blocks.map((b) => b?.type).lastIndexOf('web_search_tool_result');
  const text = blocks.slice(lastSearch + 1).filter((b) => b?.type === 'text').map((b) => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed: any; try { parsed = JSON.parse(m[0]); } catch { return []; }
  return (Array.isArray(parsed?.notes) ? parsed.notes : [])
    .filter((n: any) => typeof n?.text === 'string' && n.text.trim().length > 40)
    .slice(0, MAX_NOTES)
    .map((n: any) => ({ topic: String(n.topic ?? '').slice(0, 60), text: String(n.text).replace(/\s+/g, ' ').trim().slice(0, 600), source: String(n.source ?? '').slice(0, 80) }));
}

/** Good places to stop in an area (kind "stops", 2026-10-26): coffee, food, a pub, a farm stall, a sight, by reputation. */
export const stopsPrompt = (area: string, region: string) => `Find places worth stopping at in ${area}${region ? `, ${region}` : ''} for a motorcyclist out on a ride: coffee, breakfast, lunch, a pub, a farm stall, a bike shop, a biker favourite, something worth seeing.
Search the web. Up to 6, only ones your search results show are open and well liked; leave out anything the results do not state, and anything outside ${area}.
Reply with ONLY JSON: {"stops":[{"name":"","kind":"cafe|restaurant|pub|farm stall|bike shop|sight|other","why":"one spoken sentence: what it is known for, from the reviews"}]}`;

const KINDS = ['cafe', 'restaurant', 'pub', 'farm stall', 'bike shop', 'sight', 'other'];
/** The stops from the reply's JSON: names and one sentence each, kinds from the list. */
export function parseStops(text: string): Array<{ name: string; kind: string; why: string }> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed: any; try { parsed = JSON.parse(m[0]); } catch { return []; }
  return (Array.isArray(parsed?.stops) ? parsed.stops : [])
    .filter((x: any) => typeof x?.name === 'string' && x.name.trim() && typeof x?.why === 'string' && x.why.trim().length > 15)
    .slice(0, 6)
    .map((x: any) => ({ name: x.name.trim().slice(0, 80), kind: KINDS.includes(x.kind) ? x.kind : 'other', why: x.why.replace(/\s+/g, ' ').trim().slice(0, 300) }));
}

/**
 * Who does the research (a model that searches the web). One function per provider, picked by RESEARCH_PROVIDER on
 * the server (default "claude"), so another can be plugged in without touching the prompts. Checked 2026-10-26:
 * Claude Haiku + web search really searches (3 searches, ~3.6 US cents a town); Gemini Flash with Google Search came
 * back WITHOUT searching (answers from memory, addresses unverified), and Groq's search models were not on the key.
 */
type Research = (prompt: string) => Promise<{ text: string } | { error: string; status: number }>;
const PROVIDERS: Record<string, Research> = {
  claude: async (prompt) => {
    const key = env('ANTHROPIC_API_KEY');
    if (!key) return { error: 'server has no ANTHROPIC_API_KEY', status: 503 };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env('RESEARCH_MODEL') || MODEL, max_tokens: 1500, thinking: { type: 'disabled' },
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return { error: `Claude said HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, status: 502 };
    const reply: any = await res.json();
    const blocks: any[] = Array.isArray(reply?.content) ? reply.content : [];
    const lastSearch = blocks.map((b) => b?.type).lastIndexOf('web_search_tool_result');
    return { text: blocks.slice(lastSearch + 1).filter((b) => b?.type === 'text').map((b) => b.text).join('') };
  },
};

export async function POST(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const research = PROVIDERS[env('RESEARCH_PROVIDER') || 'claude'];
  if (!research) return json({ error: 'unknown RESEARCH_PROVIDER' }, 503);
  const body: any = await req.json().catch(() => null);
  const area = String(body?.area ?? '').trim(), region = String(body?.region ?? '').trim();
  const exclude = (Array.isArray(body?.exclude) ? body.exclude : []).map((x: any) => String(x).slice(0, 60)).slice(0, 40);
  if (!area || area.length > 80 || region.length > 80) return json({ error: 'bad area' }, 400);
  const kind = body?.kind === 'landmark' || body?.kind === 'stops' ? body.kind : 'area';
  const about = String(body?.about ?? '').trim().slice(0, 160);
  const prompt = kind === 'landmark' ? landmarkPrompt(area, about, region) : kind === 'stops' ? stopsPrompt(area, region) : storyPrompt(area, region, exclude);
  const r = await research(prompt);
  if ('error' in r) return json({ error: r.error }, r.status);
  if (kind === 'stops') {
    const stops = parseStops(r.text);
    return stops.length ? json({ stops }) : json({ error: 'no stops found' }, 502);
  }
  const notes = parseNotes({ content: [{ type: 'text', text: r.text }] });
  if (!notes.length) return json({ error: 'no notes found' }, 502); // not kept: asked again on a later ride
  return json({ notes });
}
