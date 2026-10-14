import { button, checkbox, el } from './dom';

/**
 * VOICE TEST panel (stage 0 of voice input). Answers three questions on the real bike before any voice feature is
 * built: which headset buttons reach the page, whether a button press can open the mic, and what the helmet mic
 * sounds like at speed. Everything it finds also goes into the saved log, so a ride can be shared and read later.
 */

/** Browser pieces the test uses, passed in so the smoke test can stand in for them. */
export interface VoiceDeps {
  mediaSession: MediaSession | undefined;
  getUserMedia: ((c: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
  makeRecorder: ((s: MediaStream, mimeType: string) => MediaRecorder) | undefined;
  recorderType: () => string;
  makeAudio: () => HTMLAudioElement;
  makeAudioContext: (() => AudioContext) | undefined;
  objectUrl: (b: Blob) => string;
}

export function browserVoiceDeps(): VoiceDeps {
  const nav = window.navigator;
  const MR = (window as any).MediaRecorder as typeof MediaRecorder | undefined;
  const AC = ((window as any).AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  return {
    mediaSession: 'mediaSession' in nav ? nav.mediaSession : undefined,
    getUserMedia: nav.mediaDevices?.getUserMedia ? (c) => nav.mediaDevices.getUserMedia(c) : undefined,
    makeRecorder: MR ? (s, mimeType) => new MR(s, mimeType ? { mimeType } : undefined) : undefined,
    recorderType: () => (MR?.isTypeSupported?.('audio/mp4') ? 'audio/mp4' : MR?.isTypeSupported?.('audio/webm') ? 'audio/webm' : ''),
    makeAudio: () => new Audio(),
    makeAudioContext: AC ? () => new AC() : undefined,
    objectUrl: (b) => URL.createObjectURL(b),
  };
}

export interface VoiceTestContext {
  /** Current speed, if a ride is running, to label recordings */
  speed(): number | null;
  /** Write a finding into the saved ride log */
  log(msg: string): void;
}

const BUTTONS: MediaSessionAction[] = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'stop'];
const BUTTON_NAMES: Partial<Record<MediaSessionAction, string>> = {
  play: 'play', pause: 'pause', previoustrack: 'previous track', nexttrack: 'next track',
  seekbackward: 'skip back', seekforward: 'skip forward', stop: 'stop',
};

/**
 * One second of near-silent audio as a WAV file. Playing it on a loop makes the page the phone's "now playing" app,
 * which is the only way a web page receives headset button presses. A faint dither is used rather than pure silence
 * in case the phone ignores an all-zero track.
 */
export function quietWav(seconds = 1, rate = 8000): Blob {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i % 2 ? 1 : -1, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/** Loudest moment of a recording in dBFS (0 = clipping), from the analyser's peak sample level. */
export const toDb = (peak: number) => (peak > 0 ? Math.round(20 * Math.log10(peak)) : -Infinity);

export function mountVoiceTestPanel(root: HTMLElement, ctx: VoiceTestContext, deps: VoiceDeps = browserVoiceDeps()) {
  root.innerHTML = '';
  const wrap = el('details', 'panel');
  wrap.append(el('summary', '', 'VOICE TEST (headset buttons and helmet mic)'));
  const say = (msg: string) => { ctx.log(msg); };

  // ---- 1. buttons
  wrap.append(el('h3', '', '1. Which headset buttons reach Betty'));
  wrap.append(el('p', 'hint', 'Tap Start, then press each button on the headset or helmet comms. Each press that gets through is listed here. Siri\'s long press will not show up: iPhone keeps that one.'));
  const heard = el('div', 'info', 'Not listening yet.');
  const counts = new Map<string, number>();
  const pressLog = el('div', 'presslog');
  const micOnPress = checkbox('Also try to open the mic when a button is pressed (test 2)', false, () => {});
  let audio: HTMLAudioElement | null = null;
  let listening = false;
  const showCounts = () => {
    heard.textContent = counts.size
      ? `Heard: ${[...counts].map(([k, n]) => `${k} x${n}`).join(', ')}`
      : listening ? 'Listening. Press the headset buttons now.' : 'Not listening yet.';
  };
  const onButton = (action: MediaSessionAction) => {
    const name = BUTTON_NAMES[action] ?? action;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    pressLog.prepend(el('div', '', `${new Date().toTimeString().slice(0, 8)}  ${name}`));
    showCounts();
    say(`[voice test] headset button reached the page: ${name}`);
    if (audio?.paused) void audio.play().catch(() => {}); // a pause press must not end the test
    if (micOnPress.cb.checked) void record(3, `opened by the ${name} button`);
  };
  const startBtn = button('Start listening for buttons', async () => {
    if (listening) {
      listening = false;
      audio?.pause();
      for (const a of BUTTONS) { try { deps.mediaSession?.setActionHandler(a, null); } catch { /* not supported */ } }
      startBtn.textContent = 'Start listening for buttons';
      showCounts();
      say(`[voice test] button test stopped. ${heard.textContent}`);
      return;
    }
    if (!deps.mediaSession) { heard.textContent = 'This browser cannot receive headset buttons at all (no Media Session).'; say('[voice test] no Media Session support'); return; }
    audio = deps.makeAudio();
    audio.src = deps.objectUrl(quietWav());
    audio.loop = true;
    try { await audio.play(); } catch (e) { say(`[voice test] could not start the silent track: ${(e as Error).name}`); }
    try {
      const MM = (window as any).MediaMetadata;
      if (MM) deps.mediaSession.metadata = new MM({ title: 'Betty: button test', artist: 'Betty' });
    } catch { /* cosmetic */ }
    const supported: string[] = [];
    for (const a of BUTTONS) {
      try { deps.mediaSession.setActionHandler(a, () => onButton(a)); supported.push(BUTTON_NAMES[a] ?? a); } catch { /* not supported */ }
    }
    listening = true;
    startBtn.textContent = 'Stop listening';
    showCounts();
    say(`[voice test] listening for headset buttons (page accepts: ${supported.join(', ')})`);
  });
  wrap.append(startBtn, micOnPress.wrap, heard, pressLog);

  // ---- 2 and 3. mic recordings
  wrap.append(el('h3', '', '2 and 3. Helmet mic: record and play back'));
  wrap.append(el('p', 'hint', 'Record 5 seconds while talking normally at a standstill, at 60 and at 100 km/h. Each recording is labelled with the speed and which mic was used. Play them back when you stop.'));
  const status = el('div', 'info', '');
  const meter = el('div', 'meter'); const bar = el('div', 'meterbar'); meter.append(bar);
  const recs = el('div', 'recs');
  let busy = false;

  async function record(seconds: number, why = 'tapped on screen') {
    if (busy) return;
    if (!deps.getUserMedia || !deps.makeRecorder) {
      status.textContent = 'This browser cannot record from the mic.'; say('[voice test] no mic recording support'); return;
    }
    busy = true;
    let stream: MediaStream;
    try {
      stream = await deps.getUserMedia({ audio: true });
    } catch (e) {
      busy = false;
      const msg = `mic did not open (${why}): ${(e as Error).name}`;
      status.textContent = msg; say(`[voice test] ${msg}`);
      return;
    }
    const mic = stream.getAudioTracks()[0]?.label || 'unknown mic';
    const speed = ctx.speed();
    status.textContent = `Recording ${seconds} s from "${mic}"...`;
    let peak = 0;
    let ac: AudioContext | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    try {
      if (deps.makeAudioContext) {
        ac = deps.makeAudioContext();
        const an = ac.createAnalyser(); an.fftSize = 1024;
        ac.createMediaStreamSource(stream).connect(an);
        const data = new Float32Array(an.fftSize);
        poll = setInterval(() => {
          an.getFloatTimeDomainData(data);
          let p = 0; for (const x of data) p = Math.max(p, Math.abs(x));
          peak = Math.max(peak, p);
          bar.style.width = `${Math.min(100, Math.round(p * 100))}%`;
        }, 100);
      }
    } catch { /* level meter is a nicety */ }
    const type = deps.recorderType();
    const rec = deps.makeRecorder(stream, type);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const done = new Promise<void>((res) => { rec.onstop = () => res(); });
    rec.start();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    rec.stop();
    await done;
    if (poll) clearInterval(poll);
    void ac?.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop()); // releases the mic so the headset leaves call mode
    bar.style.width = '0%';
    busy = false;

    const blob = new Blob(chunks, { type: type || chunks[0]?.type || 'audio/mp4' });
    const db = toDb(peak);
    const label = `${new Date().toTimeString().slice(0, 5)} · ${speed == null ? 'no ride running' : `${Math.round(speed)} km/h`} · ${mic} · loudest ${Number.isFinite(db) ? db + ' dB' : 'not measured'} · ${why}`;
    const url = deps.objectUrl(blob);
    const row = el('div', 'rec');
    const player = el('audio'); player.controls = true; player.src = url;
    const save = el('a', 'ghost', 'Save'); save.href = url; save.download = `betty-mic-${Date.now()}.${type.includes('webm') ? 'webm' : 'm4a'}`;
    row.append(el('div', 'meta', label), player, save);
    recs.prepend(row);
    status.textContent = `Recorded ${(blob.size / 1024).toFixed(0)} KB.`;
    say(`[voice test] recording: ${label}, ${(blob.size / 1024).toFixed(0)} KB`);
  }

  wrap.append(button('Record 5 seconds', () => void record(5)), status, meter, recs);
  root.append(wrap);
  return { record, onButton };
}
