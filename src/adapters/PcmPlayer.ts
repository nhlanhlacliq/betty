/**
 * Streamed Gemini audio (raw 16-bit little-endian PCM, 24 kHz, mono) as it arrives, so she starts talking about
 * 2 to 3 s after asking instead of 5 to 6 s. A PcmClip collects the bytes (it can start downloading before its turn,
 * and be played again later); PcmPlayer plays one through Web Audio, scheduling small buffers back to back.
 *
 * RISK (2026-10-16, owner accepted): this is a second sound source next to the headset buttons' silent track. On
 * iPhone it might take the buttons away. Switch "Cloud voice" back to the non-streamed option if presses stop.
 */
export class PcmClip {
  chunks: Uint8Array[] = [];
  done = false;
  error: string | null = null;
  private listeners = new Set<() => void>();
  readonly rate = 24000;

  push(b: Uint8Array) { if (b.length) { this.chunks.push(b); this.emit(); } }
  finish() { this.done = true; this.emit(); }
  fail(why: string) { this.error = why; this.done = true; this.emit(); }
  /** Subscribe to new data, the end, or a failure. Returns an unsubscribe. */
  on(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private emit() { this.listeners.forEach((f) => f()); }
  get bytes() { return this.chunks.reduce((n, c) => n + c.length, 0); }
}

/** Little-endian 16-bit PCM to floats. An odd trailing byte is returned for the next call. */
export function pcmToFloat(bytes: Uint8Array): { samples: Float32Array; rest: Uint8Array } {
  const n = bytes.length >> 1;
  const samples = new Float32Array(n);
  const v = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) samples[i] = v.getInt16(i * 2, true) / 32768;
  return { samples, rest: bytes.slice(n * 2) };
}

/** Play at least this much at a time (0.15 s): the deltas are about 27 ms each, too small to schedule one by one. */
const MIN_BYTES = 7200;
/** Wait for this much before starting (0.3 s), so a slow network does not stutter the first words. */
const LEAD_BYTES = 14400;

export class PcmPlayer {
  private ctx: AudioContext | null = null;

  /** Call inside a tap: iPhone only lets a page start Web Audio from one. */
  prime() {
    try {
      const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx ??= new AC();
      const ctx = this.ctx!;
      void ctx.resume();
      const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start();
    } catch { this.ctx = null; }
  }

  get ready() { return this.ctx !== null; }

  /** Plays the clip as its bytes arrive. Returns a function that stops it. */
  play(clip: PcmClip, onEnded: () => void, onError: (why: string) => void): () => void {
    const ctx = this.ctx;
    if (!ctx) { onError('no Web Audio'); return () => {}; }
    void ctx.resume();
    let idx = 0; let carry = new Uint8Array(0); let next = 0; let started = false; let stopped = false; let live = 0;
    const sources = new Set<AudioBufferSourceNode>();
    const finishIfDone = () => { if (!stopped && clip.done && idx >= clip.chunks.length && live === 0) { stop(); onEnded(); } };
    const schedule = (bytes: Uint8Array) => {
      const { samples, rest } = pcmToFloat(bytes);
      carry = rest;
      if (!samples.length) return;
      const buf = ctx.createBuffer(1, samples.length, clip.rate);
      buf.getChannelData(0).set(samples);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      // Running dry (slow network) leaves a short gap rather than overlapping or skipping.
      if (next < ctx.currentTime + 0.02) next = ctx.currentTime + 0.05;
      src.start(next); next += buf.duration; live++; sources.add(src);
      src.onended = () => { live--; sources.delete(src); finishIfDone(); };
    };
    const pump = () => {
      if (stopped) return;
      if (clip.error && !started) { stop(); onError(clip.error); return; }
      if (clip.done && !started && clip.bytes === 0) { stop(); onError('the stream had no audio'); return; }
      const waiting = clip.chunks.slice(idx).reduce((n, c) => n + c.length, 0) + carry.length;
      if (!started && waiting < LEAD_BYTES && !clip.done) return;
      if (waiting >= MIN_BYTES || (clip.done && waiting > 0)) {
        const parts = [carry, ...clip.chunks.slice(idx)]; idx = clip.chunks.length;
        const all = new Uint8Array(waiting); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        started = true;
        schedule(all);
      }
      finishIfDone();
    };
    const off = clip.on(pump);
    const stop = () => {
      if (stopped) return; stopped = true; off();
      sources.forEach((s) => { try { s.onended = null; s.stop(); } catch { /* already stopped */ } });
      sources.clear();
    };
    pump();
    return stop;
  }
}
