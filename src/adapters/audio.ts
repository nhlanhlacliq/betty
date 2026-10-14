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
