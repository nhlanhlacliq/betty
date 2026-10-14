import { env, fromBetty, json } from './_shared.js';

/** Models the page may ask for, and the most it may ask for in one line. Anything else is refused. */
const MODELS = new Set(['claude-haiku-5-5', 'claude-sonnet-5-5']);
const MAX_TOKENS = 500;

/**
 * POST /api/phrase: the page sends the exact Messages request it built (buildClaudeRequest); this adds the key and
 * passes it to Anthropic, returning Anthropic's reply unchanged.
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
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}
