import { JourneyStore } from '../../adapters/JourneyStore';
import type { RideRecord } from '../../core/RideMemory';
import type { TrackPoint } from '../../core/Track';
import { scenery, sceneryFor } from '../art';
import { HOME } from '../copy';
import { IconName, icon } from '../icons';
import { DEFAULT_SPAN_KM, MapInput, mapSvg, spanFor, trackCenter } from '../mapView';
import { MapView, attachMapGestures } from '../mapGestures';
import { followDock, type Shell } from '../Shell';
import { mountCollapsibleDock } from '../dockSwipe';

/** One line of the readiness sheet ("GPS: phone sensors", "Voice: Gemini, Aoede"...). */
export interface ReadyRow { icon: IconName; label: string; value: string; ok: boolean }

export interface HomeContext {
  /** Betty says hello (tap on the orb). */
  hello(): void;
  readiness(): ReadyRow[];
  fuelText(): string;
  rides(): RideRecord[];
  track(rideId: number): TrackPoint[];
  /** Where to centre the map with no ride to show */
  home(): { lat: number; lon: number };
  /** Suburb borders for a view (null when switched off or not known yet) */
  borders?(center: { lat: number; lon: number }, spanKm: number): MapInput['borders'];
  /** The planned route, if any: shown on the map instead of the last ride */
  route?(): { name: string; points: TrackPoint[]; stops: Array<{ lat: number; lon: number; name: string; named: boolean }> } | null;
}

export interface HomeScreen {
  repaintMap(): void;
  /** While a ride runs the button goes back to it, and the ride mode cannot change. */
  setRiding(on: boolean): void;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const day = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { weekday: 'long' });
