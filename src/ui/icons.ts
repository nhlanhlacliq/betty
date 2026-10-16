/**
 * Line icons for the app shell (24x24, stroked, from the design prototype). Add one = add a path here.
 * Static markup uses `<i data-icon="name"></i>`; `hydrateIcons` swaps those for the SVG.
 */
const PATHS = {
  ride: '<path d="m12 3 7 17-7-4-7 4 7-17Z"/><path d="M12 3v13"/>',
  journeys: '<path d="M4 5h6l4 3h6v12h-6l-4-3H4V5Z"/><path d="M10 5v12m4-9v12"/>',
  explore: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
  garage: '<path d="m3 9 9-6 9 6v11H3V9Z"/><path d="M7 20V10h10v10M7 14h10"/>',
  save: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  north: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  ne: '<path d="M7 17 17 7M8 7h9v9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.9 1.9-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.02 1.56V21h-2.7v-.08a1.7 1.7 0 0 0-1.06-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.9-1.9.06-.06A1.7 1.7 0 0 0 7.73 15a1.7 1.7 0 0 0-1.56-1.02H6v-2.7h.17a1.7 1.7 0 0 0 1.56-1.06 1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.9-1.9.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.02-1.56V5h2.7v.22a1.7 1.7 0 0 0 1.06 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.9 1.9-.06.06A1.7 1.7 0 0 0 19.4 10.2a1.7 1.7 0 0 0 1.56 1.02H21v2.7h-.04A1.7 1.7 0 0 0 19.4 15Z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4zM17 9l5 6m0-6-5 6"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4zM15 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.9 8.1-2 5.8-5.8 2 2-5.8z"/>',
  route: '<circle cx="6" cy="18" r="2"/><path d="M6 16V7a4 4 0 0 1 8 0v10a3 3 0 0 0 6 0v-1"/><circle cx="20" cy="13" r="2"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  cloud: '<path d="M20 17a4 4 0 0 0-1-7.9 7 7 0 0 0-13-1A4.5 4.5 0 0 0 6 17z"/><path d="m9 20-1 2m6-2-1 2"/>',
  rain: '<path d="M20 16a4 4 0 0 0-1.2-7.8 7 7 0 0 0-13-.2A4 4 0 0 0 6 16h14ZM8 20l1-2m4 2 1-2m4 2 1-2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  sunset: '<path d="M12 10V2M4.93 10.93l1.41 1.41M2 18h2m16 0h2m-2.93-7.07-1.41 1.41M22 22H2M16 6l-4 4-4-4m8 12a4 4 0 0 0-8 0"/>',
  fuel: '<path d="M3 22h12M4 9h10m0 13V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18m10-9h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
  traffic: '<path d="M5 17h14v-5l-2-5H7l-2 5zM5 12h14"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  book: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8m-8 4h8m-8 4h5"/>',
  home: '<path d="m3 11 9-8 9 8v9H3zM9 20v-7h6v7"/>',
  spark: '<path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
  close: '<path d="M5 5 19 19M19 5 5 19"/>',
  headset: '<path d="M3 14v-3a9 9 0 0 1 18 0v3M3 14h4v7H5a2 2 0 0 1-2-2zm14 0h4v5a2 2 0 0 1-2 2h-2z"/>',
  share: '<path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10v1"/>',
  shield: '<path d="m12 2 8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/><path d="m8 12 3 3 5-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
  gauge: '<path d="M12 14 16 9M3.5 18a9 9 0 1 1 17 0z"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  coffee: '<path d="M3 8h14v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM17 9h2a3 3 0 0 1 0 6h-2M6 3v2m5-2v2m5-2v2"/>',
} as const;

export type IconName = keyof typeof PATHS;

export const icon = (name: IconName, cls = 'ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? PATHS.spark}</svg>`;

/** Replace every `<i data-icon="name">` under root with its SVG. */
export function hydrateIcons(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('i[data-icon]').forEach((i) => {
    const name = i.dataset.icon as IconName;
    i.outerHTML = icon(name in PATHS ? name : 'spark', i.className ? `ico ${i.className}` : 'ico');
  });
}
