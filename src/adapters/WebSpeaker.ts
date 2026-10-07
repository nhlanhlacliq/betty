import { Speaker } from '../core/AudioQueue';

/** Browser TTS. Audio routes over the phone's Bluetooth to the helmet comms like any media. */
export class WebSpeaker implements Speaker {
  /** Call synchronously inside a tap handler: iOS only allows speech after a user gesture. */
  static prime() {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  speak(text: string, onDone: () => void) {
    if (!('speechSynthesis' in window)) { onDone(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-ZA';
    u.rate = 1.0;
    let finished = false;
    const done = () => { if (!finished) { finished = true; onDone(); } };
    u.onend = done; u.onerror = done;
    window.speechSynthesis.speak(u);
  }
  stop() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
}
