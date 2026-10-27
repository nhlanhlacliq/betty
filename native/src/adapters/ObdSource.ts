import { ElmOptions, ElmSession, ObdTransport } from '../../../src/core/Elm327';
import { NO_OBD } from '../../../src/core/StateAggregator';
import type { BikeState, DataSource } from '../../../src/core/types';
import { CONFIG } from '../../../src/config/betty';

/** One log line of what the engine is doing (to judge a ride afterwards). */
function snapshot(s: Partial<BikeState>): string {
  const e = s.engine ?? {};
  const bits = [
    s.engineTempC != null ? `coolant ${s.engineTempC} C` : '', s.rpm != null ? `${s.rpm} rpm` : '',
    e.bikeSpeedKmh != null ? `bike speed ${e.bikeSpeedKmh} km/h` : '', s.throttlePct != null ? `throttle ${s.throttlePct}%` : '',
    e.loadPct != null ? `load ${e.loadPct}%` : '', e.batteryV != null ? `battery ${e.batteryV} V` : '', e.ecuV != null ? `ECU ${e.ecuV} V` : '',
    e.intakeC != null ? `intake ${e.intakeC} C` : '', e.ltftPct != null ? `LTFT ${e.ltftPct}%` : '', e.stftPct != null ? `STFT ${e.stftPct}%` : '',
    e.baroKpa != null ? `${e.baroKpa} kPa` : '', e.kmSinceClear != null ? `${e.kmSinceClear} km since codes cleared` : '',
    e.milOn != null ? `warning light ${e.milOn ? 'ON' : 'off'}` : '', s.dtcs ? (s.dtcs.length ? `codes ${s.dtcs.join(' ')}` : 'no codes') : '',
  ].filter(Boolean);
  return `engine: ${bits.join(', ')}`;
}

/**
 * Real OBD2 through an ELM327: set the reader up, then poll every `everyMs`; the session asks only what is due
 * (CONFIG.obd.read), so the loop can be quick. A snapshot of the engine goes in the log every CONFIG.obd.logEveryMs.
 */
export class ObdSource implements DataSource {
  private running = false;
  /** Defaults from the reader test on the owner's G 310 GS (2026-10-19): CAN 11-bit 500k, ~1 s answer timeout. */
  constructor(private transport: ObdTransport & { close(): Promise<void>; lost?: boolean }, private log: (msg: string) => void, private everyMs = 250,
    private options: ElmOptions = { protocol: '6', timeout: 'FF' }) {}

  /**
   * Returns AT ONCE: the ride starts its sensors one after another and waits for each start (StateAggregator), and
   * this one reads until the ride ends. When it awaited its own loop the ride did not start until the reader was
   * unplugged (owner, 2026-10-27). Setup and reading run in the background.
   */
  async start(onUpdate: (p: Partial<BikeState>) => void) {
    this.running = true;
    void this.run(onUpdate).catch((e) => this.log(`reader stopped: ${(e as Error).message}`));
  }

  private async run(onUpdate: (p: Partial<BikeState>) => void) {
    const session = new ElmSession(this.transport, this.log, this.options);
    let lastVolt = 0, lastLog = 0;
    let seen: Partial<BikeState> = {}; // the latest of every value, for the log line
    try { await session.init(); } catch (e) { this.log(`reader setup failed: ${(e as Error).message}`); return; }
    while (this.running && !this.transport.lost) {
      const t0 = Date.now();
      try {
        const { state, voltage } = await session.poll();
        if (this.running && Object.keys(state).length) onUpdate(state);
        seen = { ...seen, ...state };
        // The reader's voltage jumps about (ride of 2026-10-27: ~150 lines); the minute line carries it. Off by default.
        const step = CONFIG.obd.voltLogStepV;
        if (step > 0 && voltage != null && Math.abs(voltage - lastVolt) >= step) { lastVolt = voltage; this.log(`reader voltage ${voltage} V`); }
        if (session.supported.length && Date.now() - lastLog >= CONFIG.obd.logEveryMs) { lastLog = Date.now(); this.log(snapshot(seen)); }
        // Engine not running yet (the bike's ECU is silent until it is): ask again every 3 s, not every second.
        if (!session.supported.length) await new Promise((r) => setTimeout(r, 2000));
      } catch (e) { this.log(`reading failed: ${(e as Error).message}`); }
      await new Promise((r) => setTimeout(r, Math.max(0, this.everyMs - (Date.now() - t0))));
    }
    if (this.transport.lost) this.log('reader lost: engine data off for the rest of the ride');
    if (this.running) onUpdate(NO_OBD);
  }
  stop() { this.running = false; void this.transport.close(); }
}
