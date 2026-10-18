import type { LatLon } from '../core/geo';
import { PlannedRoute, minutesText } from '../core/Route';
import { CheckpointWeather, checkpoints, weatherLine } from '../core/RouteAhead';

const KEY = 'betty.route.v1';
/** The planned route, kept on the phone until he clears it (it is in the data backup, like everything betty.*). */
export const RouteStore = {
  get(): PlannedRoute | null { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v?.points?.length ? v : null; } catch { return null; } },
  set(r: PlannedRoute | null) { try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); else localStorage.removeItem(KEY); } catch { /* storage full or blocked */ } },
  /** Routes he saved to ride again (newest first, 20), with their stays (Route: what is ahead, 2026-10-18). */
  saved(): PlannedRoute[] { try { const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } },
  save(r: PlannedRoute) { try { localStorage.setItem(SAVED_KEY, JSON.stringify([r, ...RouteStore.saved().filter((x) => x.plannedAt !== r.plannedAt && x.name !== r.name)].slice(0, 20))); } catch { /* full */ } },
  unsave(plannedAt: number) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(RouteStore.saved().filter((x) => x.plannedAt !== plannedAt))); } catch { /* ignore */ } },
};
const SAVED_KEY = 'betty.routes.saved.v1';
/** How long he can stay at a stop: ride through, or minutes (counted in the time left and the arrival times). */
export const STAYS = [0, 10, 15, 30, 45, 60, 90];

/** What he typed: a Google Maps link, or places separated by commas ("Heidelberg, Villiers, Clarens"). */
export function routeRequest(input: string, thrilling: boolean, from: LatLon | null) {
  const t = input.trim();
  const isLink = /^https?:\/\//i.test(t);
  return { ...(isLink ? { link: t } : { stops: t.split(/\s*[,;]\s*|\s+then\s+/i).filter(Boolean) }), thrilling, ...(from ? { from } : {}) };
}

const stays = (r: PlannedRoute) => r.stops.reduce((n, s) => n + (s.named && s.stayMin ? s.stayMin : 0), 0);
export const routeStats = (r: PlannedRoute) =>
  `${Math.round(r.km)} km · about ${minutesText(r.minutes + stays(r))}${stays(r) ? ` (${minutesText(stays(r))} of stops)` : ''}${r.delayMin ? ` · ${r.delayMin} min traffic` : ''}${r.thrilling ? ' · twisty roads' : ''}`
  + `${r.stops.filter((s) => s.named).length > 1 ? ` · via ${r.stops.filter((s) => s.named).slice(0, -1).map((s) => s.name).slice(0, 3).join(', ')}` : ''}`;

export interface PlannerContext {
  /** Where he is now, if the phone can say (the route starts there) */
  position(): Promise<LatLon | null>;
  onChange(r: PlannedRoute | null): void;
  toast(msg: string, err?: boolean): void;
  /** The weather at each checkpoint at the hour he would get there, leaving now (adapters/RouteWeather) */
  weather?(r: PlannedRoute): Promise<CheckpointWeather[] | null>;
  /** Research the towns at the named stops before he gets there; how many stories each has (server only) */
  storiesAhead?(r: PlannedRoute): Promise<Record<string, number>>;
  /** For "plan it with Betty": places he has ridden (to vary from) and roughly where he is */
  known?(): string[];
  area?(): string | null;
  /** Whether the route fits in the fuel he has ("Needs a fuel stop: fill up by Villiers") */
  fuelNote?(r: PlannedRoute): string;
  fetcher?: typeof fetch;
}

/**
 * "Where to?" in the ride-mode sheet: type places or paste a Google Maps link, choose twisty roads, Plan. Shows the
 * route with "Open in Google Maps" (for the turns) and "Clear route".
 */
