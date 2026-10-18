import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useRef, useState } from 'react';
import { FlatList, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { BikeState } from '../src/core/types';
import { ElmClassicTransport } from './src/adapters/ElmClassicTransport';
import { ObdSource } from './src/adapters/ObdSource';
import { Line, Ride, startRide } from './src/rig';

/**
 * Betty, native (first slice, 2026-10-18). A plain ride screen to prove the shared core runs on the phone: start and
 * end a ride, see speed and engine readings, read and hear her lines, type a question, pick the OBD2 reader.
 * The real design (the web app's screens) is rebuilt here step by step; see native/README.md.
 */
export default function App() {
  const ride = useRef<Ride | null>(null);
  const [riding, setRiding] = useState(false);
  const [ending, setEnding] = useState(false);
  const [s, setS] = useState<BikeState | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [ask, setAsk] = useState('');
  const [readers, setReaders] = useState<{ name: string; address: string }[] | null>(null);
  const [reader, setReader] = useState<string | null>(null);

  const add = (l: Line) => setLines((x) => [l, ...x].slice(0, 200));

  const findReaders = async () => {
    try { setReaders(await ElmClassicTransport.paired()); }
    catch (e) { add({ at: Date.now(), head: '[obd]', text: `Bluetooth: ${(e as Error).message}`, item: null }); }
  };

  const start = async () => {
    setLines([]);
    let obd: ObdSource | undefined;
    if (reader) {
      const t = new ElmClassicTransport();
      try { await t.connect(reader); obd = new ObdSource(t, (m) => add({ at: Date.now(), head: '[obd]', text: m, item: null })); }
      catch (e) { add({ at: Date.now(), head: '[obd]', text: `could not connect: ${(e as Error).message}`, item: null }); }
    }
    await activateKeepAwakeAsync();
    ride.current = await startRide({ line: add, state: setS, obd });
    setRiding(true);
  };

  const end = async () => {
    if (!ride.current) return;
    setEnding(true);
    await ride.current.end();
    ride.current = null;
    deactivateKeepAwake();
    setEnding(false); setRiding(false);
  };

  return (
    <SafeAreaView style={st.page}>
      <StatusBar style="dark" />
      <Text style={st.title}>Betty</Text>
      <View style={st.row}>
        <Stat label="km/h" value={s ? String(s.speedKmh) : '-'} />
        <Stat label="rpm" value={s?.obd ? String(s.rpm) : '-'} />
        <Stat label="°C engine" value={s?.obd ? String(s.engineTempC) : '-'} />
        <Stat label="rain %" value={s?.weather ? String(s.weather.rainChanceNextHourPct) : '-'} />
      </View>

      {!riding && Platform.OS === 'android' && (
        <View style={st.card}>
          <Pressable onPress={findReaders}><Text style={st.link}>{readers ? 'Look again for OBD2 readers' : 'Find my OBD2 reader (paired in Bluetooth settings)'}</Text></Pressable>
          {readers?.length === 0 && <Text style={st.muted}>No paired devices. Pair the reader in Android's Bluetooth settings (PIN 1234 or 0000).</Text>}
          {readers?.map((r) => (
            <Pressable key={r.address} onPress={() => setReader(reader === r.address ? null : r.address)}>
              <Text style={[st.reader, reader === r.address && st.on]}>{reader === r.address ? '● ' : '○ '}{r.name} ({r.address})</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable style={[st.button, riding && st.end]} disabled={ending} onPress={riding ? end : start}>
        <Text style={st.buttonText}>{ending ? 'Ending ride…' : riding ? 'End ride' : "Let's ride"}</Text>
      </Pressable>

      {riding && (
        <View style={st.askRow}>
          <TextInput style={st.input} value={ask} onChangeText={setAsk} placeholder="Ask Betty…" returnKeyType="send"
            onSubmitEditing={() => { if (ask.trim()) { ride.current?.ask(ask.trim()); setAsk(''); } }} />
        </View>
      )}

      <FlatList style={st.list} data={lines} keyExtractor={(l, i) => `${l.at}-${i}`} renderItem={({ item }) => (
        <View style={st.line}>
          <Text style={st.head}>{new Date(item.at).toLocaleTimeString()} {item.head}{item.item ? ` · ${item.item.fate}` : ''}</Text>
          <Text style={st.text}>{item.text}</Text>
        </View>
      )} />
    </SafeAreaView>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={st.stat}><Text style={st.statValue}>{value}</Text><Text style={st.muted}>{label}</Text></View>
);

// The web app's palette (src/ui/styles/tokens.css): cream page, ink text, Betty yellow.
const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7f6f0', paddingHorizontal: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#273f39', marginTop: 12, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 24, fontWeight: '700', color: '#273f39' },
  muted: { color: '#657960', fontSize: 13 },
  card: { backgroundColor: '#fffaf0', borderRadius: 14, padding: 12, marginBottom: 12, gap: 6 },
  link: { color: '#657960', fontWeight: '600', fontSize: 16 },
  reader: { fontSize: 16, color: '#273f39', paddingVertical: 4 },
  on: { fontWeight: '700' },
  button: { backgroundColor: '#f4dc85', borderRadius: 28, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  end: { backgroundColor: '#e8ede2' },
  buttonText: { fontSize: 18, fontWeight: '700', color: '#273f39' },
  askRow: { marginBottom: 8 },
  input: { backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  list: { flex: 1 },
  line: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d8cfc2' },
  head: { fontSize: 12, color: '#657960' },
  text: { fontSize: 16, color: '#273f39' },
});
