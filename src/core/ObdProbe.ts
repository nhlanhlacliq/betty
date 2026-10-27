/**
 * The general probe (owner, 2026-10-27: "make it a general probe and see what comes up ... search the instrument
 * cluster too ... maybe the actual fuel level"). Three READ-ONLY steps through the ELM327:
 *  1. Listen: ATMA (monitor all, the ELM's silent monitoring) records what the bike's computers send each other, the
 *     instrument cluster included (rpm, speed, fuel bars on the dash travel this way on many bikes).
 *  2. Find the computers: a UDS read (22 F190, "VIN") to every 11-bit request address; any answer, even "not
 *     supported" (7F), means a computer lives there.
 *  3. Read data ids: 22 xxxx over CONFIG.obd.probe.ranges on each computer found; every positive answer is kept, and
 *     searched for a known value (his dash odometer) in the usual encodings.
 * Nothing here writes, clears, unlocks or changes a session: only AT commands and service 22 (Elm327 isReadOnly).
 * Pure, with the transport injected.
 */
import { CONFIG } from '../config/betty';
import { ObdTransport, readOnly } from './Elm327';

export interface Frame { at: number; id: string; bytes: number[] }
const HEX = /^[0-9A-F]+$/;
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** ATMA output with headers and spaces on ("1A0 01 02 03 ...") -> frames. Status lines (BUFFER FULL, STOPPED) are skipped. */
export function parseMonitor(text: string, at = 0): Frame[] {
  const out: Frame[] = [];
  for (const line of text.toUpperCase().split(/[\r\n]+/)) {
    const tok = line.trim().split(/\s+/);
    if (tok.length < 2 || !/^[0-9A-F]{3}$|^[0-9A-F]{8}$/.test(tok[0]) || !tok.slice(1).every((t) => /^[0-9A-F]{2}$/.test(t))) continue;
    out.push({ at, id: tok[0], bytes: tok.slice(1).map((t) => parseInt(t, 16)) });
  }
  return out;
}

