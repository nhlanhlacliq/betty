import type { BikeState, EngineReadings } from './types';
import { CONFIG } from '../config/betty';

/**
 * Talking to an ELM327 OBD2 reader (Phase 4 / the native app, 2026-10-18). The reader is a serial line: we send a
 * command ("010C" = engine rpm) ending in a carriage return, it answers in hex and ends with its prompt ">". This file
 * is the protocol only (what to send, how to read the answer); how the bytes travel (Bluetooth Classic on Android,
 * BLE or Wi-Fi elsewhere) is an `ObdTransport` in the app. Pure, so it is tested.
 *
 * Owner's reader (2026-10-18): a Takealot "ELM327 mini", Bluetooth CLASSIC (PIN 1234), Android only. The 2018
 * G 310 GS most likely speaks ISO 15765-4 CAN 500k on a 16-pin socket. UNVERIFIED: which PIDs the bike answers.
 */

/** One command, its answer as text (up to the ">" prompt). */
export interface ObdTransport {
  send(command: string): Promise<string>;
}

/** Reset, echo off, no line feeds, no spaces, no headers, protocol automatic. */
export const ELM_INIT = ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0'];

/** The live values Betty reads (mode 01 PIDs) and how each answer's bytes become a value. */
/** Mode 01 values, with the standard SAE J1979 formulas. The owner's G 310 GS answers all but fuelPct (2026-10-27). */
const pct = (a: number) => Math.round((a * 1000) / 255) / 10;
const trim = (a: number) => Math.round(((a - 128) * 1000) / 128) / 10;
export const PIDS = {
  rpm: { pid: '0C', bytes: 2, value: (a: number, b: number) => Math.round((a * 256 + b) / 4) },
  coolantC: { pid: '05', bytes: 1, value: (a: number) => a - 40 },
  speedKmh: { pid: '0D', bytes: 1, value: (a: number) => a },
  throttlePct: { pid: '11', bytes: 1, value: (a: number) => Math.round((a * 100) / 255) },
  fuelPct: { pid: '2F', bytes: 1, value: (a: number) => Math.round((a * 100) / 255) },
  loadPct: { pid: '04', bytes: 1, value: pct },
  stftPct: { pid: '06', bytes: 1, value: trim },
  ltftPct: { pid: '07', bytes: 1, value: trim },
  timingDeg: { pid: '0E', bytes: 1, value: (a: number) => a / 2 - 64 },
  intakeC: { pid: '0F', bytes: 1, value: (a: number) => a - 40 },
  runS: { pid: '1F', bytes: 2, value: (a: number, b: number) => a * 256 + b },
  kmSinceClear: { pid: '31', bytes: 2, value: (a: number, b: number) => a * 256 + b },
  baroKpa: { pid: '33', bytes: 1, value: (a: number) => a },
  ecuV: { pid: '42', bytes: 2, value: (a: number, b: number) => Math.round(a * 256 + b) / 1000 },
  absLoadPct: { pid: '43', bytes: 2, value: (a: number, b: number) => Math.round(((a * 256 + b) * 1000) / 255) / 10 },
  o2V: { pid: '14', bytes: 1, value: (a: number) => Math.round((a / 200) * 1000) / 1000 },
  lambda: { pid: '44', bytes: 2, value: (a: number, b: number) => Math.round(((a * 256 + b) * 2 / 65536) * 1000) / 1000 },
} as const;

/**
 * Only commands that READ go to the bike: the reader's own AT commands, mode 01 (live values), 03 (stored codes), 07
 * (pending codes), 09 (vehicle info) and 22 (read a manufacturer data id, how apps like Biketune read the odometer).
 * Never 04 (clears the codes and the warning light), 2E/2F/31 (write, control) or anything else: a safety rule of the
 * code, not a setting.
 */
export const isReadOnly = (cmd: string) => /^(AT[A-Z0-9 .]*|01[0-9A-F]{2}|0[37]|09[0-9A-F]{2}|22[0-9A-F]{4})$/i.test(cmd.replace(/\s+/g, ''));
/** A transport that refuses anything but reads (isReadOnly). */
export const readOnly = (t: ObdTransport): ObdTransport => ({
  send: (c) => (isReadOnly(c) ? t.send(c) : Promise.reject(new Error(`refused: ${c} is not a read`))),
});

/** The engine warning light and the number of stored codes, from the "0101" answer. */
export function readStatus(raw: string): { milOn: boolean; dtcCount: number } | null {
  const b = pidBytes(raw, '01', 4);
  return b ? { milOn: (b[0] & 0x80) !== 0, dtcCount: b[0] & 0x7f } : null;
}
export type PidName = keyof typeof PIDS;

/** Answers that mean "no value" rather than a fault in our parsing. */
const NO_VALUE = /NO DATA|UNABLE TO CONNECT|CAN ERROR|BUS (INIT|BUSY|ERROR)|STOPPED|ERROR|\?/;

