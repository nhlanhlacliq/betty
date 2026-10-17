import type { LatLon } from '../core/geo';
import { PlannedRoute, minutesText } from '../core/Route';

const KEY = 'betty.route.v1';
/** The planned route, kept on the phone until he clears it (it is in the data backup, like everything betty.*). */
export const RouteStore = {
  get(): PlannedRoute | null { try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v?.points?.length ? v : null; } catch { return null; } },
  set(r: PlannedRoute | null) { try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); else localStorage.removeItem(KEY); } catch { /* storage full or blocked */ } },
};

/** What he typed: a Google Maps link, or places separated by commas ("Heidelberg, Villiers, Clarens"). */
export function routeRequest(input: string, thrilling: boolean, from: LatLon | null) {
  const t = input.trim();
  const isLink = /^https?:\/\//i.test(t);
  return { ...(isLink ? { link: t } : { stops: t.split(/\s*[,;]\s*|\s+then\s+/i).filter(Boolean) }), thrilling, ...(from ? { from } : {}) };
}

export const routeStats = (r: PlannedRoute) =>
  `${Math.round(r.km)} km · about ${minutesText(r.minutes)}${r.delayMin ? ` · ${r.delayMin} min traffic` : ''}${r.thrilling ? ' · twisty roads' : ''}`
  + `${r.stops.filter((s) => s.named).length > 1 ? ` · via ${r.stops.filter((s) => s.named).slice(0, -1).map((s) => s.name).slice(0, 3).join(', ')}` : ''}`;

export interface PlannerContext {
  /** Where he is now, if the phone can say (the route starts there) */
  position(): Promise<LatLon | null>;
  onChange(r: PlannedRoute | null): void;
  toast(msg: string, err?: boolean): void;
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
  const paint = () => {
    const r = RouteStore.get();
    $('routesummary').hidden = !r;
    if (!r) return;
    $('routename').textContent = r.name;
    $('routestats').textContent = routeStats(r);
    ($<HTMLAnchorElement>('routemaps')).href = r.mapsUrl;
  };
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
  $('routeclear')?.addEventListener('click', () => { RouteStore.set(null); paint(); ctx.onChange(null); ctx.toast('Route cleared: a free ride it is.'); });
  paint();
  return { paint };
}
