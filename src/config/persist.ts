import { CONFIG, applyConfig, resetConfig } from './betty';

const KEY = 'betty.config.v1';

/** Only user-tunable fields are persisted, so new defaults (model id, feeds) are never shadowed by old saves. */
const pick = () => ({
  safeWindow: CONFIG.safeWindow, thresholds: CONFIG.thresholds, priorities: CONFIG.priorities,
  cooldownsMs: CONFIG.cooldownsMs, ambientCooldownMs: CONFIG.ambientCooldownMs,
  ambientMaxAgeMs: CONFIG.ambientMaxAgeMs, milestoneEveryMin: CONFIG.milestoneEveryMin,
});

export function loadConfig() {
  try { const raw = localStorage.getItem(KEY); if (raw) applyConfig(JSON.parse(raw)); } catch { /* ignore */ }
}
export function saveConfig() {
  try { localStorage.setItem(KEY, JSON.stringify(pick())); } catch { /* ignore */ }
}
export function resetAndSave() { resetConfig(); saveConfig(); }
