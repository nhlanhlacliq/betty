import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG, chirpVoice, cleanRiderName } from '../../../../src/config/betty';
import { readinessRow } from '../../../../src/core/Reminders';
import { PlannedRoute, routeRequest, routeStats } from '../../../../src/core/Route';
import { FuelStore } from '../../../../src/adapters/FuelStore';
import { RideLog } from '../../../../src/adapters/RideLog';
import { RouteStore } from '../../../../src/adapters/RouteStore';
import { ServiceStore } from '../../../../src/adapters/ServiceStore';
import { TrackStore } from '../../../../src/adapters/TrackStore';
import { serverFetch } from '../../../../src/adapters/server';
import { HOME } from '../../../../src/ui/copy';
import type { IconName } from '../../../../src/ui/icons';
import { DEFAULT_SPAN_KM, MapInput, spanFor, trackCenter } from '../../../../src/ui/mapView';
import type { MapView } from '../../../../src/ui/mapGestures';
import { ElmClassicTransport } from '../../adapters/ElmClassicTransport';
import { useBetty } from '../../state/Betty';
import { Primary, Round, Secondary, TextButton } from '../../ui/Buttons';
import { Icon } from '../../ui/Icon';
import { MapSketch } from '../../ui/MapSketch';
import { Orb } from '../../ui/Orb';
import { Sheet, SheetRow } from '../../ui/Sheet';
import { C, T, shadow } from '../../ui/theme';
import { fuelText } from '../../ui/fuel';

const date = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });

interface ReadyRow { icon: IconName; label: string; value: string; ok: boolean }

/**
 * Ride, before setting off (the web's Home, design v3): the map (a sketch of the last ride, or the planned route), the
 * greeting, and the ride dock: Betty (tap the orb to hear her), how we are riding (Free ride / Desk test, talking,
 * the OBD reader, Where to?), Let's ride, and the readiness line that opens the "before you go" sheet.
 */
