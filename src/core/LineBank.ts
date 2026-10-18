import type { TriggerId } from './types';

/**
 * The offline line bank (spec in CLAUDE.md, owner agreed 2026-10-10; built 2026-10-18): while there is signal, Betty
 * writes a few variants of each alert in her own voice with BLANKS for the live values ("{rider}, about {km} kilometres
 * before reserve."). When Claude cannot be reached (no signal, a timeout) a variant is filled with the current values
 * and spoken instead of the one canned sentence; P1 alerts, which never wait on the network, use them too. A variant
 * is only used if every blank can be filled. Pure, so it is tested.
 */
export type Slots = Record<string, string>;

/** The blanks each alert's lines may use, and what the alert is about (for writing the variants). */
export const BANK_SPEC: Partial<Record<TriggerId, { slots: string[]; about: string }>> = {
  engine_overtemp: { slots: ['rider', 'temp'], about: 'the engine is running hot at {temp} degrees: pull over safely and let it cool' },
  dtc_detected: { slots: ['rider', 'codes'], about: 'the bike reports fault codes {codes}' },
  low_fuel: { slots: ['rider', 'pct'], about: 'fuel is down to {pct} percent' },
  fuel_range: { slots: ['rider', 'km'], about: 'about {km} km before the fuel reserve, by her estimate' },
  rain_soon: { slots: ['rider', 'chance'], about: 'a {chance} percent chance of rain in the next hour' },
  sunset_soon: { slots: ['rider', 'time'], about: 'sunset is at {time}' },
  traffic_incident: { slots: ['rider', 'what', 'road', 'km'], about: '{what} on {road}, {km} km ahead' },
  marked_spot: { slots: ['rider', 'metres', 'note'], about: 'a spot he marked ({note}) is {metres} metres ahead' },
  rough_patch: { slots: ['rider', 'metres'], about: 'a rough patch he has hit before, {metres} metres ahead' },
  off_route: { slots: ['rider', 'dest'], about: 'he has left his planned route to {dest}; Google Maps will guide him back' },
  route_stop: { slots: ['rider', 'stop'], about: 'his next planned stop, {stop}, is about a kilometre ahead' },
  route_arrived: { slots: ['rider', 'dest'], about: 'he has arrived at {dest}, the end of his route' },
  fatigue: { slots: ['rider', 'time'], about: 'he has been riding {time} without a proper break' },
  ride_parked: { slots: ['rider'], about: 'he has been standing still a while: has he parked? say "end ride" if done; she will keep quiet till he moves' },
};

export interface BankLine { text: string; used: boolean }
export type Bank = Partial<Record<TriggerId, BankLine[]>>;

const BLANK = /\{([a-z]+)\}/g;
/** A template with its blanks filled, or null if one cannot be (a blank with no value). */
export function fill(template: string, slots: Slots): string | null {
  let ok = true;
  const out = template.replace(BLANK, (_, k: string) => { const v = slots[k]; if (v == null || v === '') { ok = false; return ''; } return v; });
  if (!ok) return null;
  const t = out.replace(/\s{2,}/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : null; // "{what} on {road}" starts a sentence
}

/**
 * Take a variant for an alert: the first unused one that can be filled. When all have been used they come round
 * again (offline, a repeat beats the canned line). Returns the line and the bank with it marked used.
 */
export function take(bank: Bank, id: TriggerId, slots: Slots): { text: string; bank: Bank } | null {
  const list = bank[id];
  if (!list?.length) return null;
  const order = [...list.filter((l) => !l.used), ...list.filter((l) => l.used)];
  for (const l of order) {
    const text = fill(l.text, slots);
    if (!text) continue;
    const fresh = order.every((x) => x.used) ? list.map((x) => ({ ...x, used: x === l })) : list.map((x) => (x === l ? { ...x, used: true } : x));
    return { text, bank: { ...bank, [id]: fresh } };
  }
  return null;
}

/** Alerts with fewer than `min` variants: what to write next while there is signal. */
export const needs = (bank: Bank, min = 3): TriggerId[] => (Object.keys(BANK_SPEC) as TriggerId[]).filter((id) => (bank[id]?.length ?? 0) < min);

/** The request text for writing variants of some alerts (her character comes with the system prompt). */
export function bankPrompt(ids: TriggerId[], perId = 3): string {
  return `Write ${perId} different spoken versions of each of these alerts, as you would say them to him on the intercom. Use the blanks EXACTLY as written (with the curly braces); they will be filled with live values later. Address him only with the blank {rider} (never "sir" or any other name), in at most one version of each. Alerts are said straight: no jokes, one or two short sentences, plain spoken English.
${ids.map((id) => `- ${id}: ${BANK_SPEC[id]!.about}. Blanks you may use: ${BANK_SPEC[id]!.slots.map((s) => `{${s}}`).join(', ')}`).join('\n')}
Reply with ONLY JSON: {"${ids[0]}": ["...", "...", "..."]${ids.length > 1 ? ', ...' : ''}}`;
}

/** The variants out of a reply: only lines whose blanks are all allowed for that alert, at most 6 per alert. */
export function parseBank(text: string, ids: TriggerId[]): Bank {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  let j: any;
  try { j = JSON.parse(m[0]); } catch { return {}; }
  const out: Bank = {};
  for (const id of ids) {
    const allowed = new Set(BANK_SPEC[id]?.slots ?? []);
    // "sir" written out is her default name for him, not his: it becomes the {rider} blank.
    const lines = (Array.isArray(j[id]) ? j[id] : []).map((t: unknown) => String(t).trim().replace(/\bsir\b/gi, '{rider}'))
      .filter((t: string) => t.length > 5 && t.length < 240 && [...t.matchAll(BLANK)].every((b) => allowed.has(b[1])));
    if (lines.length) out[id] = lines.slice(0, 6).map((text: string) => ({ text, used: false }));
  }
  return out;
}
