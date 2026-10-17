import { haversineKm } from './geo';
import type { TrackPoint } from './Track';

/**
 * What goes on a shareable ride card (owner, 2026-10-17). Pure, so it is tested without a canvas.
 */

/** Her lines worth putting on a card, best first: a story about a place beats banter, which beats the sign-off. */
const RANK: Record<string, number> = { area_story: 0, local_fact: 1, ambient_banter: 2, ride_milestone: 3, rider_query: 4, ride_debrief: 5, startup: 6 };

/** The one line to quote: the best kind she said, not too long, voice tags removed. Null if she said nothing usable. */
export function bestLine(lines: Array<{ trigger: string; text: string }>): string | null {
  const clean = (t: string) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const usable = lines
    .map((l) => ({ rank: RANK[l.trigger] ?? 9, text: clean(l.text) }))
    .filter((l) => l.rank < 9 && l.text.length >= 30 && !l.text.startsWith('('));
  if (!usable.length) return null;
  usable.sort((a, b) => a.rank - b.rank || Math.abs(a.text.length - 140) - Math.abs(b.text.length - 140)); // ~140 chars reads best
  return shorten(usable[0].text, 260);
}

/** A ride's saved weather ("partly cloudy, 22 C") as the card shows it: "Partly cloudy · 22°C", and which icon. */
export function weatherPill(weather: string | null): { text: string; icon: 'sun' | 'cloud' | 'rain' | 'storm' | 'fog' } | null {
  if (!weather) return null;
  const m = weather.match(/^(.*?),\s*(-?\d+(?:\.\d+)?)\s*C$/i);
  const summary = (m ? m[1] : weather).trim();
  const text = `${summary[0]?.toUpperCase() ?? ''}${summary.slice(1)}${m ? ` · ${Math.round(Number(m[2]))}°C` : ''}`;
  const s = summary.toLowerCase();
  const icon = /thunder|storm/.test(s) ? 'storm' : /rain|drizzle|shower/.test(s) ? 'rain' : /fog|mist/.test(s) ? 'fog' : /cloud|overcast|snow/.test(s) ? 'cloud' : 'sun';
  return { text, icon };
}

/** Cut at a sentence end within `max` characters (or a word, with an ellipsis). */
export function shorten(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  // The last sentence end that fits, quote marks after the full stop included ('"place of peace". It was...').
  let end = -1;
  for (const m of cut.matchAll(/[.!?]["”')]?(?=\s)/g)) end = m.index! + m[0].length;
  if (end < 0 && /[.!?]["”')]?$/.test(cut)) end = cut.length;
  return end > max * 0.3 ? cut.slice(0, end) : `${t.slice(0, max).slice(0, t.slice(0, max).lastIndexOf(' '))}…`;
}

/**
 * The track without its first and last `km`: rides usually start and end at home, and a shared picture should not
 * show where he lives. On by default on the card.
 */
export function trimEnds(track: TrackPoint[], km = 0.5): TrackPoint[] {
  const along = (pts: TrackPoint[]) => {
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      d += haversineKm({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] });
      if (d >= km) return i;
    }
    return pts.length;
  };
  const from = along(track);
  const to = track.length - along([...track].reverse());
  return from < to ? track.slice(from, to) : [];
}

/** `n` points spread evenly along a track by distance (at 1/2n, 3/2n, ...), with how far along each is (0 to 1). */
export function samplesAlong(track: TrackPoint[], n: number): Array<{ lat: number; lon: number; frac: number }> {
  if (track.length < 2 || n < 1) return [];
  const cum = [0];
  for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + haversineKm({ lat: track[i - 1][0], lon: track[i - 1][1] }, { lat: track[i][0], lon: track[i][1] }));
  const total = cum[cum.length - 1];
  if (!total) return [];
  const out: Array<{ lat: number; lon: number; frac: number }> = [];
  let i = 1;
  for (let k = 0; k < n; k++) {
    const want = ((k + 0.5) / n) * total;
    while (i < cum.length - 1 && cum[i] < want) i++;
    const t = cum[i] > cum[i - 1] ? (want - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
    out.push({ lat: track[i - 1][0] + (track[i][0] - track[i - 1][0]) * t, lon: track[i - 1][1] + (track[i][1] - track[i - 1][1]) * t, frac: want / total });
  }
  return out;
}

/** What /api/area said at one point along the ride. */
export interface AreaSample { lat: number; lon: number; frac: number; suburb: string | null; town: string | null }

/**
 * The names to write along the road on a ride card: towns on a long ride (suburbs are too small to mean anything at
 * 50 km across), suburbs on a short one; each name once, at the sample in the middle of its run; never a name in
 * `exclude` (where he starts and finishes, when those are hidden); at most `max`, spread along the ride.
 */
export function pickLabels(samples: AreaSample[], spanKm: number, exclude: string[], max = 6): Array<{ name: string; lat: number; lon: number }> {
  const plain = (x: string | null) => (x ? x.replace(/^City of\s+/i, '').replace(/\s+(Metropolitan|Local|District)\s+Municipality$/i, '').trim() || null : null);
  const no = new Set(exclude.map((x) => plain(x)?.toLowerCase()).filter(Boolean));
  const runs = new Map<string, AreaSample[]>();
  for (const s of [...samples].sort((a, b) => a.frac - b.frac)) {
    const town = plain(s.town), suburb = plain(s.suburb);
    const name = spanKm >= 25 ? town ?? suburb : suburb ?? town;
    if (!name || no.has(name.toLowerCase())) continue;
    runs.set(name, [...(runs.get(name) ?? []), s]);
  }
  let picks = [...runs.entries()].map(([name, ss]) => ({ name, at: ss[Math.floor((ss.length - 1) / 2)] }))
    .sort((a, b) => a.at.frac - b.at.frac);
  if (picks.length > max) picks = Array.from({ length: max }, (_, k) => picks[Math.round((k * (picks.length - 1)) / (max - 1 || 1))]);
  return picks.map((p) => ({ name: p.name, lat: p.at.lat, lon: p.at.lon }));
}
