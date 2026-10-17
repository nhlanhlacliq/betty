import type { RiderMemory } from '../../core/Commands';
import { AreaCard, KeptArea, areaCards, filterCard, matchesText } from '../../core/Explore';
import type { AreaNote } from '../../core/types';
import { foldList, toggleFold } from '../fold';
import { icon } from '../icons';
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
}

type Tab = 'all' | 'stories' | 'unheard' | 'spots' | 'notes';
const TABS: Array<[Tab, string]> = [['all', 'Everything'], ['stories', 'Area stories'], ['unheard', 'Not heard yet'], ['spots', 'Marked spots'], ['notes', 'Notes']];

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const when = (at: number) => new Date(at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Stories shown when a card opens, before "Show all". */
const KEEP_STORIES = 3;

/** A small ring: how much of an area's stories he has heard. */
const ring = (heard: number, total: number) => {
  const r = 15, c = 2 * Math.PI * r, f = total ? heard / total : 0;
  return `<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="ring-bg"/>`
    + `<circle cx="18" cy="18" r="${r}" class="ring-fg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 18 18)"/>`
    + `<text x="18" y="22" text-anchor="middle">${total - heard}</text></svg>`;
};

/**
 * Explore: one card per area she has stories about (heard / not heard, Listen at home), the spots he marked ("mark
 * this spot") and the notes he asked her to keep, with a search and filters. Refreshes on `betty-memory`.
 */
export function mountExploreScreen(doc: Document, shell: Shell, ctx: ExploreContext) {
  const list = doc.getElementById('explorelist')!;
  const tabs = doc.getElementById('exploretabs')!;
  const search = doc.getElementById('exploresearch') as HTMLInputElement | null;
  let tab: Tab = 'all';
  /** Areas he has opened (kept across re-renders) */
  const open = new Set<string>();
  /** Areas whose story list he has opened with "Show all" */
  const unfolded = new Set<string>();
  /** The story playing now, and how to stop it */
  let playing: { id: string; stop: () => void } | null = null;
  tabs.innerHTML = TABS.map(([k, label]) => `<button type="button" data-tab="${k}">${label}</button>`).join('');

  const storyLi = (n: AreaNote, told: Set<string>) => {
    const heard = told.has(n.id), on = playing?.id === n.id;
    return `<li class="story${heard ? ' heard' : ''}"><div><p class="topic">${esc(n.topic || 'A story')}${heard ? '<small>Heard</small>' : ''}</p><p>${esc(n.text)}</p></div>`
      + `<button class="listen${on ? ' on' : ''}" type="button" data-listen="${esc(n.id)}" aria-label="${on ? 'Stop' : 'Listen'}: ${esc(n.topic || 'story')}">${on ? '<span class="stop"></span>' : icon('volume', 'ico sm')}</button></li>`;
  };

  const areaHtml = (c: AreaCard, all: AreaCard, told: Set<string>, forceOpen: boolean) => {
    const isOpen = forceOpen || open.has(c.name);
    const left = all.notes.length - all.heard;
    return `<div class="keep-card area-card${isOpen ? ' open' : ''}" data-area="${esc(c.name)}">
      <button class="area-head" type="button" data-areaopen="${esc(c.name)}" aria-expanded="${isOpen}">${ring(all.heard, all.notes.length)}
        <span><b>${esc(c.name)}</b><small>${all.notes.length} ${all.notes.length === 1 ? 'story' : 'stories'} · ${left ? `${left} not heard yet` : 'all heard'}</small></span>${icon('chev', 'ico sm')}</button>
      ${isOpen ? `<div class="area-body">${foldList(c.notes.map((n) => storyLi(n, told)), KEEP_STORIES, 'stories', 'stories', unfolded.has(c.name))}</div>` : ''}</div>`;
  };

  const render = () => {
    tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const q = search?.value.trim() ?? '';
    const m = ctx.load();
    const told = ctx.told();
    const keeps: Array<{ at: number; html: string }> = [];
    if (tab === 'all' || tab === 'spots') m.marks.forEach((k, i) => {
      if (matchesText(q, k.note, k.near ?? '')) keeps.push({ at: k.at, html: `<div class="keep-card"><p class="eyebrow">Marked spot · ${esc(when(k.at))}</p>
      <h3>${esc(k.note || 'A spot worth remembering')}</h3><p>${k.near ? `Near ${esc(k.near)}` : 'Marked on a ride'}</p>
      <a class="forget" href="https://maps.google.com/?q=${k.lat},${k.lon}" target="_blank" rel="noopener">Open map</a><button class="forget" type="button" data-forget="mark:${i}">Forget</button></div>` });
    });
    if (tab === 'all' || tab === 'notes') m.notes.forEach((n, i) => {
      if (matchesText(q, n.text)) keeps.push({ at: n.at, html: `<div class="keep-card"><p class="eyebrow">Note · ${esc(when(n.at))}</p>
      <h3>${esc(n.text)}</h3><button class="forget" type="button" data-forget="note:${i}">Forget</button></div>` });
    });
    keeps.sort((a, b) => b.at - a.at);
    const areas: string[] = [];
    if (tab === 'all' || tab === 'stories' || tab === 'unheard') {
      for (const c of areaCards(ctx.stories(), told)) {
        const shown = filterCard(c, q, told, tab === 'unheard');
        if (shown) areas.push(areaHtml(shown, c, told, q.length > 0 && !matchesText(q, c.name)));
      }
    }
    const empty = q ? `Nothing matches “${esc(q)}”.` : tab === 'unheard' ? 'You have heard every story so far.' : 'Nothing here yet.';
    list.innerHTML = keeps.length || areas.length
      ? `<div class="keep-grid">${keeps.map((c) => c.html).join('')}${areas.join('')}</div>`
      : `<div class="empty"><p>${empty}</p></div>`;
  };

  const stopPlaying = () => { const p = playing; playing = null; p?.stop(); };
  tabs.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-tab]');
    if (b) { tab = b.dataset.tab as Tab; render(); }
  });
  search?.addEventListener('input', render);
  list.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (toggleFold(t)) {
      const name = t.closest<HTMLElement>('[data-area]')?.dataset.area;
      if (name && !unfolded.delete(name)) unfolded.add(name);
      return;
    }
    const head = t.closest<HTMLElement>('[data-areaopen]');
    if (head) {
      const name = head.dataset.areaopen!;
      if (!open.delete(name)) open.add(name);
      render();
      return;
    }
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
    doc.defaultView?.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).Event('betty-memory'));
  });
  doc.defaultView?.addEventListener('betty-memory', render);
  shell.onShow((id) => { if (id === 'explore') render(); else stopPlaying(); });
  render();
  return { render };
}
