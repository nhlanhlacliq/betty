import { BikeState, createDefaultBikeState } from '../models/BikeState';
import {
  OBD2Adapter,
  GPSAdapter,
  IMUAdapter,
  TPMSAdapter,
} from '../adapters/interfaces';
import { WeatherAPIClient } from '../adapters/WeatherAPIClient';
import { TrafficAPIClient } from '../adapters/TrafficAPIClient';

type StateChangeCallback = (state: BikeState) => void;

const OBD2_POLL_INTERVAL_MS = 1000; // 1 Hz

/**
 * L3 — StateAggregator
 *
 * Merges data streams from all L2 adapters into a single BikeState.
 * Notifies subscribers whenever state changes.
 */
export class StateAggregator {
  private state: BikeState = createDefaultBikeState();
  private callbacks: Set<StateChangeCallback> = new Set();
  private obd2PollTimer: ReturnType<typeof setInterval> | null = null;
  private weatherTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(
    private obd2: OBD2Adapter,
    private gps: GPSAdapter,
    private imu: IMUAdapter,
    private tpms: TPMSAdapter,
    private weather: WeatherAPIClient,
    private traffic: TrafficAPIClient,
  ) {}

  async start(): Promise<void> {
    // OBD2 — polled at 1 Hz
    await this.obd2.connect();
    this.obd2PollTimer = setInterval(async () => {
      const data = await this.obd2.poll();
      this.merge(data);
    }, OBD2_POLL_INTERVAL_MS);

    // GPS — event-driven via subscription
    await this.gps.start();
    this.unsubscribers.push(
      this.gps.subscribe((data) => this.merge(data)),
    );

    // IMU — high-frequency event-driven
    this.imu.start();
    this.unsubscribers.push(
      this.imu.subscribe((data) => this.merge(data)),
    );

    // TPMS — slow event-driven
    await this.tpms.startScan();
    this.unsubscribers.push(
      this.tpms.subscribe((data) => this.merge(data)),
    );

    // Weather & Traffic — polled, rate-limited inside the clients
    const fetchExternal = async () => {
      const { gpsLat, gpsLon } = this.state;
      const [weatherData, trafficData] = await Promise.all([
        this.weather.fetch(gpsLat, gpsLon),
        this.traffic.fetch(gpsLat, gpsLon),
      ]);
      this.merge({ ...weatherData, ...trafficData });
    };

    await fetchExternal();
    this.weatherTimer = setInterval(fetchExternal, 60_000); // re-check every minute (clients self-throttle)

    console.log('[StateAggregator] All adapters started');
  }

  stop(): void {
    if (this.obd2PollTimer) clearInterval(this.obd2PollTimer);
    if (this.weatherTimer) clearInterval(this.weatherTimer);
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
    this.gps.stop();
    this.imu.stop();
    this.tpms.stopScan();
    this.obd2.disconnect();
    console.log('[StateAggregator] Stopped');
  }

  getState(): BikeState {
    return { ...this.state };
  }

  subscribe(callback: StateChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  private merge(partial: Partial<BikeState>): void {
    this.state = {
      ...this.state,
      ...partial,
      timestamp: Date.now(),
    };
    this.callbacks.forEach((cb) => cb(this.getState()));
  }
}
