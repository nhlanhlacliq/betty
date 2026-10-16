import { CHANGELOG } from '../changelog';
import { el } from './dom';

/** When this copy of the app was built (set by Vite), so he can tell whether a reload picked up the new version. */
declare const __BUILD_TIME__: string | undefined;
export const buildTime = (): string | null => (typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : null);

/** WHAT'S NEW panel: the changelog, newest first, with the version this page is running. */
export function mountChangelogPanel(root: HTMLElement, log = CHANGELOG, built = buildTime()) {
  root.innerHTML = '';
  const wrap = el('details', 'panel');
  const stamp = built ? new Date(built).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'dev build';
  wrap.append(el('summary', '', `WHAT'S NEW (this version: ${stamp})`));
  wrap.append(el('p', 'hint', 'If the newest entry here is missing after an update, pull down to reload the page.'));
  for (const day of log) {
    wrap.append(el('h3', '', day.date));
    const ul = el('ul', 'changes');
    for (const item of day.items) ul.append(el('li', '', item));
    wrap.append(ul);
  }
  root.append(wrap);
}
