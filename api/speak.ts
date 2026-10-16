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
/** Chirp 3 HD has en-GB but no en-ZA (2026-10-16); en-GB is the nearest. */
const CHIRP_LOCALE = 'en-GB';
const GEMINI_MODEL = () => env('GEMINI_TTS_MODEL') || 'gemini-3.8-flash-tts';

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
  if (!text) return json({ error: 'no text' }, 400);
  if (text.length > MAX_TEXT) return json({ error: 'text too long' }, 413);
  if (!VOICES.includes(voice)) return json({ error: 'unknown voice' }, 400);

  if (engine === 'chirp') {
    const key = env('GOOGLE_TTS_API_KEY');
    if (!key) return json({ error: 'cloud voice is not set up yet (server has no GOOGLE_TTS_API_KEY)' }, 503);
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: CHIRP_LOCALE, name: `${CHIRP_LOCALE}-Chirp3-HD-${voice}` },
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
        model: GEMINI_MODEL(),
        input: [{ type: 'user_input', content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice }] },
      }),
    });
    if (!res.ok) return json({ error: `Gemini voice said HTTP ${res.status}`, detail: (await res.text()).slice(0, 300) }, 502);
    const out: any = await res.json().catch(() => ({}));
    const clips = (out?.steps ?? []).filter((s: any) => s?.type === 'model_output').flatMap((s: any) => s?.content ?? []).filter((c: any) => c?.type === 'audio' && c?.data);
    const data = clips.at(-1)?.data;
    if (!data) return json({ error: 'Gemini voice sent no audio' }, 502);
    return audio(fromBase64(data), 'audio/wav');
  }
  return json({ error: 'unknown engine' }, 400);
}
