import { CONFIG, CloudVoiceMode, voiceStyle } from '../config/betty';
import { SpeakTag, Speaker } from '../core/AudioQueue';
import { quietWav } from './audio';
import { PcmClip, PcmPlayer } from './PcmPlayer';

export type Engine = 'chirp' | 'gemini';

/**
 * Which Google engine says a line. Measured 2026-10-16: Chirp about 1 s a line, Gemini 5 to 7 s (the lite model no
 * faster). So in the mixed mode Gemini only says her own unprompted lines (P3: banter, tour guide, time checks),
 * which nobody is waiting for; alerts and answers to him get Chirp.
 */
export function engineFor(mode: CloudVoiceMode, priority: number): Engine | null {
  if (mode === 'off') return null;
  if (mode === 'mixed') return priority === 3 ? 'gemini' : 'chirp';
  if (mode === 'stream') return priority <= 2 ? 'chirp' : 'gemini'; // alerts stay on fast Chirp
  return mode;
}
/** In the stream mode, lines he is waiting for (P4) are streamed; her own remarks (P3) are fetched whole, ahead. */
export const streams = (mode: CloudVoiceMode, priority: number) => mode === 'stream' && priority === 4;

/** How long speak() waits for the audio before saying the line with the phone voice instead. */
export const WAIT_MS: Record<Engine, number> = { chirp: 3500, gemini: 5000 }; // live from SA: Chirp about 2 s round trip
/** How long an unprompted line may wait for its Gemini audio BEFORE it is queued (see ready()). */
export const READY_MS = 12_000;
/** A streamed line with no audio yet after this long is said by Chirp instead. */
export const STREAM_WAIT_MS = 4500;
/** Lines she says often, made in her Gemini voice at ride start so they play at once (stream mode). */
export const STOCK_LINES = [
  'Hang on, let me check.', "I didn't hear anything. Try again?", "Sorry, I couldn't make that out. Try again?",
  "Sorry, I didn't catch that.", "I'm back.", "Noted. I'll remember that.", 'Forgotten.',
];

/** Plays one clip. Returns a function that stops it. */
export interface CloudPlayer { play(url: string, onEnded: () => void, onError: (why: string) => void): () => void }

/** A single audio element, unlocked inside a tap (iPhone only lets a page start sound from one). */
export class ElementPlayer implements CloudPlayer {
  private a: HTMLAudioElement | null = null;
  /** Call inside a tap. */
  prime() {
    try {
      this.a ??= new Audio();
      this.a.src = URL.createObjectURL(quietWav(1));
      void this.a.play().catch(() => {});
    } catch { /* no audio element: play() reports it */ }
  }
  play(url: string, onEnded: () => void, onError: (why: string) => void) {
    let a: HTMLAudioElement;
    try { a = this.a ??= new Audio(); } catch { onError('no audio player'); return () => {}; }
    const end = () => { off(); onEnded(); };
    const err = () => { off(); onError('the clip would not play'); };
    const off = () => { a.removeEventListener('ended', end); a.removeEventListener('error', err); };
    a.loop = false; a.src = url;
    a.addEventListener('ended', end); a.addEventListener('error', err);
    void a.play().catch((e) => { off(); onError(`could not play: ${(e as Error).name}`); });
    return () => { off(); a.pause(); };
  }
}

