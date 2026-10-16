import type { LogEntry } from '../../core/LineLog';
import type { RideRecord } from '../../core/RideMemory';
import { icon } from '../icons';
import type { Shell } from '../Shell';

export interface JourneysContext {
  /** Remembered rides (oldest first, as RideLog keeps them) */
  rides(): RideRecord[];
  /** Every saved line */
  entries(): LogEntry[];
  /** Copy one ride's log as plain text; resolves with whether it worked */
  copyRide(rideId: number): Promise<boolean>;
  toast(msg: string): void;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const day = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { weekday: 'long' });
const date = (ms: number) => new Date(ms).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`);
/** What she said on a ride: her spoken lines only, not silences, drops or diagnostics. */
const spokenLines = (entries: LogEntry[], rideId: number) =>
  entries.filter((e) => e.rideId === rideId && /^\[P\d\]/.test(e.head) && e.text && !e.text.startsWith('('));
const triggerOf = (head: string) => head.match(/^\[P\d\] (\w+)/)?.[1] ?? '';

/** The hills on the ride card, from the design prototype. */
const POSTCARD = `<svg viewBox="0 0 340 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="340" height="220" fill="#e2b68c"/><circle cx="266" cy="45" r="29" fill="#f8d3a3"/><path d="M0 121Q55 68 107 117T210 110T340 98V220H0" fill="#a7a994"/><path d="M0 152Q50 102 105 149T220 130T340 142V220H0" fill="#758c79"/><path d="M0 172Q59 142 112 178T231 157T340 162V220H0" fill="#466b5b"/><path d="M86 220C127 184 172 199 192 173s5-29 33-43" stroke="#f5e0b3" stroke-width="23" fill="none"/><path d="M86 220C127 184 172 199 192 173s5-29 33-43" stroke="#bb976c" stroke-dasharray="4 16" stroke-width="1.5" fill="none"/></svg>`;

/**
 * Journeys: every remembered ride, newest first. Tapping one opens its story: distance, time, the places she talked
 * about, what she flagged, and every line she said (from the saved log), with a button to copy the log.
 */
export function mountJourneysScreen(doc: Document, shell: Shell, ctx: JourneysContext) {
  const list = doc.getElementById('journeylist')!;
  const totals = doc.getElementById('journeytotals')!;
  const story = doc.getElementById('story')!;

  const renderList = () => {
    const rides = [...ctx.rides()].reverse();
    if (!rides.length) {
      totals.innerHTML = '';
      list.innerHTML = '<div class="info-note">Rides of three minutes or a kilometre and up land here, quietly organised by journey.</div>';
      return;
    }
    const km = Math.round(rides.reduce((n, r) => n + r.distanceKm, 0));
    const min = rides.reduce((n, r) => n + r.minutes, 0);
    totals.innerHTML = `<div class="stats-row"><div class="stat-cell"><b>${km} <small>km</small></b><span>${rides.length} ride${rides.length === 1 ? '' : 's'}</span></div>`
      + `<div class="stat-cell"><b>${duration(min)}</b><span>Together</span></div></div>`;
    list.innerHTML = rides.map((r) => `<button class="discover-card" type="button" data-ride="${r.startedAt}">
      <div><div class="mini-label">${esc(date(r.startedAt))}</div><b style="margin-top:7px">${esc(title(r))}</b>
      <small>${r.distanceKm} km · ${duration(r.minutes)}${r.weather ? ` · ${esc(r.weather)}` : ''}</small></div>
      <div class="discover-icon">${icon('arrow')}</div></button>`).join('');
  };

  const title = (r: RideRecord) => `${day(r.startedAt)} ride${r.places[0] ? `, ${r.places[0]}` : ''}`;

  const renderStory = (rideId: number) => {
    const r = ctx.rides().find((x) => x.startedAt === rideId);
    if (!r) return;
    const said = spokenLines(ctx.entries(), rideId);
    const moments = [
      ...r.places.map((p) => ['compass', p, 'She told you about it'] as const),
      ...r.events.map((e) => ['info', e, 'Flagged on the way'] as const),
    ];
    story.innerHTML = `<div class="eyebrow warm">${esc(date(r.startedAt))}</div>
      <h1>That was<br>a <em>good one.</em></h1>
      <p class="page-lead">${r.weather ? `Weather: ${esc(r.weather)}.` : 'Out on the road with Betty.'}</p>
      <div class="postcard">${POSTCARD}<div class="posttitle">${esc(title(r))}</div></div>
      <div class="stats-row"><div class="stat-cell"><b>${r.distanceKm} <small>km</small></b><span>Distance</span></div>
      <div class="stat-cell"><b>${duration(r.minutes)}</b><span>Duration</span></div></div>
      <div class="eyebrow muted">The little moments</div>
      ${moments.length ? moments.map(([ic, b, s]) => `<div class="moment-item"><span class="moment-symbol">${icon(ic)}</span><span class="grow"><b>${esc(b)}</b><small>${s}</small></span></div>`).join('')
        : '<div class="empty-note">A quiet one: nothing flagged, no places talked about.</div>'}
      <h2 class="section-title">What she said</h2>
      ${said.length ? said.map((e) => `<div class="said"><small>${new Date(e.at).toTimeString().slice(0, 5)} · ${esc(triggerOf(e.head).replace(/_/g, ' '))}</small>${esc(e.text.replace(/<[^>]+>/g, ''))}</div>`).join('')
        : '<div class="empty-note">No saved lines for this ride.</div>'}
      <button class="outline-button" type="button" data-copy="${rideId}">${icon('share')} Copy the ride log</button>`;
  };

  list.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-ride]');
    if (!b) return;
    renderStory(Number(b.dataset.ride));
    shell.show('story');
  });
  story.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-copy]');
    if (b) void ctx.copyRide(Number(b.dataset.copy)).then((ok) => ctx.toast(ok ? 'Ride log copied' : 'Copy is not available here'));
  });
  shell.onShow((id) => { if (id === 'journeys') renderList(); });
  renderList();
  return { renderList, renderStory };
}
