import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG } from '../../../src/config/betty';
import { ObdScanner, Reading, Sample, ScanResult, pidInfo, samplesCsv, scanExport } from '../../../src/core/ObdScan';
import { BusId, Computer, NRC, ObdProbe, findValue } from '../../../src/core/ObdProbe';
import { ServiceStore } from '../../../src/adapters/ServiceStore';
import { BleObdTransport } from '../adapters/BleObdTransport';
import { ElmClassicTransport } from '../adapters/ElmClassicTransport';
import { shareFile } from '../adapters/ShareFile';
import { useBetty } from '../state/Betty';
import { Primary, Secondary, TextButton } from '../ui/Buttons';
import { Card } from '../ui/Card';
import { C, T } from '../ui/theme';

/**
 * Garage > Engine data (owner, 2026-10-27: "a page that shows everything the OBD reader can read ... and export it for
 * analysis and integration planning"). Connects to the picked reader on its own (not during a ride: the ride holds it),
 * lists every value the bike supports with its reading and raw bytes, records them over and over, lets him send any
 * READ-ONLY command by hand (mode 22 probing), and exports JSON (everything, every exchange) or CSV (the recording).
 * The protocol and the catalog are shared code: src/core/ObdScan.ts.
 */
type Status = 'off' | 'connecting' | 'silent' | 'ready' | 'scanning' | 'recording' | 'probing';
type Transport = (BleObdTransport | ElmClassicTransport) & { lost?: boolean };
const fmt = (v: Reading['value'], unit: string) => (v == null ? '—' : `${v}${unit && typeof v === 'number' ? ` ${unit}` : ''}`);
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');

