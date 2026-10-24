import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG, chirpVoice } from '../../../src/config/betty';
import { travelDirection } from '../../../src/core/ambient';
import { checkpoints, weatherLine } from '../../../src/core/RouteAhead';
import { RiderMemoryStore } from '../../../src/adapters/RiderMemoryStore';
import { ASK_CHIPS, END_BUTTON } from '../../../src/ui/copy';
import { DEFAULT_SPAN_KM, MAP_SPANS, MAX_SPAN_KM, MIN_SPAN_KM, MapInput } from '../../../src/ui/mapView';
import type { MapView } from '../../../src/ui/mapGestures';
import { rideView } from '../../../src/ui/rideView';
import { useBetty } from '../state/Betty';
import { Primary, Round, Secondary, TextButton } from '../ui/Buttons';
import { Horizon } from '../ui/Horizon';
import { Icon } from '../ui/Icon';
import { MapSketch } from '../ui/MapSketch';
import { Orb } from '../ui/Orb';
import { Sheet } from '../ui/Sheet';
import { C, T } from '../ui/theme';

type SheetId = 'end' | 'ask' | 'menu' | 'upahead' | null;

/**
 * Ride, while riding (the web's ride screen, design v3): the map following him with Horizon on top, the live pill,
 * the menu and Quiet; the dock with km / min / speed, Betty (mini orb = repeat her last line, what she is doing, her
 * line, the chat button and the microphone: hold to talk, or mute/unmute with open mic), Lock and End ride. What to
 * show is the shared `rideView` (tested on the web); this only paints it.
 */
