import type { LogEntry } from '../../core/LineLog';
import type { RideRecord } from '../../core/RideMemory';
import type { TrackPoint } from '../../core/Track';
import { icon } from '../icons';
import { MapPin, mapSvg, spanFor, trackCenter } from '../mapView';
import type { Shell } from '../Shell';
import { rideTitle } from './HomeScreen';

export interface JourneysContext {
  /** Remembered rides (oldest first, as RideLog keeps them) */
  rides(): RideRecord[];
  /** Every saved line */
  entries(): LogEntry[];
  track(rideId: number): TrackPoint[];
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
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`);
/** What she said on a ride: her spoken lines only, not silences, drops or diagnostics. */
const spokenLines = (entries: LogEntry[], rideId: number) =>
  entries.filter((e) => e.rideId === rideId && /^\[P\d\]/.test(e.head) && e.text && !e.text.startsWith('('));
/**
 * A list that shows its first `keep` items and a quiet "Show all N" button under it (owner, 2026-10-17: a long ride's
 * lists were very long). Items past `keep` are hidden by CSS (`.folded .more`), so expanding needs no re-render.
 */
const foldList = (items: string[], keep: number, what: string) => {
  if (items.length <= keep + 1) return `<ul class="moments">${items.join('')}</ul>`;
  const lis = items.map((li, i) => (i < keep ? li : li.replace('<li>', '<li class="more">'))).join('');
  return `<ul class="moments folded">${lis}</ul><button class="text-button fold-toggle" type="button" data-fold aria-expanded="false" data-all="Show all ${items.length} ${what}">`
    + `<span>Show all ${items.length} ${what}</span>${icon('chev', 'ico sm')}</button>`;
};
const triggerOf = (head: string) => head.match(/^\[P\d\] (\w+)/)?.[1] ?? '';

/**
 * My journeys: every remembered ride, newest first. Opening one shows its story: the road taken (from the stored
 * track), distance and time, the places she talked about and what she flagged, and every line she said.
 */
export function mountJourneysScreen(doc: Document, shell: Shell, ctx: JourneysContext) {
  const list = doc.getElementById('journeylist')!;
  const totals = doc.getElementById('journeytotals')!;
  const story = doc.getElementById('story')!;

  const renderList = () => {
    const rides = [...ctx.rides()].reverse();
    if (!rides.length) {
      totals.innerHTML = '';
      list.innerHTML = `<div class="empty"><button class="orb resting" type="button" tabindex="-1" aria-hidden="true"></button><h2>Your story starts on the road.</h2>
        <p>Rides of three minutes or a kilometre and up land here, quietly organised by journey.</p></div>`;
      return;
    }
    const km = Math.round(rides.reduce((n, r) => n + r.distanceKm, 0));
    const min = rides.reduce((n, r) => n + r.minutes, 0);
    totals.innerHTML = `<div class="totals"><div><b>${rides.length}</b><small>ride${rides.length === 1 ? '' : 's'}</small></div><div><b>${km} km</b><small>together</small></div><div><b>${duration(min)}</b><small>in the saddle</small></div></div>`;
    list.innerHTML = `<div class="journey-list">${rides.map((r) => `<button class="journey-row" type="button" data-ride="${r.startedAt}">
      <div><p class="eyebrow">${esc(date(r.startedAt))}</p><h2 style="font-size:19px">${esc(rideTitle(r))}</h2><p class="sub" style="margin-top:7px">${esc(r.weather ?? 'Out with Betty')}</p></div>
      <div class="right"><b>${r.distanceKm} km</b><p class="sub">${duration(r.minutes)} · ${r.places.length + r.events.length} moments ↗</p></div></button>`).join('')}</div>`;
  };

  const renderStory = (rideId: number) => {
    const r = ctx.rides().find((x) => x.startedAt === rideId);
    if (!r) return;
    const said = spokenLines(ctx.entries(), rideId);
    const track = ctx.track(rideId);
    const places = r.places.length ? `She told you about ${r.places.slice(0, 3).join(', ')}${r.places.length > 3 ? ' and more' : ''}.` : '';
    const flags = r.events.length ? ` On the way she flagged ${r.events.join(', ')}.` : '';
    const blurb = `${r.distanceKm} km and ${duration(r.minutes)} out${r.weather ? `, ${r.weather}` : ''}. ${places}${flags}`.trim();
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
        <div class="summary-stats"><div><b>${r.distanceKm}</b><small>Kilometres</small></div><div><b>${r.minutes}</b><small>Minutes</small></div><div><b>${said.length}</b><small>Things she said</small></div></div></div>
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

  list.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ride]');
    if (b) open(Number(b.dataset.ride));
  });
  story.addEventListener('click', (e) => {
    const t = e.target as Element;
    const f = t.closest<HTMLButtonElement>('[data-fold]');
    if (f) {
      const list = f.previousElementSibling as HTMLElement;
      const open = list.classList.toggle('folded') === false;
      f.setAttribute('aria-expanded', String(open));
      f.querySelector('span')!.textContent = open ? 'Show less' : f.dataset.all!;
      if (!open) list.scrollIntoView?.({ block: 'nearest' }); // folding a long list: don't leave him far below it
    }
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
