import * as Speech from 'expo-speech';
import type { Speaker } from '../../../src/core/AudioQueue';

/**
 * The phone's own voice (expo-speech). Like WebSpeaker it ALWAYS calls onDone, also when the engine never reports
 * the end, so a lost callback cannot jam the queue (CLAUDE.md behaviour rule). Cloud voices (Chirp/Gemini) come later.
 */
export class ExpoSpeaker implements Speaker {
  private gen = 0;
  constructor(private onProblem: (msg: string) => void = () => {}) {}

  speak(text: string, onDone: () => void) {
    const my = ++this.gen;
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(deadline); onDone(); };
    // Written off after a deadline from its length: about 15 characters a second plus 4 s.
    const deadline = setTimeout(() => { if (my === this.gen) this.onProblem(`no end after ${text.length} chars, moving on`); finish(); }, 4000 + text.length * 70);
    Speech.speak(text, {
      language: 'en-ZA',
      onDone: finish, onStopped: finish,
      onError: (e) => { this.onProblem(`speech error: ${String((e as any)?.message ?? e)}`); finish(); },
    });
  }
  stop() { this.gen++; void Speech.stop(); }
}
