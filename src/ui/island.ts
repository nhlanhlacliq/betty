import { CONFIG } from '../config/betty';
import { icon } from './icons';
import type { Glance, GlanceAction } from './rideView';

/**
 * The island: the card at the top of the ride map (owner named it, 2026-10-17). Each part is a Garage setting
 * (CONFIG.island), the first four on by default:
 * - compact: a small pill ("⛽ 86 km left") that grows to the full card for EXPAND_MS when the news changes
 * - tapExpand: tap to grow it (it stays open) or shrink it
 * - browse: swipe sideways through the other cues, with dots; the most pressing comes back after BROWSE_MS
 * - actions: one button on the full card (Filled up, Tell me a story, Up ahead...)
 * - progress: a slim bar for the route, the fuel range and the light left (off by default)
 */
export const EXPAND_MS = 10_000;
export const BROWSE_MS = 20_000;

export interface IslandState { index: number; browseUntil: number; expandUntil: number; pinned: boolean; topKey: string }
export const freshIsland = (): IslandState => ({ index: 0, browseUntil: 0, expandUntil: 0, pinned: false, topKey: '' });

/** Pure: what the island shows now, and its next state. A new most-pressing cue grows the compact island. */
export function islandView(cues: Glance[], st: IslandState, now: number, cfg = CONFIG.island): { glance: Glance | null; expanded: boolean; index: number; count: number; next: IslandState } {
  if (!cues.length) return { glance: null, expanded: false, index: 0, count: 0, next: st };
  const next = { ...st };
  const top = cues[0].key ?? cues[0].title;
  if (top !== st.topKey) { if (st.topKey && cues[0].id !== 'riding') next.expandUntil = now + EXPAND_MS; next.topKey = top; }
  const browsing = cfg.browse && now < next.browseUntil && next.index < cues.length;
  if (!browsing) next.index = 0;
  const expanded = !cfg.compact || next.pinned || now < next.expandUntil || (browsing && next.index > 0);
  return { glance: cues[next.index], expanded, index: next.index, count: cues.length, next };
}

export interface IslandHooks { action(kind: GlanceAction, g: Glance): void }

export function mountIsland(doc: Document, hooks: IslandHooks) {
  const el = doc.getElementById('glance')!;
  const $ = (id: string) => doc.getElementById(id)!;
  let cues: Glance[] = [];
  let st = freshIsland();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const paint = () => {
    const v = islandView(cues, st, Date.now());
    st = v.next;
    el.hidden = !v.glance;
    if (!v.glance) return;
    const g = v.glance, cfg = CONFIG.island;
    el.classList.toggle('compact', !v.expanded);
    $('glanceicon').innerHTML = icon(g.icon);
    $('glancelabel').textContent = g.label;
    $('glancetitle').textContent = v.expanded ? g.title : (g.short ?? g.title);
    $('glancevalue').textContent = v.expanded ? g.value : '';
    const act = $('glanceaction') as HTMLButtonElement;
    act.hidden = !(cfg.actions && v.expanded && g.action);
    if (g.action) act.textContent = g.action.label;
    const bar = $('glanceprogress');
    bar.hidden = !(cfg.progress && v.expanded && g.progress !== undefined);
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round((g.progress ?? 0) * 100)}%`;
    const dots = $('glancedots');
    dots.hidden = !(cfg.browse && v.expanded && v.count > 1);
    dots.innerHTML = v.count > 1 ? Array.from({ length: Math.min(v.count, 8) }, (_, i) => `<i${i === v.index ? ' class="on"' : ''}></i>`).join('') : '';
    // Wake up when the grown island should shrink back, or the browse should return to the most pressing cue.
    clearTimeout(timer);
    const wake = [st.expandUntil, st.browseUntil].filter((t) => t > Date.now()).sort((a, b) => a - b)[0];
    if (wake) timer = setTimeout(paint, wake - Date.now() + 30);
  };

  // Tap: grow (and stay) or shrink. The action button has its own tap.
  el.addEventListener('click', (e) => {
    if ((e.target as Element).closest('#glanceaction')) return;
    if (!CONFIG.island.tapExpand) return;
    const open = !el.classList.contains('compact');
    st = { ...st, pinned: !open, expandUntil: open ? 0 : st.expandUntil, browseUntil: open ? 0 : st.browseUntil };
    paint();
  });
  $('glanceaction').addEventListener('click', (e) => {
    e.stopPropagation();
    const v = islandView(cues, st, Date.now());
    if (v.glance?.action) hooks.action(v.glance.action.kind, v.glance);
  });
  // Swipe sideways: the next or previous cue (and the card grows while he browses).
  let x0 = 0, y0 = 0;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!CONFIG.island.browse || cues.length < 2) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    const i = (st.index + (dx < 0 ? 1 : -1) + cues.length) % cues.length;
    st = { ...st, index: i, browseUntil: Date.now() + BROWSE_MS };
    paint();
  });

  return {
    /** New cues (every ride repaint) */
    set(list: Glance[]) { cues = list; paint(); },
    paint,
  };
}
