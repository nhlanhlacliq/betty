import { BikeState } from '../models/BikeState';

/**
 * OBD2 adapter — reads engine/electrical telemetry.
 */
export interface OBD2Adapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  poll(): Promise<Partial<BikeState>>;
  isConnected(): boolean;
}

/**
 * GPS adapter — provides location and heading.
 */
export interface GPSAdapter {
  start(): Promise<void>;
  stop(): void;
  /** Subscribes to position updates at ~1 Hz. Returns unsubscribe fn. */
  subscribe(callback: (data: Partial<BikeState>) => void): () => void;
  getCurrentPosition(): Promise<Partial<BikeState>>;
}

/**
 * IMU adapter — accelerometer / gyroscope for lean angle and braking.
 */
export interface IMUAdapter {
  start(): void;
  stop(): void;
  /** Subscribes to IMU updates. Returns unsubscribe fn. */
  subscribe(callback: (data: Partial<BikeState>) => void): () => void;
}

/**
 * TPMS adapter — tyre pressure monitoring.
 */
export interface TPMSAdapter {
  startScan(): Promise<void>;
  stopScan(): void;
  /** Subscribes to TPMS sensor readings. Returns unsubscribe fn. */
  subscribe(callback: (data: Partial<BikeState>) => void): () => void;
}

/**
 * TTS engine — text-to-speech output.
 */
export interface TTSEngine {
  speak(text: string): Promise<void>;
  stop(): void;
  isSpeaking(): boolean;
}

/**
 * STT engine — speech-to-text input.
 */
export interface STTEngine {
  startListening(): Promise<void>;
  stopListening(): void;
  /** Fires when a recognised utterance is ready. Returns unsubscribe fn. */
  onResult(callback: (text: string) => void): () => void;
  isListening(): boolean;
}
