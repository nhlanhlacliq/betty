/**
 * Everything the OBD reader can read, for the Garage > Engine data page (owner, 2026-10-27: "a page that shows
 * everything the OBD reader can read ... and export it for analysis and integration planning"). Separate from a ride:
 * the ride's ElmSession reads only what Betty uses; this reads every value the bike says it supports, once (a
 * snapshot) or over and over (a recording), and keeps every command and answer so the export shows exactly what the
 * bike said. Reads only (Elm327 readOnly), like the ride.
 * Pure: the catalog is data (SAE J1979 mode 01 formulas), the scanner takes any ObdTransport and an injectable clock.
 */
import { CONFIG } from '../config/betty';
import { ELM_INIT, ElmOptions, ObdTransport, cleanLines, parseDtcs, readOnly, readStatus, readVoltage, supportedPids } from './Elm327';

export type ObdValue = number | string;
export interface PidInfo {
  /** Mode 01 PID, two hex digits */
  pid: string;
  name: string;
  /** '' for values that are words (statuses) */
  unit: string;
  /** Data bytes A, B, C... -> the value */
  decode: (b: number[]) => ObdValue;
}

const u16 = (b: number[]) => b[0] * 256 + b[1];
const s16 = (b: number[]) => { const v = u16(b); return v >= 32768 ? v - 65536 : v; };
const r = (v: number, places = 1) => Math.round(v * 10 ** places) / 10 ** places;
const pct = (b: number[]) => r((b[0] * 100) / 255);
const trim = (b: number[]) => r(((b[0] - 128) * 100) / 128);
const tempC = (b: number[]) => b[0] - 40;
const torque = (b: number[]) => b[0] - 125;
const hex = (b: number[]) => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const pick = (map: Record<number, string>) => (b: number[]) => map[b[0]] ?? `code ${b[0]}`;

const FUEL_SYSTEM: Record<number, string> = { 0: 'off', 1: 'open loop (warming up)', 2: 'closed loop (oxygen sensor)', 4: 'open loop (load or decel)', 8: 'open loop (fault)', 16: 'closed loop (fault)' };
const OBD_STANDARD: Record<number, string> = { 1: 'OBD-II (CARB)', 2: 'OBD (EPA)', 3: 'OBD and OBD-II', 4: 'OBD-I', 5: 'not OBD', 6: 'EOBD (Europe)', 7: 'EOBD and OBD-II', 8: 'EOBD and OBD', 9: 'EOBD, OBD and OBD-II', 10: 'JOBD (Japan)', 13: 'JOBD and EOBD', 17: 'EMD', 21: 'HD OBD-C', 22: 'HD OBD', 23: 'WWH OBD', 33: 'HD EOBD-I', 34: 'HD EOBD-I N', 35: 'HD EOBD-II', 36: 'HD EOBD-II N', 39: 'OBDBr-1', 40: 'OBDBr-2', 41: 'KOBD (Korea)', 42: 'IOBD I (India)', 43: 'IOBD II (India)', 44: 'HD EOBD-VI' };
const FUEL_TYPE: Record<number, string> = { 0: 'not available', 1: 'petrol', 2: 'methanol', 3: 'ethanol', 4: 'diesel', 5: 'LPG', 6: 'CNG', 7: 'propane', 8: 'electric', 9: 'bifuel petrol', 17: 'hybrid petrol', 18: 'hybrid ethanol', 19: 'hybrid diesel', 20: 'hybrid electric' };
const AIR_STATUS: Record<number, string> = { 1: 'upstream', 2: 'downstream of catalyst', 4: 'from outside or off', 8: 'pump on for diagnostics' };

/** Oxygen sensor voltage (and its short-term trim when the bike gives it) */
const o2Narrow = (pid: string, n: number): PidInfo => ({
  pid, name: `Oxygen sensor ${n} voltage`, unit: 'V', decode: (b) => r(b[0] / 200, 3),
});
const o2WideV = (pid: string, n: number): PidInfo => ({ pid, name: `Oxygen sensor ${n} (wide) lambda`, unit: 'λ', decode: (b) => r((u16(b) * 2) / 65536, 3) });
const o2WideI = (pid: string, n: number): PidInfo => ({ pid, name: `Oxygen sensor ${n} (wide) current`, unit: 'mA', decode: (b) => r((b[2] * 256 + b[3]) / 256 - 128, 2) });
const catTemp = (pid: string, name: string): PidInfo => ({ pid, name: `Catalyst temperature ${name}`, unit: 'C', decode: (b) => r(u16(b) / 10 - 40) });

