import * as Speech from 'expo-speech';
import { lineEnd, lineStart } from './AudioFocus';
import type { SpeakTag, Speaker } from '../../../src/core/AudioQueue';
import { voiceTags } from '../../../src/core/ClaudeClient';

/** Kept here for the callers that set the audio up through the speaker (see AudioFocus). */
export { setUpAudio } from './AudioFocus';

/**
 * The phone's own voice (expo-speech). Like WebSpeaker it ALWAYS calls onDone, also when the engine never reports
 * the end, so a lost callback cannot jam the queue (CLAUDE.md behaviour rule). Cloud voices (Chirp/Gemini) come later.
 */
export class ExpoSpeaker implements Speaker {
  private gen = 0;
  constructor(private onProblem: (msg: string) => void = () => {}) {}

  speak(text: string, onDone: () => void, tag?: SpeakTag) {
    const my = ++this.gen;
    let done = false;
    lineStart(); // his music ducks while she speaks
    const finish = () => { if (done) return; done = true; clearTimeout(deadline); lineEnd(); onDone(); };
    // Written off after a deadline from its length: about 15 characters a second plus 4 s.
    const deadline = setTimeout(() => { if (my === this.gen) this.onProblem(`no end after ${text.length} chars, moving on`); finish(); }, 4000 + text.length * 70);
    // <laugh>, <short pause> and the like are for Gemini only: the phone voice would read them out.
    Speech.speak(voiceTags(text, false), {
      language: 'en-ZA',
      onStart: () => tag?.heard?.(),
      onDone: finish, onStopped: finish,
      onError: (e) => { this.onProblem(`speech error: ${String((e as any)?.message ?? e)}`); finish(); },
    });
  }
  stop() { this.gen++; void Speech.stop(); }
}
