import type { RiderMemory } from '../../core/Commands';
import { icon } from '../icons';
import type { Shell } from '../Shell';

export interface ExploreContext { load(): RiderMemory; save(m: RiderMemory): void }

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const when = (at: number) => new Date(at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Explore: the spots he marked ("mark this spot") and notes he asked her to keep ("remember that..."), newest first,
 * each with a map link or Forget. Same store as the Workshop's MEMORY panel; both refresh on `betty-memory`.
 */
export function mountExploreScreen(doc: Document, shell: Shell, ctx: ExploreContext) {
  const list = doc.getElementById('explorelist')!;
  const render = () => {
    const m = ctx.load();
    const rows = [
      ...m.marks.map((k, i) => ({ at: k.at, html: `<div class="moment-item"><span class="moment-symbol">${icon('pin')}</span>
        <span class="grow"><b>${esc(k.note || 'Marked spot')}</b><small>${esc(when(k.at))}${k.near ? ` · near ${esc(k.near)}` : ''}</small>
        <a href="https://maps.google.com/?q=${k.lat},${k.lon}" target="_blank" rel="noopener">Open map</a></span>
        <button class="text-button" type="button" data-forget="mark:${i}">Forget</button></div>` })),
      ...m.notes.map((n, i) => ({ at: n.at, html: `<div class="moment-item"><span class="moment-symbol">${icon('book')}</span>
        <span class="grow"><b>${esc(n.text)}</b><small>${esc(when(n.at))}</small></span>
        <button class="text-button" type="button" data-forget="note:${i}">Forget</button></div>` })),
    ].sort((a, b) => b.at - a.at);
    list.innerHTML = rows.length ? `<div class="eyebrow muted">Kept for later</div>${rows.map((r) => r.html).join('')}` : '<div class="empty-note">Nothing kept yet.</div>';
  };
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
