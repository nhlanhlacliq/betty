/**
 * Ten seconds of near-silent audio as a WAV file. Playing it on a loop makes the page the phone's "now playing" app,
 * which is the only way a web page receives headset button presses. A faint dither is used rather than pure silence
 * in case the phone ignores an all-zero track. It must be at least 5 s long: Chrome on Android only takes the media
 * session (notification and headset buttons) for media of 5 s and up. The 1 s track worked on iPhone and got no
 * presses at all on Android (a friend's Cardo Packtalk Neo, 2026-10-16).
 */
export function quietWav(seconds = 10, rate = 8000): Blob {
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

/** A short tone through the phone's audio (and so the helmet): high = listening, low = done. */
export function beep(freq: number, ms = 140) {
  try {
    const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ac: AudioContext = new AC();
    const o = ac.createOscillator(); const g = ac.createGain();
    o.frequency.value = freq; g.gain.value = 0.15;
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + ms / 1000);
    o.onended = () => { void ac.close().catch(() => {}); };
  } catch { /* a missing tone is not worth failing over */ }
}

/** A short tone as a WAV file, so it can be played by the same audio element that holds the headset buttons. */
export function toneWav(freq: number, ms = 140, rate = 16000): Blob {
  const n = Math.round((ms / 1000) * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  const fade = Math.round(rate * 0.01); // 10 ms in and out, so it does not click
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 0.15 * env * 32767), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
