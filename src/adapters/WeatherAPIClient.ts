import { BikeState } from '../models/BikeState';

const BASE_URL = 'https://api.openweathermap.org/data/2.5';

/**
 * Fetches current weather conditions for a lat/lon.
 * Updates every 10 minutes — no point calling more frequently.
 */
export class WeatherAPIClient {
  private apiKey: string;
  private lastFetch = 0;
  private readonly FETCH_INTERVAL_MS = 10 * 60 * 1000; // 10 min

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetch(lat: number, lon: number): Promise<Partial<BikeState>> {
    const now = Date.now();
    if (now - this.lastFetch < this.FETCH_INTERVAL_MS) {
      return {}; // throttle: return nothing, use last known state
    }

    try {
      const url = `${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${this.apiKey}&units=metric`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const data = await response.json();
      this.lastFetch = now;

      return {
        weatherCondition: data.weather?.[0]?.main ?? 'Unknown',
        weatherTemp: Math.round(data.main?.temp ?? 20),
      };
    } catch (err) {
      console.warn('[WeatherAPI] Fetch failed, using last known data:', err);
      return {};
    }
  }
}