export default function Ride() {
  const b = useBetty();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<SheetId>(null);
  const [locked, setLocked] = useState(false);
  const [span, setSpan] = useState(DEFAULT_SPAN_KM);
  const [manual, setManual] = useState<MapView | null>(null);
  const [dockH, setDockH] = useState(320);
  const [ask, setAsk] = useState('');
  const marks = useMemo(() => RiderMemoryStore.load().marks, [b.tick]);
  const ride = b.ride?.ride ?? null;

  // With no ride (it ended, by button or by voice), this screen is empty: back to the tabs. Opened just as a ride
  // starts, the ride can arrive a moment after the screen: only leave once it had one, or after 1.5 s without.
  const hadRide = useRef(false);
  if (b.ride) hadRide.current = true;
  useEffect(() => {
    if (b.ride || b.ending) return;
    // A ride worth keeping opens its story (as on the web); a short one goes back to the Ride tab.
    if (hadRide.current) { router.replace(b.ended?.kept ? `/story/${b.ended.rideId}` : '/'); return; }
    const t = setTimeout(() => router.replace('/'), 1500);
    return () => clearTimeout(t);
  }, [b.ride, b.ending, b.ended]);
  if (!ride) return <View style={st.screen} />;

  // His side of the conversation, for the companion's state (hold to talk; open mic listens all ride, so it is not "his turn").
  ride.talk = !b.openMic && b.voice === 'listening' ? 'listening' : 'off';
  const input = ride.rideInput();
  const v = rideView(input);
  const s = ride.agg.current;
  const here = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : ride.real ? null : CONFIG.feeds.fallbackLocation;
  const routeNow = ride.engine.routeNow();
  const map: MapInput = {
    center: manual?.center ?? here, here, headingDeg: travelDirection(s), track: ride.track,
    places: s.nearbyPlaces.map((p) => ({ lat: p.lat, lon: p.lon, label: p.name })),
    incidents: s.incidents.map((i) => ({ lat: i.lat, lon: i.lon, label: i.description })),
    marks,
    route: routeNow?.route.points, routeStops: routeNow?.route.stops.filter((x) => x.named).map((x) => ({ lat: x.lat, lon: x.lon, label: x.name })),
    spanKm: manual?.spanKm ?? span,
  };
  const quiet = input.quietMin > 0;
  const where = [s.area?.suburb, s.area?.town].filter(Boolean).join(', ');
  const note = [where || (ride.real ? 'Free ride' : 'Desk test, simulated'), s.weather ? `${Math.round(s.weather.tempC)}°, ${s.weather.summary}` : '',
    ride.real && !here ? 'waiting for GPS' : '', chirpVoice().name, b.openMic ? 'open mic' : ''].filter(Boolean).join(' · ');

  const zoom = (dir: 'in' | 'out') => {
    if (manual) { setManual({ ...manual, spanKm: Math.min(MAX_SPAN_KM, Math.max(MIN_SPAN_KM, manual.spanKm * (dir === 'in' ? 0.5 : 2))) }); return; }
    const i = MAP_SPANS.indexOf(span);
    setSpan(dir === 'in' ? MAP_SPANS[Math.max(0, i - 1)] : MAP_SPANS[Math.min(MAP_SPANS.length - 1, i + 1)]);
  };
  const endTap = () => { if (b.ending) void b.end(); else setSheet('end'); };
  const voice = b.ride!.voice;

  return (
    <View style={st.screen}>
      <View style={[StyleSheet.absoluteFill, { bottom: dockH - 30 }]}>
        <MapSketch input={map} onView={setManual} fade="ride" />
      </View>
      <View style={[st.topbar, { top: insets.top + 10 }]}>
        <View style={st.livePill}>
          <View style={st.liveDot} />
          <Text style={st.pillText}>{s.speedKmh >= 3 ? 'On the road' : 'Parked'}</Text>
          <Text style={[st.pillText, { color: '#a6ae9f' }]}>·</Text>
          <Text style={st.pillText}>{ride.real ? 'Live' : 'Desk test'}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Round icon="grid" label="Menu: Journeys, Explore, Garage" onPress={() => setSheet('menu')} />
          <Round icon={quiet ? 'mute' : 'headset'} on={quiet} label={quiet ? 'Have Betty talk again' : 'Ask Betty to be quiet'} onPress={() => ride.toggleQuiet()}>
            <View style={[st.audioDot, !quiet && { backgroundColor: '#739363' }]} />
          </Round>
        </View>
      </View>
      <Horizon cues={v.glances} top={insets.top + 62}
        onAction={(k, g) => { if (!ride.island(k, g) && k === 'upahead') setSheet('upahead'); }}
        onDismiss={(key) => { ride.dismiss(key); b.toast('Dismissed for a week.'); }} />
      <View style={[st.mapControls, { bottom: dockH + 14 }]}>
        <Round icon="plus" size={40} label="Zoom map in" onPress={() => zoom('in')} />
        <Round icon="minus" size={40} label="Zoom map out" onPress={() => zoom('out')} />
        <Round icon="target" size={40} label="Recentre map" lit={!!manual} onPress={() => { setManual(null); setSpan(DEFAULT_SPAN_KM); }} />
      </View>

      <View style={[st.dock, { paddingBottom: 18 + insets.bottom }]} onLayout={(e) => setDockH(e.nativeEvent.layout.height)}>
        <View style={st.stats}>
          <Stat value={v.distance} label="km ridden" />
          <View style={st.sep} />
          <Stat value={v.minutes} label={CONFIG.ridingTimeOnly ? 'min riding' : 'min out'} />
          <View style={st.sep} />
          <Stat value={v.speed} label="km/h" />
        </View>
        <View style={st.betty}>
          <View style={st.bettyHead}>
            <Orb size={37} mode={v.orb} label="Repeat Betty's last line" onPress={() => { if (!ride.repeat()) b.toast("She hasn't said anything yet."); }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[T.eyebrow, { fontSize: 8, marginBottom: 4 }]} numberOfLines={1}>{v.kicker}</Text>
              <Text style={st.state} numberOfLines={1}>{v.state}{b.voice === 'connecting' ? ' · connecting…' : ''}</Text>
            </View>
            <Pressable style={st.ghost} onPress={() => setSheet('ask')} accessibilityLabel="Ask Betty a question"><Icon name="chat" /></Pressable>
            <TalkButton />
          </View>
          <Text style={[st.line, v.earlier && { opacity: 0.55 }]} numberOfLines={4}>{v.message}</Text>
          {b.voice === 'listening' && !b.openMic && <Text style={st.listening}>Listening… let go when you are done</Text>}
          {b.openMic && <Text style={st.listening}>{b.voice === 'listening' ? 'Open mic: say "Betty…" to talk (tap the mic to mute)' : b.voice === 'ready' ? 'Mic muted: tap the mic to listen again' : ''}</Text>}
        </View>
        <View style={st.actions}>
          <View style={st.half}><Secondary label="Lock" icon="lock" onPress={() => setLocked(true)} style={st.lock} /></View>
          <View style={st.half}><Pressable style={({ pressed }) => [st.endButton, pressed && { transform: [{ scale: 0.97 }] }]} onPress={endTap} accessibilityRole="button">
            <View style={st.endSquare} /><Text style={st.endText}>{b.ending ? END_BUTTON.ending : END_BUTTON.idle}</Text>
          </Pressable></View>
        </View>
        <Text style={st.note} numberOfLines={1}>{note}</Text>
      </View>

      <Sheet open={sheet === 'end'} onClose={() => setSheet(null)}>
        <View style={{ alignItems: 'center', marginTop: 18, marginBottom: 6 }}><Orb /></View>
        <Text style={[T.sheetTitle, { textAlign: 'left' }]}>Call it a good ride?</Text>
        <Text style={[T.body, { color: C.muted, marginBottom: 20 }]}>I'll sign off and gather the little moments into your journey story.</Text>
        <Primary wide label="End ride" onPress={() => { setSheet(null); void b.end(); }} />
        <TextButton label="Keep riding" onPress={() => setSheet(null)} />
      </Sheet>

      <Sheet open={sheet === 'ask'} onClose={() => setSheet(null)} eyebrow="Ask Betty" title="I'm listening.">
        <View style={st.askRow}>
          <TextInput style={st.input} value={ask} onChangeText={setAsk} placeholder="Ask Betty…" placeholderTextColor="#a0a697" returnKeyType="send" autoFocus
            onSubmitEditing={() => { if (ask.trim()) { b.ride?.ask(ask.trim()); setAsk(''); setSheet(null); } }} />
        </View>
        <View style={st.chips}>
          {ASK_CHIPS.map((c) => (
            <Pressable key={c} style={st.chip} onPress={() => { b.ride?.ask(c); setSheet(null); }}><Text style={st.chipText}>{c}</Text></Pressable>
          ))}
        </View>
        <Primary wide label="Ask Betty" disabled={!ask.trim()} onPress={() => { b.ride?.ask(ask.trim()); setAsk(''); setSheet(null); }} style={{ marginTop: 16 }} />
      </Sheet>

      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title="Go to">
        <Text style={[T.body, { color: C.muted, marginBottom: 20 }]}>Betty keeps riding with you. The bar above the tabs brings you back.</Text>
        <View style={st.menu}>
          {([['journeys', 'Journeys'], ['explore', 'Explore'], ['garage', 'Garage']] as const).map(([id, label]) => (
            <Pressable key={id} style={st.menuButton} onPress={() => { setSheet(null); router.navigate(`/${id}`); }}>
              <Icon name={id} size={26} /><Text style={st.menuText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {/* Owner, 2026-10-24: the talk mode could only be picked before the ride. Switching reconnects (~10 s). */}
        <Text style={[T.eyebrow, { marginTop: 8, marginBottom: 4 }]}>Talking to Betty</Text>
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
            <Text style={st.optionSub}>Play/pause talks, next track repeats her, previous track hands the buttons back. Pauses your music.</Text>
          </View>
          <Switch value={b.buttons} onValueChange={b.setButtons} trackColor={{ true: C.sage, false: '#d6dbd0' }} />
        </View>
      </Sheet>

      <UpAhead open={sheet === 'upahead'} onClose={() => setSheet(null)} />
      {locked && <LockCover onUnlock={() => setLocked(false)} speed={v.speed} line={v.message} onTalk={() => void voice.press().then(() => setTimeout(() => voice.release(), 6000)).catch(() => {})} />}
    </View>
  );
}

const Stat = ({ value, label }: { value: string; label: string }) => (
  <View style={{ alignItems: 'center' }}><Text style={st.statValue}>{value}</Text><Text style={st.statLabel}>{label}</Text></View>
);

/** The microphone: hold to talk (the press decides his turn), or with open mic a tap mutes and unmutes. */
function TalkButton() {
  const b = useBetty();
  const voice = b.ride?.voice;
  const on = b.voice === 'listening';
  const style = [st.voice, on && st.voiceOn];
  if (!voice) return null;
  if (b.openMic) {
    return <Pressable style={style} onPress={() => void voice.toggleMic()} accessibilityLabel={on ? 'Mute the mic' : 'Listen again'}><Icon name={on ? 'mic' : 'mute'} color="#fffbe8" /></Pressable>;
  }
  return (
    <Pressable style={style} onPressIn={() => void voice.press().catch(() => {})} onPressOut={() => voice.release()} accessibilityLabel="Hold to talk to Betty">
      <Icon name="mic" color="#fffbe8" />
    </Pressable>
  );
}

/** "Up ahead": the route's named stops and a point every 40 km, with arrival time and the weather there then. */
function UpAhead({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ride = useBetty().ride?.ride;
  const now = ride?.engine.routeNow();
  if (!ride) return null;
  const p = now?.progress ?? null;
  const wx = ride.engine.routeWeather();
  const rows = now ? checkpoints(now.route, p, 40, 12).map((c) => ({ ...c, w: wx.find((w) => w.name === c.name) ?? null })) : [];
  const left = p ? `${Math.round(p.leftKm)} km and about ${p.leftMin >= 60 ? `${Math.floor(p.leftMin / 60)} h ${String(p.leftMin % 60).padStart(2, '0')}` : `${p.leftMin} min`} to go${p.offKm > 0.4 ? ` · ${p.offKm.toFixed(1)} km off the route` : ''}` : '';
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Up ahead" title={now?.route.name ?? 'Your route'}>
      {!now ? <Text style={T.sub}>No route planned. Plan one in How are we riding? on the Ride screen.</Text> : (
        <>
          {left ? <Text style={[T.sub, { marginBottom: 8 }]}>{left}</Text> : null}
          {rows.length ? rows.map((x) => (
            <View key={`${x.name}${x.km}`} style={st.aheadRow}>
              <Text style={[st.aheadName, !x.named && { fontWeight: '400', color: C.muted }]}>{x.name}</Text>
              <Text style={st.aheadValue}>{x.km} km · {new Date(Date.now() + x.inMin * 60_000).toTimeString().slice(0, 5)}{x.w ? ` · ${weatherLine(x.w)}` : ''}</Text>
            </View>
          )) : <Text style={T.sub}>Nothing left but the road.</Text>}
          <View style={{ flexDirection: 'row', gap: 9, marginTop: 16 }}>
            <Secondary label="Open in Google Maps" onPress={() => void Linking.openURL(now.route.mapsUrl)} style={{ flex: 1 }} />
            <Primary label="Back to the road" icon={null} onPress={onClose} style={{ flex: 1 }} />
          </View>
        </>
      )}
    </Sheet>
  );
}

/**
 * Lock: covers everything so nothing is pressed by accident (gloves, rain, a pocket). Hold the button for 1 s to get
 * back (the web's LockScreen). Speed and her last line stay readable; a tap on Talk asks her (6 s of listening).
 */
function LockCover({ onUnlock, speed, line, onTalk }: { onUnlock: () => void; speed: string; line: string; onTalk: () => void }) {
  const insets = useSafeAreaInsets();
  const fill = useRef(new Animated.Value(0)).current;
  const hold = () => Animated.timing(fill, { toValue: 1, duration: 1000, useNativeDriver: false }).start(({ finished }) => { if (finished) onUnlock(); });
  const letGo = () => { fill.stopAnimation(); Animated.timing(fill, { toValue: 0, duration: 150, useNativeDriver: false }).start(); };
  return (
    <View style={[st.lockCover, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 30 }]}>
      <Text style={st.lockSpeed}>{speed}</Text>
      <Text style={st.lockUnit}>km/h</Text>
      <Text style={st.lockLine} numberOfLines={4}>{line}</Text>
      <View style={{ flex: 1 }} />
      <Pressable style={st.lockTalk} onPress={onTalk} accessibilityLabel="Talk to Betty"><Icon name="mic" size={26} color={C.ink} /><Text style={st.lockTalkText}>Tap to talk</Text></Pressable>
      <Pressable onPressIn={hold} onPressOut={letGo} style={st.unlock} accessibilityLabel="Hold for one second to unlock">
        <Animated.View style={[st.unlockFill, { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        <Icon name="lock" size={18} color={C.onDark} /><Text style={st.unlockText}>Hold to unlock</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.map },
  topbar: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 },
  livePill: { backgroundColor: '#fffdf4dd', borderWidth: 1, borderColor: '#ffffff99', paddingVertical: 8, paddingHorizontal: 11, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.dot },
  pillText: { fontSize: 8, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: C.ink },
  audioDot: { position: 'absolute', bottom: 5, right: 4, width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: '#fff', backgroundColor: '#a9b2a3' },
  mapControls: { position: 'absolute', right: 21, gap: 8, zIndex: 4 },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 22, paddingHorizontal: 22, zIndex: 6,
    shadowColor: '#334c39', shadowOpacity: 0.06, shadowRadius: 32, shadowOffset: { width: 0, height: -7 } },
  stats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  statValue: { fontSize: 24, fontWeight: '500', letterSpacing: -0.8, color: C.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 9, color: C.muted, marginTop: 5 },
  sep: { width: 1, height: 28, backgroundColor: '#e0e5d9' },
  betty: { paddingTop: 18, paddingBottom: 14, paddingHorizontal: 4, marginTop: 16, borderTopWidth: 1, borderTopColor: '#e2e6d9' },
  bettyHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 12 },
  state: { fontSize: 10, color: '#85927e' },
  ghost: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' },
  voice: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  voiceOn: { backgroundColor: C.sage, shadowColor: '#c9dfe4', shadowOpacity: 1, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  line: { fontSize: 13, lineHeight: 20, minHeight: 40, color: C.ink },
  listening: { fontSize: 10, color: C.sageText, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  lock: { backgroundColor: '#e7ebe1', borderWidth: 0 },
  endButton: { minHeight: 48, borderRadius: 14, backgroundColor: C.end, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  endSquare: { width: 9, height: 9, borderRadius: 2, backgroundColor: C.endText },
  endText: { fontSize: 13, color: C.endText },
  note: { fontSize: 9, textAlign: 'center', color: '#a0a697', marginTop: 12 },
  askRow: { marginBottom: 12 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: '#e1e4d8', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: C.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: C.chip, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13 },
  chipText: { fontSize: 12, color: C.ink },
  menu: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  menuButton: { flex: 1, minHeight: 96, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: '#e1e4d8', alignItems: 'center', justifyContent: 'center', gap: 10 },
  menuText: { fontSize: 13, color: C.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e6eade' },
  optionTitle: { fontSize: 14, fontWeight: '500', color: C.ink },
  optionSub: { fontSize: 11, color: C.muted, marginTop: 5 },
  aheadRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#e6eade' },
  aheadName: { fontSize: 13, fontWeight: '500', color: C.ink, flexShrink: 0 },
  aheadValue: { fontSize: 12, color: C.muted, textAlign: 'right', flexShrink: 1 },
  lockCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: C.inkDeep, paddingHorizontal: 28, alignItems: 'center' },
  lockSpeed: { fontSize: 96, fontWeight: '300', color: C.onDark, fontVariant: ['tabular-nums'] },
  lockUnit: { fontSize: 14, color: C.onDarkMuted, marginTop: -6 },
  lockLine: { fontSize: 17, lineHeight: 25, color: C.onDark, textAlign: 'center', marginTop: 36 },
  lockTalk: { width: 150, height: 150, borderRadius: 75, backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 },
  lockTalkText: { fontSize: 14, fontWeight: '600', color: C.ink },
  unlock: { alignSelf: 'stretch', height: 56, borderRadius: 18, backgroundColor: '#ffffff1a', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  unlockFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#ffffff33' },
  unlockText: { color: C.onDark, fontSize: 14, fontWeight: '500' },
});
