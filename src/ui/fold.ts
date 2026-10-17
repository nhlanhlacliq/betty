import { icon } from './icons';

/**
 * A list that shows its first `keep` items and a quiet "Show all N" button under it (owner, 2026-10-17: long lists).
 * Items past `keep` are hidden by CSS (`.folded .more`), so opening needs no re-render. Pass `<li>` strings.
 * `cls` is the list's class (`moments` on a ride's page, `stories` in Explore).
 */
export function foldList(items: string[], keep: number, what: string, cls = 'moments', opened = false): string {
  if (items.length <= keep + 1) return `<ul class="${cls}">${items.join('')}</ul>`;
  const lis = items.map((li, i) => (i < keep ? li : li.replace(/^<li( class="([^"]*)")?/, (_m, _c, c) => `<li class="${c ? `${c} ` : ''}more"`))).join('');
  return `<ul class="${cls}${opened ? '' : ' folded'}">${lis}</ul><button class="text-button fold-toggle" type="button" data-fold aria-expanded="${opened}" data-all="Show all ${items.length} ${what}">`
    + `<span>${opened ? 'Show less' : `Show all ${items.length} ${what}`}</span>${icon('chev', 'ico sm')}</button>`;
}

/** Handles a tap on a fold button inside `root` (call from the root's click listener). True if it was one. */
export function toggleFold(target: Element): boolean {
  const f = target.closest<HTMLButtonElement>('[data-fold]');
  if (!f) return false;
  const list = f.previousElementSibling as HTMLElement;
  const open = list.classList.toggle('folded') === false;
  f.setAttribute('aria-expanded', String(open));
  f.querySelector('span')!.textContent = open ? 'Show less' : f.dataset.all!;
  if (!open) list.scrollIntoView?.({ block: 'nearest' }); // folding a long list: don't leave him far below it
  return true;
}
