import { bestLine, pickLabels, trimEnds, weatherPill } from '../core/RideCard';
import type { CardExtras } from '../adapters/CardExtras';
import { RideRecord, rideMinutes } from '../core/RideMemory';
import { CONFIG } from '../config/betty';
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
  /** Place names along the road and the metro line (null: none, or switched off in Garage > The map) */
  extras?: { samples: CardExtras['samples']; ends: string[]; metro: CardExtras['metro']; places: boolean; metroLine: boolean } | null;
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

/** A small weather glyph in the app's ink colours, centred on (x, y). */
function drawWeatherIcon(g: CanvasRenderingContext2D, kind: string, x: number, y: number) {
  g.save(); g.lineWidth = 3; g.lineCap = 'round'; g.strokeStyle = '#c9a43c'; g.fillStyle = '#f0cf5a';
  const cloud = (cx: number, cy: number) => {
    g.fillStyle = '#9fb0a3'; g.beginPath();
    g.arc(cx - 7, cy + 2, 7, 0, Math.PI * 2); g.arc(cx + 2, cy - 3, 9, 0, Math.PI * 2); g.arc(cx + 10, cy + 3, 6, 0, Math.PI * 2); g.fill();
  };
  if (kind === 'sun') {
    g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); g.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16); g.stroke(); }
  } else {
    if (kind === 'cloud') { g.beginPath(); g.arc(x + 6, y - 6, 7, 0, Math.PI * 2); g.fill(); }
    cloud(x, y);
    if (kind === 'rain' || kind === 'storm') {
      g.strokeStyle = kind === 'storm' ? '#c9a43c' : '#6f9fb5';
      for (const dx of [-7, 1, 9]) { g.beginPath(); g.moveTo(x + dx, y + 11); g.lineTo(x + dx - 3, y + 17); g.stroke(); }
    }
    if (kind === 'fog') { g.strokeStyle = '#9fb0a3'; for (const dy of [12, 17]) { g.beginPath(); g.moveTo(x - 12, y + dy); g.lineTo(x + 14, y + dy); g.stroke(); } }
  }
  g.restore();
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

  // Heading: everything below follows the title's real height (one line or two).
  g.fillStyle = C.soft; g.font = `600 26px ${FONT}`;
  g.fillText('RIDDEN WITH BETTY', PAD, PAD + 26);
  g.fillStyle = C.ink; g.font = `700 58px ${FONT}`;
  const titleLines = wrap(g, c.title, W - PAD * 2).slice(0, 2);
  titleLines.forEach((l, i) => g.fillText(l, PAD, PAD + 98 + i * 66));
  const dateY = PAD + 98 + (titleLines.length - 1) * 66 + 52;
  g.fillStyle = C.soft; g.font = `400 28px ${FONT}`;
  g.fillText(new Date(c.ride.startedAt).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), PAD, dateY);

  // Her best line is measured first: it gets the room it needs, and the map takes the rest (at least 380 px).
  const quote = bestLine(c.lines);
  const text = quote ? `“${quote}”` : `“${c.ride.weather ? `${c.ride.weather}, and a good ride.` : 'A quiet ride is a good ride, too.'}”`;
  g.font = `italic 400 31px ${FONT}`;
  let lines = wrap(g, text, W - PAD * 2 - 170);
  const mapY = dateY + 38, mapW = W - PAD * 2;
  const fixed = 68 + 74 + 56; // stats, gap to the quote box, bottom margin
  const room = (n: number) => 108 + n * 42 + 8; // the quote box's height for n lines
  const fit = Math.max(1, Math.floor((H - mapY - 380 - fixed - 116) / 42));
  if (lines.length > fit) { lines = lines.slice(0, fit); lines[fit - 1] = `${lines[fit - 1].replace(/[,;:.]?\s*\S*$/, '')}…”`; }
  const qH = Math.max(150, room(lines.length));
  const mapH = H - mapY - fixed - qH;
  const track = c.hideEnds ? trimEnds(c.track) : c.track;
  const hasRoad = track.length > 1;
  g.save(); roundRect(g, PAD, mapY, mapW, mapH, 34); g.clip();
  g.fillStyle = '#e7eadf'; g.fillRect(PAD, mapY, mapW, mapH);
  // With no road (an older ride, or one too short once home is trimmed) the scenery alone still looks like Betty.
  const spanKm = hasRoad ? spanFor(track) : 6;
  const x = hasRoad ? c.extras : null;
  // The weather pill sits over the map's top-left corner: keep names out from under it. The SVG is drawn with
  // "slice" (scaled to cover, centred), so the pill's box is turned back into map units.
  const sc = Math.max(mapW / MAP_W, mapH / MAP_H), ox = (mapW - MAP_W * sc) / 2, oy = (mapH - MAP_H * sc) / 2;
  const pill = { x0: (0 - ox) / sc, y0: (0 - oy) / sc, x1: (22 + 330 - ox) / sc, y1: (22 + 66 - oy) / sc };
  const labels = x?.places ? pickLabels(x.samples, spanKm, c.hideEnds ? x.ends : []).map((l) => ({ lat: l.lat, lon: l.lon, label: l.name })) : [];
  const svg = mapSvg({
    center: hasRoad ? trackCenter(track) : null, here: null, headingDeg: null, track: hasRoad ? track : [], places: [], incidents: [], marks: [], spanKm,
    borders: x?.metroLine && x.metro?.length ? { suburbs: [], metro: x.metro } : null, labels, avoid: [pill],
  }, 'The road', 'card')
    .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${mapW}" height="${mapH}" `);
  try { g.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`), PAD, mapY, mapW, mapH); } catch { /* plain background */ }
  if (!hasRoad) {
    const msg = 'A ride without a map, but not without a story.';
    g.font = `400 28px ${FONT}`; const w = g.measureText(msg).width + 48;
    g.fillStyle = '#fbfaf5ee'; roundRect(g, (W - w) / 2, mapY + mapH / 2 - 34, w, 60, 30); g.fill();
    g.fillStyle = C.soft; g.textAlign = 'center'; g.fillText(msg, W / 2, mapY + mapH / 2 + 6); g.textAlign = 'left';
  }
  g.restore();

  // The weather of the ride, as the app's screens show it: a small pill in the map's top corner.
  const wx = weatherPill(c.ride.weather);
  if (wx) {
    g.font = `500 26px ${FONT}`;
    const tw = g.measureText(wx.text).width, pw = tw + 90, px = PAD + 22, py = mapY + 22;
    g.fillStyle = '#fbfaf5f0'; roundRect(g, px, py, pw, 56, 28); g.fill();
    drawWeatherIcon(g, wx.icon, px + 34, py + 28);
    g.fillStyle = C.ink; g.fillText(wx.text, px + 62, py + 37);
  }

  // Numbers
  const statsY = mapY + mapH + 68;
  const min = rideMinutes(c.ride, CONFIG.ridingTimeOnly);
  const stats: Array<[string, string]> = [
    [`${c.ride.distanceKm}`, 'kilometres'],
    [min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}` : `${min}`, min >= 60 ? 'in the saddle' : 'minutes'],
    [`${c.ride.places.length}`, c.ride.places.length === 1 ? 'place' : 'places'],
    ...(c.ride.costR != null ? [[`R${c.ride.costR}`, 'of fuel'] as [string, string]] : []),
  ];
  const colW = (W - PAD * 2) / stats.length;
  stats.forEach(([v, l], i) => {
    g.fillStyle = C.ink; g.font = `700 54px ${FONT}`; g.fillText(v, PAD + i * colW, statsY);
    g.fillStyle = C.soft; g.font = `400 24px ${FONT}`; g.fillText(l, PAD + i * colW, statsY + 36);
  });

  // Her best line
  const qY = statsY + 74;
  g.fillStyle = C.card; roundRect(g, PAD, qY, W - PAD * 2, qH, 30); g.fill();
  g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
  await drawOrb(g, PAD + 70, qY + 72, 40, c.avatar);
  g.fillStyle = C.soft; g.font = `600 22px ${FONT}`; g.fillText('BETTY SAID', PAD + 130, qY + 64);
  g.fillStyle = C.ink; g.font = `italic 400 31px ${FONT}`;
  lines.forEach((l, i) => g.fillText(l, PAD + 130, qY + 108 + i * 42));

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
