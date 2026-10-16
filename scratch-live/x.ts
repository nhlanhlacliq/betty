import { POST } from '../api/speak';
import { writeFileSync } from 'node:fs';
const req = (b: any) => new Request('https://betty-zeta.vercel.app/api/speak', { method: 'POST', body: JSON.stringify(b), headers: { host: 'betty-zeta.vercel.app', origin: 'https://betty-zeta.vercel.app' } });
for (const [engine, model] of [['chirp', ''], ['gemini', 'gemini-3.8-flash-tts'], ['gemini', 'gemini-3.8-flash-lite-tts']]) {
  if (model) process.env.GEMINI_TTS_MODEL = model;
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const r = await POST(req({ text: 'Forty minutes in and the road is behaving. Cannot say the same for the taxis.', engine, voice: 'Aoede', style: engine === 'gemini' ? 'dry and wry, quietly amused, unhurried' : undefined }));
    const ms = Date.now() - t0;
    if (!r.ok) { console.log(engine, model, r.status, await r.text()); break; }
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(`scratch-live/${engine}-${model || 'chirp'}.${engine === 'chirp' ? 'mp3' : 'wav'}`, buf);
    console.log(engine, model, r.headers.get('content-type'), buf.length, 'bytes', ms, 'ms', buf.subarray(0, 4).toString());
  }
}
