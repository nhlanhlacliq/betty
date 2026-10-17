import { BIKES, Reminder, ServiceBook, alignToOdometer, dueList, dueText, markDone } from '../core/Reminders';
import type { Shell } from './Shell';

export interface RemindersContext {
  load(): ServiceBook;
  save(b: ServiceBook): void;
  now?: () => number;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const num = (v: string) => { const n = Number(v.replace(/[\s,]/g, '').replace(/km$/i, '')); return v.trim() && Number.isFinite(n) && n >= 0 ? n : null; };
/** "every 600 km", "every 2 weeks", "every 10,000 km or year" */
function interval(r: Reminder): string {
  const t = r.everyDays == null ? null
    : r.everyDays % 365 === 0 ? (r.everyDays === 365 ? 'year' : `${r.everyDays / 365} years`)
    : r.everyDays % 30 === 0 ? (r.everyDays === 30 ? 'month' : `${r.everyDays / 30} months`)
    : r.everyDays % 7 === 0 ? (r.everyDays === 7 ? 'week' : `${r.everyDays / 7} weeks`)
    : `${r.everyDays} days`;
  const km = r.everyKm != null ? `${r.everyKm.toLocaleString('en-US')} km` : null;
  return `Every ${[km, km && t && !/\d/.test(t) ? `a ${t}` : t].filter(Boolean).join(' or ')}`;
}
/** The best unit for showing a number of days in the sheet. */
const unitFor = (days: number) => (days % 365 === 0 ? 365 : days % 30 === 0 ? 30 : days % 7 === 0 ? 7 : 1);

/**
 * Garage > Reminders: the odometer, each reminder with how long until it is due (Done resets it), and a sheet to add
 * or edit one. Repaints on `betty-service` (a ride adding km, "chain done" by voice).
 */
export function mountReminders(doc: Document, shell: Shell, ctx: RemindersContext) {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const now = ctx.now ?? Date.now;
  const list = $('reminderlist');
  const odo = $<HTMLInputElement>('odometer');
  let editing: string | null = null;
  let showAll = false;
  /** Rows shown before "Show all": everything due or close, then the next few. */
  const KEEP = 5;

  const paint = () => {
    const book = ctx.load();
    if (doc.activeElement !== odo) odo.value = String(Math.round(book.odoKm));
    const rows = dueList(book, now());
    const keep = Math.max(KEEP, rows.filter((d) => d.state !== 'ok').length);
    const shown = showAll ? rows : rows.slice(0, keep);
    const bike = BIKES.find((b) => b.id === book.bike);
    const guessed = book.items.some((r) => r.assumed);
    list.innerHTML = (bike ? `<p class="sub reminder-bike">${esc(bike.name)} schedule from the handbook${book.odoKm ? '' : '. Set the odometer first so it lines up'}${guessed ? '. "Last done" is a guess until you set it or tap Done.' : '.'}</p>` : '')
      + (rows.length ? shown.map((d) => `<div class="reminder-row ${d.state}" data-reminder="${esc(d.r.id)}">
        <button class="reminder-main" type="button" data-edit="${esc(d.r.id)}"><b>${esc(d.r.name)}</b><small>${esc(interval(d.r))}${d.r.assumed ? ' · last done: a guess' : ''}</small></button>
        <span class="reminder-state">${esc(d.state === 'ok' ? dueText(d) : `${d.state === 'due' ? 'Due' : 'Soon'}: ${dueText(d)}`)}</span>
        <button class="secondary small" type="button" data-done="${esc(d.r.id)}">Done</button></div>`).join('')
        + (rows.length > keep ? `<button class="text-button fold-toggle" type="button" data-showall>${showAll ? 'Show less' : `Show all ${rows.length}`}</button>` : '')
      : '<p class="sub">No reminders. Add one below.</p>');
  };

  const open = (r: Reminder | null) => {
    editing = r?.id ?? null;
    $('remindertitle').textContent = r ? 'Edit reminder' : 'New reminder';
    $('remindernote').textContent = r?.note ?? '';
    $<HTMLInputElement>('remindername').value = r?.name ?? '';
    $<HTMLInputElement>('reminderkm').value = r?.everyKm != null ? String(r.everyKm) : '';
    const unit = r?.everyDays != null ? unitFor(r.everyDays) : 30;
    $<HTMLInputElement>('remindertime').value = r?.everyDays != null ? String(r.everyDays / unit) : '';
    $<HTMLSelectElement>('reminderunit').value = String(unit);
    const book = ctx.load();
    $<HTMLInputElement>('reminderago').value = String(r ? Math.max(0, Math.round(book.odoKm - r.lastKm)) : 0);
    const d = new Date(r?.lastAt ?? now());
    $<HTMLInputElement>('reminderdate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('reminderdelete').hidden = !r;
    shell.openSheet('reminder');
  };

  list.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-showall]')) { showAll = !showAll; paint(); return; }
    const done = t.closest('[data-done]') as HTMLElement | null;
    if (done) { ctx.save(markDone(ctx.load(), done.dataset.done!, now())); paint(); return; }
    const ed = t.closest('[data-edit]') as HTMLElement | null;
    if (ed) open(ctx.load().items.find((r) => r.id === ed.dataset.edit) ?? null);
  });
  $('reminderadd').addEventListener('click', () => open(null));
  $('reminderdelete').addEventListener('click', () => {
    if (!editing) return;
    const book = ctx.load();
    ctx.save({ ...book, items: book.items.filter((r) => r.id !== editing) });
    shell.closeSheet(); paint();
  });
  $<HTMLFormElement>('reminderform').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>('remindername').value.trim();
    const everyKm = num($<HTMLInputElement>('reminderkm').value);
    const time = num($<HTMLInputElement>('remindertime').value);
    const everyDays = time ? Math.round(time * Number($<HTMLSelectElement>('reminderunit').value)) : null;
    if (!name || (!everyKm && !everyDays)) { $('remindertitle').textContent = 'Give it a name and a distance or a time'; return; }
    const book = ctx.load();
    const ago = num($<HTMLInputElement>('reminderago').value) ?? 0;
    const date = $<HTMLInputElement>('reminderdate').value;
    const lastAt = date ? new Date(`${date}T12:00:00`).getTime() : now();
    const was = book.items.find((x) => x.id === editing);
    const r: Reminder = { ...(was ?? {}), id: editing ?? `r${now().toString(36)}`, name, everyKm: everyKm || null, everyDays, lastKm: Math.round(book.odoKm - ago), lastAt: Number.isFinite(lastAt) ? Math.min(lastAt, now()) : now(), assumed: false };
    ctx.save({ ...book, items: editing ? book.items.map((x) => (x.id === editing ? r : x)) : [...book.items, r] });
    shell.closeSheet(); paint();
  });
  odo.addEventListener('change', () => {
    const v = num(odo.value);
    if (v != null && v < 1_000_000) {
      // Setting the odometer: your own reminders keep their km since; schedule items still on a guess line up with
      // the handbook's milestones below the new reading (core/Reminders alignToOdometer).
      ctx.save(alignToOdometer(ctx.load(), v));
    }
    paint();
  });

  doc.defaultView?.addEventListener('betty-service', paint);
  shell.onShow((id) => { if (id === 'settings') paint(); });
  paint();
  return { paint, open };
}

/** For the home screen's readiness sheet: the most pressing reminder, or that nothing is due. */
export function readinessRow(book: ServiceBook, now: number): { value: string; ok: boolean } {
  const top = dueList(book, now)[0];
  if (!top || top.state === 'ok') return { value: top ? `Nothing due · next: ${top.r.name} ${dueText(top)}` : 'No reminders', ok: true };
  return { value: `${top.r.name}: ${dueText(top)}`, ok: top.state !== 'due' };
}
