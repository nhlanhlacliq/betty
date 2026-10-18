import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';
import type { ObdTransport } from '../../../src/core/Elm327';

/**
 * An ELM327 over Bluetooth CLASSIC (serial, SPP): Android only. iPhone apps cannot open classic serial links to
 * accessories outside Apple's MFi programme, so an iPhone needs a BLE or Wi-Fi reader (a different transport).
 * The reader must be paired in Android's Bluetooth settings first (PIN 1234 or 0000).
 * UNVERIFIED on the owner's reader and on React Native 0.88 (the library is a legacy native module).
 */
export class ElmClassicTransport implements ObdTransport {
  private device: BluetoothDevice | null = null;
  private buffer = '';
  private waiting: ((answer: string) => void) | null = null;
  private sub?: { remove(): void };

  /** Readers paired with the phone whose name looks like an OBD reader (all paired devices when none does). */
  static async paired(): Promise<{ name: string; address: string }[]> {
    if (!(await RNBluetoothClassic.isBluetoothEnabled())) await RNBluetoothClassic.requestBluetoothEnabled();
    const all = await RNBluetoothClassic.getBondedDevices();
    const obd = all.filter((d) => /obd|elm|v-?link|scan/i.test(d.name ?? ''));
    return (obd.length ? obd : all).map((d) => ({ name: d.name, address: d.address }));
  }

  async connect(address: string): Promise<void> {
    // The reader ends every answer with its ">" prompt, so that is the message delimiter.
    this.device = await RNBluetoothClassic.connectToDevice(address, { delimiter: '>' });
    this.sub = this.device.onDataReceived((ev) => {
      this.buffer += String(ev.data);
      const w = this.waiting;
      if (w) { this.waiting = null; const a = this.buffer; this.buffer = ''; w(a); }
    });
  }

  send(command: string, timeoutMs = 3000): Promise<string> {
    const d = this.device;
    if (!d) return Promise.reject(new Error('not connected'));
    this.buffer = '';
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting = null; resolve('NO DATA'); }, command === 'ATZ' ? 5000 : timeoutMs);
      this.waiting = (a) => { clearTimeout(timer); resolve(a); };
      void d.write(`${command}\r`);
    });
  }

  async close() { this.sub?.remove(); try { await this.device?.disconnect(); } catch { /* already gone */ } this.device = null; }
}
