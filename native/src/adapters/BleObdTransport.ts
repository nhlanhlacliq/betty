import { BleManager, type Characteristic, type Device, type Subscription } from 'react-native-ble-plx';
import { CONFIG } from '../../../src/config/betty';
import type { ObdTransport } from '../../../src/core/Elm327';

/**
 * An ELM327 reader over Bluetooth LE (the owner's Vgate iCar Pro BLE, 2026-10-27; iPhone AND Android), with
 * react-native-ble-plx. The reader is a serial line inside BLE: one characteristic we write commands to, one that
 * notifies us of the answer text, ending in the ">" prompt. Which characteristics differ by reader brand, so they are
 * found by what they can do (notify / write), not by a fixed list; the choice is logged.
 * Values travel base64 in ble-plx.
 */
let manager: BleManager | null = null;
let restored: Device[] = [];
let onRestore: ((d: Device[]) => void) | null = null;
/**
 * One Bluetooth manager for the app, with iOS state restoration: when iOS relaunches Betty in the background because
 * the reader connected (EngineWatch's standing request), the connected reader comes back here.
 */
export const ble = () => (manager ??= new BleManager({
  restoreStateIdentifier: 'betty-obd',
  restoreStateFunction: (st) => { restored = (st?.connectedPeripherals ?? []) as Device[]; onRestore?.(restored); },
}));
/** Readers iOS handed back on a background relaunch (now and later). */
export function whenRestored(f: (d: Device[]) => void) { onRestore = f; if (restored.length) f(restored); }
/** Bluetooth's own services (generic access/attribute, device info, battery): never the reader's serial line. */
const STANDARD = /^0000(1800|1801|180a|180f)-/i;

export interface FoundReader { id: string; name: string; rssi: number | null }

export async function poweredOn(timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const s = await ble().state();
    if (s === 'PoweredOn') return;
    if (s === 'Unauthorized') throw new Error('Bluetooth is not allowed for Betty (Settings > Betty > Bluetooth)');
    if (s === 'Unsupported') throw new Error('this phone has no Bluetooth LE');
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Bluetooth is off');
}

const enc = (t: string) => btoa(t);
const dec = (b64: string) => { try { return atob(b64); } catch { return ''; } };

