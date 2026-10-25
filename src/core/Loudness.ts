/**
 * Louder voice (owner, ride of 2026-10-17: "The volume isn't loud. I can't hear it over the wind noise."). A page cannot
 * play an audio element above 100%, and Gemini's clips already peak at full scale (measured: peak 0 dB, RMS -16.6 dB),
 * so plain gain would clip. Instead: gain, then a peak limiter (instant attack, short release) that holds the peaks
 * under the ceiling, so the speech gets louder on average without crackling. Chirp is boosted by Google
 * (volumeGainDb) instead. Pure, so it is tested.
 */

export const MAX_BOOST_DB = 16;
export const dbToGain = (db: number) => Math.pow(10, Math.max(0, Math.min(MAX_BOOST_DB, db)) / 20);

/** Gain plus a peak limiter, keeping its state from one chunk to the next (streamed audio comes in pieces). */
export class Limiter {
  private env = 0;
  private readonly release: number;
  constructor(private gain: number, rate = 24000, private ceiling = 0.92, releaseMs = 60) {
    this.release = Math.exp(-1 / ((rate * releaseMs) / 1000));
  }
  /** Floats in -1..1, changed in place. */
  process(f: Float32Array): Float32Array {
    if (this.gain === 1) return f;
    for (let i = 0; i < f.length; i++) {
      const y = f[i] * this.gain;
      const a = Math.abs(y);
      this.env = a > this.env ? a : this.env * this.release + a * (1 - this.release);
      const out = this.env > this.ceiling ? y * (this.ceiling / this.env) : y;
      f[i] = out > 1 ? 1 : out < -1 ? -1 : out;
    }
    return f;
  }
}

/**
 * A 16-bit PCM WAV, louder. Anything that is not one (another format, a broken header) comes back unchanged, so a
 * clip always plays.
 */
export function boostWav(bytes: Uint8Array, db: number): Uint8Array {
  const gain = dbToGain(db);
  if (gain === 1 || bytes.length < 44) return bytes;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return bytes;
  let at = 12, rate = 24000, bits = 0, format = 0;
  while (at + 8 <= bytes.length) {
    const id = tag(at), size = v.getUint32(at + 4, true);
    if (id === 'fmt ') { format = v.getUint16(at + 8, true); rate = v.getUint32(at + 12, true); bits = v.getUint16(at + 22, true); }
    if (id === 'data') {
      if (format !== 1 || bits !== 16) return bytes;
      const start = at + 8, n = Math.min(size, bytes.length - start) >> 1;
      const out = bytes.slice();
      const o = new DataView(out.buffer, out.byteOffset, out.byteLength);
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = v.getInt16(start + i * 2, true) / 32768;
      new Limiter(gain, rate).process(f);
      for (let i = 0; i < n; i++) o.setInt16(start + i * 2, Math.round(Math.max(-1, Math.min(1, f[i])) * 32767), true);
      return out;
    }
    at += 8 + size + (size & 1);
  }
  return bytes;
}

/**
 * Louder at speed (owner, ride of 2026-10-25: "struggling to hear her at higher speeds even though it was on 16 dB",
 * "not too loud at lower speeds"). His loudness setting is her voice in town; from 40 km/h up the extra rises to its
 * full amount at 120 km/h (wind noise in a helmet climbs steeply with speed). The share also drives the native voice
 * chain (more presence and compression) and, past ~90 km/h, pausing his music for her lines instead of dipping it.
 */
export const SPEED_QUIET_KMH = 40;
export const SPEED_LOUD_KMH = 120;
export const speedShare = (kmh: number) => Math.max(0, Math.min(1, (kmh - SPEED_QUIET_KMH) / (SPEED_LOUD_KMH - SPEED_QUIET_KMH)));
/** Coming down from speed eases off by this much a second (a red light or a GPS dip is not a quiet road yet). */
export const SPEED_FALL_KMH_S = 6;
/** Music paused for her above this share (about 90 km/h), dipped again below the lower one (about 75 km/h). */
const PAUSE_ON = 0.6, PAUSE_OFF = 0.4;

export interface SpeedVoiceOut { gainDb: number; share: number; pauseMusic: boolean }

/** His speed -> her loudness: up at once (wind arrives fast), down slowly. */
export class SpeedVoice {
  private kmh = 0;
  private at: number | null = null;
  private paused = false;
  constructor(private now: () => number = Date.now) {}
  update(kmh: number, o: { baseDb: number; extraDb: number; pauseMusic: boolean }): SpeedVoiceOut {
    const t = this.now();
    const fall = this.at === null ? Infinity : SPEED_FALL_KMH_S * Math.max(0, (t - this.at) / 1000);
    this.kmh = kmh >= this.kmh ? kmh : Math.max(kmh, this.kmh - fall);
    this.at = t;
    const share = speedShare(this.kmh);
    this.paused = o.pauseMusic && (this.paused ? share > PAUSE_OFF : share >= PAUSE_ON);
    return { gainDb: Math.round((o.baseDb + o.extraDb * share) * 2) / 2, share: Math.round(share * 20) / 20, pauseMusic: this.paused };
  }
}