export default function Home() {
  const b = useBetty();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<'mode' | 'ready' | null>(null);
  const [dockH, setDockH] = useState(330);
  const [manual, setManual] = useState<MapView | null>(null);
  const [route, setRoute] = useState<PlannedRoute | null>(() => RouteStore.get());
  const [fuelSince, setFuelSince] = useState<number | null>(() => FuelStore.load());
  const [gps, setGps] = useState<string>('');
  void b.tick;

  const rides = b.ready ? RideLog.load() : [];
  const last = rides.length ? [...rides].sort((x, y) => y.startedAt - x.startedAt)[0] : undefined;
  const input: MapInput = useMemo(() => {
    const planned = b.ready ? route : null;
    const track = !planned && last ? TrackStore.get(last.startedAt) : [];
    const home = CONFIG.feeds.fallbackLocation;
    const base: MapInput = planned ? {
      center: trackCenter(planned.points), here: null, headingDeg: null, track: [], route: planned.points,
      routeStops: planned.stops.filter((s) => s.named).map((s) => ({ lat: s.lat, lon: s.lon, label: s.name })),
      places: [], incidents: [], marks: [], spanKm: spanFor(planned.points),
    } : {
      center: trackCenter(track) ?? home, here: track.length ? null : home, headingDeg: null, track,
      places: [], incidents: [], marks: [], spanKm: track.length ? spanFor(track) : DEFAULT_SPAN_KM,
    };
    return manual ? { ...base, center: manual.center, spanKm: manual.spanKm } : base;
  }, [b.ready, route, last?.startedAt, manual]);

  // Explore > Ride there: Where to? opens with the place filled in.
  useEffect(() => { if (b.pendingWhere) setSheet('mode'); }, [b.pendingWhere]);
  // Kept data changed elsewhere (a ride ended, Ride this again): read the route and fuel again.
  useEffect(() => { if (b.ready) { setRoute(RouteStore.get()); setFuelSince(FuelStore.load()); } }, [b.ready, b.data]);

  const riding = !!b.ride;
  const modeTitle = HOME.modes[b.mode].title;
  const ready = readiness(b, gps);
  const bad = ready.filter((r) => !r.ok);
  const voiceRow = ready.find((r) => r.label === 'Voice');

  const go = async () => {
    if (riding) { router.push('/ride'); return; }
    await b.start();
    router.push('/ride');
  };
  const openReady = () => {
    setSheet('ready');
    void Location.getForegroundPermissionsAsync().then((p) => setGps(p.granted ? 'Phone GPS' : p.canAskAgain ? 'Asks when you ride' : 'Not allowed: Settings > Betty > Location'));
  };
  const filled = () => {
    if (b.ride) b.ride.ride.filledUp(); else FuelStore.save(0);
    setFuelSince(0);
  };

  return (
    <View style={st.screen}>
      <View style={[StyleSheet.absoluteFill, { bottom: dockH - 30 }]}>
        <MapSketch input={input} onView={setManual} fade="home"
          label={route ? `Your route to ${route.name}: not for navigation` : 'Sketch of your last ride: not for navigation'} />
      </View>
      <View style={[st.header, { top: insets.top + 9 }]} pointerEvents="box-none">
        <Text style={st.wordmark}>betty<Text style={{ color: '#bda24d' }}>.</Text></Text>
        <Pressable style={st.avatar} onPress={() => router.navigate('/garage')} accessibilityLabel="Garage and settings">
          <Text style={st.avatarText}>{cleanRiderName(CONFIG.riderName).slice(0, 1).toUpperCase()}</Text>
        </Pressable>
      </View>
      <View style={[st.greeting, { top: insets.top + 72 }]} pointerEvents="none">
        <Text style={[T.eyebrow, { fontSize: 8, letterSpacing: 1.7, color: '#748273', marginBottom: 10 }]}>{HOME.eyebrow}</Text>
        <Text style={[T.h1, { maxWidth: 260 }]}>{HOME.headline}</Text>
        <View style={st.condition}>
          <Icon name="sun" size={15} />
          {last?.weather?.match(/-?\d+\s*C/) ? <Text style={st.conditionTemp}>{last.weather.match(/-?\d+\s*C/)![0].replace(/\s*C/, '°')}</Text> : null}
          <Text style={st.conditionText}>{last ? HOME.conditionLast(last.distanceKm, date(last.startedAt)) : HOME.conditionFirst}</Text>
        </View>
      </View>
      <View style={[st.recenter, { bottom: dockH + 14 }]}>
        <Round icon="target" size={40} label="Recentre map" onPress={() => setManual(null)} lit={!!manual} />
      </View>

      <View style={st.dock} onLayout={(e) => setDockH(e.nativeEvent.layout.height)}>
        <View style={st.handle} />
        <View style={st.readyRow}>
          <Orb size={52} mode={b.helloSpeaking ? 'speaking' : 'resting'} label="Hear Betty's voice"
            onPress={() => b.hello(HOME.hello(cleanRiderName(CONFIG.riderName)))} />
          <View style={{ flex: 1 }}>
            <Text style={[T.eyebrow, { fontSize: 7, letterSpacing: 1.4, marginBottom: 7 }]}>Your riding companion</Text>
            <Text style={st.readyTitle}>{HOME.companion}</Text>
            <Text style={[T.sub, { fontSize: 11, marginTop: 5 }]}>{HOME.companionCaption}</Text>
          </View>
        </View>
        <Pressable style={st.destination} onPress={() => setSheet('mode')} accessibilityRole="button" accessibilityLabel="How are we riding?">
          <Icon name={b.mode === 'real' ? 'ride' : 'wrench'} color="#7f9082" />
          <View style={{ flex: 1 }}>
            <Text style={st.destSmall}>{HOME.pickerLabel}</Text>
            <Text style={st.destTitle} numberOfLines={1}>{route ? `${modeTitle} · ${route.name}` : modeTitle}{b.openMic ? ' · open mic' : ''}{b.buttons ? ' · buttons' : ''}</Text>
          </View>
          <Icon name="chev" color="#909b8d" />
        </Pressable>
        {b.ready ? <Primary wide label={riding ? 'Back to the ride' : "Let's ride"} onPress={() => void go()} /> : <View style={st.loading}><ActivityIndicator color={C.ink} /></View>}
        <TextButton label="Check everything before you go" icon="arrow" onPress={openReady} />
        <View style={st.readiness}>
          <View style={st.readyBit}><View style={[st.dot, bad.length > 0 && { backgroundColor: C.warn }]} /><Text style={st.readyText}>{bad.length ? `Check: ${bad[0].label.toLowerCase()}` : 'Betty ready'}</Text></View>
          {voiceRow ? <View style={[st.readyBit, { flexShrink: 1 }]}><Icon name="headset" size={11} color="#949d90" /><Text style={st.readyText} numberOfLines={1}>{voiceRow.value}</Text></View> : null}
          <Pressable style={st.readyBit} onPress={openReady} hitSlop={8}><Text style={st.readyText}>Details</Text><Icon name="info" size={11} color="#949d90" /></Pressable>
        </View>
      </View>

      <ModeSheet open={sheet === 'mode'} onClose={() => setSheet(null)} route={route} setRoute={(r) => { setRoute(r); setManual(null); b.ride?.ride.engine.setRoute(r); }} />
      <Sheet open={sheet === 'ready'} onClose={() => setSheet(null)} eyebrow="Before you go" title="Everything in place.">
        {ready.map((r) => <SheetRow key={r.label} label={r.label} value={r.value} bad={!r.ok} icon={<Icon name={r.icon} size={15} />} />)}
        <SheetRow label="Fuel range" value={fuelText(b.ride ? b.ride.ride.engine.kmSinceFill() : fuelSince)} icon={<Icon name="fuel" size={15} />} />
        <View style={st.actions}>
          <Secondary label="Filled up" onPress={filled} style={{ flex: 1 }} />
          <Primary label="All good" icon={null} onPress={() => setSheet(null)} style={{ flex: 1 }} />
        </View>
      </Sheet>
    </View>
  );
}

