import { CONFIG, CloudVoiceMode, VOICE_STYLES } from '../config/betty';
import { SpeakTag, Speaker } from '../core/AudioQueue';
import { quietWav } from './audio';

export type Engine = 'chirp' | 'gemini';

/**
 * Which Google engine says a line. Measured 2026-10-16: Chirp about 1 s a line, Gemini 5 to 7 s (the lite model no
 * faster). So in the mixed mode Gemini only says her own unprompted lines (P3: banter, tour guide, time checks),
 * which nobody is waiting for; alerts and answers to him get Chirp.
 */
export function engineFor(mode: CloudVoiceMode, priority: number): Engine | null {
  if (mode === 'off') return null;
  if (mode === 'mixed') return priority === 3 ? 'gemini' : 'chirp';
  return mode;
}

/** How long speak() waits for the audio before saying the line with the phone voice instead. */
export const WAIT_MS: Record<Engine, number> = { chirp: 3500, gemini: 5000 }; // live from SA: Chirp about 2 s round trip
/** How long an unprompted line may wait for its Gemini audio BEFORE it is queued (see ready()). */
export const READY_MS = 12_000;

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

interface Req { engine: Engine; key: string; body: { text: string; engine: Engine; voice: string; style?: string } }

/**
 * Betty's voice from Google (api/speak.ts), with the phone voice as the backup for every line: no signal, a slow
 * reply (WAIT_MS), an engine that is not set up, or a clip that will not play. onDone is ALWAYS called, as with
 * WebSpeaker. Clips are fetched as soon as a line is written (prefetch), so a line waiting its turn is ready when
 * it comes up, and repeated lines ("Hang on, let me check") are kept.
 */
export class CloudSpeaker implements Speaker {
  private cache = new Map<string, Promise<Blob>>();
  /** Lines whose audio just failed: said straight away with the phone voice rather than tried again */
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
  ) {}

  private build(engine: Engine, text: string, tag?: SpeakTag): Req {
    const style = engine === 'gemini' ? ((tag?.priority ?? 4) <= 2 ? VOICE_STYLES.alert : VOICE_STYLES[tag?.id ?? ''] ?? VOICE_STYLES.voice) : undefined;
    const body = { text, engine, voice: CONFIG.cloudVoiceName, ...(style ? { style } : {}) };
    return { engine, key: JSON.stringify(body), body };
  }

  /**
   * The request for a line. A Gemini line that cannot be had (out of quota, not set up, or this clip failed) is
   * asked of Chirp instead: same voice, plainer tone, still better than the phone. The free Gemini tier turned out
   * to allow 10 lines a day (2026-10-16).
   */
  private request(text: string, tag?: SpeakTag): Req | null {
    let engine = engineFor(CONFIG.cloudVoice, tag?.priority ?? 4);
    if (!engine || !text.trim()) return null;
    if (engine === 'gemini' && (this.unavailable.has('gemini') || this.failed.has(this.build('gemini', text, tag).key))) engine = 'chirp';
    if (this.unavailable.has(engine)) return null;
    return this.build(engine, text, tag);
  }

  private get(r: Req): Promise<Blob> {
    let p = this.cache.get(r.key);
    if (!p) {
      p = (async () => {
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
        return res.blob();
      })();
      p.catch(() => { this.cache.delete(r.key); this.failed.add(r.key); }); // not kept: next ride may have signal
      this.cache.set(r.key, p);
      while (this.cache.size > this.keep) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  /** Start fetching a line's audio now, while it waits its turn. */
  prefetch(text: string, tag?: SpeakTag) {
    const r = this.request(text, tag);
    if (r && !this.failed.has(r.key)) this.get(r).catch(() => {});
  }

  /**
   * Resolves once the line's audio is in (or has failed, or after READY_MS). Her unprompted lines wait on this
   * before they are queued, so a slow Gemini clip never holds the queue up while he waits for an answer.
   */
  ready(text: string, tag?: SpeakTag): Promise<void> {
    const r = this.request(text, tag);
    if (!r || this.failed.has(r.key)) return Promise.resolve();
    // If Gemini fails, wait for the Chirp version instead (request() now picks Chirp for this line).
    return within(this.get(r), READY_MS).then(() => {}, () => (r.engine === 'gemini' && this.failed.has(r.key) ? this.ready(text, tag) : undefined));
  }

  speak(text: string, onDone: () => void, tag?: SpeakTag) {
    const r = this.request(text, tag);
    if (!r || this.failed.has(r.key)) { this.fallback.speak(text, onDone, tag); return; }
    const my = ++this.token;
    let finished = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const done = () => { if (finished) return; finished = true; clearTimeout(deadline); onDone(); };
    const usePhone = (why: string) => {
      if (my !== this.token || finished) return;
      this.stopPlay?.(); this.stopPlay = null; clearTimeout(deadline);
      this.log(`cloud voice (${r.engine}): ${why}; said with the phone voice`);
      this.fallback.speak(text, done, tag);
    };
    within(this.get(r), WAIT_MS[r.engine]).then((blob) => {
      if (my !== this.token || finished) return;
      const url = URL.createObjectURL(blob);
      // A clip that never reports its end must not hold up every later line.
      deadline = setTimeout(() => { this.log(`cloud voice (${r.engine}): the clip never finished`); this.stopPlay?.(); done(); }, 8000 + text.split(/\s+/).length * 600);
      this.stopPlay = this.player().play(url, () => { URL.revokeObjectURL(url); done(); }, (why) => { URL.revokeObjectURL(url); usePhone(why); });
    }, (e) => usePhone((e as Error).message));
  }

  stop() {
    this.token++;
    this.stopPlay?.(); this.stopPlay = null;
    this.fallback.stop();
  }
}
