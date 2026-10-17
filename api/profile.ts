import { env, fromBetty, json } from './_shared.js';

/**
 * POST /api/profile {text} -> {profile}
 * Distils what he shares about himself (an answer from ChatGPT or Claude to "what do you know about me", notes, or a
 * conversations export) into a short rider profile for Betty, once. The original stays on his phone; only this
 * profile goes with her lines afterwards. Owner, 2026-10-17: "rider context ... a bit of salt in a good meal".
 */
const MODEL = 'claude-haiku-5-5';
/** Enough for a long "about me" answer or the useful part of an export (his own words). */
const MAX_INPUT = 60_000;
export const MAX_PROFILE = 1400;

/**
 * From a ChatGPT or Claude conversations export (JSON), only what HE wrote: that is where he talks about himself.
 * Anything else is used as text.
 */
export function ownWords(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith('[') && !t.startsWith('{')) return t;
  let data: any;
  try { data = JSON.parse(t); } catch { return t; }
  const out: string[] = [];
  const walk = (v: any) => {
    if (!v || out.join(' ').length > MAX_INPUT) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v !== 'object') return;
    // Claude export: chat_messages [{sender: 'human', text}]. ChatGPT export: mapping {id: {message: {author: {role: 'user'}, content: {parts: [...]}}}}.
    if (v.sender === 'human' && typeof v.text === 'string') out.push(v.text);
    if (v.author?.role === 'user' && Array.isArray(v.content?.parts)) out.push(v.content.parts.filter((p: unknown) => typeof p === 'string').join(' '));
    for (const k of Object.keys(v)) if (k !== 'text' && k !== 'parts') walk(v[k]);
  };
  walk(data);
  return out.length ? out.join('\n') : t;
}

export const profilePrompt = (text: string) => `Below is what a motorcyclist shared about himself (an AI assistant's summary of him, his notes, or his own messages).
Write a short rider profile for Betty, his riding co-pilot, who will use it lightly to make her company more personal.
Keep only what helps a co-pilot: who he is (name he goes by, where he lives in broad terms, work in a few words), his riding (bike, how and where he likes to ride), interests worth a remark or a story (history, music, food, sport, places), his sense of humour, and anything he would not want brought up.
Leave out anything sensitive: health, money, relationships, exact addresses, other people's details. Do not invent anything.
Plain sentences, no headings or lists, at most ${MAX_PROFILE} characters. Reply with only the profile.

---
${text}`;

export async function POST(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'server has no ANTHROPIC_API_KEY' }, 503);
  const body: any = await req.json().catch(() => null);
  const text = ownWords(String(body?.text ?? '')).slice(0, MAX_INPUT);
  if (text.trim().length < 20) return json({ error: 'Paste a bit more about yourself first.' }, 400);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: profilePrompt(text) }] }),
  });
  if (!res.ok) return json({ error: `Claude said HTTP ${res.status}` }, 502);
  const out: any = await res.json().catch(() => ({}));
  const profile = (out?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim().slice(0, MAX_PROFILE + 200);
  if (!profile) return json({ error: 'Nothing came back. Try again.' }, 502);
  return json({ profile });
}