/**
 * The standard mode 01 values (SAE J1979), what each is called in plain words and its formula. A bike lists which it
 * supports; any it lists that is not here is still read and shown as raw bytes. Add a row to teach the page a value.
 */
export const PID_CATALOG: PidInfo[] = [
  { pid: '01', name: 'Warning light and stored codes', unit: '', decode: (b) => `light ${b[0] & 0x80 ? 'ON' : 'off'}, ${b[0] & 0x7f} code${(b[0] & 0x7f) === 1 ? '' : 's'}` },
  { pid: '02', name: 'Code that froze the data', unit: '', decode: (b) => (u16(b) ? hex(b) : 'none') },
  { pid: '03', name: 'Fuel system', unit: '', decode: (b) => FUEL_SYSTEM[b[0]] ?? `code ${b[0]}` },
  { pid: '04', name: 'Engine load', unit: '%', decode: pct },
  { pid: '05', name: 'Coolant temperature', unit: 'C', decode: tempC },
  { pid: '06', name: 'Short-term fuel trim (bank 1)', unit: '%', decode: trim },
  { pid: '07', name: 'Long-term fuel trim (bank 1)', unit: '%', decode: trim },
  { pid: '08', name: 'Short-term fuel trim (bank 2)', unit: '%', decode: trim },
  { pid: '09', name: 'Long-term fuel trim (bank 2)', unit: '%', decode: trim },
  { pid: '0A', name: 'Fuel pressure', unit: 'kPa', decode: (b) => b[0] * 3 },
  { pid: '0B', name: 'Intake manifold pressure', unit: 'kPa', decode: (b) => b[0] },
  { pid: '0C', name: 'Engine speed', unit: 'rpm', decode: (b) => Math.round(u16(b) / 4) },
  { pid: '0D', name: 'Bike speed (wheel sensor)', unit: 'km/h', decode: (b) => b[0] },
  { pid: '0E', name: 'Ignition timing advance', unit: 'deg', decode: (b) => b[0] / 2 - 64 },
  { pid: '0F', name: 'Intake air temperature', unit: 'C', decode: tempC },
  { pid: '10', name: 'Air flow (MAF)', unit: 'g/s', decode: (b) => r(u16(b) / 100, 2) },
  { pid: '11', name: 'Throttle position', unit: '%', decode: pct },
  { pid: '12', name: 'Secondary air', unit: '', decode: pick(AIR_STATUS) },
  { pid: '13', name: 'Oxygen sensors present', unit: '', decode: (b) => `bank 1: ${[0, 1, 2, 3].filter((i) => b[0] & (1 << i)).map((i) => i + 1).join(', ') || 'none'}; bank 2: ${[4, 5, 6, 7].filter((i) => b[0] & (1 << i)).map((i) => i - 3).join(', ') || 'none'}` },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => o2Narrow((0x13 + n).toString(16).toUpperCase(), n)),
  { pid: '1C', name: 'OBD standard', unit: '', decode: pick(OBD_STANDARD) },
  { pid: '1D', name: 'Oxygen sensors present (4 banks)', unit: '', decode: hex },
  { pid: '1E', name: 'Power take-off', unit: '', decode: (b) => (b[0] & 1 ? 'active' : 'inactive') },
  { pid: '1F', name: 'Time since engine start', unit: 's', decode: u16 },
  { pid: '21', name: 'Distance with the warning light on', unit: 'km', decode: u16 },
  { pid: '22', name: 'Fuel rail pressure (to manifold)', unit: 'kPa', decode: (b) => r(u16(b) * 0.079) },
  { pid: '23', name: 'Fuel rail pressure', unit: 'kPa', decode: (b) => u16(b) * 10 },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => o2WideV((0x23 + n).toString(16).toUpperCase(), n)),
  { pid: '2C', name: 'Commanded EGR', unit: '%', decode: pct },
  { pid: '2D', name: 'EGR error', unit: '%', decode: trim },
  { pid: '2E', name: 'Commanded evaporative purge', unit: '%', decode: pct },
  { pid: '2F', name: 'Fuel level', unit: '%', decode: pct },
  { pid: '30', name: 'Warm-ups since codes cleared', unit: '', decode: (b) => b[0] },
  { pid: '31', name: 'Distance since codes cleared', unit: 'km', decode: u16 },
  { pid: '32', name: 'Evaporative system vapour pressure', unit: 'Pa', decode: (b) => s16(b) / 4 },
  { pid: '33', name: 'Barometric pressure', unit: 'kPa', decode: (b) => b[0] },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => o2WideI((0x33 + n).toString(16).toUpperCase(), n)),
  catTemp('3C', 'bank 1 sensor 1'), catTemp('3D', 'bank 2 sensor 1'), catTemp('3E', 'bank 1 sensor 2'), catTemp('3F', 'bank 2 sensor 2'),
  { pid: '41', name: 'Monitors this drive', unit: '', decode: hex },
  { pid: '42', name: 'Control module voltage', unit: 'V', decode: (b) => r(u16(b) / 1000, 3) },
  { pid: '43', name: 'Absolute load', unit: '%', decode: (b) => r((u16(b) * 100) / 255) },
  { pid: '44', name: 'Commanded air-fuel ratio', unit: 'λ', decode: (b) => r((u16(b) * 2) / 65536, 3) },
  { pid: '45', name: 'Relative throttle position', unit: '%', decode: pct },
  { pid: '46', name: 'Ambient air temperature', unit: 'C', decode: tempC },
  { pid: '47', name: 'Throttle position B', unit: '%', decode: pct },
  { pid: '48', name: 'Throttle position C', unit: '%', decode: pct },
  { pid: '49', name: 'Twist grip / pedal position D', unit: '%', decode: pct },
  { pid: '4A', name: 'Twist grip / pedal position E', unit: '%', decode: pct },
  { pid: '4B', name: 'Twist grip / pedal position F', unit: '%', decode: pct },
  { pid: '4C', name: 'Commanded throttle', unit: '%', decode: pct },
  { pid: '4D', name: 'Time run with the warning light on', unit: 'min', decode: u16 },
  { pid: '4E', name: 'Time since codes cleared', unit: 'min', decode: u16 },
  { pid: '4F', name: 'Maximum values (ratio, voltage, current, pressure)', unit: '', decode: hex },
  { pid: '50', name: 'Maximum air flow', unit: 'g/s', decode: (b) => b[0] * 10 },
  { pid: '51', name: 'Fuel type', unit: '', decode: pick(FUEL_TYPE) },
  { pid: '52', name: 'Ethanol in the fuel', unit: '%', decode: pct },
  { pid: '53', name: 'Evaporative system pressure (absolute)', unit: 'kPa', decode: (b) => r(u16(b) / 200, 2) },
  { pid: '54', name: 'Evaporative system pressure', unit: 'Pa', decode: s16 },
  { pid: '55', name: 'Short-term secondary oxygen trim (bank 1)', unit: '%', decode: trim },
  { pid: '56', name: 'Long-term secondary oxygen trim (bank 1)', unit: '%', decode: trim },
  { pid: '57', name: 'Short-term secondary oxygen trim (bank 2)', unit: '%', decode: trim },
  { pid: '58', name: 'Long-term secondary oxygen trim (bank 2)', unit: '%', decode: trim },
  { pid: '59', name: 'Fuel rail pressure (absolute)', unit: 'kPa', decode: (b) => u16(b) * 10 },
  { pid: '5A', name: 'Relative twist grip / pedal position', unit: '%', decode: pct },
  { pid: '5B', name: 'Hybrid battery left', unit: '%', decode: pct },
  { pid: '5C', name: 'Engine oil temperature', unit: 'C', decode: tempC },
  { pid: '5D', name: 'Fuel injection timing', unit: 'deg', decode: (b) => r(u16(b) / 128 - 210, 2) },
  { pid: '5E', name: 'Fuel rate', unit: 'L/h', decode: (b) => r(u16(b) / 20, 2) },
  { pid: '5F', name: 'Emission standard', unit: '', decode: hex },
  { pid: '61', name: 'Torque asked for', unit: '%', decode: torque },
  { pid: '62', name: 'Torque given', unit: '%', decode: torque },
  { pid: '63', name: 'Reference torque', unit: 'Nm', decode: u16 },
  { pid: '64', name: 'Torque points (idle, 1-4)', unit: '', decode: (b) => b.slice(0, 5).map((x) => `${x - 125}%`).join(', ') },
  { pid: '8E', name: 'Engine friction torque', unit: '%', decode: torque },
  { pid: 'A6', name: 'Odometer', unit: 'km', decode: (b) => r((((b[0] * 256 + b[1]) * 256 + b[2]) * 256 + b[3]) / 10) },
];
const BY_PID = new Map(PID_CATALOG.map((p) => [p.pid, p]));
export const pidInfo = (pid: string): PidInfo | undefined => BY_PID.get(pid.toUpperCase());
/** The "which PIDs do you support" maps (00, 20, 40...): asked to discover, never shown as values. */
export const isBitmapPid = (pid: string) => parseInt(pid, 16) % 0x20 === 0;

