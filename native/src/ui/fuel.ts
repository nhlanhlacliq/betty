import { CONFIG } from '../../../src/config/betty';
import { fuelLeft } from '../../../src/core/Fuel';

/** "227 km to reserve · 10 L left" (the web's fuelText). */
export function fuelText(kmSinceFill: number | null) {
  if (kmSinceFill === null) return 'Tap Filled up to start counting';
  const f = fuelLeft(kmSinceFill, CONFIG.fuel);
  return f.onReserve ? `On reserve: about ${f.kmToEmpty} km to empty` : `${f.kmToReserve} km to reserve · ${f.litres} L left`;
}

