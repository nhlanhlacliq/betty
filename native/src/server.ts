/**
 * Betty's server (the Vercel functions that hold the keys). The native app has no page origin, so it names the site
 * in `x-betty-origin` (api/_shared.ts `fromBetty` accepts it).
 */
export const SERVER_URL = 'https://betty-zeta.vercel.app';
export const SERVER_HEADERS = { 'x-betty-origin': SERVER_URL };
export const api = (path: string) => `${SERVER_URL}${path}`;