/** A mode 01 answer's data bytes for a PID, as many as the bike sent ("410C1AF8" -> [0x1A, 0xF8]); the first ECU. */
export function pidData(raw: string, pid: string): number[] | null {
  const head = `41${pid.toUpperCase()}`;
  const line = cleanLines(raw).find((l) => l.includes(head));
  if (!line) return null;
  const data = line.slice(line.indexOf(head) + 4).match(/../g);
  return data?.length ? data.map((x) => parseInt(x, 16)) : null;
}

export interface Reading { pid: string; name: string; unit: string; value: ObdValue | null; bytes: string; raw: string }
/** One answer -> the reading: decoded when the catalog knows it, raw bytes either way. */
export function decodeReading(pid: string, raw: string): Reading {
  const info = pidInfo(pid), b = pidData(raw, pid);
  let value: ObdValue | null = null;
  if (b) {
    if (!info) value = hex(b);
    else { try { const v = info.decode(b); value = typeof v === 'number' && !Number.isFinite(v) ? null : v; } catch { value = null; } }
  }
  return { pid: pid.toUpperCase(), name: info?.name ?? `PID ${pid.toUpperCase()} (not in the catalog)`, unit: info?.unit ?? '', value, bytes: b ? hex(b) : '', raw: raw.replace(/[\r\n>]+/g, ' ').trim() };
}

