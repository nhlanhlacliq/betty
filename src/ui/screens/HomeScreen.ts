import { HOME } from '../copy';
import { IconName, icon } from '../icons';
import type { Shell } from '../Shell';

/** One line of the readiness sheet ("GPS: phone sensors", "Voice: Gemini, Aoede"...). */
export interface ReadyRow { icon: IconName; label: string; value: string; ok: boolean }

export interface HomeContext {
  /** Betty says hello (tap on the orb). */
  hello(): void;
  readiness(): ReadyRow[];
  fuelText(): string;
}

export interface HomeScreen {
  /** While a ride runs the CTA goes back to it, and the ride mode cannot change. */
  setRiding(on: boolean): void;
}

/**
 * Home: the brand welcome, Betty's orb, the ride mode (real sensors or a desk test) and the start button.
 * The ride mode drives the hidden #real checkbox that main.ts reads when a ride starts.
 */
export function mountHomeScreen(doc: Document, shell: Shell, ctx: HomeContext): HomeScreen {
  const $ = (id: string) => doc.getElementById(id)!;
  $('homeeyebrow').textContent = HOME.eyebrow;
  const lines = HOME.headline.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
  $('homeheadline').innerHTML = `${lines.slice(0, -1).join('<br>')}<br><em>${lines[lines.length - 1]}</em>`;
  $('homelead').textContent = HOME.lead;
  $('orbcaption').textContent = HOME.orbCaption;

  const real = $('real') as HTMLInputElement;
  const tiles = [...doc.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  for (const t of tiles) {
    const copy = HOME.modes[t.dataset.mode as 'real' | 'sim'];
    t.querySelector('.tile-label')!.textContent = copy.title;
    t.querySelector('small')!.textContent = copy.sub;
    t.addEventListener('click', () => { if (!real.disabled) { real.checked = t.dataset.mode === 'real'; paintTiles(); } });
  }
  const paintTiles = () => {
    for (const t of tiles) {
      const on = (t.dataset.mode === 'real') === real.checked;
      t.classList.toggle('active', on);
      t.setAttribute('aria-checked', String(on));
      t.disabled = real.disabled && !on;
    }
    paintReady();
  };

  const paintReady = () => {
    const rows = ctx.readiness();
    const bad = rows.filter((r) => !r.ok);
    $('readytitle').textContent = bad.length ? 'Worth a look' : 'Ready to roll';
    $('readysub').textContent = bad.length ? `· ${bad[0].label.toLowerCase()}` : real.checked ? '· phone sensors' : '· desk test';
    $('readydot').classList.toggle('warn', bad.length > 0);
  };
  shell.onSheet((id) => {
    if (id !== 'ready') return;
    $('readyrows').innerHTML = ctx.readiness().map((r) =>
      `<div class="sheet-row"><b>${icon(r.icon, 'ico inline')}${esc(r.label)}</b><span class="${r.ok ? '' : 'bad'}">${esc(r.value)}</span></div>`).join('');
    $('readyfuel').textContent = ctx.fuelText();
  });
  shell.onShow((id) => { if (id === 'home') paintTiles(); });
  doc.defaultView?.addEventListener('betty-config', paintReady);
  $('helloorb').addEventListener('click', () => ctx.hello());

  paintTiles();
  return {
    setRiding(on) {
      $('starttext').textContent = on ? 'Back to the ride' : 'Start riding';
      paintTiles();
    },
  };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
