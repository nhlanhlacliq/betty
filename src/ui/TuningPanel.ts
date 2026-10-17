import { CONFIG } from '../config/betty';
import { resetAndSave, saveConfig } from '../config/persist';
import { RideLog } from '../adapters/RideLog';
import { Priority, TRIGGER_IDS } from '../core/types';
import { button, checkbox, el } from './dom';

function numRow(label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, unit: string) {
  const row = el('div', 'row');
  const input = el('input'); input.type = 'number';
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(get());
  input.onchange = () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) set(Math.min(max, Math.max(min, v)));
    input.value = String(get());
    saveConfig();
  };
  row.append(el('span', 'name', label), input, el('span', 'val', unit));
  window.addEventListener('betty-config', () => { input.value = String(get()); }); // changed by voice or reset
  return row;
}

const PRIORITY_LABELS: Record<Priority, string> = { 1: 'P1 critical', 2: 'P2 advisory', 3: 'P3 ambient', 4: 'P4 rider' };

export function mountTuningPanel(root: HTMLElement) {
  root.innerHTML = '';
  const wrap = el('details', 'panel');
  wrap.append(el('summary', '', 'TUNING (saved on this device)'));

  wrap.append(el('h3', '', 'Per-trigger priority and cooldown'));
  wrap.append(el('p', 'hint', 'For each line: its priority, and the seconds before it may be said again.'));
  for (const id of TRIGGER_IDS) {
    const row = el('div', 'row trig');
    const sel = el('select');
    ([1, 2, 3, 4] as Priority[]).forEach((p) => {
      const o = el('option', '', PRIORITY_LABELS[p]); o.value = String(p); sel.append(o);
    });
    sel.value = String(CONFIG.priorities[id]);
    sel.onchange = () => { CONFIG.priorities[id] = Number(sel.value) as Priority; saveConfig(); };
    const cd = el('input'); cd.type = 'number'; cd.min = '0'; cd.max = '7200'; cd.step = '5';
    cd.value = String(CONFIG.cooldownsMs[id] / 1000);
    cd.onchange = () => {
      const v = Number(cd.value);
      if (Number.isFinite(v) && v >= 0) CONFIG.cooldownsMs[id] = v * 1000;
      cd.value = String(CONFIG.cooldownsMs[id] / 1000);
      saveConfig();
    };
    row.append(el('span', 'name', id), sel, cd, el('span', 'val', 's'));
    wrap.append(row);
  }

  wrap.append(el('h3', '', 'Personality'));
  wrap.append(el('p', 'hint', 'A blend of JARVIS (Iron Man) and TARS (Interstellar). By voice: "humour 60 percent", "humour up", "more TARS", "more JARVIS", "what\'s your humour setting?"'));
  const pz = CONFIG.persona;
  wrap.append(
    numRow('TARS share (rest is JARVIS)', () => pz.tars, (v) => (pz.tars = Math.round(v)), 0, 100, 10, '%'),
    numRow('Humour', () => pz.humour, (v) => (pz.humour = Math.round(v)), 0, 100, 5, '%'),
  );

  wrap.append(el('h3', '', 'Ambient (P3) behaviour'));
  wrap.append(
    numRow('Longest line', () => CONFIG.maxSpokenSentences, (v) => (CONFIG.maxSpokenSentences = Math.round(v)), 1, 5, 1, 'sentences'),
    numRow('Min gap between P3 remarks', () => CONFIG.ambientCooldownMs / 1000, (v) => (CONFIG.ambientCooldownMs = v * 1000), 0, 3600, 5, 's'),
    numRow('Drop queued P3 after', () => CONFIG.ambientMaxAgeMs / 1000, (v) => (CONFIG.ambientMaxAgeMs = v * 1000), 5, 600, 5, 's'),
    numRow('Ride milestone every', () => CONFIG.milestoneEveryMin, (v) => (CONFIG.milestoneEveryMin = v), 1, 240, 1, 'min'),
  );

  wrap.append(el('h3', '', 'Ambient flavour mix (relative weights, all zero = silent)'));
  const a = CONFIG.ambient;
  wrap.append(
    numRow('Banter weight', () => a.banterWeight, (v) => (a.banterWeight = v), 0, 100, 5, ''),
    numRow('Tour guide weight', () => a.tourGuideWeight, (v) => (a.tourGuideWeight = v), 0, 100, 5, ''),
    numRow('Silence weight', () => a.silenceWeight, (v) => (a.silenceWeight = v), 0, 100, 5, ''),
    numRow('Tour guide place radius', () => a.placeRadiusKm, (v) => (a.placeRadiusKm = v), 1, 10, 1, 'km'),
  );

  wrap.append(el('h3', '', 'Thresholds'));
  const t = CONFIG.thresholds;
  wrap.append(
    numRow('Engine overtemp', () => t.overtempC, (v) => (t.overtempC = v), 80, 130, 1, '°C'),
    numRow('Low fuel', () => t.lowFuelPct, (v) => (t.lowFuelPct = v), 1, 50, 1, '%'),
    numRow('Rain chance alert', () => t.rainChancePct, (v) => (t.rainChancePct = v), 5, 100, 5, '%'),
    numRow('Traffic alert radius', () => t.trafficRadiusKm, (v) => (t.trafficRadiusKm = v), 1, 20, 1, 'km'),
    numRow('Traffic min severity', () => t.trafficMinSeverity, (v) => (t.trafficMinSeverity = v), 0, 4, 1, '0-4'),
    numRow('Traffic min delay', () => t.trafficMinDelaySec, (v) => (t.trafficMinDelaySec = v), 0, 1800, 30, 's'),
    numRow('Sunset warning', () => t.sunsetWarnMin, (v) => (t.sunsetWarnMin = v), 5, 180, 5, 'min before'),
    numRow('Fuel consumption', () => CONFIG.fuel.lPer100, (v) => (CONFIG.fuel.lPer100 = v), 2, 10, 0.1, 'L/100 km'),
    numRow('Fuel range warning', () => CONFIG.fuel.warnKmLeft, (v) => (CONFIG.fuel.warnKmLeft = v), 10, 200, 5, 'km left'),
  );

  wrap.append(el('h3', '', 'Hold lines back while leaned over (off = she speaks any time)'));
  wrap.append(checkbox('Hold advisory and ambient lines while leaned past the max', CONFIG.safeWindow.useLean, (on) => {
    CONFIG.safeWindow.useLean = on; saveConfig();
  }).wrap);
  wrap.append(
    numRow('Max lean', () => CONFIG.safeWindow.maxLeanDeg, (v) => (CONFIG.safeWindow.maxLeanDeg = v), 1, 60, 1, '°'),
  );

  wrap.append(el('h3', '', "Betty's memory (kept on this device only)"));
  const forget = button('', () => { RideLog.clear(); showMemory(); });
  const showMemory = () => { forget.textContent = `Forget past rides (${RideLog.load().length} remembered)`; };
  showMemory();
  wrap.append(forget);

  wrap.append(button('Reset all to defaults', () => {
    resetAndSave(); mountTuningPanel(root);
    window.dispatchEvent(new window.Event('betty-config')); // main screen inputs (name, OBD mode) follow
  }));
  root.append(wrap);
}
