import { STTEngine } from './interfaces';

// expo doesn't ship a first-party STT module; we stub the interface here.
// Phase 1 STT uses the device's native speech recognition via a community module
// or the Web Speech API on Expo Web. This class provides the interface contract.

type ResultCallback = (text: string) => void;

/**
 * Phase 1 — Speech-to-text stub.
 *
 * In Phase 1 the rider taps a button to activate voice input.
 * A full implementation would use @react-native-voice/voice.
 * This stub allows the rest of the engine to be wired without the native module.
 */
export class ExpoSTT implements STTEngine {
  private listening = false;
  private callbacks: Set<ResultCallback> = new Set();

  async startListening(): Promise<void> {
    this.listening = true;
    console.log('[ExpoSTT] Listening started (stub — wire native module for production)');
  }

  stopListening(): void {
    this.listening = false;
    console.log('[ExpoSTT] Listening stopped');
  }

  /** Simulate an incoming voice command (for development / testing). */
  simulateQuery(text: string): void {
    this.callbacks.forEach((cb) => cb(text));
  }

  onResult(callback: ResultCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  isListening(): boolean {
    return this.listening;
  }
}
