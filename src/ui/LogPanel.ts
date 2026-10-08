import { LogEntry, formatLog, ridesInLog, stamp } from '../core/LineLog';
import { RideRecord } from '../core/RideMemory';
import { button, el } from './dom';

export interface LogContext {
  /** Every saved line, including the ride in progress */
  entries(): LogEntry[];
  rides(): RideRecord[];
  clear(): void;
}

/** LOG panel: read what Betty said on this and earlier rides, and get it off the phone (copy, share, save). */
export function mountLogPanel(root: HTMLElement, ctx: LogContext) {
  root.innerHTML = '';
  const wrap = el('details', 'panel');
  wrap.append(el('summary', '', 'LOG (saved on this device)'));
  const info = el('div', 'info');
  const pick = el('select');
  const view = el('pre', 'logview');
  const note = el('span', 'val');

  let entries: LogEntry[] = [];
  const chosen = () => (pick.value === '' ? undefined : Number(pick.value));
  const text = () => formatLog(entries, ctx.rides(), chosen());
  const show = () => { view.textContent = text(); };
  const refresh = () => {
    entries = ctx.entries();
    const listed = ridesInLog(entries, ctx.rides());
    const keep = pick.value;
    pick.innerHTML = '';
    const all = el('option', '', `All rides (${listed.length} rides, ${entries.length} lines)`); all.value = '';
    pick.append(all);
    for (const r of listed) {
      const o = el('option', '', `${stamp(r.rideId)} (${r.count ? `${r.count} lines` : 'summary only'})`); o.value = String(r.rideId);
      pick.append(o);
    }
    pick.value = [...pick.options].some((o) => o.value === keep) ? keep : '';
    const summaryOnly = listed.filter((r) => !r.count).length;
    info.textContent = `${listed.length} ride(s), ${entries.length} saved line(s)`
      + `${summaryOnly ? `, ${summaryOnly} with a summary only (from before lines were saved)` : ''}. Newest lines appear after Refresh.`;
    show();
  };
  const say = (msg: string) => { note.textContent = msg; };
  const fileName = () => `betty-log-${stamp(Date.now()).replace(/[: ]/g, '-')}.txt`;

  pick.onchange = show;
  const row = el('div', 'row');
  row.append(el('span', 'name', 'Show'), pick);
  const bar = el('div', 'bar');
  bar.append(
    button('Refresh', refresh),
    button('Copy', async () => {
      try { await navigator.clipboard.writeText(text()); say('Copied.'); } catch { say('Copy failed: select the text and copy it by hand.'); }
    }),
    button('Share', async () => {
      const file = new File([text()], fileName(), { type: 'text/plain' });
      try {
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Betty log' });
        else if (navigator.share) await navigator.share({ title: 'Betty log', text: text() });
        else say('Sharing is not available in this browser: use Copy or Save file.');
      } catch { /* share sheet dismissed */ }
    }),
    button('Save file', () => {
      try {
        const a = el('a');
        a.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
        a.download = fileName();
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        say('Saved to downloads.');
      } catch { say('Saving failed: use Copy instead.'); }
    }),
    button('Clear saved log', () => { ctx.clear(); refresh(); say('Log cleared.'); }),
  );
  wrap.append(info, row, bar, note, view);
  wrap.addEventListener('toggle', () => { if (wrap.open) refresh(); });
  root.append(wrap);
  refresh();
  return { refresh };
}