const within = <T>(p: Promise<T>, ms: number) => new Promise<T>((res, rej) => {
  const t = setTimeout(() => rej(new Error(`no audio after ${ms / 1000} s`)), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

interface Req {
  engine: Engine; stream: boolean; key: string;
  body: { text: string; engine: Engine; voice: string; style?: string; model?: string; stream?: boolean; locale?: string };
}

/**
 * Betty's voice from Google (api/speak.ts), with backups for every line: a Gemini line that fails or is slow is
 * asked of Chirp (same voice), and anything Chirp cannot do is said by the phone voice (no signal, not set up, a
 * clip that will not play). onDone is ALWAYS called, as with WebSpeaker. Audio is fetched as soon as a line is
 * written (prefetch), so a line waiting its turn is ready when it comes up, and repeated lines are kept.
 * Streamed lines (stream mode, P4) play through Web Audio as the bytes arrive (PcmPlayer).
 */
export class CloudSpeaker implements Speaker {
  private cache = new Map<string, Promise<Blob>>();
  private pcm = new Map<string, PcmClip>();
  /** Lines whose audio just failed: not tried again on that engine */
  private failed = new Set<string>();
  /** Engines that said no for the rest of this ride: not set up (503), or out of quota (429) */
  private unavailable = new Set<Engine>();
  private token = 0;
  private stopPlay: (() => void) | null = null;

  constructor(
    private fallback: Speaker,
    private player: () => CloudPlayer,
    private log: (msg: string) => void = () => {},
    private fetcher: typeof fetch = (...a) => fetch(...a),
    private url = '/api/speak',
    private keep = 40,
    /** Plays streamed audio; without one, nothing is streamed */
    private pcmPlayer: PcmPlayer | null = null,
  ) {}

  private build(engine: Engine, text: string, tag?: SpeakTag): Req {
    const priority = tag?.priority ?? 4;
    const gemini = engine === 'gemini';
    const stream = gemini && streams(CONFIG.cloudVoice, priority) && !!this.pcmPlayer?.ready;
    const body = {
      text, engine, voice: CONFIG.cloudVoiceName,
      ...(gemini ? { style: voiceStyle(tag?.id, priority), model: CONFIG.geminiModel } : { locale: CONFIG.chirpLocale }),
      ...(stream ? { stream: true } : {}),
    };
    return { engine, stream, key: JSON.stringify(body), body };
  }

  /**
   * The request for a line. A Gemini line that cannot be had (out of quota, not set up, or this clip failed) is
   * asked of Chirp instead: same voice, plainer tone, still better than the phone. (The free Gemini tier allowed
   * 10 lines a day, 2026-10-16.)
   */
  private request(text: string, tag?: SpeakTag, force?: Engine): Req | null {
    let engine = force ?? engineFor(CONFIG.cloudVoice, tag?.priority ?? 4);
    if (!engine || !text.trim()) return null;
    if (engine === 'gemini' && (this.unavailable.has('gemini') || this.failed.has(this.build('gemini', text, tag).key))) engine = 'chirp';
    if (this.unavailable.has(engine)) return null;
    return this.build(engine, text, tag);
  }

  private async post(r: Req): Promise<Response> {
    const res = await this.fetcher(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
    if (!res.ok) {
      const why: any = await res.json().catch(() => ({}));
      // Not set up, or out of quota: say it once, then stop asking that engine this ride.
      if (res.status === 503 || (res.status === 502 && /HTTP 429/.test(why?.error ?? ''))) {
        if (!this.unavailable.has(r.engine)) this.log(`cloud voice (${r.engine}) unavailable for this ride: ${why?.error ?? res.status}`);
        this.unavailable.add(r.engine);
      }
      throw new Error(why?.error || `HTTP ${res.status}`);
    }
    return res;
  }

  private get(r: Req): Promise<Blob> {
    let p = this.cache.get(r.key);
    if (!p) {
      p = this.post(r).then((res) => res.blob());
      p.catch(() => { this.cache.delete(r.key); this.failed.add(r.key); }); // not kept: next ride may have signal
      this.cache.set(r.key, p);
      while (this.cache.size > this.keep) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  /** Starts (or finds) a streamed clip: the bytes are collected as they arrive, ready to play from the start. */
  private getStream(r: Req): PcmClip {
    let clip = this.pcm.get(r.key);
    if (!clip) {
      const c = new PcmClip();
      clip = c;
      this.pcm.set(r.key, c);
      while (this.pcm.size > this.keep) this.pcm.delete(this.pcm.keys().next().value!);
      void (async () => {
        try {
          const res = await this.post(r);
          const reader = res.body?.getReader();
          if (!reader) { c.push(new Uint8Array(await res.arrayBuffer())); c.finish(); return; }
          for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) c.push(value); }
          c.finish();
        } catch (e) {
          c.fail((e as Error).message);
          this.pcm.delete(r.key); this.failed.add(r.key);
        }
      })();
    }
    return clip;
  }

  /** Start fetching a line's audio now, while it waits its turn. */
  prefetch(text: string, tag?: SpeakTag) {
    const r = this.request(text, tag);
    if (!r || this.failed.has(r.key)) return;
    if (r.stream) this.getStream(r); else this.get(r).catch(() => {});
  }

  /**
   * Resolves once the line's audio is in (or has failed, or after READY_MS). Her unprompted lines wait on this
   * before they are queued, so a slow Gemini clip never holds the queue up while he waits for an answer.
   */
  ready(text: string, tag?: SpeakTag): Promise<void> {
    const r = this.request(text, tag);
    if (!r || r.stream || this.failed.has(r.key)) return Promise.resolve();
    // If Gemini fails, wait for the Chirp version instead (request() now picks Chirp for this line).
    return within(this.get(r), READY_MS).then(() => {}, () => (r.engine === 'gemini' && this.failed.has(r.key) ? this.ready(text, tag) : undefined));
  }

  speak(text: string, onDone: () => void, tag?: SpeakTag) { this.say(text, onDone, tag); }

  private say(text: string, onDone: () => void, tag?: SpeakTag, force?: Engine) {
    const r = this.request(text, tag, force);
    if (!r || this.failed.has(r.key)) {
      if (r?.engine === 'gemini' && !force) { this.say(text, onDone, tag, 'chirp'); return; }
      this.fallback.speak(text, onDone, tag); return;
    }
    const my = ++this.token;
    let finished = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let noAudio: ReturnType<typeof setTimeout> | undefined;
    const done = () => { if (finished) return; finished = true; clearTimeout(deadline); clearTimeout(noAudio); onDone(); };
    const giveUp = (why: string) => {
      if (my !== this.token || finished) return;
      this.stopPlay?.(); this.stopPlay = null; clearTimeout(deadline); clearTimeout(noAudio);
      if (r.engine === 'gemini') {
        this.log(`cloud voice (gemini): ${why}; said with Chirp`);
        this.say(text, done, tag, 'chirp');
        return;
      }
      this.log(`cloud voice (${r.engine}): ${why}; said with the phone voice`);
      this.fallback.speak(text, done, tag);
    };
    // A clip that never reports its end must not hold up every later line.
    const armDeadline = () => {
      deadline = setTimeout(() => { this.log(`cloud voice (${r.engine}): the clip never finished`); this.stopPlay?.(); done(); }, 8000 + text.split(/\s+/).length * 600);
    };

    if (r.stream && this.pcmPlayer) {
      const clip = this.getStream(r);
      if (!clip.chunks.length) {
        noAudio = setTimeout(() => { if (!clip.chunks.length) { this.failed.add(r.key); giveUp(`no audio after ${STREAM_WAIT_MS / 1000} s`); } }, STREAM_WAIT_MS);
      }
      armDeadline();
      this.stopPlay = this.pcmPlayer.play(clip, done, giveUp);
      return;
    }

    within(this.get(r), WAIT_MS[r.engine]).then((blob) => {
      if (my !== this.token || finished) return;
      const url = URL.createObjectURL(blob);
      armDeadline();
      this.stopPlay = this.player().play(url, () => { URL.revokeObjectURL(url); done(); }, (why) => { URL.revokeObjectURL(url); giveUp(why); });
    }, (e) => giveUp((e as Error).message));
  }

  stop() {
    this.token++;
    this.stopPlay?.(); this.stopPlay = null;
    this.fallback.stop();
  }
}
