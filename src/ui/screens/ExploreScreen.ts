import type { RiderMemory } from '../../core/Commands';
import { AreaCard, KeptArea, areaCards, filterCard, fitView, matchesText } from '../../core/Explore';
import type { AreaNote } from '../../core/types';
import { foldList, toggleFold } from '../fold';
import { icon } from '../icons';
import { MapView, attachMapGestures } from '../mapGestures';
import { AreaPin, MAP_H, MAP_W, areaPinRadius, mapSvg, projector } from '../mapView';
import type { Shell } from '../Shell';

export interface ExploreContext {
  load(): RiderMemory;
  save(m: RiderMemory): void;
  /** Area stories she has researched, as the phone keeps them */
  stories(): KeptArea[];
  /** Ids of the stories she has already told (on a ride or here) */
  told(): Set<string>;
  /**
   * Betty reads a story out (Chirp by default, Garage > Stories at home). `onEnd(heard)` when it finishes (heard: it
   * played to the end, so it now counts as told) or is stopped. Returns a function that stops it.
   */
  listen(note: AreaNote, onEnd: (heard: boolean) => void): () => void;
  /** Find where these areas are (found before positions were kept); fires `betty-memory` as they arrive */
  locate?(areas: Array<{ key: string; name: string }>): void;
  /** Plan a route there (opens Where to? with the place filled in) */
  rideThere?(place: string): void;
}

