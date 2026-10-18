import type { BikeState } from './types';

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
export const PIDS = {
  rpm: { pid: '0C', bytes: 2, value: (a: number, b: number) => Math.round((a * 256 + b) / 4) },
  coolantC: { pid: '05', bytes: 1, value: (a: number) => a - 40 },
  speedKmh: { pid: '0D', bytes: 1, value: (a: number) => a },
  throttlePct: { pid: '11', bytes: 1, value: (a: number) => Math.round((a * 100) / 255) },
  fuelPct: { pid: '2F', bytes: 1, value: (a: number) => Math.round((a * 100) / 255) },
} as const;
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
/** Fault codes from a mode 03 answer ("43 01 01 33" on CAN, "43 01 33 00 00 00 00" per line on older buses). */
export function parseDtcs(raw: string): string[] {
  const lines = cleanLines(raw);
  if (!lines.length) return [];
  let codes: string[];
  if (lines.every((l) => l.startsWith('43') && l.length === 14)) {
    // ISO 9141 / KWP: every line is 43 and three codes, padded with 0000.
    codes = lines.flatMap((l) => l.slice(2).match(/..../g) ?? []);
  } else {
    // CAN: 43, how many codes, then the codes (over several frames when long).
    const hex = lines.join('');
    if (!hex.startsWith('43')) return [];
    const n = parseInt(hex.slice(2, 4), 16) || 0;
    codes = hex.slice(4, 4 + n * 4).match(/..../g) ?? [];
  }
  const out = codes.filter((c) => c !== '0000').map((c) => {
    const first = parseInt(c[0], 16);
    return `${LETTER[first >> 2]}${first & 3}${c.slice(1)}`;
  });
  return [...new Set(out)];
}

/** A PID that gave no value this many times in a row is not asked again this connection (it slows every round). */
const GIVE_UP_AFTER = 3;

/**
 * One connection to the reader: set it up, then read a round of values every poll. Values the bike does not give are
 * left out of the update (and dropped from later rounds), so nothing made up reaches Betty.
 */
export class ElmSession {
  private misses: Partial<Record<PidName, number>> = {};
  private round = 0;
  supported: string[] = [];
  version = '';
  constructor(private t: ObdTransport, private log: (msg: string) => void = () => {}) {}

  async init(): Promise<void> {
    for (const c of ELM_INIT) {
      const r = await this.t.send(c);
      if (c === 'ATZ') this.version = r.replace(/[>\r\n]+/g, ' ').trim();
    }
    this.supported = [...supportedPids(await this.t.send('0100')), ...supportedPids(await this.t.send('0120'), 0x20)];
    this.log(`reader ${this.version || '(no version)'}, bike supports PIDs ${this.supported.join(' ') || 'none reported'}`);
  }

  /** Is this PID worth asking: not given up on, and (when the bike sent its list) on that list. */
  wants(name: PidName): boolean {
    if ((this.misses[name] ?? 0) >= GIVE_UP_AFTER) return false;
    return !this.supported.length || this.supported.includes(PIDS[name].pid);
  }

  /** One round: rpm, coolant, throttle, fuel (and fault codes every 30th round). */
  async poll(): Promise<{ state: Partial<BikeState>; speedKmh: number | null }> {
    const state: Partial<BikeState> = { obd: true };
    const get = async (name: PidName) => {
      if (!this.wants(name)) return null;
      const v = readPid(name, await this.t.send(`01${PIDS[name].pid}`));
      if (v == null) {
        this.misses[name] = (this.misses[name] ?? 0) + 1;
        if (this.misses[name] === GIVE_UP_AFTER) this.log(`no ${name} from the bike, not asking again`);
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
    if (fuel != null) state.fuelPct = fuel;
    const speedKmh = await get('speedKmh');
    if (this.round++ % 30 === 0) state.dtcs = parseDtcs(await this.t.send('03'));
    return { state, speedKmh };
  }
}
