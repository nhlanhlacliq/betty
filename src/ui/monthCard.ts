import { bestLine } from '../core/RideCard';
import { fitView } from '../core/Explore';
import { MonthGroup } from '../core/Journeys';
import type { TrackPoint } from '../core/Track';
import { C, FONT, H, PAD, W, drawOrb, loadImage, roundRect, wrap } from './rideCard';
import { mapSvg } from './mapView';

/**
 * A month's recap to share (Journeys 8, 2026-10-18): 1080 x 1350 like the ride card, in the app's colours: the month,
 * every road of the month on one map, km / rides / riding time / fuel, the places, and her best line of the month.
 * The roads are the rough copies (RoadStore): the start and end of a 60-point road are only roughly where he lives,
 * and at a month's scale home is a dot among many.
 */
export interface MonthCardInput {
  month: MonthGroup;
  roads: TrackPoint[][];
  lines: Array<{ trigger: string; text: string }>;
  avatar: Blob | null;
  duration: (min: number) => string;
}

export async function drawMonthCard(doc: Document, c: MonthCardInput): Promise<Blob> {
  const canvas = doc.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This phone cannot draw the card.');
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const [name, year] = c.month.label.split(' ');
  g.fillStyle = C.soft; g.font = `600 26px ${FONT}`; g.fillText(`${name.toUpperCase()} WITH BETTY`, PAD, PAD + 26);
  g.fillStyle = C.ink; g.font = `700 64px ${FONT}`; g.fillText(`${name} ${year}`, PAD, PAD + 104);
  const places = [...new Set(c.month.rides.flatMap((r) => r.places))];
  g.fillStyle = C.soft; g.font = `400 28px ${FONT}`;
  g.fillText(places.length ? `${places.slice(0, 3).join(', ')}${places.length > 3 ? ` and ${places.length - 3} more` : ''}` : `${c.month.rides.length} rides with Betty`, PAD, PAD + 154);

  // Her best line of the month gets its room first; the map takes the rest.
  const quote = bestLine(c.lines);
  g.font = `italic 400 31px ${FONT}`;
  const qLines = quote ? wrap(g, `“${quote}”`, W - PAD * 2 - 170).slice(0, 4) : [];
  const qH = qLines.length ? 108 + qLines.length * 42 + 8 : 0;
  const mapY = PAD + 190, statsH = 130;
  const mapH = H - mapY - statsH - (qH ? qH + 30 : 0) - 56;
  g.save(); roundRect(g, PAD, mapY, W - PAD * 2, mapH, 34); g.clip();
  g.fillStyle = '#e7eadf'; g.fillRect(PAD, mapY, W - PAD * 2, mapH);
  const pts = c.roads.flatMap((t) => t.map(([lat, lon]) => ({ lat, lon })));
  if (pts.length) {
    const v = fitView(pts, W - PAD * 2, mapH);
    const svg = mapSvg({ center: v.center, here: null, headingDeg: null, track: [], places: [], incidents: [], marks: [], spanKm: v.spanKm, roads: c.roads }, 'Every road of the month', 'month')
      .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${W - PAD * 2}" height="${mapH}" `);
    try { g.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`), PAD, mapY, W - PAD * 2, mapH); } catch { /* plain */ }
  }
  g.restore();

  const statsY = mapY + mapH + 74;
  const m = c.month;
  const stats: Array<[string, string]> = [
    [`${Math.round(m.km)}`, 'kilometres'], [`${m.rides.length}`, m.rides.length === 1 ? 'ride' : 'rides'], [c.duration(m.minutes), 'riding'],
    ...(m.costR != null ? [[`R${m.costR}`, 'of fuel'] as [string, string]] : []),
  ];
  const colW = (W - PAD * 2) / stats.length;
  stats.forEach(([v, l], i) => {
    g.fillStyle = C.ink; g.font = `700 52px ${FONT}`; g.fillText(v, PAD + i * colW, statsY);
    g.fillStyle = C.soft; g.font = `400 24px ${FONT}`; g.fillText(l, PAD + i * colW, statsY + 36);
  });
  if (qH) {
    const qY = statsY + 70;
    g.fillStyle = C.card; roundRect(g, PAD, qY, W - PAD * 2, qH, 30); g.fill();
    g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
    await drawOrb(g, PAD + 70, qY + 72, 40, c.avatar);
    g.fillStyle = C.soft; g.font = `600 22px ${FONT}`; g.fillText('BEST THING BETTY SAID', PAD + 130, qY + 64);
    g.fillStyle = C.ink; g.font = `italic 400 31px ${FONT}`;
    qLines.forEach((l, i) => g.fillText(l, PAD + 130, qY + 108 + i * 42));
  }
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the picture.'))), 'image/png'));
}
