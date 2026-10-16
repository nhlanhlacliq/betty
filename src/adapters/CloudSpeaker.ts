import { CONFIG, CloudVoiceMode, chirpVoice, voiceStyle } from '../config/betty';
import { SpeakTag, Speaker } from '../core/AudioQueue';
import { quietWav } from './audio';
import { PcmClip, PcmPlayer } from './PcmPlayer';
import { voiceTags } from '../core/ClaudeClient';
import { ClipStore } from './ClipStore';

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
/**
 * Lines someone is waiting for are streamed: answers (P4) in the stream mode, and alerts too when Gemini says
 * everything. Her own remarks (P3) are fetched whole, ahead of time, and queued when ready.
 */
export const streams = (mode: CloudVoiceMode, priority: number) => (mode === 'stream' && priority === 4) || (mode === 'gemini' && priority !== 3);

/** How long speak() waits for the audio before saying the line with the phone voice instead. */
export const WAIT_MS: Record<Engine, number> = { chirp: 3500, gemini: 5000 }; // live from SA: Chirp about 2 s round trip
/** How long an unprompted line may wait for its Gemini audio BEFORE it is queued (see ready()). */
export const READY_MS = 12_000;
/**
 * Gemini voice on the paid Tier 1 allows 10 requests a minute: a ride start (7 stock phrases + the briefing + her
 * first remarks) hit it and got 429 (2026-10-17). Betty keeps to GEMINI_PER_MIN, and fetching stock phrases ahead
 * leaves LOW_PRIORITY_RESERVE of those free for lines he will actually hear.
 */
export const GEMINI_PER_MIN = 8;
const LOW_PRIORITY_RESERVE = 4;
class GeminiBusy extends Error {}

