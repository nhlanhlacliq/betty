import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG } from '../../../../src/config/betty';
import { formatLog } from '../../../../src/core/LineLog';
import { rideMinutes, stoppedMinutes } from '../../../../src/core/RideMemory';
import type { PlannedRoute } from '../../../../src/core/Route';
import { rideAgainStops } from '../../../../src/core/RouteAhead';
import { JourneyStore } from '../../../../src/adapters/JourneyStore';
import { LineLogStore } from '../../../../src/adapters/LineLogStore';
import { RideLog } from '../../../../src/adapters/RideLog';
import { RoadStore } from '../../../../src/adapters/RoadStore';
import { RouteStore } from '../../../../src/adapters/RouteStore';
import { TrackStore } from '../../../../src/adapters/TrackStore';
import { serverFetch } from '../../../../src/adapters/server';
import { deleteRideData, duration, rideTitle, spokenLines, triggerOf } from '../../../../src/app/rides';
import { spanFor, trackCenter } from '../../../../src/ui/mapView';
import { useBetty } from '../../state/Betty';
import { Primary, Secondary, TextButton } from '../../ui/Buttons';
import { Card, Fold } from '../../ui/Card';
import { MapSketch } from '../../ui/MapSketch';
import { Orb } from '../../ui/Orb';
import { C, T } from '../../ui/theme';

const longDate = (ms: number) => new Date(ms).toLocaleString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * A ride's story (the web's, design v3): her orb, his name for the ride (Star, Rename), the numbers with riding and
 * stopped time, the road taken (with hard brakes and bumps), the places and what she flagged, every line she said,
 * and Share the log / Ride this again / Delete. Not yet here: the picture card to share (the web draws it on a
 * canvas) and sending the ride to a friend's Betty.
 */