export interface BusId { id: string; frames: number; perSecond: number; length: number; changing: number[]; min: number[]; max: number[]; first: string; last: string }
/** Per id on the bus: how often it is sent, its length, which bytes change (and their range), first and last frame. */
export function summarizeFrames(frames: Frame[], seconds: number): BusId[] {
  const by = new Map<string, Frame[]>();
  for (const f of frames) by.set(f.id, [...(by.get(f.id) ?? []), f]);
  return [...by.entries()].map(([id, fs]) => {
    const len = Math.max(...fs.map((f) => f.bytes.length));
    const min = Array.from({ length: len }, (_, i) => Math.min(...fs.map((f) => f.bytes[i] ?? 255)));
    const max = Array.from({ length: len }, (_, i) => Math.max(...fs.map((f) => f.bytes[i] ?? 0)));
    return { id, frames: fs.length, perSecond: Math.round((fs.length / Math.max(1, seconds)) * 10) / 10, length: len,
      changing: min.map((m, i) => (m !== max[i] ? i : -1)).filter((i) => i >= 0), min, max,
      first: fs[0].bytes.map(hex2).join(' '), last: fs[fs.length - 1].bytes.map(hex2).join(' ') };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The answer from one computer (headers on, spaces on, ISO-TP frames with their PCI byte) put back together:
 * "7E8 10 0B 62 F1 90 57 42" + "7E8 21 33 ..." -> {from: '7E8', data: [0x62, 0xF1, 0x90, ...]}. One entry per sender.
 */
export function reassemble(text: string): Array<{ from: string; data: number[] }> {
  const by = new Map<string, { want: number; data: number[] }>();
  for (const f of parseMonitor(text)) {
    const [pci, ...rest] = f.bytes;
    const kind = pci >> 4;
    if (kind === 0) by.set(f.id, { want: pci & 0x0f, data: rest.slice(0, pci & 0x0f) });
    else if (kind === 1) by.set(f.id, { want: ((pci & 0x0f) << 8) | rest[0], data: rest.slice(1) });
    else if (kind === 2) { const m = by.get(f.id); if (m) m.data.push(...rest); }
  }
  return [...by.entries()].map(([from, m]) => ({ from, data: m.data.slice(0, m.want || m.data.length) }));
}

export interface DidAnswer { ok: true; data: number[] }
export interface DidRefused { ok: false; nrc: number }
/** A service 22 answer for one data id: its data (after 62 + the id), a refusal code (7F 22 xx), or null (no answer). */
export function didAnswer(text: string, did: string): DidAnswer | DidRefused | null {
  const want = [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2, 4), 16)];
  for (const m of reassemble(text)) {
    if (m.data[0] === 0x7f && m.data[1] === 0x22) return { ok: false, nrc: m.data[2] ?? 0 };
    if (want.every((b, i) => m.data[i] === b)) return { ok: true, data: m.data.slice(3) };
  }
  return null;
}
/** What a refusal code means, in words. */
export const NRC: Record<number, string> = { 0x11: 'service not supported', 0x12: 'not supported', 0x13: 'wrong length', 0x22: 'conditions not right', 0x31: 'no such id', 0x33: 'locked (needs security access)', 0x78: 'busy, answer pending', 0x7f: 'not in this session' };

export interface Computer { request: string; reply: string; answer: string }
export interface DidHit { request: string; did: string; bytes: string; text: string }

const ascii = (b: number[]) => b.map((c) => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.')).join('');
const parse = (bytes: string) => bytes.split(' ').filter(Boolean).map((x) => parseInt(x, 16));

export interface ValueMatch { request: string; did: string; offset: number; encoding: string; raw: number; value: number }
/**
 * Where a known number (his dash odometer, say 29,859) sits in the answers: every offset, 2/3/4 bytes, big and little
 * endian, scaled 1, 1/10 and 1/100 (a km counter in tenths is common). Within tolerancePct (he may have ridden a bit).
 */
export function findValue(hits: DidHit[], target: number, tolerancePct = CONFIG.obd.probe.matchPct): ValueMatch[] {
  const out: ValueMatch[] = [];
  for (const h of hits) {
    const b = parse(h.bytes);
    for (let o = 0; o < b.length; o++) for (const n of [2, 3, 4]) {
      if (o + n > b.length) continue;
      const s = b.slice(o, o + n);
      for (const [end, bytes] of [['BE', s], ['LE', [...s].reverse()]] as const) {
        const raw = bytes.reduce((v, x) => v * 256 + x, 0);
        for (const scale of [1, 0.1, 0.01]) {
          const value = raw * scale;
          if (Math.abs(value - target) <= target * (tolerancePct / 100)) out.push({ request: h.request, did: h.did, offset: o, encoding: `u${n * 8} ${end}${scale === 1 ? '' : ` x${scale}`}`, raw, value: Math.round(value * 100) / 100 });
        }
      }
    }
  }
  return out;
}

/** The data ids in the configured ranges ("F180-F1FF") as four-digit hex. */
export function didsIn(ranges: string[] = CONFIG.obd.probe.ranges): string[] {
  const out: string[] = [];
  for (const r of ranges) {
    const [a, b] = r.split('-').map((x) => parseInt(x, 16));
    for (let d = a; d <= (b ?? a); d++) out.push(d.toString(16).toUpperCase().padStart(4, '0'));
  }
  return [...new Set(out)];
}

/** The ELM set up for probing: headers and spaces on (to see who answers), formatting on (ISO-TP), a short wait. */
export const PROBE_SETUP = () => ['ATH1', 'ATS1', 'ATCAF1', `ATST${CONFIG.obd.probe.waitHex}`];

export interface ProbeTransport extends ObdTransport { monitor?(ms: number): Promise<string> }

export class ObdProbe {
  frames: Frame[] = [];
  computers: Computer[] = [];
  hits: DidHit[] = [];
  refused: Record<string, Record<string, number>> = {};
  stopped = false;
  private t: ProbeTransport;
  constructor(t: ProbeTransport, private log: (m: string) => void = () => {}, private now: () => number = Date.now) {
    // reads only, like every other path to the bike; listening (ATMA) sends nothing to the bus
    this.t = { send: readOnly(t).send, ...(t.monitor ? { monitor: (ms: number) => t.monitor!(ms) } : {}) };
  }
  stop() { this.stopped = true; }
  private async setup() { for (const c of PROBE_SETUP()) await this.t.send(c); }

  /** 1. Listen to the bus for `ms`. Needs a transport that can monitor (BLE). */
  async listen(ms = CONFIG.obd.probe.listenMs): Promise<BusId[]> {
    if (!this.t.monitor) throw new Error('this reader link cannot listen (Bluetooth LE readers only)');
    await this.setup();
    const at = this.now();
    const text = await this.t.monitor(ms);
    const got = parseMonitor(text, at);
    this.frames.push(...got);
    const ids = summarizeFrames(got, ms / 1000);
    this.log(`listened ${ms / 1000} s: ${got.length} frames from ${ids.length} ids${/BUFFER FULL/i.test(text) ? ' (the reader\'s buffer filled: busy bus)' : ''}`);
    return ids;
  }

  /** 2. Every request address in CONFIG.obd.probe.addresses asked a UDS read (22 F190); any answer means a computer is there. */
  async findComputers(progress: (done: number, of: number) => void = () => {}): Promise<Computer[]> {
    await this.setup();
    const [from, to] = CONFIG.obd.probe.addresses.map((x) => parseInt(x, 16));
    const all: number[] = [];
    for (let id = from; id <= to; id++) all.push(id);
    for (const [i, id] of all.entries()) {
      if (this.stopped) break;
      progress(i, all.length);
      const req = id.toString(16).toUpperCase().padStart(3, '0');
      await this.t.send(`ATSH${req}`);
      await this.t.send(`ATCRA${(id + 8).toString(16).toUpperCase().padStart(3, '0')}`); // the usual reply address: request + 8
      const text = await this.t.send('22F190');
      const m = reassemble(text)[0];
      if (m) { this.computers.push({ request: req, reply: m.from, answer: m.data.map(hex2).join(' ') }); this.log(`computer at ${req} (answers from ${m.from}): ${m.data.map(hex2).join(' ')}`); }
    }
    await this.t.send('ATAR');
    progress(all.length, all.length);
    return this.computers;
  }

  /** 3. Read every data id in the ranges on one computer; positive answers kept as hits. */
  async readDids(c: Computer, progress: (done: number, of: number) => void = () => {}): Promise<DidHit[]> {
    await this.setup();
    await this.t.send(`ATSH${c.request}`);
    await this.t.send(`ATCRA${c.reply}`);
    const dids = didsIn();
    const found: DidHit[] = [];
    for (const [i, did] of dids.entries()) {
      if (this.stopped) break;
      if (i % 16 === 0) progress(i, dids.length);
      const a = didAnswer(await this.t.send(`22${did}`), did);
      if (!a) continue;
      if (a.ok) { const h = { request: c.request, did, bytes: a.data.map(hex2).join(' '), text: ascii(a.data) }; found.push(h); this.hits.push(h); this.log(`${c.request} ${did}: ${h.bytes} "${h.text}"`); }
      else (this.refused[c.request] ??= {})[did] = a.nrc;
    }
    await this.t.send('ATAR');
    progress(dids.length, dids.length);
    return found;
  }

  /** Everything found, for the export. */
  report(target?: { odometerKm?: number | null; fuelNote?: string }) {
    return {
      bus: summarizeFrames(this.frames, CONFIG.obd.probe.listenMs / 1000),
      frames: this.frames.slice(0, CONFIG.obd.probe.keepFrames).map((f) => ({ at: new Date(f.at).toISOString(), id: f.id, bytes: f.bytes.map(hex2).join(' ') })),
      computers: this.computers, hits: this.hits,
      refusedCounts: Object.fromEntries(Object.entries(this.refused).map(([req, m]) => [req, Object.entries(Object.values(m).reduce<Record<string, number>>((n, c) => { const k = NRC[c] ?? `code ${hex2(c)}`; n[k] = (n[k] ?? 0) + 1; return n; }, {}))])),
      ...(target?.odometerKm ? { odometerKm: target.odometerKm, odometerMatches: findValue(this.hits, target.odometerKm) } : {}),
      ...(target?.fuelNote ? { fuelNote: target.fuelNote } : {}),
    };
  }
}