/** A streamed line with no audio yet after this long is said by Chirp instead. */
export const STREAM_WAIT_MS = 4500;
/** Lines she says often, made in her Gemini voice at ride start so they play at once (stream mode). */
export const STOCK_LINES = [
  'Hang on, let me check.', "I didn't hear anything. Try again?", "Sorry, I couldn't make that out. Try again?",
  "Sorry, I didn't catch that.", "I'm back.", "Noted. I'll remember that.", 'Forgotten.',
];
/** One line per voice sound, for the "Test sounds" button: [tag, line]. Kept on the phone like the stock lines. */
export const SOUND_TEST_LINES: Array<[string, string]> = [
  ['laugh', 'You took that corner like it owed you money. <laugh> Fair enough.'],
  ['chuckle', 'Forty kilometres and not one wrong turn. <chuckle> I am almost impressed.'],
  ['snicker', 'The taxi indicated. <snicker> I will believe it when I see it.'],
  ['sigh', 'Three incidents on the N3. <sigh> Of course there are.'],
  ['phew', '<phew> That rain cloud has gone the other way.'],
  ['pff', '<pff> Twelve kilometres an hour of wind. Hardly worth mentioning.'],
  ['tsk', '<tsk> Someone has parked across the yellow line again.'],
  ['yawn', 'Sixty-two on a dead straight road for twenty minutes. <yawn> Wake me at the next bend.'],
  ['throat-clearing', '<throat-clearing> Fuel range is down to forty kilometres.'],
  ['short pause', 'I have good news and bad news. <short pause> The bad news is that there is no good news.'],
];
/** Lines fetched whole (not streamed) and kept on the phone across rides. */
const KEPT = new Set([...STOCK_LINES, ...SOUND_TEST_LINES.map(([, l]) => l)]);

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
  engine: Engine; stream: boolean; key: string; /** kept on the phone across rides */ kept: boolean;
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
  /** When each Gemini request of the last minute went out, and until when Google asked us to wait */
  private geminiAt: number[] = [];
  private geminiPausedUntil = 0;
  /** Gemini models out for the day (each has its own daily limit: Lite 100 a day on Tier 1, 2026-10-17) */
  private modelsOut = new Set<string>();
  /** The Gemini model to ask: the chosen one, or the other one when the chosen one is out for the day. */
  private geminiModel(): string {
    const other = CONFIG.geminiModel === 'full' ? 'lite' : 'full';
    return this.modelsOut.has(CONFIG.geminiModel) ? other : CONFIG.geminiModel;
  }

  constructor(
    private fallback: Speaker,
    private player: () => CloudPlayer,
    private log: (msg: string) => void = () => {},
    private fetcher: typeof fetch = (...a) => fetch(...a),
    private url = '/api/speak',
    private keep = 40,
    /** Plays streamed audio; without one, nothing is streamed */
    private pcmPlayer: PcmPlayer | null = null,
    /** Told when a line's audio starts: which engine, streamed or not, and how long after speak() (for the Test button) */
    private onAudio: (engine: Engine, streamed: boolean, ms: number) => void = () => {},
    /** Keeps stock-line clips across rides */
    private store: ClipStore | null = null,
  ) {}

  private build(engine: Engine, text: string, tag?: SpeakTag): Req {
    const priority = tag?.priority ?? 4;
    const gemini = engine === 'gemini';
    const stream = gemini && streams(CONFIG.cloudVoice, priority) && !!this.pcmPlayer?.ready && !KEPT.has(text);
    // <laugh>/<sigh> are performed by Gemini only; Chirp would read them out.
    const chirp = chirpVoice();
    const body = {
      text: voiceTags(text, gemini), engine, voice: gemini ? CONFIG.cloudVoiceName : chirp.name,
      ...(gemini ? { style: voiceStyle(tag?.id, priority), model: this.geminiModel() } : { locale: chirp.locale }),
      ...(stream ? { stream: true } : {}),
    };
    return { engine, stream, kept: gemini && KEPT.has(text), key: JSON.stringify(body), body };
  }

  /**
   * The request for a line. A Gemini line that cannot be had (out of quota, not set up, or this clip failed) is
   * asked of Chirp instead: same voice, plainer tone, still better than the phone. (The free Gemini tier allowed
   * 10 lines a day, 2026-10-16.)
   */
  private request(text: string, tag?: SpeakTag, force?: Engine): Req | null {
    let engine = force ?? engineFor(CONFIG.cloudVoice, tag?.priority ?? 4);
    if (!engine || !text.trim()) return null;
    if (engine === 'gemini') {
      const g = this.build('gemini', text, tag);
      const have = this.cache.has(g.key) || this.pcm.has(g.key); // already fetched (or on its way): use it
      // Kept lines may be on the phone already, so they go ahead and check the budget only if they must be fetched.
      if (!have && (this.unavailable.has('gemini') || this.failed.has(g.key) || (!g.kept && !this.geminiRoom()))) engine = 'chirp';
    }
    if (this.unavailable.has(engine)) return null;
    return this.build(engine, text, tag);
  }

  /** Room for one more Gemini request this minute (keeping `reserve` free). */
  geminiRoom(reserve = 0): boolean {
    const now = Date.now();
    this.geminiAt = this.geminiAt.filter((t) => now - t < 60_000);
    return now >= this.geminiPausedUntil && this.geminiAt.length < GEMINI_PER_MIN - reserve;
  }

  /** Waits (up to maxMs) until Gemini has room: for the sound test, which plays ten Gemini lines in a row. */
  async whenGeminiFree(maxMs = 60_000): Promise<void> {
    const until = Date.now() + maxMs;
    while (!this.geminiRoom() && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  }

  private async post(r: Req): Promise<Response> {
    if (r.engine === 'gemini') this.geminiAt.push(Date.now());
    const res = await this.fetcher(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r.body) });
    if (!res.ok) {
      const why: any = await res.json().catch(() => ({}));
      const detail = String(why?.detail ?? '');
      const limited = res.status === 502 && /HTTP 429/.test(why?.error ?? '');
      if (limited && !/per day/i.test(detail)) {
        // A per-minute limit: wait as long as Google says, then carry on with Gemini. Chirp fills in meanwhile.
        const secs = Number(detail.match(/retry in (\d+)/i)?.[1] ?? 60);
        if (Date.now() >= this.geminiPausedUntil) this.log(`cloud voice (gemini): at its limit (${detail.match(/limit: [^)]+/)?.[0] ?? 'per minute'}); Chirp for the next ${secs} s`);
        this.geminiPausedUntil = Date.now() + secs * 1000;
      } else if (limited && r.engine === 'gemini' && r.body.model && !this.modelsOut.has(r.body.model) && this.modelsOut.size === 0) {
        // One model's daily limit: switch to the other Gemini model for the rest of the ride (it has its own).
        this.modelsOut.add(r.body.model);
        this.log(`cloud voice (gemini ${r.body.model}): out for the day (${detail.match(/limit: [^)]+/)?.[0] ?? 'per day'}); switching to ${this.geminiModel()}`);
      } else if (res.status === 503 || limited) {
        // Not set up, or out of quota for the day: say it once, then stop asking that engine this ride.
        if (!this.unavailable.has(r.engine)) this.log(`cloud voice (${r.engine}) unavailable for this ride: ${why?.error ?? res.status}${detail ? ` (${detail.slice(0, 120)})` : ''}`);
        this.unavailable.add(r.engine);
      }
      throw new Error(why?.error || `HTTP ${res.status}`);
    }
    return res;
  }

  private get(r: Req): Promise<Blob> {
    let p = this.cache.get(r.key);
    if (!p) {
      const kept = r.kept;
      p = (async () => {
        if (kept) { const hit = await this.store?.get(r.key).catch(() => null); if (hit) return hit; }
        // Fetching a stock phrase ahead must not use up the minute's Gemini budget: it is fetched when needed instead.
        if (r.engine === 'gemini' && !this.geminiRoom(kept ? LOW_PRIORITY_RESERVE : 0)) throw new GeminiBusy('Gemini busy this minute');
        const blob = await this.post(r).then((res) => res.blob());
        if (kept) void this.store?.put(r.key, blob).catch(() => {});
        return blob;
      })();
      p.catch((e) => { this.cache.delete(r.key); if (!(e instanceof GeminiBusy)) this.failed.add(r.key); }); // busy: try again later
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
      this.fallback.speak(voiceTags(text, false), onDone, tag); return;
    }
    const my = ++this.token;
    const t0 = Date.now();
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
      this.fallback.speak(voiceTags(text, false), done, tag);
    };
    // A clip that never reports its end must not hold up every later line.
    const armDeadline = () => {
      deadline = setTimeout(() => { this.log(`cloud voice (${r.engine}): the clip never finished`); this.stopPlay?.(); done(); }, 8000 + text.split(/\s+/).length * 600);
    };

    if (r.stream && this.pcmPlayer) {
      const clip = this.getStream(r);
      if (!clip.chunks.length) {
        noAudio = setTimeout(() => { if (!clip.chunks.length) { this.failed.add(r.key); giveUp(`no audio after ${STREAM_WAIT_MS / 1000} s`); } }, STREAM_WAIT_MS);
        const off = clip.on(() => { if (clip.chunks.length) { off(); if (my === this.token && !finished) this.onAudio('gemini', true, Date.now() - t0); } });
      } else this.onAudio('gemini', true, 0);
      armDeadline();
      this.stopPlay = this.pcmPlayer.play(clip, done, giveUp);
      return;
    }

    within(this.get(r), WAIT_MS[r.engine]).then((blob) => {
      if (my !== this.token || finished) return;
      this.onAudio(r.engine, false, Date.now() - t0);
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
