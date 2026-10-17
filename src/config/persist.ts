import { CONFIG, applyConfig, resetConfig } from './betty';

const KEY = 'betty.config.v1';

/** Only user-tunable fields are persisted, so new defaults (model id, feeds) are never shadowed by old saves. */
const pick = () => ({
  safeWindow: CONFIG.safeWindow, thresholds: CONFIG.thresholds, priorities: CONFIG.priorities,
  cooldownsMs: CONFIG.cooldownsMs, ambientCooldownMs: CONFIG.ambientCooldownMs,
  ambientMaxAgeMs: CONFIG.ambientMaxAgeMs, milestoneEveryMin: CONFIG.milestoneEveryMin,
  ambient: CONFIG.ambient, maxSpokenSentences: CONFIG.maxSpokenSentences, persona: CONFIG.persona, fuel: CONFIG.fuel, obdMode: CONFIG.obdMode, riderName: CONFIG.riderName, bikeName: CONFIG.bikeName, voiceURI: CONFIG.voiceURI, headsetButtons: CONFIG.headsetButtons, showGlance: CONFIG.showGlance, useProfile: CONFIG.useProfile, island: CONFIG.island, micDeviceId: CONFIG.micDeviceId, micLabel: CONFIG.micLabel, micRaw: CONFIG.micRaw, cloudVoice: CONFIG.cloudVoice, cloudVoiceName: CONFIG.cloudVoiceName, geminiModel: CONFIG.geminiModel, chirpLocale: CONFIG.chirpLocale, chirpStandIn: CONFIG.chirpStandIn,
});

export function loadConfig() {
  try { const raw = localStorage.getItem(KEY); if (raw) applyConfig(JSON.parse(raw)); } catch { /* ignore */ }
}
export function saveConfig() {
  try { localStorage.setItem(KEY, JSON.stringify(pick())); } catch { /* ignore */ }
}
export function resetAndSave() { resetConfig(); saveConfig(); }
