/** Decorative landscapes for ride cards (from the design). Three moods, picked per ride so a list does not repeat. */
export type Scenery = 'hills' | 'pass' | 'country';
const KINDS: Scenery[] = ['hills', 'pass', 'country'];

export const sceneryFor = (seed: number): Scenery => KINDS[Math.abs(Math.floor(seed / 1000)) % KINDS.length];

let seq = 0;
export function scenery(kind: Scenery): string {
  const sky = `sky-${kind}-${++seq}`; // unique per drawing: see mapView on ids in hidden copies
  const hills = kind === 'hills';
  const near = hills ? '#899d8d' : '#8f9a7b';
  return `<svg class="landscape" viewBox="0 0 480 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`
    + `<defs><linearGradient id="${sky}" x2="0" y2="1"><stop stop-color="#c8dad9"/><stop offset="1" stop-color="#f0e9d5"/></linearGradient></defs>`
    + `<rect width="480" height="180" fill="url(#${sky})"/><circle cx="381" cy="35" r="19" fill="#f7e8b5" opacity=".8"/>`
    + `<path d="M0 110 50 65 82 88 141 27 195 75 246 48 298 92 357 62 412 94 480 78V180H0Z" fill="${hills ? '#b5bda9' : '#afb5a3'}"/>`
    + `<path d="M0 145 55 99 94 117 149 66 192 111 243 90 310 126 390 100 480 123V180H0Z" fill="${near}"/>`
    + (kind === 'country' ? '<path d="M0 166Q110 116 227 153T480 146V180H0Z" fill="#bac09a"/>' : '<path d="M0 160Q120 130 240 158T480 150V180H0Z" fill="#a3b08f"/>')
    + `<path d="M${hills ? 340 : 260} 190C170 139 335 130 236 110S183 90 205 78" stroke="#dcd9c7" stroke-width="13" fill="none"/>`
    + `<path d="M${hills ? 340 : 260} 190C170 139 335 130 236 110S183 90 205 78" stroke="#fbf1ce" stroke-width="1.5" stroke-dasharray="6 6" fill="none"/>`
    + `<path d="M360 180Q340 146 382 132T480 137V180Z" fill="#738a71" opacity=".65"/></svg>`;
}
