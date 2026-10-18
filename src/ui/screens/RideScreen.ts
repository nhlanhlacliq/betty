import { icon } from '../icons';
import { DEFAULT_SPAN_KM, MAP_SPANS, MAX_SPAN_KM, MIN_SPAN_KM, MapInput, mapSvg } from '../mapView';
import { MapView, attachMapGestures } from '../mapGestures';
import { mountCollapsibleDock } from '../dockSwipe';
import type { GlanceAction, Glance, RideView } from '../rideView';
import { mountIsland } from '../island';
import { followDock } from '../Shell';
import { revealWords } from '../motion';

export interface RideActions {
  /** The microphone: start talking, or finish if already listening. */
  talk(): void;
  /** Tap on the orb: hear her last line again. */
  repeat(): void;
  /** The headset button: ask her to be quiet, or have her back. */
  toggleQuiet(): void;
  /** A typed question or a question chip (the chat screen), through the same path as speech. */
  ask(text: string): void;
  /** The island's card button */
  island(kind: GlanceAction, g: Glance): void;
  /** He dismissed a Horizon card (a traffic incident, by incidentKey) */
  dismiss?(key: string): void;
}

export interface RideExtras {
  /** Live pill: on the road, parked... */
  status: string;
  /** Live pill, second half: Live or Desk test */
  mode: string;
  /** The note under the buttons: where he is, the weather, warnings */
  line: string;
  quiet: boolean;
  listening: boolean;
}

export interface RideScreen {
  paint(v: RideView, x: RideExtras, map: Omit<MapInput, 'spanKm'>): void;
  /** Repaint the map (borders arrived) */
  repaintMap(): void;
}

/**
 * Ride, while riding: the full-screen map sketch with the glance card, and the dock with the ride numbers, Betty
 * (orb, state, what she says, chat and microphone) and Lock / End ride. What to show is decided by rideView (pure,
 * tested); this paints it, touching the DOM only where something changed.
 */
export function mountRideScreen(doc: Document, actions: RideActions, borders?: (center: { lat: number; lon: number }, spanKm: number) => MapInput['borders']): RideScreen {
  const $ = (id: string) => doc.getElementById(id)!;
  $('ask').addEventListener('click', () => actions.talk());
  $('rideorb').addEventListener('click', () => actions.repeat());
  $('mute').addEventListener('click', () => actions.toggleQuiet());
  followDock(doc.querySelector('[data-screen="ride"]')!, doc.querySelector('.active-dock')!);
  const island = mountIsland(doc, { action: (kind, g) => actions.island(kind, g), dismiss: actions.dismiss ? (key) => actions.dismiss!(key) : undefined });
  mountCollapsibleDock(doc.querySelector('[data-screen="ride"]')!, doc.querySelector('.active-dock')!, 'ride');

  let span = DEFAULT_SPAN_KM;
  let lastMap: Omit<MapInput, 'spanKm'> | null = null;
  /** Set once he pans or pinches: the map stops following him until the target button. */
  let manual: MapView | null = null;
  const last = new Map<string, string>();
  const text = (id: string, value: string) => { if (last.get(id) !== value) { last.set(id, value); $(id).textContent = value; } };
  const html = (id: string, value: string) => { if (last.get(id) !== value) { last.set(id, value); $(id).innerHTML = value; } };
  const paintMap = () => {
    if (!lastMap) return;
    const view: MapInput = manual ? { ...lastMap, center: manual.center, spanKm: manual.spanKm } : { ...lastMap, spanKm: span };
    if (view.center) view.borders = borders?.(view.center, view.spanKm) ?? null;
    html('ridemap', mapSvg(view, undefined, 'ride'));
    doc.querySelector('[data-zoom="reset"]')?.classList.toggle('lit', manual !== null);
  };
  doc.querySelectorAll<HTMLElement>('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.zoom === 'reset') { manual = null; span = DEFAULT_SPAN_KM; paintMap(); return; }
    const factor = b.dataset.zoom === 'in' ? 0.5 : 2;
    if (manual) manual = { ...manual, spanKm: Math.min(MAX_SPAN_KM, Math.max(MIN_SPAN_KM, manual.spanKm * factor)) };
    else { const i = MAP_SPANS.indexOf(span); span = b.dataset.zoom === 'in' ? MAP_SPANS[Math.max(0, i - 1)] : MAP_SPANS[Math.min(MAP_SPANS.length - 1, i + 1)]; }
    paintMap();
  }));
  // Pan, pinch, double tap, wheel. The first move takes the map off "follow me".
  attachMapGestures(doc.querySelector('.active-map') as HTMLElement, $('ridemap'),
    () => manual ?? (lastMap?.center ? { center: lastMap.center, spanKm: span } : null),
    (v) => { manual = v; paintMap(); });

  return {
    repaintMap() { last.delete('ridemap'); paintMap(); },
    paint(v, x, map) {
      lastMap = map;
      paintMap();
      $('rideorb').className = `orb mini ${v.orb}`;
      text('ridestatus', x.status);
      text('modepill', x.mode);
      text('rideline', x.line);
      text('ridekicker', v.kicker);
      text('companionstate', v.state);
      // Her line appears word by word while she says it (Little animations); anything else just shows.
      $('ridesub').classList.toggle('earlier', !!v.earlier);
      if (last.get('ridesub') !== v.message) {
        last.set('ridesub', v.message);
        if (v.orb === 'speaking') revealWords($('ridesub'), v.message, doc); else { $('ridesub').textContent = v.message; $('ridesub').removeAttribute('aria-label'); }
      }
      text('rideheadline', v.headline);
      text('rideplace', v.place);
      text('ridefacts', v.facts);
      text('ridetemp', v.temp);
      text('ridedist', v.distance);
      text('ridemin', v.minutes);
      text('ridespeed', v.speed);
      island.set(v.glances);
      $('asktext').hidden = !x.listening;
      $('ask').classList.toggle('listening', x.listening);
      const mute = $('mute');
      mute.classList.toggle('on', x.quiet);
      mute.setAttribute('aria-label', x.quiet ? 'Have Betty talk again' : 'Ask Betty to be quiet');
      html('muteicon', icon(x.quiet ? 'mute' : 'headset', 'ico sm'));
      $('mutedot').classList.toggle('on', !x.quiet);
    },
  };
}
