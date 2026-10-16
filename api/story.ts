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
Each note: two or three plain spoken sentences with the specifics (names, years) that make it interesting. Only facts your search results state; leave out anything you cannot confirm, and do not pad with general facts about the wider region.${exclude.length ? `\nAlready covered, find different stories: ${exclude.join('; ')}.` : ''}
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

export async function POST(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'server has no ANTHROPIC_API_KEY' }, 503);
  const body: any = await req.json().catch(() => null);
  const area = String(body?.area ?? '').trim(), region = String(body?.region ?? '').trim();
  const exclude = (Array.isArray(body?.exclude) ? body.exclude : []).map((x: any) => String(x).slice(0, 60)).slice(0, 20);
  if (!area || area.length > 80 || region.length > 80) return json({ error: 'bad area' }, 400);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1500, thinking: { type: 'disabled' },
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: storyPrompt(area, region, exclude) }],
    }),
  });
  if (!res.ok) return json({ error: `Claude said HTTP ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
  const notes = parseNotes(await res.json());
  if (!notes.length) return json({ error: 'no notes found' }, 502);
  return json({ notes });
}
