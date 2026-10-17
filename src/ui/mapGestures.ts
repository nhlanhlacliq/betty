import type { LatLon } from '../core/geo';
import { MAP_H, MAP_W, MAX_SPAN_KM, MIN_SPAN_KM, unproject } from './mapView';

/**
 * Pan and zoom on the map sketches (home and ride; owner, 2026-10-17): one finger or the mouse drags, two fingers
 * pinch, a double tap zooms in, the wheel zooms. While the fingers move the drawn sketch is only shifted and scaled
 * (smooth); when they lift it is drawn again for the new view (sharp). Pure maths in `viewAfter`, tested.
 */
export interface MapView { center: LatLon; spanKm: number }

const clampSpan = (s: number) => Math.min(MAX_SPAN_KM, Math.max(MIN_SPAN_KM, s));

/**
 * The view after a gesture on a w x h box: everything was scaled by `scale` about `origin` (box px) and then moved
 * by `move` (px). The sketch fills the box like CSS cover (viewBox 660 x 500, slice), so box px are converted first.
 */
export function viewAfter(v: MapView, w: number, h: number, origin: { x: number; y: number }, scale: number, move: { x: number; y: number }): MapView {
  const k = Math.max(w / MAP_W, h / MAP_H); // box px per map unit
  const s = Math.max(1e-3, scale);
  // The box point that ends up in the middle of the box, before the gesture.
  const px = origin.x + (w / 2 - move.x - origin.x) / s;
  const py = origin.y + (h / 2 - move.y - origin.y) / s;
  const center = unproject(v.center, v.spanKm, MAP_W / 2 + (px - w / 2) / k, MAP_H / 2 + (py - h / 2) / k);
  return { center, spanKm: clampSpan(v.spanKm / s) };
}

interface Pt { x: number; y: number }

export function attachMapGestures(host: HTMLElement, art: HTMLElement, get: () => MapView | null, set: (v: MapView) => void) {
  const pts = new Map<number, Pt>();
  let start: { a: Pt; b: Pt | null } | null = null;
  let scale = 1, move = { x: 0, y: 0 }, origin = { x: 0, y: 0 }, moved = false, lastTap = 0, lastType = '';
  const local = (e: { clientX: number; clientY: number }): Pt => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const show = () => { art.style.transformOrigin = `${origin.x}px ${origin.y}px`; art.style.transform = `translate(${move.x}px, ${move.y}px) scale(${scale})`; };
  const commit = () => {
    const v = get();
    if (v && (moved || scale !== 1)) {
      const r = host.getBoundingClientRect();
      set(viewAfter(v, r.width, r.height, origin, scale, move));
    }
    art.style.transform = ''; scale = 1; move = { x: 0, y: 0 }; moved = false;
  };
  const begin = () => {
    const [a, b] = [...pts.values()];
    start = { a, b: b ?? null };
    // A second finger starts a pinch from where the first one got to.
    if (b) { origin = mid(a, b); } else { origin = a; }
  };

  host.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest?.('button, a, input, .glance-card, .map-controls')) return;
    if (!get()) return;
    lastType = e.pointerType;
    host.setPointerCapture?.(e.pointerId);
    if (pts.size === 1 && (moved || scale !== 1)) commit(); // finish the one-finger pan before the pinch starts
    pts.set(e.pointerId, local(e));
    begin();
  });
  host.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, local(e));
    const [a, b] = [...pts.values()];
    if (b && start.b) {
      scale = dist(a, b) / dist(start.a, start.b);
      const m = mid(a, b), m0 = mid(start.a, start.b);
      move = { x: m.x - m0.x, y: m.y - m0.y };
    } else {
      move = { x: a.x - start.a.x, y: a.y - start.a.y };
    }
    if (Math.abs(move.x) + Math.abs(move.y) > 4 || scale !== 1) moved = true;
    if (moved) show();
  });
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size) { commit(); begin(); return; } // a pinch became a pan
    const tap = !moved && scale === 1;
    commit(); start = null;
    // Double tap: zoom in about the finger.
    if (tap && e.pointerType !== 'mouse') {
      const now = Date.now();
      if (now - lastTap < 300) { zoomAt(local(e), 2); lastTap = 0; } else lastTap = now;
    }
  };
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  const zoomAt = (p: Pt, s: number) => {
    const v = get(); if (!v) return;
    const r = host.getBoundingClientRect();
    set(viewAfter(v, r.width, r.height, p, s, { x: 0, y: 0 }));
  };
  // Mouse double click (touch double taps are handled above; some phones also fire dblclick for them).
  host.addEventListener('dblclick', (e) => { if (lastType === 'mouse' || !lastType) zoomAt(local(e), 2); });
  host.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(local(e), Math.exp(-e.deltaY * 0.0025)); }, { passive: false });
}
