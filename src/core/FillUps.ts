/**
 * Consumption from his real fill-ups (owner, 2026-10-27): the bike gives no fuel level and its engine load cannot
 * stand in for air flow (first reader ride), so the litres at the pump are the truth. Full tank to full tank: the
 * litres put in at the second full fill (plus any top-ups in between) burned the distance ridden between them.
 * Distance: Betty's own km since the last fill-up, or the bike's "km since codes cleared" counter (PID 31) when both
 * fill-ups have it and it makes sense, because the bike counts rides Betty was not running for. Pure, so it is tested.
 */
import { CONFIG } from '../config/betty';

export interface FillUp {
  at: number;
  /** Litres from the pump; null = not given (the fill-up still resets the range, but cannot teach consumption) */
  litres: number | null;
  /** Filled to the brim (only full-to-full gives consumption) */
  full: boolean;
  /** Betty's km since the previous fill-up, when this one was made (null = no earlier fill-up on record) */
  km: number | null;
  /** The bike's PID 31 counter at this fill-up (last seen), null without a reader */
  counterKm: number | null;
  pricePerL?: number;
}

export interface Tank { from: number; to: number; litres: number; km: number; lPer100: number; by: 'counter' | 'betty' }

/** Every full-to-full stretch with litres known for each fill in it and at least fillUps.minKm ridden. Oldest first. */
export function tanks(list: FillUp[], minKm = CONFIG.fillUps.minKm): Tank[] {
  const out: Tank[] = [];
  const fills = [...list].sort((a, b) => a.at - b.at);
  let start = -1;
  for (let i = 0; i < fills.length; i++) {
    if (!fills[i].full) continue;
    if (start >= 0) {
      const part = fills.slice(start + 1, i + 1);
      const litres = part.every((f) => f.litres != null) ? part.reduce((n, f) => n + (f.litres as number), 0) : null;
      const bettyKm = part.every((f) => f.km != null) ? part.reduce((n, f) => n + (f.km as number), 0) : null;
      const a = fills[start].counterKm, b = fills[i].counterKm;
      // The counter wins when it ran forward and is not wildly less than Betty saw (cleared codes reset it to 0).
      const counterKm = a != null && b != null && b > a && (bettyKm == null || b - a >= bettyKm * 0.9) ? b - a : null;
      const km = counterKm ?? bettyKm;
      if (litres != null && km != null && km >= minKm) out.push({ from: fills[start].at, to: fills[i].at, litres, km, lPer100: Math.round((litres / km) * 1000) / 10, by: counterKm != null ? 'counter' : 'betty' });
    }
    start = i;
  }
  return out;
}

/** His consumption from the last fillUps.tanks stretches, weighted by distance; null until there is one. */
export function learnedPer100(list: FillUp[]): { lPer100: number; tanks: number; km: number } | null {
  const t = tanks(list).slice(-CONFIG.fillUps.tanks);
  if (!t.length) return null;
  const km = t.reduce((n, x) => n + x.km, 0), litres = t.reduce((n, x) => n + x.litres, 0);
  return { lPer100: Math.round((litres / km) * 1000) / 10, tanks: t.length, km: Math.round(km) };
}

/**
 * Km since the fill-up after this one: a full tank starts again at 0; a top-up of known litres takes off the km those
 * litres last at his consumption (never below 0); a top-up with no litres is treated as full (as before).
 */
export function kmAfterFill(kmBefore: number | null, litres: number | null, full: boolean, lPer100 = CONFIG.fuel.lPer100): number {
  if (full || litres == null || kmBefore == null) return 0;
  return Math.max(0, Math.round((kmBefore - (litres / Math.max(0.5, lPer100)) * 100) * 10) / 10);
}

/** "9.2 litres", "9,2 L", "nine litres"? (digits only) or "R250 worth" (litres from the price) in what he said. */
export function litresSaid(said: string, pricePerL = CONFIG.fuel.pricePerL): number | null {
  const l = said.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:litres?|liters?|l\b|ℓ)/i);
  if (l) { const n = Number(l[1].replace(',', '.')); return n > 0 && n <= 40 ? n : null; }
  const r = said.match(/\b(?:r\s?(\d{2,4})|(\d{2,4})\s*rand)\b/i);
  if (r && pricePerL > 0) { const n = Number(r[1] ?? r[2]) / pricePerL; return n > 0 && n <= 40 ? Math.round(n * 10) / 10 : null; }
  return null;
}
/** He said it was not a full tank ("only half", "not full", "a partial fill", "just a few litres"). */
export const saysPartial = (said: string) => /\b(not (a )?full|partial|half (a )?tank|only (half|a few|\d)|just a few litres|didn'?t fill (it )?up)\b/i.test(said);

/** For his answers and the Garage: what the fill-ups say. */
export function describeFills(list: FillUp[]): string {
  const l = learnedPer100(list);
  if (!l) return list.length ? 'No consumption from fill-ups yet: it needs two full tanks with the litres given.' : 'No fill-ups recorded yet.';
  return `From his fill-ups: ${l.lPer100} L/100 km over the last ${l.tanks === 1 ? 'tank' : `${l.tanks} tanks`} (${l.km} km).`;
}