/**
 * The answer's frames as hex lines: echo, "SEARCHING...", spaces and the prompt removed; on a long CAN answer the
 * byte-count line ("00A") dropped and the frame numbers ("0:", "1:") stripped. [] for an answer with no value.
 */
export function cleanLines(raw: string): string[] {
  const t = raw.replace(/SEARCHING\.\.\./g, '').replace(/>/g, '').toUpperCase();
  if (NO_VALUE.test(t)) return [];
  return t.split(/[\r\n]+/).map((l) => l.replace(/\s+/g, '').replace(/^[0-9A-F]:/, ''))
    .filter((l) => /^[0-9A-F]+$/.test(l) && !/^[0-9A-F]{3}$/.test(l));
}
/** The answer as one hex string, or null when it has no value. */
export function cleanAnswer(raw: string): string | null {
  const lines = cleanLines(raw);
  return lines.length ? lines.join('') : null;
}

/** A mode 01 answer's data bytes for a PID ("410C1AF8" -> [0x1A, 0xF8]), or null. Takes the first ECU that answered. */
export function pidBytes(raw: string, pid: string, count: number): number[] | null {
  const hex = cleanAnswer(raw);
  if (!hex) return null;
  const at = hex.indexOf(`41${pid.toUpperCase()}`);
  if (at < 0) return null;
  const data = hex.slice(at + 4, at + 4 + count * 2);
  if (data.length < count * 2) return null;
  return Array.from({ length: count }, (_, i) => parseInt(data.slice(i * 2, i * 2 + 2), 16));
}

/** A live value from its answer, or null when the bike did not give one. */
export function readPid(name: PidName, raw: string): number | null {
  const p = PIDS[name];
  const b = pidBytes(raw, p.pid, p.bytes);
  return b ? (p.value as (...x: number[]) => number)(...b) : null;
}

/**
 * Which mode 01 PIDs the bike says it supports, from the "0100" answer (a 32-bit map of PIDs 01 to 20; "0120" covers
 * 21 to 40, pass base 0x20). Worth logging on the first connection: it says what this bike can tell Betty.
 */
export function supportedPids(raw: string, base = 0): string[] {
  const b = pidBytes(raw, base.toString(16).padStart(2, '0'), 4);
  if (!b) return [];
  const out: string[] = [];
  b.forEach((byte, i) => { for (let bit = 0; bit < 8; bit++) if (byte & (0x80 >> bit)) out.push((base + i * 8 + bit + 1).toString(16).toUpperCase().padStart(2, '0')); });
  return out;
}

const LETTER = ['P', 'C', 'B', 'U'];
/** Fault codes from a mode 03 answer ("43 01 01 33" on CAN, "43 01 33 00 00 00 00" per line on older buses). Mode 07
 *  (pending codes) answers the same way with head "47". */
export function parseDtcs(raw: string, head = '43'): string[] {
  const lines = cleanLines(raw);
  if (!lines.length) return [];
  let codes: string[];
  if (lines.every((l) => l.startsWith(head) && l.length === 14)) {
    // ISO 9141 / KWP: every line is 43 and three codes, padded with 0000.
    codes = lines.flatMap((l) => l.slice(2).match(/..../g) ?? []);
  } else {
    // CAN: 43, how many codes, then the codes (over several frames when long).
    const hex = lines.join('');
    if (!hex.startsWith(head)) return [];
    const n = parseInt(hex.slice(2, 4), 16) || 0;
    codes = hex.slice(4, 4 + n * 4).match(/..../g) ?? [];
  }
  const out = codes.filter((c) => c !== '0000').map((c) => {
    const first = parseInt(c[0], 16);
    return `${LETTER[first >> 2]}${first & 3}${c.slice(1)}`;
  });
  return [...new Set(out)];
}

/** A PID the bike does NOT list as supported is dropped after this many misses in a row. One it lists is never dropped:
 *  on the owner's G 310 GS (2026-10-19) a cheap clone missed most answers, and dropping after 3 would lose rpm at once. */
const GIVE_UP_AFTER = 3;

export interface ElmOptions {
  /** ATSP value: '0' = automatic (default); '6' = ISO 15765-4 CAN 11-bit 500k, what the G 310 GS speaks. */
  protocol?: string;
  /** ATST value in hex (x 4 ms): 'FF' = ~1 s, for ECUs slower than the reader's default ~200 ms. */
  timeout?: string;
  /** ATSH value: ask one ECU directly (e.g. '7E0', the engine) instead of everyone. */
  header?: string;
}

/** Battery / charging voltage from the reader's ATRV answer ("14.3V"), or null. Works even when the ECU is silent. */
export function readVoltage(raw: string): number | null {
  const m = raw.match(/(\d{1,2}\.\d)\s*V/i);
  return m ? Number(m[1]) : null;
}

/**
 * One connection to the reader: set it up, then each poll asks what is DUE (CONFIG.obd.read: rpm and speed often,
 * temperatures every few seconds, the slow ones now and then), so a slow ECU is not flooded. Values the bike does not
 * give are left out, so nothing made up reaches Betty. Learned on the bike (2026-10-19): its ECU only answers with the
 * ENGINE RUNNING, so until it answers 0100 each poll tries again (and reports only the voltage).
 */
