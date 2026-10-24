import { CONFIG } from '../config/betty';
import { icon } from './icons';
import { motionOn, play, resize } from './motion';
import type { Glance, GlanceAction } from './rideView';

export { BROWSE_MS, EXPAND_MS, freshIsland, islandView } from './rideView';
export type { IslandState } from './rideView';
import { BROWSE_MS, freshIsland, islandView } from './rideView';

export interface IslandHooks {
  action(kind: GlanceAction, g: Glance): void;
  /** He dismissed a card (traffic): hide what `key` names */
  dismiss?(key: string): void;
}

export function mountIsland(doc: Document, hooks: IslandHooks) {
  const el = doc.getElementById('glance')!;
  const $ = (id: string) => doc.getElementById(id)!;
  let cues: Glance[] = [];
  let st = freshIsland();
  let timer: ReturnType<typeof setTimeout> | undefined;

  let shownIndex = -1;
  const paint = () => {
    const v = islandView(cues, st, Date.now());
    // News (a new most-pressing cue, not plain speed): a soft glow, so a glance is enough (Little animations).
    const news = !!st.topKey && v.next.topKey !== st.topKey && cues[0]?.id !== 'riding';
    st = v.next;
    el.hidden = !v.glance;
    if (!v.glance) return;
    // Growing, shrinking or moving to another card goes smoothly; a reading that just ticks over does not animate.
    const reshape = el.classList.contains('compact') === v.expanded || shownIndex !== v.index;
    shownIndex = v.index;
    if (reshape) resize(el, () => fill(v), doc, [el.querySelector<HTMLElement>('.island-body')!]); else fill(v);
    if (news) play(el, 'news');
  };
  const fill = (v: ReturnType<typeof islandView>) => {
    const g = v.glance!, cfg = CONFIG.island;
    el.classList.toggle('compact', !v.expanded);
    $('glanceicon').innerHTML = icon(g.icon);
    $('glancelabel').textContent = g.label;
    $('glancetitle').textContent = v.expanded ? g.title : (g.short ?? g.title);
    $('glancevalue').textContent = v.expanded ? g.value : '';
    const act = $('glanceaction') as HTMLButtonElement;
    act.hidden = !(cfg.actions && v.expanded && g.action);
    if (g.action) act.textContent = g.action.label;
    $('glancedismiss').hidden = !(v.expanded && g.dismiss && hooks.dismiss);
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
  // Dismiss (traffic): the × on the open card, or swipe the card up. It leaves upwards, then the next card shows.
  const shownCard = () => islandView(cues, st, Date.now()).glance;
  const dismiss = () => {
    const key = shownCard()?.dismiss;
    if (!key || !hooks.dismiss) return;
    const go = () => { el.classList.remove('dismissing'); st = { ...st, pinned: false, index: 0, browseUntil: 0 }; hooks.dismiss!(key); };
    if (motionOn(doc)) { el.classList.add('dismissing'); setTimeout(go, 220); } else go();
  };
  $('glancedismiss').addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
  // Swipe sideways: the next or previous cue (and the card grows while he browses). Swipe up: dismiss (traffic).
  let x0 = 0, y0 = 0;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const ux = e.changedTouches[0].clientX - x0, uy = e.changedTouches[0].clientY - y0;
    if (uy < -40 && Math.abs(uy) > Math.abs(ux) && shownCard()?.dismiss) { dismiss(); return; }
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
