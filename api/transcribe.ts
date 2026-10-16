import { env, fromBetty, json } from './_shared.js';

/** A push-to-talk clip is a few seconds; anything this big is not one. */
const MAX_BYTES = 3 * 1024 * 1024;
/** Open-source Whisper, run by Groq. Free tier at the time of writing: 2,000 requests and 28,800 audio seconds a day. */
const MODEL = 'whisper-large-v3-turbo';
/** Words Whisper should expect, which helps with names it would otherwise mishear. */
const HINT = 'Hey Betty. Hello Betty. Betty, the bike, Gauteng, Edenvale, Modderfontein, Kempton Park, Pretoria, Johannesburg.';

const extension = (type: string) => (type.includes('webm') ? 'webm' : type.includes('wav') ? 'wav' : type.includes('ogg') ? 'ogg' : 'm4a');

/** POST /api/transcribe with the recorded audio as the body: returns {text}. */
export async function POST(req: Request): Promise<Response> {
  if (!fromBetty(req)) return json({ error: 'not allowed' }, 403);
  const key = env('GROQ_API_KEY');
  if (!key) return json({ error: 'voice is not set up yet (server has no GROQ_API_KEY)' }, 503);
  const type = req.headers.get('content-type') || 'audio/mp4';
  const audio = await req.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'no audio' }, 400);
  if (audio.byteLength > MAX_BYTES) return json({ error: 'clip too long' }, 413);
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `speech.${extension(type)}`);
  form.append('model', MODEL);
  form.append('language', 'en');
  form.append('temperature', '0');
  form.append('response_format', 'json');
  form.append('prompt', HINT);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form,
  });
  if (!res.ok) return json({ error: `transcription service said HTTP ${res.status}` }, 502);
  const out: any = await res.json().catch(() => ({}));
  return json({ text: String(out?.text ?? '').trim() });
}
