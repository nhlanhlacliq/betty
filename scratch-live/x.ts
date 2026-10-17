import { POST } from '../api/route';
const h = { host: 'x', origin: 'https://x' };
for (const stops of [['Clarens'], ['Heidelberg', 'Villiers', 'Clarens'], ['BMW Motorrad Fourways'], ['Hartbeespoort'], ['Cullinan']]) {
  const r = await POST(new Request('https://x/api/route', { method: 'POST', headers: h, body: JSON.stringify({ stops, from: { lat: -26.14, lon: 28.15 } }) }));
  const j: any = await r.json();
  console.log(stops.join(' > '), '=>', j.error ?? `${j.name} | ${j.km} km ${j.minutes} min | ${j.stops.map((s: any) => `${s.name} (${s.lat.toFixed(2)},${s.lon.toFixed(2)})`).join(' > ')}`);
}
