import { RiderMemory } from '../core/Commands';
import { button, el } from './dom';

export interface MemoryContext {
  load(): RiderMemory;
  save(m: RiderMemory): void;
}

const when = (at: number) => new Date(at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * MEMORY panel: what he told Betty to remember ("remember that...") and the spots he marked ("mark this spot"),
 * newest first, each with a map link or a Forget button. Refreshes on the `betty-memory` window event.
 */
export function mountMemoryPanel(root: HTMLElement, ctx: MemoryContext) {
  root.innerHTML = '';
  const wrap = el('details', 'panel');
  const summary = el('summary', '');
  const list = el('div', 'memlist');
  wrap.append(summary, el('p', 'hint', 'Say "remember that..." or "mark this spot" to Betty. She uses these when you ask her later, on any ride.'), list);

  const render = () => {
    const m = ctx.load();
    summary.textContent = `MEMORY (${m.notes.length} notes, ${m.marks.length} spots)`;
    list.innerHTML = '';
    const rows: Array<{ at: number; node: HTMLElement }> = [];
    m.notes.forEach((n, i) => {
      const row = el('div', 'memrow');
      row.append(el('div', 'meta', `Note · ${when(n.at)}`), el('div', '', n.text),
        button('Forget', () => { ctx.save({ ...m, notes: m.notes.filter((_, j) => j !== i) }); render(); }, 'ghost small'));
      rows.push({ at: n.at, node: row });
    });
    m.marks.forEach((k, i) => {
      const row = el('div', 'memrow');
      const map = el('a', '', 'Open map'); map.href = `https://maps.google.com/?q=${k.lat},${k.lon}`; map.target = '_blank'; map.rel = 'noopener';
      row.append(el('div', 'meta', `Spot · ${when(k.at)}${k.near ? ` · near ${k.near}` : ''}`), el('div', '', k.note || '(no note)'), map,
        button('Forget', () => { ctx.save({ ...m, marks: m.marks.filter((_, j) => j !== i) }); render(); }, 'ghost small'));
      rows.push({ at: k.at, node: row });
    });
    rows.sort((a, b) => b.at - a.at).forEach((r) => list.append(r.node));
    if (!rows.length) list.append(el('div', 'hint', 'Nothing yet.'));
  };
  render();
  window.addEventListener('betty-memory', render);
  root.append(wrap);
  return { render };
}