type Tab = 'all' | 'stories' | 'unheard' | 'spots' | 'notes';
const TABS: Array<[Tab, string]> = [['all', 'Everything'], ['stories', 'Area stories'], ['unheard', 'Not heard yet'], ['spots', 'Marked spots'], ['notes', 'Notes']];

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const when = (at: number) => new Date(at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Stories shown when a card opens, before "Show all". */
const KEEP_STORIES = 3;
/** Marked spots on Explore's map (map units; the map is ~0.55 px a unit on a phone) */
const MARK_R = 12;

/** A small ring: how much of an area's stories he has heard. */
const ring = (heard: number, total: number) => {
  const r = 15, c = 2 * Math.PI * r, f = total ? heard / total : 0;
  return `<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="ring-bg"/>`
    + `<circle cx="18" cy="18" r="${r}" class="ring-fg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 18 18)"/>`
    + `<text x="18" y="22" text-anchor="middle">${total - heard}</text></svg>`;
};

/**
 * Explore: one card per area she has stories about (heard / not heard, Listen at home, Ride there), the spots he
 * marked ("mark this spot") and the notes he asked her to keep, with a search, filters, and a map of it all (tap a dot
 * for its stories). Refreshes on `betty-memory`.
 */
export function mountExploreScreen(doc: Document, shell: Shell, ctx: ExploreContext) {
  const list = doc.getElementById('explorelist')!;
  const tabs = doc.getElementById('exploretabs')!;
  const search = doc.getElementById('exploresearch') as HTMLInputElement | null;
  const modeBtn = doc.getElementById('exploremode') as HTMLButtonElement | null;
  const mapHost = doc.getElementById('exploremap');
  const art = doc.getElementById('exploreart');
  const hint = doc.getElementById('explorehint');
  const pinBody = doc.getElementById('explorepinbody');
  let tab: Tab = 'all';
  let mode: 'list' | 'map' = 'list';
  /** Areas he has opened (kept across re-renders) */
  const open = new Set<string>();
  /** Areas whose story list he has opened with "Show all" */
  const unfolded = new Set<string>();
  /** The story playing now, and how to stop it */
  let playing: { id: string; stop: () => void } | null = null;
  /** The map's view (null: fit everything on the next paint), and what the place sheet shows */
  let view: MapView | null = null;
  let sheet: { kind: 'area'; name: string } | { kind: 'mark'; index: number } | null = null;
  /** Areas already asked to be located this visit */
  const locating = new Set<string>();
  tabs.innerHTML = TABS.map(([k, label]) => `<button type="button" data-tab="${k}">${label}</button>`).join('');

  const storyLi = (n: AreaNote, told: Set<string>) => {
    const heard = told.has(n.id), on = playing?.id === n.id;
    return `<li class="story${heard ? ' heard' : ''}"><div><p class="topic">${esc(n.topic || 'A story')}${heard ? '<small>Heard</small>' : ''}</p><p>${esc(n.text)}</p></div>`
      + `<button class="listen${on ? ' on' : ''}" type="button" data-listen="${esc(n.id)}" aria-label="${on ? 'Stop' : 'Listen'}: ${esc(n.topic || 'story')}">${on ? '<span class="stop"></span>' : icon('volume', 'ico sm')}</button></li>`;
  };

  const areaHtml = (c: AreaCard, all: AreaCard, told: Set<string>, forceOpen: boolean) => {
    const isOpen = forceOpen || open.has(c.name);
    const left = all.notes.length - all.heard;
    const ride = ctx.rideThere ? `<div class="area-actions"><button class="secondary" type="button" data-ridethere="${esc(c.name)}">${icon('route', 'ico sm')} Ride there</button></div>` : '';
    return `<div class="keep-card area-card${isOpen ? ' open' : ''}" data-area="${esc(c.name)}">
      <button class="area-head" type="button" data-areaopen="${esc(c.name)}" aria-expanded="${isOpen}">${ring(all.heard, all.notes.length)}
        <span><b>${esc(c.name)}</b><small>${all.notes.length} ${all.notes.length === 1 ? 'story' : 'stories'} · ${left ? `${left} not heard yet` : 'all heard'}</small></span>${icon('chev', 'ico sm')}</button>
      ${isOpen ? `<div class="area-body">${foldList(c.notes.map((n) => storyLi(n, told)), KEEP_STORIES, 'stories', 'stories', unfolded.has(c.name))}${ride}</div>` : ''}</div>`;
  };

  const markHtml = (k: RiderMemory['marks'][number], i: number) => `<div class="keep-card"><p class="eyebrow">Marked spot · ${esc(when(k.at))}</p>
      <h3>${esc(k.note || 'A spot worth remembering')}</h3><p>${k.near ? `Near ${esc(k.near)}` : 'Marked on a ride'}</p>
      <a class="forget" href="https://maps.google.com/?q=${k.lat},${k.lon}" target="_blank" rel="noopener">Open map</a><button class="forget" type="button" data-forget="mark:${i}">Forget</button></div>`;

  /** What the search and the tab let through: area cards (whole and narrowed) and spots with their index. */
  const shown = () => {
    const q = search?.value.trim() ?? '';
    const m = ctx.load();
    const told = ctx.told();
    const areas = tab === 'all' || tab === 'stories' || tab === 'unheard'
      ? areaCards(ctx.stories(), told).map((c) => ({ all: c, card: filterCard(c, q, told, tab === 'unheard') })).filter((x): x is { all: AreaCard; card: AreaCard } => !!x.card)
      : [];
    const marks = tab === 'all' || tab === 'spots' ? m.marks.map((k, i) => ({ k, i })).filter(({ k }) => matchesText(q, k.note, k.near ?? '')) : [];
    const notes = tab === 'all' || tab === 'notes' ? m.notes.map((n, i) => ({ n, i })).filter(({ n }) => matchesText(q, n.text)) : [];
    return { q, told, areas, marks, notes };
  };

  const renderList = () => {
    const { q, told, areas, marks, notes } = shown();
    const keeps: Array<{ at: number; html: string }> = [
      ...marks.map(({ k, i }) => ({ at: k.at, html: markHtml(k, i) })),
      ...notes.map(({ n, i }) => ({ at: n.at, html: `<div class="keep-card"><p class="eyebrow">Note · ${esc(when(n.at))}</p>
      <h3>${esc(n.text)}</h3><button class="forget" type="button" data-forget="note:${i}">Forget</button></div>` })),
    ].sort((a, b) => b.at - a.at);
    const cards = areas.map(({ all, card }) => areaHtml(card, all, told, q.length > 0 && !matchesText(q, all.name)));
    const empty = q ? `Nothing matches “${esc(q)}”.` : tab === 'unheard' ? 'You have heard every story so far.' : 'Nothing here yet.';
    list.innerHTML = keeps.length || cards.length
      ? `<div class="keep-grid">${keeps.map((c) => c.html).join('')}${cards.join('')}</div>`
      : `<div class="empty"><p>${empty}</p></div>`;
  };

  /** The dots for the map: areas with a position, and his marked spots. */
  const pins = () => {
    const { areas, marks, told } = shown();
    const placed = areas.filter(({ all }) => all.lat != null && all.lon != null);
    const missing = areas.filter(({ all }) => all.lat == null && all.keys.some((k) => !locating.has(k)));
    if (missing.length && ctx.locate) {
      const ask = missing.flatMap(({ all }) => all.keys.filter((k) => !locating.has(k)).map((key) => ({ key, name: all.name })));
      ask.forEach((a) => locating.add(a.key));
      ctx.locate(ask);
    }
    const waiting = areas.filter(({ all }) => all.lat == null).length;
    const areaPins: AreaPin[] = placed.map(({ all, card }) => ({ id: all.name, lat: all.lat!, lon: all.lon!, label: all.name, unheard: card.notes.filter((n) => !told.has(n.id)).length, total: card.notes.length }));
    return { areaPins, marks, waiting };
  };

  const renderMap = () => {
    if (!art || !mapHost) return;
    const { areaPins, marks, waiting } = pins();
    const box = mapHost.getBoundingClientRect();
    view ??= fitView([...areaPins, ...marks.map(({ k }) => k)], box.width || 660, box.height || 500);
    art.innerHTML = mapSvg({
      center: view.center, here: null, headingDeg: null, track: [], places: [], incidents: [], spanKm: view.spanKm,
      marks: marks.map(({ k }) => ({ lat: k.lat, lon: k.lon })), markRadius: MARK_R, areaPins,
    }, 'Your stories and spots on a map', 'explore');
    if (hint) hint.textContent = waiting ? `Finding ${waiting} more ${waiting === 1 ? 'area' : 'areas'} on the map...`
      : areaPins.length || marks.length ? 'Tap a dot for its stories. Yellow: stories you have not heard yet.' : 'Nothing to show here yet.';
  };

  const renderSheet = () => {
    if (!pinBody || !sheet) return;
    const told = ctx.told();
    if (sheet.kind === 'area') {
      const name = sheet.name;
      const c = areaCards(ctx.stories(), told).find((x) => x.name === name);
      pinBody.innerHTML = c ? `<p class="eyebrow">Area stories</p><div class="keep-grid">${areaHtml(c, c, told, true)}</div>` : '';
    } else {
      const k = ctx.load().marks[sheet.index];
      pinBody.innerHTML = k ? `<p class="eyebrow">Marked spot</p><div class="keep-grid">${markHtml(k, sheet.index)}</div>` : '';
    }
  };

  const render = () => {
    tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const map = mode === 'map' && tab !== 'notes'; // notes have no place
    modeBtn?.setAttribute('aria-pressed', String(mode === 'map'));
    const label = modeBtn?.querySelector('span');
    if (label) label.textContent = mode === 'map' ? 'List' : 'Map';
    if (mapHost) mapHost.hidden = !map;
    list.hidden = map;
    if (map) renderMap(); else renderList();
    renderSheet();
  };

  const stopPlaying = () => { const p = playing; playing = null; p?.stop(); };
  tabs.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-tab]');
    if (b) { tab = b.dataset.tab as Tab; view = null; render(); }
  });
  search?.addEventListener('input', () => { view = null; render(); });
  modeBtn?.addEventListener('click', () => { mode = mode === 'map' ? 'list' : 'map'; view = null; render(); });
  doc.getElementById('explorefit')?.addEventListener('click', () => { view = null; render(); });

  // The map: pan and zoom like the others; a tap (not a drag) on a dot opens its sheet.
  if (mapHost && art) {
    attachMapGestures(mapHost, art, () => view, (v) => { view = v; renderMap(); });
    let down: { x: number; y: number } | null = null;
    mapHost.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    mapHost.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button') || !view) return;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      const r = mapHost.getBoundingClientRect();
      const k = Math.max(r.width / MAP_W, r.height / MAP_H) || 1;
      const ox = (r.width - MAP_W * k) / 2, oy = (r.height - MAP_H * k) / 2;
      const tap = { x: (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k };
      const at = projector(view.center, view.spanKm);
      const { areaPins, marks } = pins();
      const hits = [
        ...areaPins.map((p) => ({ d: Math.hypot(at(p).x - tap.x, at(p).y - tap.y) - areaPinRadius(p), go: () => { sheet = { kind: 'area', name: p.id }; } })),
        ...marks.map(({ k: m, i }) => ({ d: Math.hypot(at(m).x - tap.x, at(m).y - tap.y) - MARK_R, go: () => { sheet = { kind: 'mark', index: i }; } })),
      ].filter((h) => h.d * k < 14).sort((a, b) => a.d - b.d); // within ~14 px of the dot's edge
      if (!hits.length) return;
      hits[0].go();
      renderSheet();
      shell.openSheet('explorepin');
    });
  }

  const onTap = (e: Event) => {
    const t = e.target as Element;
    if (toggleFold(t)) {
      const name = t.closest<HTMLElement>('[data-area]')?.dataset.area;
      if (name && !unfolded.delete(name)) unfolded.add(name);
      return;
    }
    const head = t.closest<HTMLElement>('[data-areaopen]');
    if (head) {
      if (t.closest('#explorepinbody')) return; // the sheet's card stays open
      const name = head.dataset.areaopen!;
      if (!open.delete(name)) open.add(name);
      render();
      return;
    }
    const go = t.closest<HTMLElement>('[data-ridethere]');
    if (go) { stopPlaying(); shell.closeSheet(); ctx.rideThere?.(go.dataset.ridethere!); return; }
    const l = t.closest<HTMLElement>('[data-listen]');
    if (l) {
      const id = l.dataset.listen!;
      const wasMe = playing?.id === id;
      stopPlaying();
      if (wasMe) { render(); return; }
      const note = ctx.stories().flatMap((a) => a.notes).find((n) => n.id === id);
      if (!note) return;
      const mine = { id, stop: () => {} };
      playing = mine;
      mine.stop = ctx.listen(note, () => { if (playing === mine) playing = null; render(); });
      render();
      return;
    }
    const b = t.closest<HTMLElement>('[data-forget]');
    if (!b) return;
    const [kind, idx] = b.dataset.forget!.split(':');
    const m = ctx.load(); const i = Number(idx);
    ctx.save(kind === 'mark' ? { ...m, marks: m.marks.filter((_, j) => j !== i) } : { ...m, notes: m.notes.filter((_, j) => j !== i) });
    if (sheet) { sheet = null; shell.closeSheet(); }
    doc.defaultView?.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).Event('betty-memory'));
  };
  list.addEventListener('click', onTap);
  pinBody?.addEventListener('click', onTap);
  doc.defaultView?.addEventListener('betty-memory', render);
  shell.onShow((id) => { if (id === 'explore') render(); else { stopPlaying(); sheet = null; } });
  render();
  return { render };
}
