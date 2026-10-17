import { bestLine, trimEnds } from '../core/RideCard';
import type { RideRecord } from '../core/RideMemory';
import type { TrackPoint } from '../core/Track';
import { MAP_H, MAP_W, mapSvg, spanFor, trackCenter } from './mapView';

/**
 * A shareable picture of one ride: 1080 x 1350 (portrait, fits WhatsApp status and Instagram), in the app's colours:
 * title and date, the road as the app's sketch (start and end trimmed so home stays private), the numbers, and her
 * best line of the ride beside her orb or his own picture. Drawn on a canvas; shared with the share sheet.
 */
export interface CardInput {
  ride: RideRecord;
  title: string;
  track: TrackPoint[];
  lines: Array<{ trigger: string; text: string }>;
  avatar: Blob | null;
  hideEnds: boolean;
}

const W = 1080, H = 1350, PAD = 72;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const C = { bg: '#f7f6f0', ink: '#273f39', soft: '#7d857b', card: '#ffffff', accent: '#e8c95c', line: '#e3e8da' };

const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = src; });

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of text.split(' ')) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxW && line) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Her orb (the yellow companion) or his picture, as a circle. */
async function drawOrb(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, avatar: Blob | null) {
  if (avatar) {
    try {
      const url = URL.createObjectURL(avatar);
      const img = await loadImage(url);
      g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
      const s = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2); // a GIF shows its first frame
      g.restore(); URL.revokeObjectURL(url);
      return;
    } catch { /* fall back to the companion */ }
  }
  const grad = g.createRadialGradient(cx - r * 0.36, cy - r * 0.54, r * 0.05, cx, cy, r * 1.15);
  grad.addColorStop(0.03, '#fff4b9'); grad.addColorStop(0.55, '#f3da80'); grad.addColorStop(1, '#c9ae62');
  g.fillStyle = grad; g.beginPath(); g.ellipse(cx, cy, r, r * 0.95, -0.14, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#716542';
  for (const dx of [-r * 0.2, r * 0.2]) { roundRect(g, cx + dx - r * 0.06, cy - r * 0.1, r * 0.12, r * 0.2, r * 0.06); g.fill(); }
}

export async function drawRideCard(doc: Document, c: CardInput): Promise<Blob> {
  const canvas = doc.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This phone cannot draw the card.');
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);

  // Heading
  g.fillStyle = C.soft; g.font = `600 26px ${FONT}`;
  g.fillText('RIDDEN WITH BETTY', PAD, PAD + 26);
  g.fillStyle = C.ink; g.font = `700 58px ${FONT}`;
  wrap(g, c.title, W - PAD * 2).slice(0, 2).forEach((l, i) => g.fillText(l, PAD, PAD + 100 + i * 66));
  g.fillStyle = C.soft; g.font = `400 28px ${FONT}`;
  g.fillText(new Date(c.ride.startedAt).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), PAD, PAD + 100 + 66 + 50);

  // The road
  const mapY = 330, mapW = W - PAD * 2, mapH = Math.round((mapW * MAP_H) / MAP_W);
  const track = c.hideEnds ? trimEnds(c.track) : c.track;
  g.save(); roundRect(g, PAD, mapY, mapW, mapH, 34); g.clip();
  if (track.length > 1) {
    const svg = mapSvg({ center: trackCenter(track), here: null, headingDeg: null, track, places: [], incidents: [], marks: [], spanKm: spanFor(track) }, 'The road', 'card')
      .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${mapW}" height="${mapH}" `);
    try { g.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`), PAD, mapY, mapW, mapH); }
    catch { g.fillStyle = '#e7eadf'; g.fillRect(PAD, mapY, mapW, mapH); }
  } else {
    g.fillStyle = '#e7eadf'; g.fillRect(PAD, mapY, mapW, mapH);
    g.fillStyle = C.soft; g.font = `400 30px ${FONT}`; g.textAlign = 'center'; g.fillText('A ride without a map, but not without a story.', W / 2, mapY + mapH / 2); g.textAlign = 'left';
  }
  g.restore();

  // Numbers
  const statsY = mapY + mapH + 70;
  const min = c.ride.minutes;
  const stats: Array<[string, string]> = [
    [`${c.ride.distanceKm}`, 'kilometres'],
    [min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}` : `${min}`, min >= 60 ? 'in the saddle' : 'minutes'],
    [`${c.ride.places.length}`, c.ride.places.length === 1 ? 'place' : 'places'],
  ];
  const colW = (W - PAD * 2) / stats.length;
  stats.forEach(([v, l], i) => {
    g.fillStyle = C.ink; g.font = `700 54px ${FONT}`; g.fillText(v, PAD + i * colW, statsY);
    g.fillStyle = C.soft; g.font = `400 24px ${FONT}`; g.fillText(l, PAD + i * colW, statsY + 36);
  });

  // Her best line
  const quote = bestLine(c.lines);
  const qY = statsY + 80, qH = H - qY - PAD;
  g.fillStyle = C.card; roundRect(g, PAD, qY, W - PAD * 2, qH, 30); g.fill();
  g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
  await drawOrb(g, PAD + 70, qY + 72, 40, c.avatar);
  g.fillStyle = C.soft; g.font = `600 22px ${FONT}`; g.fillText('BETTY SAID', PAD + 130, qY + 64);
  g.fillStyle = C.ink; g.font = `italic 400 31px ${FONT}`;
  const text = quote ? `“${quote}”` : `“${c.ride.weather ? `${c.ride.weather}, and a good ride.` : 'A quiet ride is a good ride, too.'}”`;
  wrap(g, text, W - PAD * 2 - 170).slice(0, Math.floor((qH - 70) / 42)).forEach((l, i) => g.fillText(l, PAD + 130, qY + 108 + i * 42));

  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the picture.'))), 'image/png'));
}

/** Share the card through the share sheet (WhatsApp, Instagram, Photos...), or download it where that is missing. */
export async function shareRideCard(doc: Document, png: Blob, name: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([png], name, { type: 'image/png' });
  const nav = doc.defaultView?.navigator;
  if (nav?.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: 'My ride with Betty' }); return 'shared'; } catch { return 'cancelled'; }
  }
  const a = doc.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  doc.body.append(a); a.click(); a.remove();
  return 'saved';
}
