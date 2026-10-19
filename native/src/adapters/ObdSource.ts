import { ElmOptions, ElmSession, ObdTransport } from '../../../src/core/Elm327';
import { NO_OBD } from '../../../src/core/StateAggregator';
import type { BikeState, DataSource } from '../../../src/core/types';

/** Real OBD2 through an ELM327: set the reader up, then a round of readings every `everyMs`. */
export class ObdSource implements DataSource {
  private running = false;
  /** Defaults from the reader test on the owner's G 310 GS (2026-10-19): CAN 11-bit 500k, ~1 s answer timeout. */
  constructor(private transport: ObdTransport & { close(): Promise<void> }, private log: (msg: string) => void, private everyMs = 1000,
    private options: ElmOptions = { protocol: '6', timeout: 'FF' }) {}

  async start(onUpdate: (p: Partial<BikeState>) => void) {
    const session = new ElmSession(this.transport, this.log, this.options);
    let lastVolt = 0;
    this.running = true;
    try { await session.init(); } catch (e) { this.log(`reader setup failed: ${(e as Error).message}`); return; }
    while (this.running) {
      const t0 = Date.now();
      try {
        const { state, voltage } = await session.poll();
        if (this.running && Object.keys(state).length) onUpdate(state);
        // Battery/charging voltage: logged when it moves by 0.3 V (12.5 engine off, ~14.3 charging on the G 310 GS).
        if (voltage != null && Math.abs(voltage - lastVolt) >= 0.3) { lastVolt = voltage; this.log(`battery ${voltage} V`); }
        // Engine not running yet (the bike's ECU is silent until it is): ask again every 3 s, not every second.
        if (!session.supported.length) await new Promise((r) => setTimeout(r, 2000));
      } catch (e) { this.log(`reading failed: ${(e as Error).message}`); }
      await new Promise((r) => setTimeout(r, Math.max(0, this.everyMs - (Date.now() - t0))));
    }
    onUpdate(NO_OBD);
  }
  stop() { this.running = false; void this.transport.close(); }
}
