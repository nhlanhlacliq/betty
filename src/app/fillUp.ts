import { CONFIG } from '../config/betty';
import { saveConfig } from '../config/persist';
import { BikeCounter, FillUpStore, FuelStore } from '../adapters/FuelStore';
import { kmAfterFill, learnedPer100 } from '../core/FillUps';
import { kmToReserve } from '../core/Fuel';

export interface FillUpInput { litres?: number | null; full?: boolean }

/**
 * A fill-up, from any button or from what he said, shared by both apps: kept in the history (litres, full or not, km
 * since the last one, the bike's counter), the range reset (or shortened for a top-up), and after a full tank his
 * consumption relearned from the fill-ups (CONFIG.fillUps.learn). Returns the new km since the fill-up and a line to show.
 */
export function noteFillUp(o: FillUpInput, kmSinceFill: number | null, counterKm: number | null = BikeCounter.load(), at = Date.now()) {
  const litres = o.litres ?? null, full = o.full ?? true;
  FillUpStore.add({ at, litres, full, km: kmSinceFill, counterKm, pricePerL: CONFIG.fuel.pricePerL });
  const km = kmAfterFill(kmSinceFill, litres, full);
  FuelStore.save(km);
  let learned: ReturnType<typeof learnedPer100> = null;
  if (full && CONFIG.fillUps.learn) {
    learned = learnedPer100(FillUpStore.load());
    if (learned && learned.lPer100 !== CONFIG.fuel.lPer100) { CONFIG.fuel.lPer100 = learned.lPer100; saveConfig(); }
  }
  const range = Math.max(0, Math.round(kmToReserve(CONFIG.fuel) - km));
  const text = `${litres != null ? `${litres} L noted` : 'Fill-up noted'}${full ? '' : ' (a top-up)'}: about ${range} km to reserve.${learned ? ` Your consumption from fill-ups: ${learned.lPer100} L/100 km.` : ''}`;
  return { km, learned, range, text };
}