/** What is in place before a ride (the web's readiness rows, for the phone). */
function readiness(b: ReturnType<typeof useBetty>, gps: string): ReadyRow[] {
  const book = b.ready ? ServiceStore.load() : null;
  return [
    { icon: 'pin', label: 'GPS', value: b.mode === 'sim' ? 'Simulated (desk test)' : gps || 'Phone GPS', ok: !/Not allowed/.test(gps) },
    { icon: 'volume', label: 'Voice', value: `Chirp, ${chirpVoice().name}`, ok: true },
    { icon: 'headset', label: 'Talking to her', value: `${b.openMic ? 'Open mic: say "Betty…"' : 'Hold the talk button'}${b.buttons ? ', headset buttons' : ''}`, ok: true },
    { icon: 'spark', label: 'Brain', value: 'Claude, keys on the server', ok: true },
    { icon: 'gauge', label: 'Engine data', value: b.reader ? 'OBD2 reader' : 'Off: GPS only', ok: true },
    { icon: 'wrench', label: 'Maintenance', ...(book ? readinessRow(book, Date.now()) : { value: '-', ok: true }) },
    { icon: 'lock', label: 'Screen', value: 'Kept awake while riding', ok: true },
  ];
}

/**
 * "How are we riding?": Free ride or Desk test, how he talks to her (hold to talk / open mic), the OBD2 reader
 * (Android), and Where to? (places or a Google Maps link, planned by TomTom on Betty's server).
 */