export default function Story() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rideId = Number(id);
  const b = useBetty();
  const insets = useSafeAreaInsets();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [again, setAgain] = useState('');
  const [, bump] = useState(0);
  const r = useMemo(() => RideLog.load().find((x) => x.startedAt === rideId) ?? null, [rideId, b.data]);
  const said = useMemo(() => { b.logger.save(); return spokenLines(LineLogStore.load(), rideId); }, [rideId, b.data, b.lines.length]);
  const track = useMemo(() => TrackStore.get(rideId), [rideId]);

  if (!r) {
    return (
      <View style={[st.page, { paddingTop: insets.top + 20 }]}>
        <TextButton label="← My journeys" onPress={() => router.back()} />
        <Text style={T.h2}>That ride is not kept on this phone.</Text>
      </View>
    );
  }
  const shown = rideMinutes(r, CONFIG.ridingTimeOnly);
  const stopped = stoppedMinutes(r);
  const places = r.places.length ? `She told you about ${r.places.slice(0, 3).join(', ')}${r.places.length > 3 ? ' and more' : ''}.` : '';
  const flags = r.events.length ? ` On the way she flagged ${r.events.join(', ')}.` : '';
  const blurb = `${r.distanceKm} km and ${duration(shown)} ${CONFIG.ridingTimeOnly && stopped != null ? 'riding' : 'out'}${r.weather ? `, ${r.weather}` : ''}. ${places}${flags}`.trim();
  const moments = [...r.places.map((p) => ({ text: p, kind: 'A sense of place' })), ...r.events.map((e) => ({ text: e, kind: 'Flagged on the way' }))];
  const starred = JourneyStore.starred(rideId);
  const running = !!b.ride && b.ride.ride.engine.rideSnapshot().startedAt === rideId;

  const shareLog = () => { b.logger.save(); void Share.share({ message: formatLog(LineLogStore.load(), RideLog.load(), rideId), title: rideTitle(r) }); };
  const rideAgain = async () => {
    const road = track.length > 1 ? track : RoadStore.get(rideId);
    if (road.length < 2) { b.toast('No road kept for this ride to follow.'); return; }
    setAgain('Planning the route...');
    try {
      const res = await serverFetch('/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stops: rideAgainStops(road), thrilling: false }) });
      const out: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);
      const route: PlannedRoute = { ...out, name: `Again: ${rideTitle(r)}`, plannedAt: Date.now() };
      RouteStore.set(route); b.ride?.ride.engine.setRoute(route); b.touch();
      b.toast(`Planned: ${Math.round(route.km)} km. It's in How are we riding? on the Ride tab.`);
      router.navigate('/');
    } catch (e) { b.toast(`Could not plan it: ${(e as Error).message}`); }
    finally { setAgain(''); }
  };
  const del = () => {
    if (running) { b.toast('That ride is still going: end it first.'); return; }
    b.logger.forgetRide(rideId); deleteRideData(rideId); b.touch();
    b.toast('Ride deleted.'); router.back();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[st.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <View style={st.intro}>
        <View style={{ flex: 1 }}><Text style={[T.eyebrow, { marginBottom: 8 }]}>A ride worth remembering</Text><Text style={T.h2}>Your little escape.</Text></View>
        <TextButton label="← My journeys" onPress={() => router.back()} />
      </View>

      <View style={st.hero}>
        <Orb />
        <Text style={[T.eyebrow, { marginBottom: 8 }]}>Saved privately on this phone</Text>
        {renaming !== null ? (
          <TextInput style={st.rename} value={renaming} onChangeText={setRenaming} autoFocus maxLength={60} returnKeyType="done" selectTextOnFocus
            onEndEditing={() => { JourneyStore.rename(rideId, renaming); setRenaming(null); b.touch(); }} accessibilityLabel="Name this ride" />
        ) : <Text style={[T.h1, { fontSize: 30, lineHeight: 34, textAlign: 'center' }]}>{rideTitle(r)}</Text>}
        <View style={st.tools}>
          <Pressable onPress={() => { JourneyStore.setStar(rideId, !starred); bump((x) => x + 1); }} hitSlop={8}><Text style={st.link}>{starred ? '★ Starred' : '☆ Star'}</Text></Pressable>
          <Pressable onPress={() => setRenaming(rideTitle(r))} hitSlop={8}><Text style={st.link}>Rename</Text></Pressable>
        </View>
        <Text style={[T.body, { textAlign: 'center', color: C.muted }]}>{blurb}</Text>
        <View style={st.stats}>
          <Stat value={String(r.distanceKm)} label="Kilometres" />
          <Stat value={String(shown)} label={CONFIG.ridingTimeOnly && stopped != null ? 'Minutes riding' : 'Minutes'} />
          <Stat value={String(said.length)} label="Things she said" />
          {r.costR != null && <Stat value={`R${r.costR}`} label={`Fuel, ${r.fuelL} L`} />}
        </View>
        {stopped != null && r.minutes > 0 && (
          <View style={{ alignSelf: 'stretch', marginTop: 14 }}>
            <View style={st.split}><View style={[st.splitFill, { width: `${Math.round(((r.minutes - stopped) / r.minutes) * 100)}%` }]} /></View>
            <View style={st.splitText}><Text style={T.sub}><Text style={st.bold}>{duration(r.minutes - stopped)}</Text> riding</Text><Text style={T.sub}><Text style={st.bold}>{duration(stopped)}</Text> stopped</Text></View>
          </View>
        )}
      </View>

      <Card title="The road you took">
        {track.length > 1 ? (
          <View style={st.map}>
            <MapSketch id="story" fade="none" label="The road you took"
              input={{ center: trackCenter(track), here: null, headingDeg: null, track, places: [], incidents: [], marks: [], spanKm: spanFor(track), labelSize: 26,
                rough: (r.rough ?? []).map(([lat, lon]) => ({ lat, lon })) }} />
          </View>
        ) : <Text style={T.sub}>No map for this ride: it was recorded before Betty kept the road, or without GPS.</Text>}
        <Text style={[T.sub, { marginTop: 10 }]}>{longDate(r.startedAt)}{r.rough?.length ? ` · ${r.rough.length} hard brake${r.rough.length === 1 ? '' : 's'} or bump${r.rough.length === 1 ? '' : 's'} (amber)` : ''}</Text>
        {moments.length ? (
          <View style={{ marginTop: 10 }}>
            <Fold items={moments} limit={4} noun="moments" render={(m, i) => (
              <View key={i} style={st.moment}><Text style={st.momentText}>{m.text}</Text><Text style={T.sub}>{m.kind}</Text></View>
            )} />
          </View>
        ) : <Text style={[T.sub, { marginTop: 10 }]}>A quiet ride is a good ride, too.</Text>}
      </Card>

      <Card title="The moments in between">
        {said.length ? (
          <Fold items={said} limit={5} noun="things she said" render={(e) => (
            <View key={e.id} style={st.moment}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={st.momentText}>{triggerOf(e.head).replace(/_/g, ' ')}</Text>
                <Text style={T.sub}>{new Date(e.at).toTimeString().slice(0, 5)}</Text>
              </View>
              <Text style={[T.body, { marginTop: 4 }]}>{e.text.replace(/<[^>]+>/g, '')}</Text>
            </View>
          )} />
        ) : <View style={st.moment}><Text style={st.momentText}>A moment for yourself</Text><Text style={T.sub}>No saved lines for this ride</Text></View>}
        <View style={st.actions}>
          <Secondary label="Share the log" icon="share" onPress={shareLog} style={{ flex: 1 }} />
          {track.length > 1 || RoadStore.get(rideId).length > 1
            ? <Primary label={again || 'Ride this again'} icon={again ? null : 'arrow'} disabled={!!again} onPress={() => void rideAgain()} style={{ flex: 1 }} />
            : <Primary label="Ride again" onPress={() => router.navigate('/')} style={{ flex: 1 }} />}
        </View>
        {asking ? (
          <View style={{ marginTop: 14 }}>
            <Text style={T.sub}><Text style={st.bold}>Delete this ride?</Text> Its map, numbers and everything Betty said on it go from this phone. Your fuel count and odometer stay as they are.</Text>
            <View style={st.actions}>
              <Secondary label="Keep it" onPress={() => setAsking(false)} style={{ flex: 1 }} />
              <Secondary label="Delete" onPress={del} style={{ flex: 1, backgroundColor: C.end, borderColor: 'transparent' }} />
            </View>
          </View>
        ) : <TextButton label="Delete this ride" onPress={() => setAsking(true)} />}
      </Card>
    </ScrollView>
  );
}