export default function Engine() {
  const b = useBetty();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('off');
  const [note, setNote] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [live, setLive] = useState<Sample | null>(null);
  const [rows, setRows] = useState(0);
  const [progress, setProgress] = useState('');
  const [cmd, setCmd] = useState('');
  const [asks, setAsks] = useState<Array<{ cmd: string; answer: string }>>([]);
  const [readers, setReaders] = useState<{ id: string; name: string; sub: string }[] | null>(null);
  const transport = useRef<Transport | null>(null);
  const scanner = useRef<ObdScanner | null>(null);
  const samples = useRef<Sample[]>([]);
  const recording = useRef(false);
  const rideHasIt = !!b.ride && !!b.reader && b.mode === 'real';
  // the general probe (core/ObdProbe)
  const probe = useRef<ObdProbe | null>(null);
  const [bus, setBus] = useState<BusId[] | null>(null);
  const [computers, setComputers] = useState<Computer[] | null>(null);
  const [hits, setHits] = useState(0);
  const [odo, setOdo] = useState(() => { const k = ServiceStore.load().odoKm; return k ? String(Math.round(k)) : ''; });
  const [fuelNote, setFuelNote] = useState('');
  const [probeNote, setProbeNote] = useState('');
  const odoKm = Number(odo.replace(/[\s,]/g, '')) || null;
  const getProbe = () => (probe.current ??= new ObdProbe(transport.current as any, (m) => b.logger.add('[probe]', m)));
  const probeStep = async (what: 'listen' | 'find' | 'read') => {
    if (!transport.current || !scanner.current) return;
    const p = getProbe(); p.stopped = false;
    setStatus('probing'); void activateKeepAwakeAsync('obd');
    try {
      if (what === 'listen') { setProbeNote('Listening to the bike for 20 s…'); const ids = await p.listen(); setBus(ids); setProbeNote(`Heard ${p.frames.length} messages from ${ids.length} ids.`); }
      if (what === 'find') { const c = await p.findComputers((d, of) => setProbeNote(`Asking address ${d + 1} of ${of}…`)); setComputers([...c]); setProbeNote(`${c.length} computer${c.length === 1 ? '' : 's'} answered.`); }
      if (what === 'read') {
        const list = computers?.length ? computers : [{ request: '7E0', reply: '7E8', answer: '' }];
        for (const [i, c] of list.entries()) {
          if (p.stopped) break;
          await p.readDids(c, (d, of) => setProbeNote(`Computer ${i + 1} of ${list.length} (${c.request}): data id ${d} of ${of}… ${p.hits.length} answers so far`));
          setHits(p.hits.length);
        }
        const m = odoKm ? findValue(p.hits, odoKm) : [];
        setProbeNote(`${p.hits.length} data ids answered.${odoKm ? ` ${m.length ? `Odometer candidates: ${m.slice(0, 5).map((x) => `${x.request} ${x.did} (${x.encoding} = ${x.value})`).join(', ')}` : 'No answer holds your odometer.'}` : ''}`);
      }
    } catch (e) { setProbeNote(`Probe stopped: ${(e as Error).message}`); }
    // back to normal reading: the ELM set up as before the probe
    try { await scanner.current.init(); } catch { /* reported by the next read */ }
    deactivateKeepAwake('obd');
    setStatus(transport.current?.lost ? 'off' : 'ready');
  };

  const close = async () => {
    recording.current = false;
    deactivateKeepAwake('obd');
    await transport.current?.close().catch(() => {});
    transport.current = null; scanner.current = null;
  };
  useEffect(() => () => { void close(); }, []);

  const connect = async () => {
    const r = b.reader;
    if (!r) return;
    setStatus('connecting'); setNote(`Connecting to ${r.name}…`);
    try {
      const classic = r.id.startsWith('classic:');
      const t: Transport = classic ? new ElmClassicTransport() : new BleObdTransport((m) => b.logger.add('[obd]', m));
      await t.connect(classic ? r.id.slice(8) : r.id);
      transport.current = t;
      const s = new ObdScanner(t, { protocol: '6', timeout: 'FF' });
      scanner.current = s;
      await s.init();
      await look();
    } catch (e) { setStatus('off'); setNote(`Could not connect: ${(e as Error).message}`); await close(); }
  };
  /** Ask the bike what it supports; it is silent until the engine runs. */
  const look = async () => {
    const s = scanner.current;
    if (!s) return;
    const sup = await s.discover();
    if (!sup.length) { setStatus('silent'); setNote(`Connected to ${b.reader?.name} (${s.version || 'reader'}), but the bike is not answering. Start the engine, then try again.`); return; }
    setStatus('ready'); setNote(`The bike lists ${sup.length} values. ${s.protocol}`);
    await runScan();
  };
  const runScan = async () => {
    const s = scanner.current;
    if (!s) return;
    setStatus('scanning');
    try {
      const res = await s.scan(b.reader?.name ?? '', (d, of) => setProgress(d < of ? `Reading ${d + 1} of ${of}…` : ''));
      setScan(res); setLive(null); setStatus('ready');
    } catch (e) { setNote(`Reading failed: ${(e as Error).message}`); setStatus(transport.current?.lost ? 'off' : 'ready'); }
    setProgress('');
  };
  const record = async () => {
    const s = scanner.current;
    if (!s) return;
    if (recording.current) { recording.current = false; return; }
    recording.current = true; setStatus('recording');
    void activateKeepAwakeAsync('obd');
    const t0 = Date.now();
    while (recording.current && !transport.current?.lost) {
      try {
        const row = await s.sweep();
        samples.current.push(row);
        if (samples.current.length > CONFIG.obd.scan.maxRows) samples.current.shift();
        setLive(row); setRows(samples.current.length);
        const n = samples.current.filter((x) => x.at >= t0).length;
        setProgress(`${(n / Math.max(1, (Date.now() - t0) / 1000)).toFixed(1)} rows a second`);
      } catch (e) { setNote(`Reading failed: ${(e as Error).message}`); break; }
      if (CONFIG.obd.scan.sweepGapMs) await new Promise((r) => setTimeout(r, CONFIG.obd.scan.sweepGapMs));
    }
    recording.current = false; deactivateKeepAwake('obd'); setProgress('');
    setStatus(transport.current?.lost ? 'off' : 'ready');
    if (transport.current?.lost) setNote('The reader disconnected.');
  };
  const ask = async () => {
    const s = scanner.current, c = cmd.trim();
    if (!s || !c) return;
    try { const a = await s.send(c); setAsks((x) => [{ cmd: c.toUpperCase(), answer: a.replace(/[\r\n>]+/g, ' ').trim() || '(nothing)' }, ...x].slice(0, 30)); }
    catch (e) { setAsks((x) => [{ cmd: c.toUpperCase(), answer: (e as Error).message }, ...x].slice(0, 30)); }
  };
  const exportJson = async () => {
    const j = scanExport(scan, samples.current, scanner.current?.exchanges ?? [], { bike: CONFIG.bikeName, exportedAt: Date.now(), probe: probe.current?.report({ odometerKm: odoKm, fuelNote: fuelNote || undefined }) });
    try { await shareFile(`betty-obd-${stamp()}.json`, JSON.stringify(j, null, 1), 'application/json', 'public.json'); } catch (e) { setNote((e as Error).message); }
  };
  const exportCsv = async () => {
    const pids = scan?.supported ?? scanner.current?.supported ?? [];
    try { await shareFile(`betty-obd-recording-${stamp()}.csv`, samplesCsv(samples.current, pids), 'text/csv', 'public.comma-separated-values-text'); } catch (e) { setNote((e as Error).message); }
  };
  const findReaders = async () => {
    setNote('Looking for readers…');
    try {
      const le = (await BleObdTransport.scan(6)).map((r) => ({ id: r.id, name: r.name, sub: 'Bluetooth LE' }));
      const classic = Platform.OS === 'android' ? (await ElmClassicTransport.paired().catch(() => [])).map((r) => ({ id: `classic:${r.address}`, name: r.name, sub: `paired · ${r.address}` })) : [];
      setReaders([...le, ...classic]); setNote(le.length + classic.length ? 'Pick your reader.' : 'No reader found. Plugged in, ignition on?');
    } catch (e) { setNote(`Bluetooth: ${(e as Error).message}`); }
  };

  const connected = status !== 'off' && status !== 'connecting';
  const busy = status === 'connecting' || status === 'scanning' || status === 'probing';
  const shown: Reading[] = (scan?.readings ?? []).map((r) => (live && r.pid in live.values ? { ...r, value: live.values[r.pid] } : r));
  const battery = live?.batteryV ?? scan?.batteryV ?? null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[st.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <View style={st.head}>
        <View style={{ flex: 1 }}><Text style={[T.eyebrow, { marginBottom: 8 }]}>Workshop</Text><Text style={[T.h1, { fontSize: 30, lineHeight: 34 }]}>Engine data.</Text></View>
        <TextButton label="← Garage" onPress={() => router.back()} />
      </View>
      <Text style={[T.sub, { marginBottom: 12 }]}>Everything your OBD2 reader can read from the bike, live, with a recording you can export. It only reads: nothing is ever cleared or changed.</Text>

      {rideHasIt ? (
        <Card><Text style={T.body}>A ride is using the reader. End the ride to look at everything it can read.</Text></Card>
      ) : !b.reader ? (
        <Card title="No reader picked">
          <Text style={T.sub}>Plug the reader in and switch the ignition on, then find it.</Text>
          <TextButton label={readers ? 'Look again' : 'Find my OBD2 reader'} onPress={() => void findReaders()} />
          {readers?.map((r) => (
            <Pressable key={r.id} style={st.option} onPress={() => b.setReader({ id: r.id, name: r.name })}>
              <Text style={st.optionTitle}>○ {r.name}</Text><Text style={T.sub}>{r.sub}</Text>
            </Pressable>
          ))}
        </Card>
      ) : (
        <Card title={b.reader.name} sub={note || 'Engine running for the bike to answer (the reader alone gives only the battery).'}>
          <View style={st.buttons}>
            {!connected && <Primary label={status === 'connecting' ? 'Connecting…' : 'Connect'} icon={null} disabled={busy} onPress={() => void connect()} style={{ flex: 1 }} />}
            {status === 'silent' && <Primary label="Try again" icon={null} onPress={() => void look()} style={{ flex: 1 }} />}
            {connected && status !== 'silent' && <Secondary label={status === 'scanning' ? 'Reading…' : 'Read all again'} disabled={busy || status === 'recording'} onPress={() => void runScan()} style={{ flex: 1 }} />}
            {connected && status !== 'silent' && <Primary label={status === 'recording' ? 'Stop recording' : 'Record'} icon={null} disabled={busy} onPress={() => void record()} style={{ flex: 1 }} />}
            {connected && <Secondary label="Disconnect" disabled={status === 'recording' || status === 'probing'} onPress={() => { void close(); setStatus('off'); setNote(''); }} />}
          </View>
          {!!progress && <Text style={[T.sub, { marginTop: 8 }]}>{progress}</Text>}
          {rows > 0 && <Text style={[T.sub, { marginTop: 4 }]}>Recording: {rows.toLocaleString('en-US')} rows (up to {CONFIG.obd.scan.maxRows.toLocaleString('en-US')} kept).</Text>}
        </Card>
      )}

      {scan && (
        <Card title="The bike">
          <Row k="VIN" v={scan.bike.vin ?? 'not given'} />
          <Row k="Engine computer" v={scan.bike.ecuName ?? 'not given'} />
          <Row k="Calibration" v={scan.bike.calibration ?? 'not given'} />
          <Row k="Protocol" v={scan.reader.protocol || '—'} />
          <Row k="Reader" v={scan.reader.version || '—'} />
          <Row k="Battery (reader)" v={battery != null ? `${battery} V` : '—'} />
          <Row k="Warning light" v={scan.warningLight == null ? '—' : scan.warningLight ? 'ON' : 'off'} />
          <Row k="Stored codes" v={scan.storedCodes.join(', ') || 'none'} />
          <Row k="Pending codes" v={scan.pendingCodes.join(', ') || 'none'} last />
        </Card>
      )}

      {scan && (
        <Card title={`${scan.supported.length} values the bike gives`} sub={live ? `Live, ${new Date(live.at).toLocaleTimeString()}` : `Read at ${new Date(scan.at).toLocaleTimeString()}`}>
          {shown.map((r, i) => (
            <View key={r.pid} style={[st.reading, i === shown.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={st.readName}>{pidInfo(r.pid) ? r.name : `PID ${r.pid}`}</Text>
                <Text style={st.readSub}>01{r.pid}{r.bytes ? ` · ${r.bytes}` : ' · no answer'}{pidInfo(r.pid) ? '' : ' · not in the catalog'}</Text>
              </View>
              <Text style={st.readValue}>{fmt(r.value, r.unit)}</Text>
            </View>
          ))}
        </Card>
      )}

      {connected && (
        <Card title="Ask the bike" sub="Any read command: AT (the reader), 01xx live value, 03 / 07 codes, 09xx bike info, 22xxxx a maker's data id (how apps read BMW's odometer). Anything that clears or writes is refused.">
          <View style={st.buttons}>
            <TextInput value={cmd} onChangeText={setCmd} placeholder="e.g. 22 F1 90" autoCapitalize="characters" autoCorrect={false} style={st.input} onSubmitEditing={() => void ask()} />
            <Secondary label="Send" disabled={status === 'recording' || busy} onPress={() => void ask()} />
          </View>
          {asks.map((a, i) => <Text key={i} style={st.mono}>{a.cmd} → {a.answer}</Text>)}
        </Card>
      )}

      {connected && status !== 'silent' && (
        <Card title="Probe the bike" sub="Looks beyond the standard values, on every computer it can find, the instrument cluster included: what they send each other, and every BMW data id in a set of ranges. Reads only. Ignition on with the engine idling; the full read takes a while (about 5 to 10 minutes a computer).">
          <View style={st.buttons}>
            <Text style={[T.body, { flex: 1 }]}>Dash odometer (km)</Text>
            <TextInput value={odo} onChangeText={setOdo} keyboardType="number-pad" placeholder="29859" style={[st.input, { flex: 0, minWidth: 110 }]} />
          </View>
          <TextInput value={fuelNote} onChangeText={setFuelNote} placeholder="Fuel on the dash now, e.g. 4 of 6 bars" style={[st.input, { marginTop: 8, fontFamily: undefined }]} />
          <View style={st.buttons}>
            <Secondary label="1. Listen" disabled={status === 'probing' || status === 'recording'} onPress={() => void probeStep('listen')} style={{ flex: 1 }} />
            <Secondary label="2. Find computers" disabled={status === 'probing' || status === 'recording'} onPress={() => void probeStep('find')} style={{ flex: 1 }} />
          </View>
          <View style={st.buttons}>
            <Primary label="3. Read their data" icon={null} disabled={status === 'probing' || status === 'recording'} onPress={() => void probeStep('read')} style={{ flex: 1 }} />
            {status === 'probing' && <Secondary label="Stop" onPress={() => probe.current?.stop()} />}
          </View>
          {!!probeNote && <Text style={[T.sub, { marginTop: 8 }]}>{probeNote}</Text>}
          {bus && <Text style={[T.eyebrow, { marginTop: 12 }]}>On the bus</Text>}
          {bus?.map((x) => <Text key={x.id} style={st.mono}>{x.id} · {x.perSecond}/s · {x.length} bytes · moving: {x.changing.length ? x.changing.map((i) => `#${i}`).join(' ') : 'none'} · {x.last}</Text>)}
          {computers && <Text style={[T.eyebrow, { marginTop: 12 }]}>Computers</Text>}
          {computers?.map((c) => <Text key={c.request} style={st.mono}>{c.request} → {c.reply}: {c.answer.startsWith('7F') ? `there (${NRC[parseInt(c.answer.split(' ')[2], 16)] ?? c.answer})` : c.answer}</Text>)}
          {computers?.length === 0 && <Text style={T.sub}>None answered on the usual reply addresses. Step 3 will try the engine computer (7E0).</Text>}
          {hits > 0 && <Text style={[T.sub, { marginTop: 8 }]}>{hits} data ids answered. Export JSON to send them over.</Text>}
        </Card>
      )}

      {(scan || rows > 0) && (
        <Card title="Export" sub="JSON: the bike, every value, the recording and every command with its answer and timing. CSV: the recording, one row per pass, for a spreadsheet.">
          <View style={st.buttons}>
            <Secondary label="Export JSON" icon="share" onPress={() => void exportJson()} style={{ flex: 1 }} />
            <Secondary label="Export CSV" icon="share" disabled={!rows} onPress={() => void exportCsv()} style={{ flex: 1 }} />
          </View>
          {rows > 0 && status !== 'recording' && <TextButton label="Clear the recording" onPress={() => { samples.current = []; setRows(0); setLive(null); }} />}
        </Card>
      )}
    </ScrollView>
  );
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return <View style={[st.reading, last && { borderBottomWidth: 0 }]}><Text style={[st.readSub, { flex: 1, fontSize: 13 }]}>{k}</Text><Text style={[st.readValue, { flexShrink: 1, textAlign: 'right' }]} selectable>{v}</Text></View>;
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  buttons: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
  option: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  optionTitle: { fontSize: 15, color: C.ink, fontWeight: '600' },
  reading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  readName: { fontSize: 14, color: C.ink },
  readSub: { fontSize: 11, color: C.muted, marginTop: 2 },
  readValue: { fontSize: 15, color: C.ink, fontWeight: '600', fontVariant: ['tabular-nums'] },
  input: { flex: 1, minWidth: 150, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, backgroundColor: C.card, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  mono: { fontSize: 12, color: C.ink, marginTop: 6, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
