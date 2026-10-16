import type { RiderMemory } from '../../core/Commands';
import type { AreaNote } from '../../core/types';
import type { Shell } from '../Shell';

export interface ExploreContext {
  load(): RiderMemory;
  save(m: RiderMemory): void;
  /** Area stories she has researched, by area name */
  stories(): Record<string, AreaNote[]>;
  /** Ids of the stories she has already told */
  told(): Set<string>;
}

type Tab = 'all' | 'spots' | 'notes' | 'stories';
const TABS: Array<[Tab, string]> = [['all', 'Everything'], ['spots', 'Marked spots'], ['notes', 'Notes'], ['stories', 'Area stories']];

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const when = (at: number) => new Date(at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Explore: the spots he marked ("mark this spot"), notes he asked her to keep ("remember that..."), and the area
 * stories she has researched (told or still to tell). Same stores as the Workshop's MEMORY panel and the area feed;
 * refreshes on `betty-memory`.
 */
export function mountExploreScreen(doc: Document, shell: Shell, ctx: ExploreContext) {
  const list = doc.getElementById('explorelist')!;
  const tabs = doc.getElementById('exploretabs')!;
  let tab: Tab = 'all';
  tabs.innerHTML = TABS.map(([k, label]) => `<button type="button" data-tab="${k}">${label}</button>`).join('');

  const render = () => {
    tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const m = ctx.load();
    const cards: Array<{ at: number; html: string }> = [];
    if (tab === 'all' || tab === 'spots') m.marks.forEach((k, i) => cards.push({ at: k.at, html: `<div class="keep-card"><p class="eyebrow">Marked spot · ${esc(when(k.at))}</p>
      <h3>${esc(k.note || 'A spot worth remembering')}</h3><p>${k.near ? `Near ${esc(k.near)}` : 'Marked on a ride'}</p>
      <a class="forget" href="https://maps.google.com/?q=${k.lat},${k.lon}" target="_blank" rel="noopener">Open map</a><button class="forget" type="button" data-forget="mark:${i}">Forget</button></div>` }));
    if (tab === 'all' || tab === 'notes') m.notes.forEach((n, i) => cards.push({ at: n.at, html: `<div class="keep-card"><p class="eyebrow">Note · ${esc(when(n.at))}</p>
      <h3>${esc(n.text)}</h3><button class="forget" type="button" data-forget="note:${i}">Forget</button></div>` }));
    cards.sort((a, b) => b.at - a.at);
    if (tab === 'all' || tab === 'stories') {
      const told = ctx.told();
      for (const [area, notes] of Object.entries(ctx.stories())) for (const n of notes) {
        cards.push({ at: 0, html: `<div class="keep-card"><p class="eyebrow">${esc(area)} · ${told.has(n.id) ? 'told' : 'still to tell'}</p><h3>${esc(n.topic)}</h3><p>${esc(n.text)}</p></div>` });
      }
    }
    list.innerHTML = cards.length ? `<div class="keep-grid">${cards.map((c) => c.html).join('')}</div>` : '<div class="empty"><p>Nothing here yet.</p></div>';
  };
  tabs.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-tab]');
    if (b) { tab = b.dataset.tab as Tab; render(); }
  });
  list.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-forget]');
    if (!b) return;
    const [kind, idx] = b.dataset.forget!.split(':');
    const m = ctx.load(); const i = Number(idx);
    ctx.save(kind === 'mark' ? { ...m, marks: m.marks.filter((_, j) => j !== i) } : { ...m, notes: m.notes.filter((_, j) => j !== i) });
    doc.defaultView?.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).Event('betty-memory'));
  });
  doc.defaultView?.addEventListener('betty-memory', render);
  shell.onShow((id) => { if (id === 'explore') render(); });
  render();
  return { render };
}
