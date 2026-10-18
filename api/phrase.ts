import { env, fromBetty, json } from './_shared.js';

/** Models the page may ask for, and the most it may ask for in one line. Anything else is refused. */
const MODELS = new Set(['claude-haiku-5-5', 'claude-sonnet-5-5']);
const MAX_TOKENS = 500;

/**
 * POST /api/phrase: the page sends the exact Messages request it built (buildClaudeRequest); this adds the key and
 * passes it to Anthropic, returning Anthropic's reply unchanged (streamed through when the page asks for `stream: true`).
 */
export async function POST(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'server has no ANTHROPIC_API_KEY' }, 503);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'body is not JSON' }, 400); }
  if (!MODELS.has(body?.model) || !Array.isArray(body?.messages) || typeof body?.max_tokens !== 'number' || body.max_tokens > MAX_TOKENS) {
    return json({ error: 'request not allowed' }, 400);
  }
  // The one tool the page may use: Claude's web search, for his questions, a couple of searches at most.
  if (body.tools !== undefined && !(Array.isArray(body.tools) && body.tools.length === 1 && body.tools[0]?.type === 'web_search_20250305'
    && body.tools[0]?.name === 'web_search' && typeof body.tools[0]?.max_uses === 'number' && body.tools[0].max_uses <= 2)) {
    return json({ error: 'tool not allowed' }, 400);
  }
  // He asked her to search: the page may make that one tool compulsory, nothing else.
  if (body.tool_choice !== undefined && !(body.tools && body.tool_choice?.type === 'tool' && body.tool_choice?.name === 'web_search' && Object.keys(body.tool_choice).length === 2)) {
    return json({ error: 'tool choice not allowed' }, 400);
  }
  if (body.stream !== undefined && body.stream !== true) return json({ error: 'request not allowed' }, 400);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  // Streamed (his answers, 2026-10-19): pass the events straight through as they come, so the page can start speaking
  // the first sentence while the rest is written. An error reply is not a stream: sent whole, as before.
  if (body.stream === true && res.ok && res.body) {
    return new Response(res.body, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
  }
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}
