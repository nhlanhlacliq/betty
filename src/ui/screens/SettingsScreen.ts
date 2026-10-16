import { CONFIG, TALK_PRESETS, TalkPreset, applyTalkPreset, currentTalkPreset } from '../../config/betty';
import { saveConfig } from '../../config/persist';
import { SETTINGS_TALK } from '../copy';
import type { Shell } from '../Shell';

export interface SettingsContext { sample(): void }

/**
 * Settings: the personality dials (humour, JARVIS/TARS blend, how often she talks), the visual companion switch and
 * a voice sample. The name, voice and ride-setup fields further down are static markup bound by main.ts.
 * Voice commands and TUNING change the same CONFIG; this follows them through the `betty-config` event.
 */
export function mountSettingsScreen(doc: Document, shell: Shell, ctx: SettingsContext) {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const humour = $<HTMLInputElement>('humour');
  const blend = $<HTMLInputElement>('blend');
  const seg = $('talkseg');
  const glance = $<HTMLButtonElement>('glanceswitch');
  const changed = () => { saveConfig(); doc.defaultView?.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).Event('betty-config')); };

  seg.innerHTML = (Object.keys(TALK_PRESETS) as TalkPreset[])
    .map((k) => `<button type="button" data-talk="${k}">${SETTINGS_TALK[k]}</button>`).join('');

  const paint = () => {
    humour.value = String(CONFIG.persona.humour);
    $('humourval').textContent = `${CONFIG.persona.humour}%`;
    blend.value = String(CONFIG.persona.tars);
    $('blendval').textContent = `${CONFIG.persona.tars}% TARS`;
    const preset = currentTalkPreset();
    seg.querySelectorAll<HTMLButtonElement>('[data-talk]').forEach((b) => {
      const on = b.dataset.talk === preset;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('talkhint').textContent = preset ? "Only when there's something worth saying." : 'Custom mix, set in the Workshop (TUNING).';
    glance.classList.toggle('on', CONFIG.showGlance);
    glance.setAttribute('aria-checked', String(CONFIG.showGlance));
  };

  humour.addEventListener('input', () => { $('humourval').textContent = `${humour.value}%`; });
  humour.addEventListener('change', () => { CONFIG.persona.humour = Number(humour.value); changed(); });
  blend.addEventListener('input', () => { $('blendval').textContent = `${blend.value}% TARS`; });
  blend.addEventListener('change', () => { CONFIG.persona.tars = Number(blend.value); changed(); });
  seg.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-talk]');
    if (b) { applyTalkPreset(b.dataset.talk as TalkPreset); changed(); }
  });
  glance.addEventListener('click', () => { CONFIG.showGlance = !CONFIG.showGlance; changed(); });
  $('sample').addEventListener('click', () => ctx.sample());

  doc.defaultView?.addEventListener('betty-config', paint);
  shell.onShow((id) => { if (id === 'settings') paint(); });
  paint();
}
