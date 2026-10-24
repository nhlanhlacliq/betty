/**
 * Betty's server (the Vercel functions that hold the keys). The web app is served from it, so `/api/...` works as is.
 * The native app has no page origin: at start-up it sets the full address and names the site in `x-betty-origin`
 * (api/_shared.ts `fromBetty` accepts it). Every `/api/` request in the shared code goes through `serverFetch`.
 */
let base = '';
let extra: Record<string, string> = {};

export function setServer(url: string, headers: Record<string, string> = {}) { base = url.replace(/\/$/, ''); extra = headers; }
export const serverUrl = (path: string) => (path.startsWith('/') ? base + path : path);
export const serverHeaders = () => ({ ...extra });

/** `fetch`, with `/api/...` sent to Betty's server (and its headers added). Other URLs are fetched as they are. */
export const serverFetch: typeof fetch = (input, init) => {
  if (typeof input !== 'string' || !input.startsWith('/')) return fetch(input, init);
  return fetch(base + input, Object.keys(extra).length ? { ...init, headers: { ...extra, ...(init?.headers as Record<string, string> | undefined) } } : init);
};
