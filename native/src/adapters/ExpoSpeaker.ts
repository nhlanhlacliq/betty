import * as Speech from 'expo-speech';
import { setAudioModeAsync } from 'expo-audio';
import type { SpeakTag, Speaker } from '../../../src/core/AudioQueue';
import { voiceTags } from '../../../src/core/ClaudeClient';

/**
 * Her voice must play with the iPhone's silent switch on (first run, 2026-10-18: nothing was heard; the default audio
 * session obeys the switch). Mixed with his music for now; ducking it per line comes with the cloud voices.
 */
export const setUpAudio = () => setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {});

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
    const finish = () => { if (done) return; done = true; clearTimeout(deadline); onDone(); };
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
