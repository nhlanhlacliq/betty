/**
 * Shared bits for Betty's server functions. Files starting with "_" are not deployed as endpoints by Vercel.
 * The functions exist so API keys live on the server instead of in the JavaScript every visitor downloads.
 */

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/**
 * Only answer Betty's own page. This stops casual reuse of the endpoints from other sites; it is not real
 * security (anyone can fake these headers from a script), so keep spend limits on the keys.
 */
export function fromBetty(req: Request): boolean {
  const host = req.headers.get('host') ?? '';
  const ok = (u: string) => {
    try { const h = new URL(u).host; return h === host || /^localhost(:\d+)?$/.test(h); } catch { return false; }
  };
  const origin = req.headers.get('origin');
  if (origin) return ok(origin);
  const referer = req.headers.get('referer');
  return referer ? ok(referer) : false;
}

export const env = (name: string) => (typeof process !== 'undefined' ? process.env[name] : undefined);