export class BleObdTransport implements ObdTransport {
  private device: Device | null = null;
  private writeChar: Characteristic | null = null;
  private sub: Subscription | null = null;
  private gone: Subscription | null = null;
  private buffer = '';
  private waiting: ((answer: string) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  /** Set when the reader drops (the ride carries on without engine data) */
  lost = false;
  /** The reader's serial-line service, once connected (EngineWatch listens for it while the reader sleeps) */
  serviceUUID: string | null = null;

  constructor(private log: (msg: string) => void = () => {}) {}

  /** Readers nearby for `seconds`: the ones whose name looks like an OBD reader (CONFIG.obd.readerNames), else every
   *  named device (a reader with an odd name), strongest signal first. */
  static async scan(seconds = 6): Promise<FoundReader[]> {
    await poweredOn();
    const seen = new Map<string, FoundReader>();
    await ble().startDeviceScan(null, { allowDuplicates: false }, (err, d) => {
      if (err || !d) return;
      const name = d.localName ?? d.name;
      if (name) seen.set(d.id, { id: d.id, name, rssi: d.rssi ?? null });
    });
    await new Promise((r) => setTimeout(r, seconds * 1000));
    await ble().stopDeviceScan();
    const all = [...seen.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    const re = new RegExp(CONFIG.obd.readerNames, 'i');
    const obd = all.filter((r) => re.test(r.name));
    return obd.length ? obd : all;
  }

  async connect(id: string): Promise<void> {
    this.sub?.remove(); this.gone?.remove(); // connecting again after the reader was lost
    await poweredOn();
    const d = await ble().connectToDevice(id, { timeout: 10_000 });
    await d.discoverAllServicesAndCharacteristics();
    // The serial line: a service of the reader's own with a notify and a write characteristic (one may do both).
    let pick: { notify: Characteristic; write: Characteristic } | null = null;
    for (const svc of await d.services()) {
      if (STANDARD.test(svc.uuid)) continue;
      const chars = await svc.characteristics();
      const notify = chars.find((c) => c.isNotifiable || c.isIndicatable);
      const write = chars.find((c) => c.isWritableWithoutResponse) ?? chars.find((c) => c.isWritableWithResponse);
      if (notify && write) { pick = { notify, write }; break; }
    }
    if (!pick) { await d.cancelConnection().catch(() => {}); throw new Error('no serial line found on this device (not an OBD reader?)'); }
    this.log(`reader serial line: service ${pick.notify.serviceUUID}, answers on ${pick.notify.uuid}, commands to ${pick.write.uuid}`);
    this.device = d; this.writeChar = pick.write; this.lost = false; this.serviceUUID = pick.notify.serviceUUID;
    this.sub = pick.notify.monitor((err, ch) => {
      if (err) return;
      this.buffer += dec(ch?.value ?? '');
      if (this.buffer.includes('>') && this.waiting) { const w = this.waiting; this.waiting = null; const a = this.buffer; this.buffer = ''; w(a); }
    });
    this.gone = ble().onDeviceDisconnected(id, () => { this.lost = true; this.log('reader disconnected'); this.waiting?.('NO DATA'); this.waiting = null; });
  }

  /** One command, its answer (up to ">"), one at a time; "NO DATA" when nothing comes back in time. */
  send(command: string, timeoutMs = command === 'ATZ' ? 5000 : 3000): Promise<string> {
    const run = async (): Promise<string> => {
      const d = this.device, w = this.writeChar;
      if (!d || !w || this.lost) throw new Error('not connected');
      this.buffer = '';
      const answer = new Promise<string>((resolve) => {
        const timer = setTimeout(() => { this.waiting = null; resolve('NO DATA'); }, timeoutMs);
        this.waiting = (a) => { clearTimeout(timer); resolve(a); };
      });
      // BLE writes are small (20 bytes on older readers): a command goes in pieces, the reader waits for the "\r".
      const bytes = `${command}\r`;
      for (let i = 0; i < bytes.length; i += 20) {
        const part = enc(bytes.slice(i, i + 20));
        if (w.isWritableWithoutResponse) await d.writeCharacteristicWithoutResponseForService(w.serviceUUID, w.uuid, part);
        else await d.writeCharacteristicWithResponseForService(w.serviceUUID, w.uuid, part);
      }
      return answer;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  /**
   * Listen to the bus (the probe): ATMA makes the reader print every frame it sees until any character is sent. Collects
   * for `ms`, then stops it with a carriage return and waits for the prompt. Sends nothing to the bike.
   */
  monitor(ms: number): Promise<string> {
    const run = async (): Promise<string> => {
      const d = this.device, w = this.writeChar;
      if (!d || !w || this.lost) throw new Error('not connected');
      const write = (t: string) => (w.isWritableWithoutResponse ? d.writeCharacteristicWithoutResponseForService(w.serviceUUID, w.uuid, enc(t)) : d.writeCharacteristicWithResponseForService(w.serviceUUID, w.uuid, enc(t)));
      this.buffer = ''; this.waiting = null;
      await write('ATMA\r');
      await new Promise((r) => setTimeout(r, ms));
      const text = this.buffer;
      const done = new Promise<string>((resolve) => {
        const timer = setTimeout(() => { this.waiting = null; resolve(''); }, 3000);
        this.waiting = (a) => { clearTimeout(timer); resolve(a); };
        if (this.buffer.includes('>')) { const a = this.buffer; this.buffer = ''; this.waiting = null; clearTimeout(timer); resolve(a); }
      });
      this.buffer = '';
      await write('\r');
      const tail = await done;
      return text + tail;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  async close() {
    this.sub?.remove(); this.gone?.remove();
    try { await this.device?.cancelConnection(); } catch { /* already gone */ }
    this.device = null; this.writeChar = null;
  }
}
