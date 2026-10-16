import { SilenceDetector } from '../core/SilenceDetector';

export interface PttDeps {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  makeRecorder: (s: MediaStream, mimeType: string) => MediaRecorder;
  recorderType: () => string;
  /** Mic level 0..1 every ~100 ms, or null if the browser cannot measure it */
  meter: (s: MediaStream, onLevel: (level: number) => void) => (() => void) | null;
  /** Microphones the phone offers, to find the helmet's by name */
  listInputs: () => Promise<Array<{ deviceId: string; label: string }>>;
}

/** The phone's own mic, as iPhone and Android name it. Anything else connected is taken to be the helmet. */
const BUILT_IN = /\biphone\b|\bipad\b|built-?in|^default\b|handset|^phone\b/i;

/** Rejects if the promise has not settled in ms: a phone's mic or recorder can simply never answer. */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${what} did not answer in ${ms / 1000} s`)), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

/**
 * Which mic to open: the one he picked (by id, or by name, since ids can change between visits), else a connected
 * headset, else the phone's choice. On 2026-10-16 "phone's choice" recorded from the iPhone with the helmet connected.
 */
export function chooseMic(inputs: Array<{ deviceId: string; label: string }>, wantId: string, wantLabel: string): string {
  const byId = wantId && inputs.find((d) => d.deviceId === wantId);
  if (byId) return byId.deviceId;
  const byLabel = wantLabel && inputs.find((d) => d.label === wantLabel);
  if (byLabel) return byLabel.deviceId;
  const headset = inputs.find((d) => d.label && !BUILT_IN.test(d.label));
  return headset?.deviceId ?? '';
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
    listInputs: async () => {
      const all = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
      return all.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
    },
  };
}

export interface Clip { audio: Blob; ms: number; heardSpeech: boolean; mic: string; /** loudest level, dBFS */ peakDb: number | null; /** the recorder did not stop cleanly */ stalled: boolean }

/**
 * Records one question: stops after a pause in his speech, on a second press, or at the maximum length.
 *
 * The mic is closed straight after each question. Keeping it open between questions (tried 2026-10-16) left the
 * iPhone's orange mic dot on and the helmet in call mode, where its button sends call controls instead of
 * play/pause, so no second press ever reached Betty (owner's observation). release() also runs at END RIDE.
 */
export class PushToTalk {
  private stopNow: (() => void) | null = null;
  private stream: MediaStream | null = null;
  private streamFor = '';

  constructor(
    private deps: PttDeps,
    private wanted: () => { id: string; label: string; raw?: boolean },
    private maxMs = 8000,
    private now: () => number = Date.now,
  ) {}

  get listening() { return this.stopNow !== null; }
  /** Second press: finish now. */
  stop() { this.stopNow?.(); }
  /** Close the mic (END RIDE), so the headset leaves call mode. */
  release() { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; }

  private async open(): Promise<MediaStream> {
    const want = this.wanted();
    let id = want.id;
    try { id = chooseMic(await within(this.deps.listInputs(), 3000, 'the mic list'), want.id, want.label); } catch { /* cannot list: use the id */ }
    const plain = want.raw ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : {};
    const live = this.stream?.getAudioTracks().some((t) => (t as any).readyState !== 'ended');
    if (this.stream && live && this.streamFor === id) return this.stream;
    this.release();
    try {
      const audio = { ...(id ? { deviceId: { exact: id } } : {}), ...plain };
      this.stream = await within(this.deps.getUserMedia({ audio: Object.keys(audio).length ? audio : true }), 6000, 'the mic');
    } catch (e) {
      if (!id) throw e;
      this.stream = await within(this.deps.getUserMedia({ audio: want.raw ? plain : true }), 6000, 'the mic'); // that mic has gone: take the phone's choice
    }
    this.streamFor = id;
    return this.stream;
  }

  async record(): Promise<Clip> {
    const stream = await this.open();
    const mic = stream.getAudioTracks()[0]?.label || 'unknown mic';
    const type = this.deps.recorderType();
    const rec = this.deps.makeRecorder(stream, type);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const t0 = this.now();
    const silence = new SilenceDetector();
    let measured = false;
    let stalled = false;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return; done = true; clearTimeout(cap); stopMeter?.();
        // If the recorder never reports that it stopped, carry on with what it gave: a hung recorder once froze her.
        const late = setTimeout(() => { stalled = true; resolve(); }, 2000);
        rec.onstop = () => { clearTimeout(late); resolve(); };
        try { rec.stop(); } catch { clearTimeout(late); stalled = true; resolve(); }
      };
      this.stopNow = finish;
      const cap = setTimeout(finish, this.maxMs);
      const stopMeter = this.deps.meter(stream, (level) => { measured = true; if (silence.update(level, this.now())) finish(); });
      try { rec.start(); } catch { stalled = true; finish(); }
    });
    this.stopNow = null;
    this.release(); // orange dot off, helmet out of call mode: the next press can reach Betty
    return {
      audio: new Blob(chunks, { type: type || chunks[0]?.type || 'audio/mp4' }),
      ms: this.now() - t0,
      heardSpeech: measured ? silence.heardSpeech : true, // unmeasured: let the transcriber decide
      mic,
      stalled,
      peakDb: measured && silence.peak > 0 ? Math.round(20 * Math.log10(silence.peak)) : null,
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
