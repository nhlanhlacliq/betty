import { env, fromBetty, json } from './_shared.js';

/**
 * Turns one of Betty's lines into audio with a Google voice (the cloud voice, 2026-10-16).
 * - chirp: Cloud Text-to-Speech, Chirp 3 HD. Fast and steady; used for alerts. Key: GOOGLE_TTS_API_KEY (a Google
 *   Cloud project with billing and the Text-to-Speech API; 1 million characters a month free).
 * - gemini: Gemini TTS, which takes a "style" for how to say the line; used for banter, tour guide and answers.
 *   Key: GEMINI_API_KEY (AI Studio, free tier: Google may use the text to improve its products).
 * Both engines share the same 30 voice names, so she sounds like one person.
 */

/** The Chirp 3 HD / Gemini prebuilt voices (identical lists, checked against both docs 2026-10-16). */
export const VOICES = ['Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe', 'Callirrhoe', 'Charon',
  'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux', 'Iapetus', 'Kore', 'Laomedeia', 'Leda', 'Orus', 'Pulcherrima', 'Puck',
  'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix', 'Zephyr', 'Zubenelgenubi'];
const MAX_TEXT = 800;
const MAX_STYLE = 200;
/** Chirp 3 HD English accents (no en-ZA, 2026-10-16). The voice name is the same in each; the accent differs. */
const CHIRP_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-IN'];
/** Gemini TTS models Betty may ask for: full (best) or lite (first sound about 0.8 s sooner when streamed). */
const GEMINI_MODELS: Record<string, () => string> = {
  full: () => env('GEMINI_TTS_MODEL') || 'gemini-3.8-flash-tts',
  lite: () => 'gemini-3.8-flash-lite-tts',
};

/**
 * Gemini's streamed reply (server-sent events) turned into a plain stream of raw audio: 16-bit little-endian PCM,
 * 24 kHz, mono, from each `step.delta` audio event. Measured 2026-10-16: first audio after 2.2 s (lite) to 3 s (full)
 * instead of the 5 to 6 s a whole clip takes.
 */
function pcmStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        buf += dec.decode(value, { stream: true });
        let sent = false;
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
          const event = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = event.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let j: any; try { j = JSON.parse(line.slice(6)); } catch { continue; }
          if (j?.event_type === 'step.delta' && j.delta?.type === 'audio' && j.delta.data) { controller.enqueue(fromBase64(j.delta.data)); sent = true; }
        }
        if (sent) return;
      }
    },
    cancel() { void reader.cancel(); },
  });
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const audio = (bytes: Uint8Array, type: string) => new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'no-store' } });

/** POST /api/speak {text, engine: 'chirp' | 'gemini', voice, style?} -> audio bytes (mp3 or wav). */
export async function POST(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const body: any = await req.json().catch(() => null);
  const text = String(body?.text ?? '').trim();
  const engine = body?.engine;
  const voice = String(body?.voice ?? '');
  const style = String(body?.style ?? '').slice(0, MAX_STYLE);
  const model = GEMINI_MODELS[String(body?.model ?? 'full')];
  const stream = body?.stream === true;
  if (!model) return json({ error: 'unknown model' }, 400);
  const locale = String(body?.locale ?? 'en-US');
  if (!CHIRP_LOCALES.includes(locale)) return json({ error: 'unknown accent' }, 400);
  if (!text) return json({ error: 'no text' }, 400);
  if (text.length > MAX_TEXT) return json({ error: 'text too long' }, 413);
  // Chirp: the 30 standard voices. Gemini also takes its accent library ids (en-us-veda, en-gb-advisor-8, ...).
  const libraryId = /^[a-z]{2}-[a-z]{2}-[a-z0-9-]{1,40}$/.test(voice);
  if (!VOICES.includes(voice) && !(engine === 'gemini' && libraryId)) return json({ error: 'unknown voice' }, 400);

  if (engine === 'chirp') {
    const key = env('GOOGLE_TTS_API_KEY');
    if (!key) return json({ error: 'cloud voice is not set up yet (server has no GOOGLE_TTS_API_KEY)' }, 503);
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: locale, name: `${locale}-Chirp3-HD-${voice}` },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });
    if (!res.ok) return json({ error: `Google voice said HTTP ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
    const out: any = await res.json().catch(() => ({}));
    if (!out?.audioContent) return json({ error: 'Google voice sent no audio' }, 502);
    return audio(fromBase64(out.audioContent), 'audio/mpeg');
  }

  if (engine === 'gemini') {
    const key = env('GEMINI_API_KEY');
    if (!key) return json({ error: 'cloud voice is not set up yet (server has no GEMINI_API_KEY)' }, 503);
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: model(),
        ...(stream ? { stream: true } : {}),
        input: [{ type: 'user_input', content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice }] },
      }),
    });
    if (!res.ok) return json({ error: `Gemini voice said HTTP ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
    if (stream) {
      if (!res.body) return json({ error: 'Gemini voice sent no stream' }, 502);
      return new Response(pcmStream(res.body), { headers: { 'content-type': 'audio/l16; rate=24000; channels=1', 'cache-control': 'no-store' } });
    }
    const out: any = await res.json().catch(() => ({}));
    const clips = (out?.steps ?? []).filter((s: any) => s?.type === 'model_output').flatMap((s: any) => s?.content ?? []).filter((c: any) => c?.type === 'audio' && c?.data);
    const data = clips.at(-1)?.data;
    if (!data) return json({ error: 'Gemini voice sent no audio' }, 502);
    return audio(fromBase64(data), 'audio/wav');
  }
  return json({ error: 'unknown engine' }, 400);
}
