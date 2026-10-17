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
  return shorten(usable[0].text, 220);
}

/** Cut at a sentence end within `max` characters (or a word, with an ellipsis). */
export function shorten(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
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