function ModeSheet({ open, onClose, route, setRoute }: { open: boolean; onClose: () => void; route: PlannedRoute | null; setRoute: (r: PlannedRoute | null) => void }) {
  const b = useBetty();
  const [where, setWhere] = useState('');
  const [twisty, setTwisty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [readers, setReaders] = useState<{ name: string; address: string }[] | null>(null);
  const riding = !!b.ride;
  useEffect(() => { if (open && b.pendingWhere) { setWhere(b.pendingWhere); b.setPendingWhere(null); } }, [open, b.pendingWhere]);

  const plan = async () => {
    if (!where.trim() || busy) return;
    setBusy(true); setNote('');
    try {
      const here = b.ride?.ride.agg.current;
      let from = here?.lat != null && here.lon != null ? { lat: here.lat, lon: here.lon } : null;
      if (!from) { const p = await Location.getLastKnownPositionAsync().catch(() => null); if (p) from = { lat: p.coords.latitude, lon: p.coords.longitude }; }
      const res = await serverFetch('/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(routeRequest(where, twisty, from)) });
      const out: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
      const r: PlannedRoute = { ...out, plannedAt: Date.now() };
      RouteStore.set(r); setRoute(r); setWhere('');
      setNote(`Planned: ${r.name}, ${Math.round(r.km)} km.`);
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  };
  const findReaders = async () => {
    try { setReaders(await ElmClassicTransport.paired()); } catch (e) { setNote(`Bluetooth: ${(e as Error).message}`); }
  };

  return (
    <Sheet open={open} onClose={onClose} eyebrow="Your next little escape" title="How are we riding?">
      {(['real', 'sim'] as const).map((m) => {
        const on = b.mode === m;
        return (
          <Pressable key={m} style={st.option} disabled={riding && !on} onPress={() => b.setMode(m)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
            <View style={[st.placeIcon, on && { backgroundColor: C.yellow }]}><Icon name={m === 'real' ? 'ride' : 'wrench'} color={on ? C.ink : '#85957a'} /></View>
            <View style={{ flex: 1 }}><Text style={st.optionTitle}>{HOME.modes[m].title}</Text><Text style={st.optionSub}>{HOME.modes[m].sub}</Text></View>
            <Text style={st.check}>{on ? '✓' : '›'}</Text>
          </Pressable>
        );
      })}

      <Text style={[T.eyebrow, { marginTop: 22, marginBottom: 4 }]}>Talking to Betty</Text>
      <View style={st.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={st.optionTitle}>Open mic</Text>
          <Text style={st.optionSub}>{b.openMic ? 'Say "Betty…" to talk. The helmet stays in call mode.' : 'Off: hold the talk button to speak to her.'}</Text>
        </View>
        <Switch value={b.openMic} onValueChange={b.setOpenMic} trackColor={{ true: C.sage, false: '#d6dbd0' }} />
      </View>
      <View style={st.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={st.optionTitle}>Headset buttons</Text>
          <Text style={st.optionSub}>Play/pause talks to Betty{b.openMic ? ' (with open mic: mutes and unmutes)' : ''}, next track repeats her, previous track hands the buttons back. Pauses your music while she has them.</Text>
        </View>
        <Switch value={b.buttons} onValueChange={b.setButtons} trackColor={{ true: C.sage, false: '#d6dbd0' }} />
      </View>

      {Platform.OS === 'android' && !riding && (
        <>
          <Text style={[T.eyebrow, { marginTop: 22, marginBottom: 4 }]}>Engine data</Text>
          <TextButton label={readers ? 'Look again for OBD2 readers' : 'Find my OBD2 reader (paired in Bluetooth settings)'} onPress={() => void findReaders()} />
          {readers?.length === 0 && <Text style={T.sub}>No paired devices. Pair the reader in Android's Bluetooth settings (PIN 1234 or 0000).</Text>}
          {readers?.map((r) => (
            <Pressable key={r.address} style={st.option} onPress={() => b.setReader(b.reader === r.address ? null : r.address)}>
              <Text style={st.optionTitle}>{b.reader === r.address ? '● ' : '○ '}{r.name}</Text><Text style={st.optionSub}>{r.address}</Text>
            </Pressable>
          ))}
        </>
      )}

      <Text style={[T.eyebrow, { marginTop: 22, marginBottom: 8 }]}>Where to?</Text>
      <View style={st.routeForm}>
        <TextInput style={st.input} value={where} onChangeText={setWhere} placeholder="Clarens, or stops: Heidelberg, Villiers, Clarens, or a Google Maps link"
          placeholderTextColor="#a0a697" returnKeyType="go" onSubmitEditing={() => void plan()} autoCorrect={false} />
        <Primary label={busy ? 'Planning…' : 'Plan'} icon={null} onPress={() => void plan()} disabled={busy || !where.trim()} style={{ paddingHorizontal: 16 }} />
      </View>
      <View style={st.switchRow}>
        <Text style={[st.optionTitle, { flex: 1, fontWeight: '400' }]}>Twisty roads (thrilling route)</Text>
        <Switch value={twisty} onValueChange={setTwisty} trackColor={{ true: C.sage, false: '#d6dbd0' }} />
      </View>
      <Text style={st.tip}>Tip: plan your ride in Google Maps, stops and all, tap Share and paste the link here.</Text>
      {note ? <Text style={[T.sub, { marginTop: 8 }]}>{note}</Text> : null}
      {route && (
        <View style={st.routeCard}>
          <Text style={st.optionTitle}>{route.name}</Text>
          {route.why ? <Text style={st.optionSub}>{route.why}</Text> : null}
          <Text style={st.optionSub}>{routeStats(route)}</Text>
          <View style={st.actions}>
            <Secondary label="Open in Google Maps" onPress={() => void Linking.openURL(route.mapsUrl)} style={{ flex: 1 }} />
            <Secondary label="Clear" onPress={() => { RouteStore.set(null); setRoute(null); }} />
          </View>
        </View>
      )}
      <Text style={st.tip}>Betty follows the route for time left, stops and leaving it. Google Maps gives you the turns. Leave it empty for a free ride.</Text>
    </Sheet>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.map },
  header: { position: 'absolute', left: 25, right: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 3 },
  wordmark: { fontSize: 29, fontWeight: '800', letterSpacing: -1.5, color: C.ink },
  avatar: { height: 36, width: 36, borderRadius: 18, borderWidth: 1, borderColor: '#ffffff99', backgroundColor: '#f8f9f0d0', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '600', color: C.ink },
  greeting: { position: 'absolute', left: 26, right: 26, zIndex: 3 },
  condition: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16 },
  conditionTemp: { fontSize: 11, fontWeight: '600', color: C.ink },
  conditionText: { fontSize: 10, color: '#818c7f' },
  recenter: { position: 'absolute', right: 22, zIndex: 4 },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 14,
    shadowColor: '#334c39', shadowOpacity: 0.06, shadowRadius: 32, shadowOffset: { width: 0, height: -7 }, zIndex: 5 },
  handle: { width: 33, height: 4, borderRadius: 4, backgroundColor: '#d6dbd0', alignSelf: 'center', marginBottom: 18 },
  readyRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 20 },
  readyTitle: { fontSize: 20, letterSpacing: -0.55, fontWeight: '600', color: C.ink },
  destination: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: '#e1e4d8', borderRadius: 16, paddingVertical: 13, paddingHorizontal: 16, minHeight: 64, marginBottom: 12 },
  destSmall: { fontSize: 8, fontWeight: '500', letterSpacing: 1, color: C.muted, textTransform: 'uppercase', marginBottom: 5 },
  destTitle: { fontSize: 15, fontWeight: '500', color: C.ink },
  loading: { minHeight: 55, alignItems: 'center', justifyContent: 'center' },
  readiness: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#e5e8df' },
  readyBit: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  readyText: { fontSize: 9, color: '#949d90' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.dot },
  actions: { flexDirection: 'row', gap: 9, marginTop: 16, flexWrap: 'wrap' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 76, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#e6eade' },
  placeIcon: { width: 41, height: 41, borderRadius: 12, backgroundColor: '#e8eddf', alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 14, fontWeight: '500', color: C.ink },
  optionSub: { fontSize: 11, color: C.muted, marginTop: 5 },
  check: { fontSize: 17, color: '#829876' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  routeForm: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: '#e1e4d8', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: C.ink, ...shadow, shadowOpacity: 0 },
  tip: { fontSize: 11, color: '#929e88', marginTop: 10, lineHeight: 16 },
  routeCard: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: '#e1e4d8' },
});
