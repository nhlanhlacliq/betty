import { Platform } from 'react-native';
import { kv } from '../../../src/adapters/kv';
import { CONFIG } from '../../../src/config/betty';
import { ble, poweredOn, whenRestored } from './BleObdTransport';
import { notifyBikeOn } from './Notify';

/**
 * "Your bike is on, tap to ride" (owner, 2026-10-27: auto start, not auto end). A standing Bluetooth connection request
 * for his reader: iOS keeps it at almost no battery cost and wakes Betty (or relaunches her in the background, state
 * restoration) when the reader powers up with the bike. Then one local notification; a tap starts the ride. Not after a
 * ride just ended (CONFIG.autoStart.quietMin), and only once the reader had been away CONFIG.autoStart.awayMin, so a stop
 * for coffee is not "the bike is on". Does not work after he swipes Betty away in the app switcher (iOS rule) or before
 * the first unlock after a restart. UNVERIFIED ON THE BIKE: whether the Vgate sleeps and wakes with the bike.
 */
const KEY = 'betty.watch.v1';
type Saved = { goneAt?: number; rideEndedAt?: number; notifiedAt?: number };
const load = (): Saved => { try { return JSON.parse(kv.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
const save = (p: Saved) => { try { kv.setItem(KEY, JSON.stringify({ ...load(), ...p })); } catch { /* ignore */ } };

export class EngineWatch {
  private armed: string | null = null;
  private connected = false;
  constructor(private log: (m: string) => void, private riding: () => boolean, private readerName: () => string) {
    whenRestored((list) => { const d = this.armed && list.find((x) => x.id === this.armed); if (d) void this.seen(d.id); });
  }

  /** Wait for this reader (Bluetooth LE ids only). Safe to call again. */
  arm(id: string) {
    if (!CONFIG.autoStart.notify || id.startsWith('classic:') || this.armed === id) return;
    this.armed = id;
    void this.wait(id);
  }

  /** Let go of the reader (a ride or the Engine data page is about to use it). */
  async release() {
    const id = this.armed;
    this.armed = null;
    if (id && this.connected) { this.connected = false; await ble().cancelDeviceConnection(id).catch(() => {}); }
  }

  /** A ride has just ended: no "bike on" for a while (the bike is still on). */
  rideEnded() { save({ rideEndedAt: Date.now() }); }

  private async wait(id: string) {
    try {
      await poweredOn(15_000);
      // No timeout: iOS waits as long as it takes; Android needs autoConnect for the same.
      await ble().connectToDevice(id, Platform.OS === 'android' ? { autoConnect: true } : undefined);
      if (this.armed !== id) { await ble().cancelDeviceConnection(id).catch(() => {}); return; }
      await this.seen(id);
    } catch (e) {
      if (this.armed !== id) return;
      this.log(`bike watch: ${(e as Error).message}; trying again in a minute`);
      setTimeout(() => { if (this.armed === id) void this.wait(id); }, 60_000);
    }
  }

  private async seen(id: string) {
    this.connected = true;
    const sub = ble().onDeviceDisconnected(id, () => {
      sub.remove(); this.connected = false;
      if (this.armed !== id) return;
      save({ goneAt: Date.now() }); // the bike went off (or out of range)
      void this.wait(id);
    });
    const s = load(), now = Date.now(), c = CONFIG.autoStart;
    const away = s.goneAt === undefined || now - s.goneAt >= c.awayMin * 60_000;
    const quiet = [s.rideEndedAt, s.notifiedAt].some((t) => t !== undefined && now - t < c.quietMin * 60_000);
    if (this.riding() || !away || quiet) { this.log(`bike watch: reader seen, no notification (${this.riding() ? 'riding' : !away ? 'it was only away a moment' : 'a ride just ended'})`); return; }
    save({ notifiedAt: now });
    this.log('bike watch: reader awake, "tap to ride" sent');
    await notifyBikeOn(this.readerName()).catch((e) => this.log(`bike watch: notification failed: ${(e as Error).message}`));
  }
}
