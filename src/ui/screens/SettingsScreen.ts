import { CONFIG, TALK_PRESETS, TalkPreset, applyTalkPreset, currentTalkPreset } from '../../config/betty';
import { saveConfig } from '../../config/persist';
import { TALK_LABELS } from '../copy';
import type { Shell } from '../Shell';

export interface SettingsContext { sample(): void; fuelText(): string }

const CUSTOM = 'custom';
/** Garage > The island: one switch per behaviour (CONFIG.island). */
const ISLAND: Array<[string, keyof typeof CONFIG.island]> = [
  ['islandcompact', 'compact'], ['islandtap', 'tapExpand'], ['islandbrowse', 'browse'], ['islandactions', 'actions'], ['islandprogress', 'progress'],
];

/**
 * Garage & settings: the personality dials (narration, humour, JARVIS/TARS blend), the visual companion switch and
 * a voice sample. The name, voice, fuel and ride-setup controls are static markup bound by main.ts.
 * Voice commands and TUNING change the same CONFIG; this follows them through the `betty-config` event.
 */
export function mountSettingsScreen(doc: Document, shell: Shell, ctx: SettingsContext) {
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const humour = $<HTMLInputElement>('humour');
  const blend = $<HTMLInputElement>('blend');
  const preset = $<HTMLSelectElement>('talkpreset');
  const glance = $<HTMLInputElement>('glanceswitch');
  const changed = () => { saveConfig(); doc.defaultView?.dispatchEvent(new (doc.defaultView as Window & typeof globalThis).Event('betty-config')); };

  preset.innerHTML = (Object.keys(TALK_PRESETS) as TalkPreset[]).map((k) => `<option value="${k}">${TALK_LABELS[k]}</option>`).join('')
    + `<option value="${CUSTOM}" disabled>Custom (TUNING)</option>`;

  const paint = () => {
    humour.value = String(CONFIG.persona.humour);
    $('humourval').textContent = `${CONFIG.persona.humour}%`;
    blend.value = String(CONFIG.persona.tars);
    $('blendval').textContent = `${CONFIG.persona.tars}% TARS`;
    const p = currentTalkPreset();
    preset.value = p ?? CUSTOM;
    $('talkhint').textContent = p ? 'How much company feels right?' : 'A custom mix, set in the Workshop (TUNING).';
    glance.checked = CONFIG.showGlance;
    $<HTMLInputElement>('mapborders').checked = CONFIG.mapBorders;
    $<HTMLInputElement>('cardplaces').checked = CONFIG.cardPlaces;
    $<HTMLInputElement>('cardmetro').checked = CONFIG.cardMetro;
    for (const [id, key] of ISLAND) { const b = $<HTMLInputElement>(id); b.checked = CONFIG.island[key]; b.disabled = !CONFIG.showGlance; }
    $('garagefuel').textContent = ctx.fuelText();
  };

  humour.addEventListener('input', () => { $('humourval').textContent = `${humour.value}%`; });
  humour.addEventListener('change', () => { CONFIG.persona.humour = Number(humour.value); changed(); });
  blend.addEventListener('input', () => { $('blendval').textContent = `${blend.value}% TARS`; });
  blend.addEventListener('change', () => { CONFIG.persona.tars = Number(blend.value); changed(); });
  preset.addEventListener('change', () => { if (preset.value !== CUSTOM) { applyTalkPreset(preset.value as TalkPreset); changed(); } });
  glance.addEventListener('change', () => { CONFIG.showGlance = glance.checked; changed(); });
  $<HTMLInputElement>('mapborders').addEventListener('change', (e) => { CONFIG.mapBorders = (e.target as HTMLInputElement).checked; changed(); });
  $<HTMLInputElement>('cardplaces').addEventListener('change', (e) => { CONFIG.cardPlaces = (e.target as HTMLInputElement).checked; changed(); });
  $<HTMLInputElement>('cardmetro').addEventListener('change', (e) => { CONFIG.cardMetro = (e.target as HTMLInputElement).checked; changed(); });
  for (const [id, key] of ISLAND) $<HTMLInputElement>(id).addEventListener('change', (e) => { CONFIG.island[key] = (e.target as HTMLInputElement).checked; changed(); });
  $('sample').addEventListener('click', () => ctx.sample());

  doc.defaultView?.addEventListener('betty-config', paint);
  shell.onShow((id) => { if (id === 'settings') paint(); });
  paint();
  return { paint };
}
