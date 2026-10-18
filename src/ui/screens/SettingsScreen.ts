import { CONFIG, TALK_PRESETS, TalkPreset, applyTalkPreset, currentTalkPreset, mixSummary } from '../../config/betty';
import { saveConfig } from '../../config/persist';
import { TALK_LABELS } from '../copy';
import type { Shell } from '../Shell';

export interface SettingsContext { sample(): void; fuelText(): string }

const CUSTOM = 'custom';
const boostText = (db: number) => (db > 0 ? `+${db} dB` : 'Off');
/** Garage > Horizon (was "the island"; owner renamed it 2026-10-18): one switch per behaviour (CONFIG.island). */
const ISLAND: Array<[string, keyof typeof CONFIG.island]> = [
  ['islandcompact', 'compact'], ['islandtap', 'tapExpand'], ['islandbrowse', 'browse'], ['islandactions', 'actions'], ['islandprogress', 'progress'], ['islandlock', 'lockLine'],
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
    // What the setting actually does (owner, 2026-10-18: "does that have any effect?"): how often she talks, and what.
    $('talkhint').textContent = `${p ? '' : 'A custom mix (by voice or in the Workshop). '}${mixSummary()} Alerts and answers are not affected.`;
    glance.checked = CONFIG.showGlance;
    $<HTMLInputElement>('mapborders').checked = CONFIG.mapBorders;
    $<HTMLInputElement>('cardplaces').checked = CONFIG.cardPlaces;
    $<HTMLSelectElement>('listenvoice').value = CONFIG.listenVoice;
    $<HTMLInputElement>('cardmetro').checked = CONFIG.cardMetro;
    $<HTMLInputElement>('voiceboost').value = String(CONFIG.voiceBoostDb);
    $('voiceboostval').textContent = boostText(CONFIG.voiceBoostDb);
    $<HTMLInputElement>('ridingonly').checked = CONFIG.ridingTimeOnly;
    $<HTMLInputElement>('journeythumbs').checked = CONFIG.journeyThumbs;
    const f = CONFIG.fuel;
    for (const [id, v] of [['tankl', f.tankL], ['reservel', f.reserveL], ['lper100', f.lPer100], ['fuelprice', f.pricePerL]] as const) {
      const box = $<HTMLInputElement>(id); if (doc.activeElement !== box) box.value = String(v);
    }
    const when = new Date(f.priceAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
    $('pricesub').textContent = f.priceSource === 'auto' ? `Rand a litre. Looked up ${when}; checked each month.` : `Rand a litre. Yours, set ${when}; looked up again after the next monthly change.`;
    for (const [id, key] of ISLAND) { const b = $<HTMLInputElement>(id); b.checked = CONFIG.island[key]; b.disabled = !CONFIG.showGlance && key !== 'lockLine'; } // the lock line works with the card hidden
    $('garagefuel').textContent = ctx.fuelText();
  };

  humour.addEventListener('input', () => { $('humourval').textContent = `${humour.value}%`; });
  humour.addEventListener('change', () => { CONFIG.persona.humour = Number(humour.value); changed(); });
  blend.addEventListener('input', () => { $('blendval').textContent = `${blend.value}% TARS`; });
  blend.addEventListener('change', () => { CONFIG.persona.tars = Number(blend.value); changed(); });
  preset.addEventListener('change', () => { if (preset.value !== CUSTOM) { applyTalkPreset(preset.value as TalkPreset); changed(); } });
  glance.addEventListener('change', () => { CONFIG.showGlance = glance.checked; changed(); });
  $<HTMLInputElement>('mapborders').addEventListener('change', (e) => { CONFIG.mapBorders = (e.target as HTMLInputElement).checked; changed(); });
  $<HTMLSelectElement>('listenvoice').addEventListener('change', (e) => { CONFIG.listenVoice = (e.target as HTMLSelectElement).value as typeof CONFIG.listenVoice; changed(); });
  $<HTMLInputElement>('cardplaces').addEventListener('change', (e) => { CONFIG.cardPlaces = (e.target as HTMLInputElement).checked; changed(); });
  $<HTMLInputElement>('cardmetro').addEventListener('change', (e) => { CONFIG.cardMetro = (e.target as HTMLInputElement).checked; changed(); });
  const boost = $<HTMLInputElement>('voiceboost');
  boost.addEventListener('input', () => { $('voiceboostval').textContent = boostText(Number(boost.value)); });
  boost.addEventListener('change', () => { CONFIG.voiceBoostDb = Number(boost.value); changed(); });
  // Fuel: a figure he types is kept if it makes sense; the price he types wins until the next monthly change.
  const num = (id: string, min: number, max: number, set: (v: number) => void) => $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value.replace(',', '.'));
    if (Number.isFinite(v) && v >= min && v <= max) { set(Math.round(v * 100) / 100); changed(); } else paint();
  });
  num('tankl', 3, 40, (v) => { CONFIG.fuel.tankL = v; CONFIG.fuel.reserveL = Math.min(CONFIG.fuel.reserveL, v); });
  num('reservel', 0, 10, (v) => { CONFIG.fuel.reserveL = Math.min(v, CONFIG.fuel.tankL); });
  num('lper100', 2, 15, (v) => { CONFIG.fuel.lPer100 = v; });
  num('fuelprice', 5, 100, (v) => { CONFIG.fuel.pricePerL = v; CONFIG.fuel.priceSource = 'manual'; CONFIG.fuel.priceAt = Date.now(); });
  $<HTMLInputElement>('journeythumbs').addEventListener('change', (e) => { CONFIG.journeyThumbs = (e.target as HTMLInputElement).checked; changed(); });
  $<HTMLInputElement>('ridingonly').addEventListener('change', (e) => { CONFIG.ridingTimeOnly = (e.target as HTMLInputElement).checked; changed(); });
  for (const [id, key] of ISLAND) $<HTMLInputElement>(id).addEventListener('change', (e) => { CONFIG.island[key] = (e.target as HTMLInputElement).checked; changed(); });
  $('sample').addEventListener('click', () => ctx.sample());

  doc.defaultView?.addEventListener('betty-config', paint);
  shell.onShow((id) => { if (id === 'settings') paint(); });
  paint();
  return { paint };
}
