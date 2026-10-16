/**
 * Decides when a push-to-talk recording is over, from the mic level sampled every ~100 ms (peak 0..1).
 * It waits until he has actually started speaking, then stops after a pause. Wind in a helmet may never drop to
 * true silence, so the caller also enforces a maximum length and a second press always stops it.
 *
 * The thresholds follow the background level heard in the first half second: the helmet mic ("V6") peaked
 * anywhere from -55 to -1 dB on the 2026-10-14 rides, and a fixed speech level of 0.12 (-18 dB) would have
 * missed him talking at -26 dB. 2026-10-16: a first question peaking at -31 dB counted as nothing, and the helmet
 * takes a moment to switch to its mic, so speech now starts at -32 dB (0.025) and it waits 5 s before giving up.
 */
export class SilenceDetector {
  private spokeAt: number | null = null;
  private quietSince: number | null = null;
  private startedAt: number | null = null;
  private floor = Infinity;
  /** Loudest level heard, for the log */
  peak = 0;

  constructor(
    /** Lowest level that counts as speech, however quiet the background */
    private speechMin = 0.025,
    /** Highest level that counts as a pause, however quiet the background */
    private quietMin = 0.02,
    private pauseMs = 1200,
    /** Give up if he says nothing at all for this long */
    private noSpeechMs = 5000,
    /** How long the background is measured for at the start */
    private floorMs = 500,
  ) {}

  private get speech() { return Math.min(0.15, Math.max(this.speechMin, this.floor * 3)); }
  private get quiet() { return Math.min(this.speech * 0.8, Math.max(this.quietMin, this.floor * 1.6)); }

  /** Returns true when the recording should stop. */
  update(level: number, now: number): boolean {
    this.startedAt ??= now;
    this.peak = Math.max(this.peak, level);
    if (this.spokeAt === null && now - this.startedAt <= this.floorMs) this.floor = Math.min(this.floor, level);
    if (level >= this.speech) { this.spokeAt = now; this.quietSince = null; return false; }
    if (this.spokeAt === null) return now - this.startedAt >= this.noSpeechMs;
    if (level <= this.quiet) {
      this.quietSince ??= now;
      return now - this.quietSince >= this.pauseMs;
    }
    this.quietSince = null; // in between: still talking, quietly
    return false;
  }

  get heardSpeech() { return this.spokeAt !== null; }
}
