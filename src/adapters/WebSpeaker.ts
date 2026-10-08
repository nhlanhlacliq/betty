import { Speaker } from '../core/AudioQueue';

/** The slice of speechSynthesis this needs, so the recovery logic can be tested with a fake. */
export interface Synth {
  speaking: boolean;
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  resume(): void;
}
export interface SpeakerTimings {
  /** No sign of the line starting after this long = the engine swallowed it */
  startMs: number;
  /** Allowance per word, plus baseMs, before a line that never reports its end is written off */
  perWordMs: number;
  baseMs: number;
}
const DEFAULT_TIMINGS: SpeakerTimings = { startMs: 3000, perWordMs: 450, baseMs: 5000 };

/**
 * Browser TTS. Audio routes over the phone's Bluetooth to the helmet comms like any media.
 *
 * Mobile speech engines fail quietly: a line can be swallowed without ever starting, or play and never report its
 * end. Either one used to leave the queue waiting forever, so every later line was logged but never spoken.
 * Every line therefore gets one retry if it does not start, and a deadline after which it is written off, so
 * onDone is ALWAYS called and the next line can go.
 */
export class WebSpeaker implements Speaker {
  /** Call synchronously inside a tap handler: iOS only allows speech after a user gesture. */
  static prime() {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  private token = 0;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  /** Held on purpose: some browsers drop the events of an utterance that has been garbage-collected. */
  private current: SpeechSynthesisUtterance | null = null;

  constructor(
    private onProblem: (msg: string) => void = () => {},
    private synth: Synth | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null,
    private make: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text),
    private timings: SpeakerTimings = DEFAULT_TIMINGS,
  ) {}

  speak(text: string, onDone: () => void) {
    if (!this.synth) { onDone(); return; }
    this.clearTimers();
    this.attempt(text, onDone, ++this.token, false);
  }

  stop() {
    this.token++; // anything still in flight is now stale and must not call onDone
    this.clearTimers();
    this.current = null;
    this.synth?.cancel();
  }

  private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

  private attempt(text: string, onDone: () => void, token: number, isRetry: boolean) {
    const synth = this.synth!;
    let started = false;
    let over = false; // this attempt has been settled one way or another
    const live = () => !over && token === this.token;
    const finish = (problem?: string) => {
      if (!live()) return;
      over = true;
      this.clearTimers();
      this.current = null;
      if (problem) this.onProblem(problem);
      onDone();
    };
    const retryOrGiveUp = (why: string) => {
      if (!live()) return;
      if (isRetry) { synth.cancel(); finish(`speech failed twice (${why}), line skipped`); return; }
      over = true;
      this.clearTimers();
      this.onProblem(`speech did not start (${why}), retrying`);
      synth.cancel();
      this.attempt(text, onDone, token, true);
    };

    const u = this.make(text);
    u.lang = 'en-ZA';
    u.rate = 1.0;
    u.onstart = () => { started = true; };
    u.onend = () => finish();
    u.onerror = (e) => {
      const kind = (e as SpeechSynthesisErrorEvent)?.error ?? 'error';
      if (started || kind === 'interrupted' || kind === 'canceled') finish(); else retryOrGiveUp(kind);
    };
    this.current = u;

    synth.resume(); // an engine left paused (after the tab was hidden) accepts lines and plays nothing
    synth.speak(u);

    const words = text.trim().split(/\s+/).length;
    this.timers.push(
      setTimeout(() => { if (live() && !started && !synth.speaking) retryOrGiveUp('no start'); }, this.timings.startMs),
      setTimeout(() => {
        if (!live()) return;
        synth.cancel();
        finish('speech never reported finishing, moving on');
      }, this.timings.baseMs + words * this.timings.perWordMs),
    );
  }
}