export class ElmSession {
  private misses: Partial<Record<PidName, number>> = {};
  private asked: Record<string, number> = {};
  supported: string[] = [];
  version = '';
  /** Everything read so far (each poll's state carries all of it, so the state never loses a slow value). */
  readonly engine: EngineReadings = {};
  private t: ObdTransport;
  constructor(t: ObdTransport, private log: (msg: string) => void = () => {}, private opt: ElmOptions = {}, private now: () => number = Date.now) {
    this.t = readOnly(t);
  }

  async init(): Promise<void> {
    const cmds = ELM_INIT.map((c) => (c === 'ATSP0' && this.opt.protocol ? `ATSP${this.opt.protocol}` : c));
    if (this.opt.timeout) cmds.push(`ATST${this.opt.timeout}`);
    if (this.opt.header) cmds.push(`ATSH${this.opt.header}`);
    for (const c of cmds) {
      const r = await this.t.send(c);
      if (c === 'ATZ') this.version = r.replace(/[>\r\n]+/g, ' ').trim();
    }
    await this.discover();
    this.log(`reader ${this.version || '(no version)'}, ${this.supported.length ? `bike supports PIDs ${this.supported.join(' ')}` : 'bike not answering yet (engine off?)'}`);
  }

  /** Ask which PIDs the bike supports (01-20, 21-40, 41-60); true once it has answered. */
  private async discover(): Promise<boolean> {
    const first = supportedPids(await this.t.send('0100'));
    if (!first.length) return false;
    let all = first;
    for (const base of [0x20, 0x40]) {
      if (!all.includes(base.toString(16).toUpperCase())) break;
      all = [...all, ...supportedPids(await this.t.send(`01${base.toString(16).toUpperCase()}`), base)];
    }
    this.supported = all;
    return true;
  }

  /** Is this PID worth asking: on the bike's list (never dropped), or not given up on while there is no list. */
  wants(name: PidName): boolean {
    if (this.supported.length) return this.supported.includes(PIDS[name].pid);
    return (this.misses[name] ?? 0) < GIVE_UP_AFTER;
  }
  private due(key: string, everyMs: number | undefined): boolean {
    if (everyMs == null || everyMs <= 0) return false;
    const t = this.now();
    if (t - (this.asked[key] ?? -Infinity) < everyMs) return false;
    this.asked[key] = t;
    return true;
  }

  /**
   * One round: what is due. Before the bike answers, only the voltage and another try at 0100. `speedKmh` is the
   * bike's own speed (its wheel sensor), separate so it does not overwrite GPS speed.
   */
  async poll(): Promise<{ state: Partial<BikeState>; speedKmh: number | null; voltage: number | null }> {
    const c = CONFIG.obd;
    let voltage: number | null = null;
    if (this.due('ATRV', c.voltEveryMs)) { voltage = readVoltage(await this.t.send('ATRV')); if (voltage != null) this.engine.batteryV = voltage; }
    if (!this.supported.length) {
      if (!(await this.discover())) return { state: voltage != null ? { engine: { ...this.engine } } : {}, speedKmh: null, voltage };
      this.log(`bike answering now: supports PIDs ${this.supported.join(' ')}`);
    }
    const state: Partial<BikeState> = { obd: true };
    const get = async (name: PidName) => {
      if (!this.wants(name) || !this.due(name, c.read[name])) return null;
      const v = readPid(name, await this.t.send(`01${PIDS[name].pid}`));
      if (v == null) {
        this.misses[name] = (this.misses[name] ?? 0) + 1;
        if (this.misses[name] === 10) this.log(`no ${name} for 10 tries in a row (reader or connection?)`);
      } else this.misses[name] = 0;
      return v;
    };
    const rpm = await get('rpm');
    if (rpm != null) state.rpm = rpm;
    const temp = await get('coolantC');
    if (temp != null) state.engineTempC = temp;
    const thr = await get('throttlePct');
    if (thr != null) state.throttlePct = thr;
    const fuel = await get('fuelPct');
    if (fuel != null) { state.fuelPct = fuel; state.fuelKnown = true; }
    const speedKmh = await get('speedKmh');
    if (speedKmh != null) this.engine.bikeSpeedKmh = speedKmh;
    for (const name of ['loadPct', 'stftPct', 'ltftPct', 'timingDeg', 'intakeC', 'runS', 'kmSinceClear', 'baroKpa', 'ecuV', 'absLoadPct', 'lambda', 'o2V'] as const) {
      const v = await get(name);
      if (v != null) this.engine[name] = v;
    }
    if (this.due('0101', c.statusEveryMs)) { const st = readStatus(await this.t.send('0101')); if (st) Object.assign(this.engine, st); }
    if (this.due('03', c.dtcEveryMs)) state.dtcs = parseDtcs(await this.t.send('03'));
    state.engine = { ...this.engine };
    return { state, speedKmh, voltage };
  }
}
