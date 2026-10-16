import { ASK_CHIPS } from '../copy';
import { icon } from '../icons';
import { DEFAULT_SPAN_KM, MAP_SPANS, MapInput, mapSvg } from '../mapView';
import type { RideView } from '../rideView';

export interface RideActions {
  /** The microphone: start talking, or finish if already listening. */
  talk(): void;
  /** Tap on the orb: hear her last line again. */
  repeat(): void;
  /** Quiet: ask her to be quiet, or have her back. */
  toggleQuiet(): void;
  /** A typed question or a question chip, through the same path as speech. */
  ask(text: string): void;
}

export interface RideExtras {
  /** Eyebrow: on the road, parked... */
  status: string;
  /** Under the title: free ride, desk test, warnings */
  line: string;
  quiet: boolean;
  listening: boolean;
  /** The status row under the map */
  statusRow: Array<{ icon: 'dot' | Parameters<typeof icon>[0]; text: string }>;
}

export interface RideScreen {
  paint(v: RideView, x: RideExtras, map: Omit<MapInput, 'spanKm'>): void;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Ride, while riding: the map sketch with one glance cue and the ride numbers, Betty's card (orb, what she says,
 * the microphone), the moment around him, and Lock / Quiet / End. What to show is decided by rideView (pure,
 * tested); this paints it, touching the DOM only where something changed.
 */
export function mountRideScreen(doc: Document, actions: RideActions): RideScreen {
  const $ = (id: string) => doc.getElementById(id)!;
  $('ask').addEventListener('click', () => actions.talk());
  $('rideorb').addEventListener('click', () => actions.repeat());
  $('mute').addEventListener('click', () => actions.toggleQuiet());
  $('askchips').innerHTML = ASK_CHIPS.map((q) => `<button class="small-chip" type="button" data-ask="${esc(q)}">${esc(q)}</button>`).join('');
  $('askchips').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ask]');
    if (b) actions.ask(b.dataset.ask!);
  });
  const input = $('askinput') as HTMLInputElement;
  $('askform').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) { input.value = ''; actions.ask(q); }
  });

  let span = DEFAULT_SPAN_KM;
  let lastMap: Omit<MapInput, 'spanKm'> | null = null;
  const last = new Map<string, string>();
  const text = (id: string, value: string) => { if (last.get(id) !== value) { last.set(id, value); $(id).textContent = value; } };
  const html = (id: string, value: string) => { if (last.get(id) !== value) { last.set(id, value); $(id).innerHTML = value; } };
  const paintMap = () => { if (lastMap) html('ridemap', mapSvg({ ...lastMap, spanKm: span }, undefined, 'ride')); };
  doc.querySelectorAll<HTMLElement>('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    const i = MAP_SPANS.indexOf(span);
    span = b.dataset.zoom === 'in' ? MAP_SPANS[Math.max(0, i - 1)] : b.dataset.zoom === 'out' ? MAP_SPANS[Math.min(MAP_SPANS.length - 1, i + 1)] : DEFAULT_SPAN_KM;
    paintMap();
  }));

  return {
    paint(v, x, map) {
      lastMap = map;
      paintMap();
      const heading = map.headingDeg;
      ($('compassarrow') as HTMLElement).style.transform = heading == null ? '' : `rotate(${-Math.round(heading)}deg)`;
      $('rideorb').className = `orb ${v.orb}`;
      text('ridestatus', x.status);
      text('rideplace', v.place || 'Free ride');
      text('rideline', x.line);
      text('companionstate', v.state);
      text('ridesub', v.message);
      text('ridekicker', v.kicker);
      text('rideheadline', v.headline);
      text('ridefacts', v.facts);
      text('ridedist', v.distance);
      text('ridemin', v.minutes);
      text('ridespeed', v.speed);
      text('ridetemp', v.temp);
      $('glance').hidden = !v.glance;
      if (v.glance) {
        html('glanceicon', icon(v.glance.icon));
        text('glancelabel', v.glance.label);
        text('glancetitle', v.glance.title);
        text('glancevalue', v.glance.value);
      }
      text('asktext', x.listening ? 'Listening… tap when done' : 'Tap to talk · tap me to repeat');
      $('ask').classList.toggle('listening', x.listening);
      const mute = $('mute');
      mute.classList.toggle('on', x.quiet);
      mute.setAttribute('aria-label', x.quiet ? 'Have Betty talk again' : 'Ask Betty to be quiet');
      html('muteicon', icon(x.quiet ? 'mute' : 'volume', 'ico sm'));
      text('mutetext', x.quiet ? 'Quiet on' : 'Quiet');
      html('ridestatusrow', x.statusRow.map((s) => `<span>${s.icon === 'dot' ? '<span class="dot"></span>' : icon(s.icon)} ${esc(s.text)}</span>`).join('')
        + '<span class="last">Alerts always get the right of way.</span>');
    },
  };
}