/** A mode 09 text answer (VIN 0902, calibration 0904, ECU name 090A) as text, or null. Handles CAN multi-frame and older one-line-per-part answers. */
export function mode09Text(raw: string, pid: string): string | null {
  const head = `49${pid.toUpperCase()}`;
  const lines = cleanLines(raw);
  if (!lines.length) return null;
  let data: string;
  if (lines.length > 1 && lines.every((l) => l.startsWith(head))) data = lines.map((l) => l.slice(6)).join(''); // 49 02 <part> <4 bytes>
  else {
    const all = lines.join(''), at = all.indexOf(head);
    if (at < 0) return null;
    data = all.slice(at + 6); // 49 02 <count>
  }
  const text = (data.match(/../g) ?? []).map((x) => parseInt(x, 16)).filter((c) => c >= 0x20 && c < 0x7f).map((c) => String.fromCharCode(c)).join('').trim();
  return text || null;
}

export interface Exchange { at: number; cmd: string; answer: string; ms: number }
export interface ScanResult {
  at: number;
  reader: { name: string; version: string; protocol: string };
  bike: { vin: string | null; calibration: string | null; ecuName: string | null };
  batteryV: number | null;
  /** Every mode 01 PID the bike lists, bitmaps left out */
  supported: string[];
  readings: Reading[];
  warningLight: boolean | null;
  storedCodes: string[];
  pendingCodes: string[];
}
export interface Sample { at: number; batteryV: number | null; values: Record<string, ObdValue | null> }

/**
 * The scanner: connect (init), list what the bike supports (every bitmap it chains, up to C0), read it all once
 * (scan), then read it again and again while recording (sweep). Every command and answer is kept (`exchanges`).
 */
export class ObdScanner {
  readonly exchanges: Exchange[] = [];
  supported: string[] = [];
  version = '';
  protocol = '';
  private t: ObdTransport;
  constructor(t: ObdTransport, private opt: ElmOptions = {}, private now: () => number = Date.now) {
    const ro = readOnly(t);
    this.t = {
      send: async (cmd) => {
        const t0 = this.now();
        const answer = await ro.send(cmd);
        this.exchanges.push({ at: t0, cmd, answer: answer.replace(/[\r\n]+/g, ' ').replace(/>/g, '').trim(), ms: this.now() - t0 });
        if (this.exchanges.length > CONFIG.obd.scan.maxExchanges) this.exchanges.splice(0, this.exchanges.length - CONFIG.obd.scan.maxExchanges);
        return answer;
      },
    };
  }

  /** Any read-only command, typed by hand (AT, 01xx, 03, 07, 09xx, 22xxxx): the answer as text. Anything else is refused. */
  send(cmd: string) { return this.t.send(cmd.replace(/\s+/g, '').toUpperCase()); }

  async init(): Promise<void> {
    const cmds = ELM_INIT.map((c) => (c === 'ATSP0' && this.opt.protocol ? `ATSP${this.opt.protocol}` : c));
    if (this.opt.timeout) cmds.push(`ATST${this.opt.timeout}`);
    if (this.opt.header) cmds.push(`ATSH${this.opt.header}`);
    for (const c of cmds) {
      const a = await this.t.send(c);
      if (c === 'ATZ') this.version = a.replace(/[>\r\n]+/g, ' ').trim();
    }
  }

