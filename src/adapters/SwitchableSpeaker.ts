import { Speaker } from '../core/AudioQueue';

/** Wraps a real speaker. When silent, it simulates speech duration so queue behaviour stays observable. */
export class SwitchableSpeaker implements Speaker {
  aloud = true;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private real: Speaker) {}

  speak(text: string, onDone: () => void) {
    if (this.aloud) { this.real.speak(text, onDone); return; }
    const ms = Math.max(1200, text.split(/\s+/).length * 350);
    this.timer = setTimeout(onDone, ms);
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.real.stop(); }
}