const date = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`);
/** His name for the ride if he gave it one (My journeys > Rename), otherwise "Sunday near Sandton". */
export const rideTitle = (r: RideRecord) => JourneyStore.name(r.startedAt) ?? (r.places[0] ? `${day(r.startedAt)} near ${r.places[0]}` : `${day(r.startedAt)} ride`);

/** A past ride as a card with a landscape (My journeys). */
export const rideCard = (r: RideRecord) => `<button class="route-card" type="button" data-ride="${r.startedAt}"><div class="route-image">${scenery(sceneryFor(r.startedAt))}
  <span class="tag">${esc(date(r.startedAt))}</span></div><div class="route-card-body">
  <h3>${esc(rideTitle(r))}</h3><p class="sub">${esc(r.weather ?? 'Out with Betty')}</p>
  <div class="route-meta"><span>${r.distanceKm} km</span><span>·</span><span>${duration(r.minutes)}</span>${r.places.length ? `<span>·</span><span>${r.places.length} place${r.places.length === 1 ? '' : 's'}</span>` : ''}</div></div></button>`;

/**
 * Ride, before setting off: the map (a sketch of the last ride), the greeting, and the ride dock: Betty (tap the orb
 * to hear her), how we are riding (a sheet with Free ride / Desk test, driving the hidden #real checkbox main.ts reads
 * at start), Let's ride, and a readiness line that opens the details sheet.
 */
export function mountHomeScreen(doc: Document, shell: Shell, ctx: HomeContext): HomeScreen {
  const $ = (id: string) => doc.getElementById(id)!;
  $('homeeyebrow').textContent = HOME.eyebrow;
  $('homeheadline').textContent = HOME.headline;
  $('homemessage').textContent = HOME.companion;
  $('homecaption').textContent = HOME.companionCaption;
  $('pickerlabel').textContent = HOME.pickerLabel;
  followDock(doc.querySelector('[data-screen="home"]')!, doc.querySelector('[data-screen="home"] .ride-dock')!);
  mountCollapsibleDock(doc.querySelector('[data-screen="home"]')!, doc.querySelector('[data-screen="home"] .ride-dock')!, 'home');

  const real = $('real') as HTMLInputElement;
  const tiles = [...doc.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  for (const t of tiles) {
    const copy = HOME.modes[t.dataset.mode as 'real' | 'sim'];
    t.querySelector('.tile-label')!.textContent = copy.title;
    t.querySelector('small')!.textContent = copy.sub;
    t.addEventListener('click', () => {
      if (real.disabled) return;
      real.checked = t.dataset.mode === 'real';
      paint();
      shell.closeSheet();
    });
  }

  const paintReady = () => {
    const rows = ctx.readiness();
    const bad = rows.filter((r) => !r.ok);
    $('readytitle').textContent = bad.length ? `Check: ${bad[0].label.toLowerCase()}` : 'Betty ready';
    $('readydot').classList.toggle('warn', bad.length > 0);
    const voice = rows.find((r) => r.label === 'Voice');
    $('readyvoice').innerHTML = voice ? `${icon('headset', 'ico xs')} ${esc(voice.value)}` : '';
    $('readysub').textContent = 'Details';
  };

  let lastMap = '';
  /** The view that fits what is shown, and his own once he pans or pinches (until the target button). */
  let fitted: MapView | null = null;
  let manual: MapView | null = null;
  const paint = () => {
    const mode = real.checked ? 'real' : 'sim';
    const plannedName = ctx.route?.()?.name;
    $('modetitle').textContent = plannedName ? `${HOME.modes[mode].title} · ${plannedName}` : HOME.modes[mode].title;
    $('minititle').textContent = plannedName ?? HOME.modes[mode].title; // the slim panel's line
    $('modeicon').innerHTML = icon(mode === 'real' ? 'ride' : 'wrench');
    for (const t of tiles) {
      const on = t.dataset.mode === mode;
      t.classList.toggle('active', on);
      t.setAttribute('aria-checked', String(on));
      t.querySelector('.check')!.textContent = on ? '✓' : '›';
      t.disabled = real.disabled && !on;
    }
    paintReady();
    const last = [...ctx.rides()].reverse()[0];
    const planned = ctx.route?.() ?? null;
    // A planned route takes the map (dotted, with its named stops); otherwise the last ride's road.
    const track = planned ? [] : last ? ctx.track(last.startedAt) : [];
    const input: MapInput = planned ? {
      center: trackCenter(planned.points), here: null, headingDeg: null, track: [], route: planned.points,
      routeStops: planned.stops.filter((s) => s.named).map((s) => ({ lat: s.lat, lon: s.lon, label: s.name })),
      places: [], incidents: [], marks: [], spanKm: spanFor(planned.points),
    } : {
      center: trackCenter(track) ?? ctx.home(), here: track.length ? null : ctx.home(), headingDeg: null, track,
      places: [], incidents: [], marks: [], spanKm: track.length ? spanFor(track) : DEFAULT_SPAN_KM,
    };
    fitted = input.center ? { center: input.center, spanKm: input.spanKm } : null;
    const view = manual ? { ...input, center: manual.center, spanKm: manual.spanKm } : input;
    if (view.center) view.borders = ctx.borders?.(view.center, view.spanKm) ?? null;
    const svg = mapSvg(view,
      planned ? `Your route to ${planned.name}: not for navigation` : 'Sketch of your last ride: not for navigation', 'home');
    if (svg !== lastMap) { lastMap = svg; $('homemap').innerHTML = svg; }
    $('hometemp').textContent = last?.weather?.match(/-?\d+\s*C/)?.[0].replace(/\s*C/, '°') ?? '';
    $('homecondition').textContent = last ? HOME.conditionLast(last.distanceKm, date(last.startedAt)) : HOME.conditionFirst;
  };

  shell.onSheet((id) => {
    if (id !== 'ready') return;
    $('readyrows').innerHTML = ctx.readiness().map((r) =>
      `<div class="sheet-row"><b>${icon(r.icon, 'ico sm')}${esc(r.label)}</b><span class="${r.ok ? '' : 'bad'}">${esc(r.value)}</span></div>`).join('');
    $('readyfuel').textContent = ctx.fuelText();
  });
  shell.onShow((id) => { if (id === 'home') paint(); });
  doc.defaultView?.addEventListener('betty-config', paint);
  $('helloorb').addEventListener('click', () => ctx.hello());
  $('homerecenter').addEventListener('click', () => { manual = null; lastMap = ''; paint(); });
  attachMapGestures(doc.querySelector('[data-screen="home"] .ride-map') as HTMLElement, $('homemap'), () => manual ?? fitted, (v) => { manual = v; paint(); });

  paint();
  return {
    /** Repaint the map (borders arrived) */
    repaintMap() { lastMap = ''; paint(); },
    setRiding(on) {
      $('starttext').textContent = on ? 'Back to the ride' : "Let's ride";
      paint();
    },
  };
}
