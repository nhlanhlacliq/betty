import { TTSEngine } from './interfaces';

let SpeechModule: typeof import('expo-speech') | null = null;

async function getSpeech() {
  if (!SpeechModule) {
    SpeechModule = await import('expo-speech');
  }
  return SpeechModule;
}

/**
 * Phase 1 — Text-to-speech using expo-speech.
 * Audio routes through Bluetooth if a device is connected.
 */
export class ExpoSpeechTTS implements TTSEngine {
  private speaking = false;

  async speak(text: string): Promise<void> {
    const Speech = await getSpeech();

    return new Promise((resolve, reject) => {
      this.speaking = true;
      Speech.speak(text, {
        language: 'en-ZA',  // South African English accent
        rate: 0.95,
        pitch: 1.0,
        onDone: () => {
          this.speaking = false;
          resolve();
        },
        onError: (error) => {
          this.speaking = false;
          reject(error);
        },
        onStopped: () => {
          this.speaking = false;
          resolve();
        },
      });
    });
  }

  stop(): void {
    getSpeech().then((Speech) => Speech.stop());
    this.speaking = false;
  }

  isSpeaking(): boolean {
    return this.speaking;
  }
}
