import { ElmSession, ObdTransport } from '../../../src/core/Elm327';
import { NO_OBD } from '../../../src/core/StateAggregator';
import type { BikeState, DataSource } from '../../../src/core/types';

/** Real OBD2 through an ELM327: set the reader up, then a round of readings every `everyMs`. */
export class ObdSource implements DataSource {
  private running = false;
  constructor(private transport: ObdTransport & { close(): Promise<void> }, private log: (msg: string) => void, private everyMs = 1000) {}

  async start(onUpdate: (p: Partial<BikeState>) => void) {
    const session = new ElmSession(this.transport, this.log);
    this.running = true;
    try { await session.init(); } catch (e) { this.log(`reader setup failed: ${(e as Error).message}`); return; }
    while (this.running) {
      const t0 = Date.now();
      try {
        const { state } = await session.poll();
        if (this.running) onUpdate(state);
      } catch (e) { this.log(`reading failed: ${(e as Error).message}`); }
      await new Promise((r) => setTimeout(r, Math.max(0, this.everyMs - (Date.now() - t0))));
    }
    onUpdate(NO_OBD);
  }
  stop() { this.running = false; void this.transport.close(); }
}