export function mountRoutePlanner(doc: Document, ctx: PlannerContext) {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const form = $<HTMLFormElement>('routeform');
  const input = $<HTMLInputElement>('routeinput');
  const twisty = $<HTMLInputElement>('routethrilling');
  const go = $<HTMLButtonElement>('routeplan');
  /** Weather and stories, fetched once per route (and again when a stay changes the arrival times). */
  let wx: { key: string; list: CheckpointWeather[] } | null = null;
  let stories: { key: number; counts: Record<string, number> } | null = null;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
  const paintSaved = () => {
    const box = $('savedroutes');
    if (!box) return;
    const list = RouteStore.saved();
    box.hidden = !list.length;
    box.innerHTML = list.length ? `<p class="eyebrow">Saved routes</p>${list.map((x) => `<div class="saved-route"><button class="text-button" type="button" data-use-route="${x.plannedAt}"><b>${esc(x.name)}</b><small>${Math.round(x.km)} km</small></button><button class="saved-x" type="button" data-unsave="${x.plannedAt}" aria-label="Remove ${esc(x.name)}">×</button></div>`).join('')}` : '';
  };
  const paint = () => {
    paintSaved();
    const r = RouteStore.get();
    $('routesummary').hidden = !r;
    if (!r) return;
    $('routename').textContent = r.name;
    const why = $('routewhy'); if (why) { why.textContent = r.why ?? ''; why.hidden = !r.why; }
    $('routestats').textContent = routeStats(r);
    const fuel = $('routefuel'); if (fuel) fuel.textContent = ctx.fuelNote?.(r) ?? '';
    ($<HTMLAnchorElement>('routemaps')).href = r.mapsUrl;
    const saved = RouteStore.saved().some((x) => x.plannedAt === r.plannedAt);
    const sv = $('routesave'); if (sv) { sv.textContent = saved ? 'Saved' : 'Save route'; (sv as HTMLButtonElement).disabled = saved; }
    // The stops: arrival if he leaves now, the weather there then, stories ready, and how long he stays.
    const cps = checkpoints(r, null, 1e9, 40).filter((c) => c.named);
    const key = `${r.plannedAt}:${r.stops.map((x) => x.stayMin ?? 0).join(',')}`;
    const list = $('routestops');
    if (list) {
      const last = cps.length - 1;
      list.innerHTML = cps.map((c, k) => {
        const i = r.stops.findIndex((x) => x.named && x.name === c.name);
        const w = wx?.key === key ? wx.list.find((x) => x.name === c.name) : null;
        const n = stories?.key === r.plannedAt ? stories.counts[c.name] : undefined;
        const stay = k < last && i >= 0 ? `<select data-stay="${i}" aria-label="Stay at ${esc(c.name)}">${STAYS.map((m) => `<option value="${m}"${(r.stops[i].stayMin ?? 0) === m ? ' selected' : ''}>${m ? `Stop ${m} min` : 'Ride through'}</option>`).join('')}</select>` : '';
        return `<li><div><b>${esc(c.name)}</b><small>${c.km} km · about ${hhmm(Date.now() + c.inMin * 60_000)}${w ? ` · ${esc(weatherLine(w))}` : ''}${n ? ` · ${n} ${n === 1 ? 'story' : 'stories'} ready` : ''}</small></div>${stay}</li>`;
      }).join('');
    }
    if (ctx.weather && wx?.key !== key) {
      const want = key;
      void ctx.weather(r).then((l) => { if (l && RouteStore.get()?.plannedAt === r.plannedAt) { wx = { key: want, list: l }; paint(); } });
      wx = { key: want, list: [] }; // asked: do not ask again while it comes
    }
    if (ctx.storiesAhead && stories?.key !== r.plannedAt) {
      stories = { key: r.plannedAt, counts: {} };
      void ctx.storiesAhead(r).then((counts) => { if (stories?.key === r.plannedAt) { stories = { key: r.plannedAt, counts }; paint(); } });
    }
  };
  $('routestops')?.addEventListener('change', (e) => {
    const sel = (e.target as Element).closest<HTMLSelectElement>('[data-stay]');
    const r = RouteStore.get();
    if (!sel || !r) return;
    const i = Number(sel.dataset.stay), m = Number(sel.value);
    const next: PlannedRoute = { ...r, stops: r.stops.map((s, k) => (k === i ? { ...s, stayMin: m || undefined } : s)) };
    RouteStore.set(next);
    if (RouteStore.saved().some((x) => x.plannedAt === r.plannedAt)) RouteStore.save(next);
    paint(); ctx.onChange(next);
  });
  $('routesave')?.addEventListener('click', () => { const r = RouteStore.get(); if (r) { RouteStore.save(r); ctx.toast(`Saved: ${r.name}.`); paint(); } });
  $('savedroutes')?.addEventListener('click', (e) => {
    const t = e.target as Element;
    const un = t.closest<HTMLElement>('[data-unsave]');
    if (un) { RouteStore.unsave(Number(un.dataset.unsave)); paint(); return; }
    const use = t.closest<HTMLElement>('[data-use-route]');
    const r = use ? RouteStore.saved().find((x) => x.plannedAt === Number(use.dataset.useRoute)) : null;
    if (r) { RouteStore.set(r); paint(); ctx.onChange(r); ctx.toast(`Route: ${r.name}.`); }
  });
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value.trim() || go.disabled) return;
    go.disabled = true; go.textContent = 'Planning...';
    try {
      const res = await (ctx.fetcher ?? fetch)('/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(routeRequest(input.value, twisty.checked, await ctx.position())) });
      const out: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
      const r: PlannedRoute = { ...out, plannedAt: Date.now() };
      RouteStore.set(r); input.value = '';
      paint(); ctx.onChange(r);
      ctx.toast(`Route planned: ${r.name}, ${Math.round(r.km)} km.`);
    } catch (err) { ctx.toast((err as Error).message, true); }
    finally { go.disabled = false; go.textContent = 'Plan'; }
  });
  // Plan it with Betty: what he describes -> her stops (api/plan) -> the route through them (api/route).
  const ask = $<HTMLButtonElement>('routeask');
  ask?.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) { ctx.toast('Describe the ride in the box first: "a two-hour breakfast run, twisty roads".'); input.focus(); return; }
    if (ask.disabled) return;
    const label = ask.textContent; ask.disabled = true; ask.textContent = 'Betty is planning...';
    const f = ctx.fetcher ?? fetch;
    try {
      const from = await ctx.position();
      const pr = await f('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ask: text, area: ctx.area?.() ?? '', known: ctx.known?.() ?? [], ...(from ? { from } : {}) }) });
      const plan: any = await pr.json().catch(() => ({}));
      if (!pr.ok) throw new Error(plan?.error || `HTTP ${pr.status}`);
      const stops = (plan.stops as string[]).map((s) => (s === 'HOME' ? (from ? `${from.lat.toFixed(5)},${from.lon.toFixed(5)}` : '') : s)).filter(Boolean);
      ask.textContent = `Routing ${stops.length} stops...`;
      const rr = await f('/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stops, thrilling: !!plan.thrilling, ...(from ? { from } : {}) }) });
      const out: any = await rr.json().catch(() => ({}));
      if (!rr.ok) throw new Error(out?.error || `HTTP ${rr.status}`);
      const r: PlannedRoute = { ...out, name: plan.name || out.name, why: plan.why || undefined, plannedAt: Date.now() };
      RouteStore.set(r); input.value = '';
      paint(); ctx.onChange(r);
      ctx.toast(`Betty planned ${r.name}: ${Math.round(r.km)} km.`);
    } catch (err) { ctx.toast((err as Error).message, true); }
    finally { ask.disabled = false; ask.textContent = label; }
  });
  $('routeclear')?.addEventListener('click', () => { RouteStore.set(null); paint(); ctx.onChange(null); ctx.toast('Route cleared: a free ride it is.'); });
  paint();
  return { paint };
}
