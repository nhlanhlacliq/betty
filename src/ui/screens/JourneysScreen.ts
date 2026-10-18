import type { LogEntry } from '../../core/LineLog';
import { RideRecord, fuelSpend, rideMinutes, stoppedMinutes } from '../../core/RideMemory';
import { CONFIG } from '../../config/betty';
import type { TrackPoint } from '../../core/Track';
import { icon } from '../icons';
import { foldList, toggleFold } from '../fold';
import { MapPin, mapSvg, spanFor, trackCenter } from '../mapView';
import type { Shell } from '../Shell';
import { rideTitle } from './HomeScreen';
import { groupByMonth, monthKey } from '../../core/Journeys';
import { miniTrackSvg } from '../miniMap';
import { rideRecords } from '../../core/Records';
import { fitView } from '../../core/Explore';
import { MapView, attachMapGestures } from '../mapGestures';
import { MAP_H, MAP_W, projector } from '../mapView';

export interface JourneysContext {
  /** Remembered rides (oldest first, as RideLog keeps them) */
  rides(): RideRecord[];
  /** Every saved line */
  entries(): LogEntry[];
  track(rideId: number): TrackPoint[];
  /** The rough copy of every ride's road by ride id (RoadStore), read once per render: thumbnails, Your roads. */
  roads?(): Record<string, TrackPoint[]>;
  /**
   * The place names and metro line for this ride's map (Garage > The map), if already kept, and a promise for when
   * they have been fetched (null when there is nothing to fetch). The story map shows them, and the card reuses them.
   */
  mapExtras?(rideId: number): { labels: MapPin[]; metro: Array<Array<[number, number]>> | null } | null;
  prepareCard?(rideId: number): Promise<unknown> | null;
  /** Copy one ride's log as plain text; resolves with whether it worked */
  copyRide(rideId: number): Promise<boolean>;
  /** Save one ride's log as a file */
  saveRide(rideId: number): void;
  /** Make and share a picture of the ride (ui/rideCard.ts) */
  /** `status` puts each step on the Share button ("Finding places...", "Making your card...") */
  shareRide(rideId: number, hideEnds: boolean, status: (text: string) => void): Promise<void>;
  toast(msg: string): void;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const date = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const longDate = (ms: number) => new Date(ms).toLocaleString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** What fuel cost this month and per km (rides that kept a cost: from 2026-10-17 on). */
function spendLine(rides: RideRecord[]): string {
  const f = fuelSpend(rides, Date.now());
  if (f.perKmR == null) return '';
  const month = f.monthRides ? `R${f.monthR} on fuel this month over ${f.monthRides} ride${f.monthRides === 1 ? '' : 's'}` : 'No fuel spent this month yet';
  return `<p class="fuel-spend">${month} · about R${f.perKmR.toFixed(2)} a km</p>`;
}

/** Riding and stopped time as a slim bar under the ride's numbers, when the ride kept its riding time. */
function timeSplit(r: RideRecord): string {
  const stopped = stoppedMinutes(r);
  if (stopped == null || r.minutes <= 0) return '';
  const riding = r.minutes - stopped;
  const pct = Math.round((riding / r.minutes) * 100);
  return `<div class="time-split" aria-label="${riding} minutes riding, ${stopped} stopped"><div class="bar"><i style="width:${pct}%"></i></div>
    <p><span><b>${duration(riding)}</b> riding</span><span><b>${duration(stopped)}</b> stopped</span></p></div>`;
}

const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`);
/** What she said on a ride: her spoken lines only, not silences, drops or diagnostics. */
const spokenLines = (entries: LogEntry[], rideId: number) =>
  entries.filter((e) => e.rideId === rideId && /^\[P\d\]/.test(e.head) && e.text && !e.text.startsWith('('));
const triggerOf = (head: string) => head.match(/^\[P\d\] (\w+)/)?.[1] ?? '';

/**
 * My journeys: every remembered ride, newest first. Opening one shows its story: the road taken (from the stored
 * track), distance and time, the places she talked about and what she flagged, and every line she said.
 */
export function mountJourneysScreen(doc: Document, shell: Shell, ctx: JourneysContext) {
  const list = doc.getElementById('journeylist')!;
  const totals = doc.getElementById('journeytotals')!;
  const story = doc.getElementById('story')!;

  /** Months shown open: the newest by default; he opens and closes the others. */
  const openMonths = new Set<string>();
  let touched = false;
  let roads: Record<string, TrackPoint[]> = {};
  const row = (r: RideRecord) => {
    const road = roads[String(r.startedAt)] ?? [];
    return `<button class="journey-row" type="button" data-ride="${r.startedAt}">
      ${CONFIG.journeyThumbs ? `<span class="journey-thumb">${miniTrackSvg(road)}</span>` : ''}
      <div class="journey-main"><p class="eyebrow">${esc(date(r.startedAt))}</p><h2>${esc(rideTitle(r))}</h2><p class="sub">${esc(r.weather ?? 'Out with Betty')}</p></div>
      <div class="right"><b>${r.distanceKm} km</b><p class="sub">${duration(rideMinutes(r, CONFIG.ridingTimeOnly))}</p></div></button>`;
  };

  // ---- Your roads (Journeys 3): every ride's rough road on one map, pan and zoom, tap a road to open its ride.
  const roadsCard = doc.getElementById('roadscard');
  const roadsHost = doc.getElementById('roadsmap');
  const roadsArt = doc.getElementById('roadsart');
  let roadsView: MapView | null = null;
  const roadList = () => Object.entries(roads).filter(([id, t]) => t.length > 1 && ctx.rides().some((r) => String(r.startedAt) === id));
  const renderRoads = () => {
    if (!roadsCard || !roadsHost || !roadsArt) return;
    const list = roadList();
    roadsCard.hidden = !list.length;
    if (!list.length) return;
    const box = roadsHost.getBoundingClientRect();
    roadsView ??= fitView(list.flatMap(([, t]) => t.map(([lat, lon]) => ({ lat, lon }))), box.width || 660, box.height || 300);
    roadsArt.innerHTML = mapSvg({ center: roadsView.center, here: null, headingDeg: null, track: [], places: [], incidents: [], marks: [], spanKm: roadsView.spanKm,
      roads: list.map(([, t]) => t) }, 'Your roads: every ride you have kept', 'roads');
  };
  if (roadsHost && roadsArt) {
    attachMapGestures(roadsHost, roadsArt, () => roadsView, (v) => { roadsView = v; renderRoads(); });
    doc.getElementById('roadsfit')?.addEventListener('click', () => { roadsView = null; renderRoads(); });
    let down: { x: number; y: number } | null = null;
    roadsHost.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    roadsHost.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button') || !roadsView) return;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const r = roadsHost.getBoundingClientRect();
      const k = Math.max(r.width / MAP_W, r.height / MAP_H) || 1;
      const tap = { x: (e.clientX - r.left - (r.width - MAP_W * k) / 2) / k, y: (e.clientY - r.top - (r.height - MAP_H * k) / 2) / k };
      const at = projector(roadsView.center, roadsView.spanKm);
      // Distance from the tap to each road's line segments, in map units; the nearest within ~14 px opens its ride.
      const seg = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
        const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
        const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      };
      let best: { id: string; d: number } | null = null;
      for (const [id, t] of roadList()) {
        const q = t.map(([lat, lon]) => at({ lat, lon }));
        for (let i = 1; i < q.length; i++) { const d = seg(tap, q[i - 1], q[i]); if (!best || d < best.d) best = { id, d }; }
      }
      if (best && best.d * k < 14) open(Number(best.id));
    });
  }

  // ---- Records and milestones (Journeys 4)
  const recordsBox = doc.getElementById('journeyrecords');
  const renderRecords = (rides: RideRecord[]) => {
    if (!recordsBox) return;
    if (!rides.length) { recordsBox.innerHTML = ''; return; }
    const rec = rideRecords(rides, roads, CONFIG.ridingTimeOnly, Date.now());
    const tile = (label: string, value: string, sub: string, ride?: number) => `<${ride ? `button type="button" data-ride="${ride}"` : 'div'} class="record-tile"><small>${esc(label)}</small><b>${esc(value)}</b><span>${esc(sub)}</span></${ride ? 'button' : 'div'}>`;
    const tiles = [
      rec.longest && tile('Longest ride', `${rec.longest.km} km`, date(rec.longest.ride.startedAt), rec.longest.ride.startedAt),
      rec.longestTime && tile('Longest in the saddle', duration(rec.longestTime.minutes), date(rec.longestTime.ride.startedAt), rec.longestTime.ride.startedAt),
      rec.furthest && rec.furthest.km >= 1 && tile('Furthest out', `${rec.furthest.km} km`, 'from where you set off', rec.furthest.ride.startedAt),
      rec.highest && tile('Highest point', `${rec.highest.m.toLocaleString('en-US')} m`, date(rec.highest.ride.startedAt), rec.highest.ride.startedAt),
      rec.bestMonth && tile('Best month', `${rec.bestMonth.km} km`, rec.bestMonth.label),
      rec.streak || rec.bestStreak ? tile('Weeks in a row', `${rec.streak}`, rec.bestStreak > rec.streak ? `best ${rec.bestStreak}` : rec.streak ? 'with a ride every week' : 'ride this week to start one') : '',
    ].filter(Boolean).join('');
    const next = rec.nextKm;
    const pct = next ? Math.round(((rec.totalKm - next.from) / (next.at - next.from)) * 100) : 100;
    recordsBox.innerHTML = `<section class="records-card"><h2>Records</h2><div class="record-grid">${tiles}</div>
      ${next ? `<div class="milestone"><p><b>${next.at.toLocaleString('en-US')} km with Betty</b><span>${next.left.toLocaleString('en-US')} to go</span></p><div class="bar"><i style="width:${pct}%"></i></div></div>` : ''}
      ${rec.nextRides ? `<p class="sub milestone-rides">${rec.nextRides.left} ride${rec.nextRides.left === 1 ? '' : 's'} to your ${rec.nextRides.at}th.</p>` : ''}</section>`;
  };

  const renderList = () => {
    const rides = [...ctx.rides()].reverse();
    if (!rides.length) {
      totals.innerHTML = '';
      if (roadsCard) roadsCard.hidden = true;
      if (recordsBox) recordsBox.innerHTML = '';
      list.innerHTML = `<div class="empty"><button class="orb resting" type="button" tabindex="-1" aria-hidden="true"></button><h2>Your story starts on the road.</h2>
        <p>Rides of three minutes or a kilometre and up land here, quietly organised by journey.</p>
        <button class="text-button" type="button" data-help="start">How Betty works</button></div>`;
      return;
    }
    const km = Math.round(rides.reduce((n, r) => n + r.distanceKm, 0));
    const min = rides.reduce((n, r) => n + rideMinutes(r, CONFIG.ridingTimeOnly), 0);
    totals.innerHTML = `<div class="totals"><div><b>${rides.length}</b><small>ride${rides.length === 1 ? '' : 's'}</small></div><div><b>${km} km</b><small>together</small></div><div><b>${duration(min)}</b><small>in the saddle</small></div></div>${spendLine(rides)}`;
    // By month (owner, 2026-10-18: "just a long scrolling list"): the newest month open, older ones a header line.
    const months = groupByMonth(rides, CONFIG.ridingTimeOnly);
    roads = ctx.roads?.() ?? {};
    renderRoads();
    renderRecords(rides);
    if (!touched) { openMonths.clear(); openMonths.add(months[0].key); }
    const thisMonth = monthKey(Date.now());
    list.innerHTML = months.map((m) => {
      const open = openMonths.has(m.key);
      const bits = [`${m.rides.length} ride${m.rides.length === 1 ? '' : 's'}`, `${Math.round(m.km)} km`, duration(m.minutes), m.costR != null ? `R${m.costR} fuel` : ''].filter(Boolean).join(' · ');
      return `<section class="journey-month${open ? ' open' : ''}" data-month="${m.key}">
        <button class="month-head" type="button" data-month-toggle="${m.key}" aria-expanded="${open}"><span><b>${m.key === thisMonth ? 'This month' : esc(m.label)}</b><small>${esc(bits)}</small></span><i class="chev" aria-hidden="true"></i></button>
        ${open ? `<div class="journey-list">${m.rides.map(row).join('')}</div>` : ''}</section>`;
    }).join('');
  };

  const renderStory = (rideId: number) => {
    const r = ctx.rides().find((x) => x.startedAt === rideId);
    if (!r) return;
    const said = spokenLines(ctx.entries(), rideId);
    const track = ctx.track(rideId);
    const places = r.places.length ? `She told you about ${r.places.slice(0, 3).join(', ')}${r.places.length > 3 ? ' and more' : ''}.` : '';
    const flags = r.events.length ? ` On the way she flagged ${r.events.join(', ')}.` : '';
    const shown = rideMinutes(r, CONFIG.ridingTimeOnly);
    const stopped = stoppedMinutes(r);
    const blurb = `${r.distanceKm} km and ${duration(shown)} ${CONFIG.ridingTimeOnly && stopped != null ? 'riding' : 'out'}${r.weather ? `, ${r.weather}` : ''}. ${places}${flags}`.trim();
    const moments = [
      ...r.places.map((p) => `<li>${esc(p)}<small>A sense of place</small></li>`),
      ...r.events.map((e) => `<li>${esc(e)}<small>Flagged on the way</small></li>`),
    ];
    story.dataset.ride = String(rideId); // which ride is showing (a refresh reopens it)
    // The road, with the towns along it and the metro line once they are known (fetched now if not kept yet).
    const roadMap = () => {
      const x = ctx.mapExtras?.(rideId) ?? null;
      return mapSvg({ center: trackCenter(track), here: null, headingDeg: null, track, places: [], incidents: [], marks: [], spanKm: spanFor(track),
        labels: x?.labels ?? [], labelSize: 26, borders: x?.metro?.length ? { suburbs: [], metro: x.metro } : null }, 'The road you took', 'story');
    };
    if (track.length > 1) {
      void ctx.prepareCard?.(rideId)?.then(() => {
        const m = story.querySelector('.story-map');
        if (m && story.dataset.ride === String(rideId)) m.innerHTML = roadMap();
      });
    }
    story.innerHTML = `<div class="intro"><div><p class="eyebrow">A ride worth remembering</p><h1>Your little escape.</h1></div>
        <button class="text-button" type="button" data-go="journeys">← My journeys</button></div>
      <div class="summary-hero"><div class="orb resting"></div><p class="eyebrow">Saved privately on this phone</p>
        <h1>${esc(rideTitle(r))}</h1><p>${esc(blurb)}</p>
        <div class="summary-stats"><div><b>${r.distanceKm}</b><small>Kilometres</small></div><div><b>${shown}</b><small>${CONFIG.ridingTimeOnly && stopped != null ? 'Minutes riding' : 'Minutes'}</small></div><div><b>${said.length}</b><small>Things she said</small></div>${r.costR != null ? `<div><b>R${r.costR}</b><small>Fuel, ${r.fuelL} L</small></div>` : ''}</div>
        ${timeSplit(r)}</div>
      <div class="page-grid">
        <div class="settings-card"><h2>The road you took</h2>
          ${track.length > 1 ? `<div class="story-map">${roadMap()}</div>`
            : '<p class="empty-note">No map for this ride: it was recorded before Betty kept the road, or without GPS.</p>'}
          <p>${esc(longDate(r.startedAt))}</p>
          ${moments.length ? foldList(moments, 4, 'moments') : '<p class="sub">A quiet ride is a good ride, too.</p>'}
        </div>
        <div class="settings-card"><h2>The moments in between</h2>
          ${said.length ? foldList(said.map((e) => `<li>${esc(triggerOf(e.head).replace(/_/g, ' '))}<small>${new Date(e.at).toTimeString().slice(0, 5)}</small><span class="said">${esc(e.text.replace(/<[^>]+>/g, ''))}</span></li>`), 5, 'things she said')
            : '<ul class="moments"><li>A moment for yourself<small>No saved lines for this ride</small></li></ul>'}
          <div class="share-ride"><button class="primary wide" type="button" data-share="${rideId}">${icon('share', 'ico sm')} Share this ride</button>
            <label class="check-row"><input type="checkbox" data-hideends checked /> Hide where I start and finish</label></div>
          <div class="dialog-actions"><button class="secondary" type="button" data-copy="${rideId}">${icon('share', 'ico sm')} Copy the log</button>
            <button class="secondary" type="button" data-save="${rideId}">Save as a file</button><button class="primary" type="button" data-go="home">Ride again →</button></div>
        </div>
      </div>`;
  };

  recordsBox?.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ride]');
    if (b) open(Number(b.dataset.ride));
  });
  list.addEventListener('click', (e) => {
    const mt = (e.target as Element).closest<HTMLElement>('[data-month-toggle]');
    if (mt) {
      const k = mt.dataset.monthToggle!;
      touched = true;
      if (openMonths.has(k)) openMonths.delete(k); else openMonths.add(k);
      renderList();
      return;
    }
    const b = (e.target as Element).closest<HTMLElement>('[data-ride]');
    if (b) open(Number(b.dataset.ride));
  });
  story.addEventListener('click', (e) => {
    const t = e.target as Element;
    toggleFold(t);
    const c = t.closest<HTMLElement>('[data-copy]');
    if (c) void ctx.copyRide(Number(c.dataset.copy)).then((ok) => ctx.toast(ok ? 'Ride log copied' : 'Copy is not available here'));
    const s = t.closest<HTMLElement>('[data-save]');
    if (s) ctx.saveRide(Number(s.dataset.save));
    const sh = t.closest<HTMLButtonElement>('[data-share]');
    if (sh && !sh.disabled) {
      const hide = story.querySelector<HTMLInputElement>('[data-hideends]')?.checked ?? true;
      const label = sh.innerHTML;
      sh.disabled = true;
      sh.setAttribute('aria-busy', 'true');
      void ctx.shareRide(Number(sh.dataset.share), hide, (text) => { sh.textContent = text; })
        .finally(() => { sh.disabled = false; sh.removeAttribute('aria-busy'); sh.innerHTML = label; });
    }
  });
  const open = (rideId: number) => { renderStory(rideId); shell.show('story'); };
  shell.onShow((id) => { if (id === 'journeys') renderList(); });
  renderList();
  return { renderList, renderStory, open };
}