  /** Which PIDs the bike lists (follows each bitmap's "next map" bit up to C0); [] while it is silent (engine off). */
  async discover(): Promise<string[]> {
    let all: string[] = [];
    for (let base = 0; base <= 0xc0; base += 0x20) {
      const b = base.toString(16).toUpperCase().padStart(2, '0');
      if (base && !all.includes(b)) break;
      const got = supportedPids(await this.t.send(`01${b}`), base);
      if (!got.length) break;
      all = [...all, ...got];
    }
    this.supported = all.filter((p) => !isBitmapPid(p));
    const dp = await this.t.send('ATDPN').catch(() => '');
    const name = await this.t.send('ATDP').catch(() => '');
    this.protocol = `${name.replace(/[>\r\n]+/g, ' ').trim()}${dp ? ` (${dp.replace(/[>\r\n]+/g, ' ').trim()})` : ''}`;
    return this.supported;
  }

  /** Everything once: the supported values, the bike's identity, codes, warning light and battery. */
  async scan(readerName: string, progress: (done: number, of: number) => void = () => {}): Promise<ScanResult> {
    const batteryV = readVoltage(await this.t.send('ATRV'));
    if (!this.supported.length) await this.discover();
    const readings: Reading[] = [];
    for (const [i, pid] of this.supported.entries()) {
      progress(i, this.supported.length);
      readings.push(decodeReading(pid, await this.t.send(`01${pid}`)));
    }
    progress(this.supported.length, this.supported.length);
    const st = readings.find((x) => x.pid === '01');
    const status = st ? readStatus(st.raw) : null;
    const ask09 = async (pid: string) => mode09Text(await this.t.send(`09${pid}`), pid);
    return {
      at: this.now(), reader: { name: readerName, version: this.version, protocol: this.protocol },
      bike: { vin: await ask09('02'), calibration: await ask09('04'), ecuName: await ask09('0A') },
      batteryV, supported: this.supported, readings,
      warningLight: status ? status.milOn : null,
      storedCodes: parseDtcs(await this.t.send('03')), pendingCodes: parseDtcs(await this.t.send('07'), '47'),
    };
  }

  /** One pass over `pids` (the supported values by default) and the battery: one row of a recording. */
  async sweep(pids: string[] = this.supported): Promise<Sample> {
    const at = this.now();
    const values: Record<string, ObdValue | null> = {};
    for (const pid of pids) values[pid] = decodeReading(pid, await this.t.send(`01${pid}`)).value;
    return { at, batteryV: readVoltage(await this.t.send('ATRV')), values };
  }
}

/** The whole page as one JSON file: what the bike is, what it supports, the readings, the recording and every exchange. */
export function scanExport(scan: ScanResult | null, samples: Sample[], exchanges: Exchange[], app: { bike: string; exportedAt: number }) {
  const pids = scan?.supported ?? [...new Set(samples.flatMap((s) => Object.keys(s.values)))];
  return {
    kind: 'betty-obd-scan', version: 1, exportedAt: new Date(app.exportedAt).toISOString(), bikeName: app.bike,
    scan: scan && { ...scan, at: new Date(scan.at).toISOString() },
    catalog: pids.map((pid) => ({ pid, name: pidInfo(pid)?.name ?? null, unit: pidInfo(pid)?.unit ?? null, known: !!pidInfo(pid) })),
    recording: { rows: samples.length, columns: ['at', 'batteryV', ...pids], samples: samples.map((s) => ({ at: new Date(s.at).toISOString(), batteryV: s.batteryV, ...s.values })) },
    exchanges: exchanges.map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
  };
}

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** The recording as CSV: one row per sweep, one column per value ("Engine speed (rpm) [0C]"), seconds from the start. */
export function samplesCsv(samples: Sample[], pids: string[]): string {
  const t0 = samples[0]?.at ?? 0;
  const head = ['time', 'seconds', 'Battery (V) [ATRV]', ...pids.map((p) => { const i = pidInfo(p); return `${i?.name ?? `PID ${p}`}${i?.unit ? ` (${i.unit})` : ''} [${p}]`; })];
  const rows = samples.map((s) => [new Date(s.at).toISOString(), ((s.at - t0) / 1000).toFixed(2), s.batteryV, ...pids.map((p) => s.values[p])]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
