/**
 * Decides when a push-to-talk recording is over, from the mic level sampled every ~100 ms (peak 0..1).
 * It waits until he has actually started speaking, then stops after a pause. Wind in a helmet may never drop to
 * true silence, so the caller also enforces a maximum length and a second press always stops it.
 */
export class SilenceDetector {
  private spokeAt: number | null = null;
  private quietSince: number | null = null;
  private startedAt: number | null = null;

  constructor(
    private speech = 0.12,
    private quiet = 0.05,
    private pauseMs = 1200,
    /** Give up if he says nothing at all for this long */
    private noSpeechMs = 4000,
  ) {}

  /** Returns true when the recording should stop. */
  update(level: number, now: number): boolean {
    this.startedAt ??= now;
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
