/**
 * BettyEngine — factory that assembles all layers for Phase 1 (phone).
 *
 * Swapping adapters for Phase 4 (Raspberry Pi) means only changing
 * the imports in this file; all core logic remains unchanged.
 */
import { StateAggregator } from './core/StateAggregator';
import { TriggerEngine } from './core/TriggerEngine';
import { ClaudeAPIClient } from './core/ClaudeAPIClient';
import { AudioPriorityQueue } from './core/AudioPriorityQueue';
import { RideSessionManager } from './core/RideSessionManager';

// Phase 1 adapters
import { MockOBD2Adapter } from './adapters/MockOBD2Adapter';
import { PhoneGPSAdapter } from './adapters/PhoneGPSAdapter';
import { PhoneIMUAdapter } from './adapters/PhoneIMUAdapter';
import { MockTPMSAdapter } from './adapters/MockTPMSAdapter';
import { ExpoSpeechTTS } from './adapters/ExpoSpeechTTS';
import { ExpoSTT } from './adapters/ExpoSTT';
import { WeatherAPIClient } from './adapters/WeatherAPIClient';
import { TrafficAPIClient } from './adapters/TrafficAPIClient';

export interface BettyEngineConfig {
  anthropicApiKey: string;
  openWeatherApiKey: string;
  tomTomApiKey: string;
}

export function createBettyEngine(config: BettyEngineConfig): {
  session: RideSessionManager;
  stt: ExpoSTT;
} {
  // L2 adapters
  const obd2 = new MockOBD2Adapter();
  const gps = new PhoneGPSAdapter();
  const imu = new PhoneIMUAdapter();
  const tpms = new MockTPMSAdapter();
  const tts = new ExpoSpeechTTS();
  const stt = new ExpoSTT();
  const weather = new WeatherAPIClient(config.openWeatherApiKey);
  const traffic = new TrafficAPIClient(config.tomTomApiKey);

  // L3 aggregation
  const aggregator = new StateAggregator(obd2, gps, imu, tpms, weather, traffic);

  // L4 trigger logic
  const triggerEngine = new TriggerEngine();

  // L5 intelligence
  const claude = new ClaudeAPIClient(config.anthropicApiKey);

  // L6 audio output
  const audioQueue = new AudioPriorityQueue(tts);

  // Session orchestrator
  const session = new RideSessionManager(
    aggregator,
    triggerEngine,
    claude,
    audioQueue,
    stt,
  );

  return { session, stt };
}
