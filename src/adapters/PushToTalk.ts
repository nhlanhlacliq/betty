import { SilenceDetector } from '../core/SilenceDetector';

export interface PttDeps {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  makeRecorder: (s: MediaStream, mimeType: string) => MediaRecorder;
  recorderType: () => string;
  /** Mic level 0..1 every ~100 ms, or null if the browser cannot measure it */
  meter: (s: MediaStream, onLevel: (level: number) => void) => (() => void) | null;
}

export function browserPttDeps(): PttDeps {
  const MR = (window as any).MediaRecorder as typeof MediaRecorder;
  const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    makeRecorder: (s, mimeType) => new MR(s, mimeType ? { mimeType } : undefined),
    recorderType: () => (MR?.isTypeSupported?.('audio/mp4') ? 'audio/mp4' : MR?.isTypeSupported?.('audio/webm') ? 'audio/webm' : ''),
    meter: (s, onLevel) => {
      if (!AC) return null;
      const ac: AudioContext = new AC();
      const an = ac.createAnalyser(); an.fftSize = 1024;
      ac.createMediaStreamSource(s).connect(an);
      const data = new Float32Array(an.fftSize);
      const t = setInterval(() => {
        an.getFloatTimeDomainData(data);
        let p = 0; for (const x of data) p = Math.max(p, Math.abs(x));
        onLevel(p);
      }, 100);
      return () => { clearInterval(t); void ac.close().catch(() => {}); };
    },
  };
}

export interface Clip { audio: Blob; ms: number; heardSpeech: boolean; mic: string }

/**
 * Records one question: opens the chosen mic, stops after a pause in his speech, on a second press, or at the
 * maximum length, then closes the mic straight away so the headset leaves call mode.
 */
export class PushToTalk {
  private stopNow: (() => void) | null = null;

  constructor(private deps: PttDeps, private deviceId: () => string, private maxMs = 8000, private now: () => number = Date.now) {}

  get listening() { return this.stopNow !== null; }
  /** Second press: finish now. */
  stop() { this.stopNow?.(); }

  async record(): Promise<Clip> {
    const id = this.deviceId();
    const stream = await this.deps.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
    const mic = stream.getAudioTracks()[0]?.label || 'unknown mic';
    const type = this.deps.recorderType();
    const rec = this.deps.makeRecorder(stream, type);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const t0 = this.now();
    const silence = new SilenceDetector();
    let measured = false;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(cap); stopMeter?.(); rec.onstop = () => resolve(); rec.stop(); };
      this.stopNow = finish;
      const cap = setTimeout(finish, this.maxMs);
      const stopMeter = this.deps.meter(stream, (level) => { measured = true; if (silence.update(level, this.now())) finish(); });
      rec.start();
    });
    this.stopNow = null;
    stream.getTracks().forEach((t) => t.stop());
    return {
      audio: new Blob(chunks, { type: type || chunks[0]?.type || 'audio/mp4' }),
      ms: this.now() - t0,
      heardSpeech: measured ? silence.heardSpeech : true, // unmeasured: let the transcriber decide
      mic,
    };
  }
}

/** Sends a clip to Betty's server for transcription. Returns the words, or throws with a reason. */
export async function transcribe(clip: Blob, url = '/api/transcribe'): Promise<string> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': clip.type || 'audio/mp4' }, body: clip });
  const out: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
  return String(out?.text ?? '').trim();
}
