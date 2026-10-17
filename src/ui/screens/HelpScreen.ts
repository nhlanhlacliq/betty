import { matchesText } from '../../core/Explore';
import { HELP_TOPICS, VOICE_COMMANDS, helpHtml, searchHelp } from '../help';
import type { Shell } from '../Shell';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Help (a screen reached from Garage) and the Garage search box, which finds settings rows, help topics and voice
 * commands (owner, 2026-10-17: "a search bar on the garage to find things quicker"). Rows that do not match get
 * `.search-hide` (not `hidden`, which some rows use for their own state).
 */
export function mountHelpScreen(doc: Document, shell: Shell) {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T | null;
  const body = $('helpbody');
  if (body) body.innerHTML = helpHtml();

  /** Opens Help at a topic (from Garage, or a search result). */
  const openTopic = (id: string) => {
    shell.closeSheet();
    shell.show('help');
    const box = $<HTMLInputElement>('helpsearch');
    if (box && box.value) { box.value = ''; filterHelp(''); }
    const d = doc.getElementById(`help-${id}`) as HTMLDetailsElement | null;
    if (!d) return;
    d.open = true;
    d.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };

  const filterHelp = (q: string) => {
    const hits = new Set(searchHelp(q).map((t) => t.id));
    for (const t of HELP_TOPICS) {
      const d = doc.getElementById(`help-${t.id}`) as HTMLDetailsElement | null;
      if (!d) continue;
      d.classList.toggle('search-hide', !!q.trim() && !hits.has(t.id));
      if (q.trim()) d.open = hits.has(t.id);
    }
    const none = $('helpnone'); if (none) none.hidden = !q.trim() || hits.size > 0;
  };
  $<HTMLInputElement>('helpsearch')?.addEventListener('input', (e) => filterHelp((e.target as HTMLInputElement).value));

  // ---- Garage search
  const cards = () => [...doc.querySelectorAll<HTMLElement>('#garagecards > .settings-card')];
  const textOf = (el: Element) => `${el.textContent ?? ''} ${[...el.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')).join(' ')}`;
  const found = $('garagefound');
  const searchGarage = (q: string) => {
    const on = !!q.trim();
    let shown = 0;
    for (const card of cards()) {
      const title = card.querySelector('h2')?.textContent ?? '';
      const whole = on && matchesText(q, title);
      let any = !on || whole;
      for (const row of [...card.children].filter((c) => c.tagName !== 'H2') as HTMLElement[]) {
        const hit = !on || whole || matchesText(q, textOf(row));
        row.classList.toggle('search-hide', !hit);
        any ||= hit;
      }
      card.classList.toggle('search-hide', !any);
      if (any && on) shown++;
    }
    if (!found) return;
    const topics = on ? searchHelp(q).slice(0, 4) : [];
    const commands = on ? VOICE_COMMANDS.flatMap((g) => g.items).filter((c) => matchesText(q, c.say.join(' '), c.does)).slice(0, 3) : [];
    found.hidden = !on;
    if (!on) return;
    found.innerHTML = [
      ...commands.map((c) => `<button class="found-row" type="button" data-help="commands"><span class="eyebrow">Say</span><b>"${esc(c.say[0])}"</b><small>${esc(c.does)}</small></button>`),
      ...topics.map((t) => `<button class="found-row" type="button" data-help="${t.id}"><span class="eyebrow">Help</span><b>${esc(t.title)}</b></button>`),
      !shown && !topics.length && !commands.length ? '<p class="sub">Nothing matches that. Try another word, or open Help.</p>' : '',
    ].join('');
  };
  $<HTMLInputElement>('garagesearch')?.addEventListener('input', (e) => searchGarage((e.target as HTMLInputElement).value));

  doc.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('[data-help]') as HTMLElement | null;
    if (b?.dataset.help) openTopic(b.dataset.help);
  });
  return { openTopic, searchGarage, filterHelp };
}