const Stat = ({ value, label }: { value: string; label: string }) => (
  <View style={{ alignItems: 'center', flex: 1 }}><Text style={st.statValue}>{value}</Text><Text style={st.statLabel}>{label}</Text></View>
);

const st = StyleSheet.create({
  page: { paddingHorizontal: 20, backgroundColor: C.bg },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  hero: { alignItems: 'center', paddingVertical: 16, marginBottom: 14 },
  tools: { flexDirection: 'row', gap: 22, marginVertical: 12 },
  link: { fontSize: 13, color: C.sageText, fontWeight: '500' },
  rename: { alignSelf: 'stretch', fontSize: 24, fontWeight: '600', color: C.ink, textAlign: 'center', borderBottomWidth: 2, borderBottomColor: C.yellow, paddingVertical: 6 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 18 },
  statValue: { fontSize: 22, fontWeight: '600', letterSpacing: -0.6, color: C.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 9, color: C.muted, marginTop: 4, textAlign: 'center' },
  split: { height: 6, borderRadius: 3, backgroundColor: '#e4e8dd', overflow: 'hidden' },
  splitFill: { height: '100%', backgroundColor: C.sage },
  splitText: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  bold: { fontWeight: '700', color: C.ink },
  map: { height: 280, borderRadius: 16, overflow: 'hidden' },
  moment: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#eef0e8' },
  momentText: { fontSize: 13, fontWeight: '500', color: C.ink, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: 9, marginTop: 16 },
});

