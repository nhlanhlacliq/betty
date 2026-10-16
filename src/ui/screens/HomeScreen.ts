import type { RideRecord } from '../../core/RideMemory';
import type { TrackPoint } from '../../core/Track';
import { scenery, sceneryFor } from '../art';
import { HOME } from '../copy';
import { IconName, icon } from '../icons';
import { DEFAULT_SPAN_KM, mapSvg, spanFor, trackCenter } from '../mapView';
import type { Shell } from '../Shell';

/** One line of the readiness dialog ("GPS: phone sensors", "Voice: Gemini, Aoede"...). */
export interface ReadyRow { icon: IconName; label: string; value: string; ok: boolean }

export interface HomeContext {
  /** What she calls him, for "Where shall we go, ...?" */
  name(): string;
  /** Betty says hello (tap on the orb). */
  hello(): void;
  readiness(): ReadyRow[];
  fuelText(): string;
  rides(): RideRecord[];
  track(rideId: number): TrackPoint[];
  /** Where to centre the map with no ride to show */
  home(): { lat: number; lon: number };
  openRide(rideId: number): void;
}

export interface HomeScreen {
  /** While a ride runs the button goes back to it, and the ride mode cannot change. */
  setRiding(on: boolean): void;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const day = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { weekday: 'long' });
const date = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`);
export const rideTitle = (r: RideRecord) => r.places[0] ? `${day(r.startedAt)} near ${r.places[0]}` : `${day(r.startedAt)} ride`;

/** A past ride as a card (Home's "Roads you've ridden", My journeys' list on a wide screen). */
export const rideCard = (r: RideRecord) => `<button class="route-card" type="button" data-ride="${r.startedAt}">${scenery(sceneryFor(r.startedAt))}
  <span class="tag">${esc(date(r.startedAt))}</span><div class="route-card-body"><span class="card-arrow">${icon('ne')}</span>
  <h3>${esc(rideTitle(r))}</h3><p class="sub" style="font-size:10px">${esc(r.weather ?? 'Out with Betty')}</p>
  <div class="route-meta"><span>${r.distanceKm} km</span><span>·</span><span>${duration(r.minutes)}</span>${r.places.length ? `<span>·</span><span>${r.places.length} place${r.places.length === 1 ? '' : 's'}</span>` : ''}</div></div></button>`;

/**
 * Ride, before setting off: the welcome, a sketch of the last ride, Betty's card (tap the orb to hear her), the ride
 * mode (real sensors or a desk test, driving the hidden #real checkbox main.ts reads at start), the start button,
 * a readiness line, and the last few rides.
 */
export function mountHomeScreen(doc: Document, shell: Shell, ctx: HomeContext): HomeScreen {
  const $ = (id: string) => doc.getElementById(id)!;
  $('homeeyebrow').textContent = HOME.eyebrow;
  $('homelead').textContent = HOME.lead;
  $('homemessage').textContent = HOME.companion;
  $('homecaption').textContent = HOME.companionCaption;
  $('pickerlabel').textContent = HOME.pickerLabel;
  $('homemapchip').textContent = HOME.mapChip;
  $('homemaptiny').textContent = HOME.mapTiny;
  $('roadstitle').textContent = HOME.roadsTitle;

  const real = $('real') as HTMLInputElement;
  const tiles = [...doc.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  for (const t of tiles) {
    const copy = HOME.modes[t.dataset.mode as 'real' | 'sim'];
    t.querySelector('.tile-label')!.textContent = copy.title;
    t.querySelector('small')!.textContent = copy.sub;
    t.addEventListener('click', () => { if (!real.disabled) { real.checked = t.dataset.mode === 'real'; paint(); } });
  }

  const paintReady = () => {
    const rows = ctx.readiness();
    const bad = rows.filter((r) => !r.ok);
    $('readytitle').textContent = bad.length ? 'Worth a look:' : 'Ready to roll';
    $('readysub').textContent = bad.length ? bad[0].label.toLowerCase() : real.checked ? '· phone sensors' : '· desk test';
    $('readydot').classList.toggle('warn', bad.length > 0);
    $('homestatus').innerHTML = rows.filter((r) => ['GPS', 'Voice', 'Brain'].includes(r.label))
      .map((r) => `<span>${r.label === 'GPS' ? '<span class="dot"></span>' : icon(r.icon)} ${esc(r.value)}</span>`).join('')
      + '<span class="last">Everything starts with a little curiosity.</span>';
  };

  const paint = () => {
    $('homeheadline').textContent = HOME.headline(ctx.name());
    for (const t of tiles) {
      const on = (t.dataset.mode === 'real') === real.checked;
      t.classList.toggle('active', on);
      t.setAttribute('aria-checked', String(on));
      t.disabled = real.disabled && !on;
    }
    paintReady();
    const rides = [...ctx.rides()].reverse();
    const last = rides[0];
    const track = last ? ctx.track(last.startedAt) : [];
    $('homemap').innerHTML = mapSvg({
      center: trackCenter(track) ?? ctx.home(), here: track.length ? null : ctx.home(), headingDeg: null, track,
      places: [], incidents: [], marks: [], spanKm: track.length ? spanFor(track) : DEFAULT_SPAN_KM,
    }, 'Sketch of your last ride: not for navigation', 'home');
    $('homemaptext').textContent = last ? HOME.mapLast(last.distanceKm, last.places[0] ?? null) : HOME.mapFirst;
    $('homemapbadge').textContent = last ? date(last.startedAt) : '';
    $('roads').innerHTML = rides.length ? rides.slice(0, 3).map(rideCard).join('') : `<div class="empty"><p>${esc(HOME.roadsEmpty)}</p></div>`;
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
  $('roads').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ride]');
    if (b) ctx.openRide(Number(b.dataset.ride));
  });

  paint();
  return {
    setRiding(on) {
      $('starttext').textContent = on ? 'Back to the ride' : "Let's ride";
      paint();
    },
  };
}
