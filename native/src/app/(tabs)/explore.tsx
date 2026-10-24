import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AreaCard, areaCards, dayKey, exploreStats, filterCard, fitView, matchesText, NEW_FOR_MS, storyOfDay } from '../../../../src/core/Explore';
import type { MarkedSpot, RiderMemory } from '../../../../src/core/Commands';
import type { AreaNote } from '../../../../src/core/types';
import { AreaStore, ToldStore } from '../../../../src/adapters/AreaSource';
import { RiderMemoryStore } from '../../../../src/adapters/RiderMemoryStore';
import { serverFetch } from '../../../../src/adapters/server';
import { MAP_H, MAP_W, areaPinRadius, projector } from '../../../../src/ui/mapView';
import type { MapView } from '../../../../src/ui/mapGestures';
import { useBetty } from '../../state/Betty';
import { Secondary } from '../../ui/Buttons';
import { Card, Choice, Fold, Search } from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { MapSketch } from '../../ui/MapSketch';
import { Sheet } from '../../ui/Sheet';
import { C, T } from '../../ui/theme';

type Tab = 'all' | 'stories' | 'unheard' | 'notes';
const when = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
const mapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

/**
 * Explore (the web's, design v3): the tally, the story of the day (Listen), his marked spots and notes, and the area
 * stories as cards (a ring for heard of all, unheard first, folded to 3, Listen to each, Ride there). Search and the
 * tabs filter everything; Map shows the areas (yellow while some are unheard, bigger with more) and his spots, tap a
 * dot to open it. Listen reads a story in her Chirp voice; heard to the end it counts as told on a ride too.
 * The grouping, filtering and picks are the shared core (core/Explore).
 */
export default function Explore() {
  const b = useBetty();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const stopPlay = useRef<(() => void) | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [box, setBox] = useState({ w: 360, h: 420 });
  const [pin, setPin] = useState<{ card?: AreaCard; spot?: MarkedSpot } | null>(null);
  const dayPick = useRef<{ day: string; pick: ReturnType<typeof storyOfDay> } | null>(null);

  const told = useMemo(() => new Set(b.ride ? b.ride.ride.engine.toldNoteIds() : ToldStore.load()), [b.data, b.ride, playing]);
  const kept = useMemo(() => (b.ready ? Object.entries(AreaStore.all()).map(([key, k]) => ({ key, notes: k.notes ?? [], at: k.at ?? 0, lat: k.lat, lon: k.lon })) : []), [b.ready, b.data]);
  const cards = useMemo(() => areaCards(kept, told), [kept, told]);
  const memory: RiderMemory = useMemo(() => (b.ready ? RiderMemoryStore.load() : { notes: [], marks: [] }), [b.ready, b.data]);
  const stats = exploreStats(cards, memory.marks.length, Date.now());
  // The story of the day stays the day's pick once heard (it shows "Hear it again"), so it does not swap under him.
  const today = dayKey(Date.now());
  if (!dayPick.current || dayPick.current.day !== today) dayPick.current = { day: today, pick: storyOfDay(cards, told, today) };
  const pick = dayPick.current.pick;

  const shownCards = tab === 'notes' ? [] : cards.map((c) => filterCard(c, q, told, tab === 'unheard')).filter((c): c is AreaCard => !!c);
  const spots = tab === 'all' || tab === 'notes' ? [...memory.marks].reverse().filter((m) => matchesText(q, m.note, m.near ?? '')) : [];
  const notes = tab === 'all' || tab === 'notes' ? [...memory.notes].reverse().filter((n) => matchesText(q, n.text)) : [];

  // Areas found before positions were kept: looked up one a second (Nominatim's rule), each kept for good.
  useEffect(() => {
    if (mode !== 'map') return;
    const missing = cards.filter((c) => c.lat == null);
    if (!missing.length) return;
    let stop = false;
    void (async () => {
      for (const c of missing) {
        if (stop) return;
        try {
          const key = c.keys[0], region = key.split('|')[1] ?? 'South Africa';
          const res = await serverFetch(`/api/area?q=${encodeURIComponent(`${c.name}, ${region}`)}`);
          if (res.ok) { const p = await res.json(); if (Number.isFinite(p?.lat)) { AreaStore.place(key, { lat: p.lat, lon: p.lon }); b.touch(); } }
        } catch { /* tried again next visit */ }
        await new Promise((r) => setTimeout(r, 1100));
      }
    })();
    return () => { stop = true; };
  }, [mode, cards.length]);
  useEffect(() => () => stopPlay.current?.(), []);

  const listen = (note: AreaNote) => {
    if (b.ride) { b.toast('On a ride, ask her: "tell me a story".'); return; }
    stopPlay.current?.();
    if (playing === note.id) { setPlaying(null); return; }
    setPlaying(note.id);
    stopPlay.current = b.listen(note.text, (heard) => {
      if (heard) ToldStore.save([...new Set([...ToldStore.load(), note.id])]);
      setPlaying((p) => (p === note.id ? null : p));
      stopPlay.current = null;
    });
  };
  const forget = (m: RiderMemory) => { RiderMemoryStore.save(m); b.ride?.ride.engine.setMemory(m); b.touch(); };
  const rideThere = (place: string) => { b.setPendingWhere(place); router.navigate('/'); b.toast(`${place} is in Where to? Tap Plan.`); };

  const pins = cards.filter((c) => c.lat != null && c.lon != null);
  const mapPoints = [...pins.map((c) => ({ lat: c.lat!, lon: c.lon! })), ...memory.marks];
  const fitted = view ?? (mapPoints.length ? fitView(mapPoints, box.w, box.h) : null);
  const tapMap = (p: { x: number; y: number }, bx: { w: number; h: number }) => {
    if (!fitted) return;
    const k = Math.max(bx.w / MAP_W, bx.h / MAP_H) || 1;
    const tap = { x: (p.x - (bx.w - MAP_W * k) / 2) / k, y: (p.y - (bx.h - MAP_H * k) / 2) / k };
    const at = projector(fitted.center, fitted.spanKm);
    let best: { d: number; card?: AreaCard; spot?: MarkedSpot } | null = null;
    for (const c of pins) {
      const pt = at({ lat: c.lat!, lon: c.lon! });
      const d = Math.hypot(tap.x - pt.x, tap.y - pt.y) - areaPinRadius({ id: c.name, lat: c.lat!, lon: c.lon!, label: c.name, unheard: c.notes.length - c.heard, total: c.notes.length });
      if (!best || d < best.d) best = { d, card: c };
    }
    for (const m of memory.marks) { const pt = at(m); const d = Math.hypot(tap.x - pt.x, tap.y - pt.y) - 12; if (!best || d < best.d) best = { d, spot: m }; }
    if (best && best.d * k < 14) setPin({ card: best.card, spot: best.spot });
  };

  const storyRow = (n: AreaNote) => {
    const heard = told.has(n.id);
    return (
      <View key={n.id} style={st.story}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[T.eyebrow, { flex: 1 }]}>{n.topic}{heard ? ' · heard' : ''}</Text>
          <Pressable style={[st.listen, playing === n.id && { backgroundColor: C.ink }]} onPress={() => listen(n)} accessibilityLabel={playing === n.id ? 'Stop' : 'Listen'}>
            <Icon name={playing === n.id ? 'stop' : 'play'} size={13} color={playing === n.id ? '#fffbe8' : C.ink} />
            <Text style={[st.listenText, playing === n.id && { color: '#fffbe8' }]}>{playing === n.id ? 'Stop' : 'Listen'}</Text>
          </Pressable>
        </View>
        <Text style={[T.body, { marginTop: 6 }, heard && { color: C.muted }]}>{n.text}</Text>
      </View>
    );
  };
  const areaCard = (c: AreaCard) => {
    const unheard = c.notes.filter((n) => !told.has(n.id)).length;
    const total = cards.find((x) => x.name === c.name)?.notes.length ?? c.notes.length;
    const heardAll = cards.find((x) => x.name === c.name)?.heard ?? 0;
    const open = openCards.has(c.name) || !!q.trim();
    return (
      <View key={c.name} style={st.area}>
        <Pressable style={st.areaHead} onPress={() => { const s2 = new Set(openCards); if (s2.has(c.name)) s2.delete(c.name); else s2.add(c.name); setOpenCards(s2); }} accessibilityState={{ expanded: open }}>
          <Ring heard={heardAll} total={total} unheard={unheard} />
          <View style={{ flex: 1 }}>
            <Text style={st.areaName}>{c.name}{c.at && Date.now() - c.at < NEW_FOR_MS ? '  ' : ''}{c.at && Date.now() - c.at < NEW_FOR_MS ? <Text style={st.newTag}> New </Text> : null}</Text>
            <Text style={T.sub}>{unheard ? `${unheard} not heard yet · ` : 'All heard · '}{total} stor{total === 1 ? 'y' : 'ies'}</Text>
          </View>
          <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon name="chev" color="#909b8d" /></View>
        </Pressable>
        {open && (
          <View style={{ marginTop: 6 }}>
            <Fold items={c.notes} limit={3} noun="stories" render={storyRow} />
            <Secondary label={`Ride there: ${c.name}`} icon="route" onPress={() => rideThere(c.name)} style={{ marginTop: 10 }} />
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[st.page, { paddingTop: insets.top + 20 }]} keyboardShouldPersistTaps="handled">
      <View style={st.head}>
        <View style={{ flex: 1 }}>
          <Text style={[T.eyebrow, { marginBottom: 10 }]}>Follow your curiosity</Text>
          <Text style={[T.h1, { fontSize: 33, lineHeight: 37 }]}>Good roads. New stories.</Text>
          <Text style={[T.sub, { marginTop: 8 }]}>The stories she knows about the places you ride, spots you marked and things you asked her to remember.</Text>
        </View>
        <Pressable style={st.modeBtn} onPress={() => setMode(mode === 'list' ? 'map' : 'list')} accessibilityLabel={mode === 'list' ? 'Show the map' : 'Show the list'}>
          <Icon name={mode === 'list' ? 'pin' : 'book'} size={15} /><Text style={st.modeText}>{mode === 'list' ? 'Map' : 'List'}</Text>
        </Pressable>
      </View>
      {cards.length + memory.marks.length + memory.notes.length > 0 && (
        <Text style={st.tally}>{stats.areas} area{stats.areas === 1 ? '' : 's'} · {stats.heard} of {stats.stories} stories heard · {stats.spots} spot{stats.spots === 1 ? '' : 's'}{stats.fresh ? ` · ${stats.fresh} new this week` : ''}</Text>
      )}
      <Search value={q} onChange={setQ} placeholder="Search areas, stories, spots and notes" />
      <View style={{ marginBottom: 14 }}>
        <Choice value={tab} onChange={setTab} options={[['all', 'Everything'], ['stories', 'Area stories'], ['unheard', 'Not heard yet'], ['notes', 'Notes']]} />
      </View>

      {mode === 'map' && tab !== 'notes' ? (
        fitted ? (
          <View style={st.map} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            <MapSketch id="explore" fade="none" label="Your areas and spots" onView={setView} onTap={tapMap}
              input={{ center: fitted.center, spanKm: fitted.spanKm, here: null, headingDeg: null, track: [], places: [], incidents: [],
                marks: tab === 'all' ? memory.marks : [], markRadius: 12,
                areaPins: shownCards.filter((c) => c.lat != null).map((c) => {
                  const full = cards.find((x) => x.name === c.name)!;
                  return { id: c.name, lat: c.lat!, lon: c.lon!, label: c.name, unheard: full.notes.length - full.heard, total: full.notes.length };
                }) }} />
          </View>
        ) : <Text style={T.sub}>Nothing on the map yet: area stories and marked spots show here once you have some.</Text>
      ) : (
        <>
          {!q && tab !== 'notes' && pick && (
            <Card title="Story of the day" sub={pick.area}>
              {storyRow(pick.note)}
              <Pressable onPress={() => { setOpenCards(new Set([...openCards, pick.area])); setTab('all'); }}><Text style={[st.link, { marginTop: 10 }]}>More from {pick.area}</Text></Pressable>
            </Card>
          )}
          {spots.map((m) => (
            <View key={`m${m.at}`} style={st.area}>
              <View style={st.areaHead}>
                <View style={st.spotDot}><Icon name="pin" size={16} color="#fffbe8" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={st.areaName}>{m.note || 'Marked spot'}</Text>
                  <Text style={T.sub}>{[m.near && `near ${m.near}`, `marked ${when(m.at)}`].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
              <View style={st.rowActions}>
                <Secondary label="Open map" icon="ne" onPress={() => void Linking.openURL(mapsUrl(m.lat, m.lon))} style={{ flex: 1 }} />
                <Secondary label="Forget" onPress={() => forget({ ...memory, marks: memory.marks.filter((x) => x.at !== m.at) })} style={{ flex: 1 }} />
              </View>
            </View>
          ))}
          {notes.map((n) => (
            <View key={`n${n.at}`} style={st.area}>
              <Text style={T.body}>{n.text}</Text>
              <View style={[st.rowActions, { alignItems: 'center' }]}>
                <Text style={[T.sub, { flex: 1 }]}>Noted {when(n.at)}</Text>
                <Secondary label="Forget" onPress={() => forget({ ...memory, notes: memory.notes.filter((x) => x.at !== n.at) })} />
              </View>
            </View>
          ))}
          {shownCards.map(areaCard)}
          {!shownCards.length && !spots.length && !notes.length && (
            <Card title="A little less planning" sub="You don't always need a destination.">
              <Text style={T.sub}>{q ? 'Nothing matches that.' : 'On a ride, say "mark this spot" or "remember that…" and it lands here. Area stories are researched the first time you ride through a town.'}</Text>
            </Card>
          )}
        </>
      )}

      <Sheet open={!!pin} onClose={() => setPin(null)} eyebrow={pin?.spot ? 'Your marked spot' : 'Area stories'} title={pin?.card?.name ?? pin?.spot?.note ?? 'Marked spot'}>
        {pin?.card && (
          <>
            <Fold items={pin.card.notes} limit={3} noun="stories" render={storyRow} />
            <Secondary label={`Ride there: ${pin.card.name}`} icon="route" onPress={() => { const n = pin.card!.name; setPin(null); rideThere(n); }} style={{ marginTop: 12 }} />
          </>
        )}
        {pin?.spot && (
          <>
            <Text style={T.sub}>{[pin.spot.near && `near ${pin.spot.near}`, `marked ${when(pin.spot.at)}`].filter(Boolean).join(' · ')}</Text>
            <Secondary label="Open map" icon="ne" onPress={() => void Linking.openURL(mapsUrl(pin.spot!.lat, pin.spot!.lon))} style={{ marginTop: 12 }} />
          </>
        )}
      </Sheet>
    </ScrollView>
  );
}

/** Heard of all as a ring, the unheard count in the middle. */
function Ring({ heard, total, unheard }: { heard: number; total: number; unheard: number }) {
  const r = 17, c = 2 * Math.PI * r, f = total ? heard / total : 0;
  return (
    <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={44} height={44} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={22} cy={22} r={r} stroke="#e4e8dd" strokeWidth={4} fill="none" />
        <Circle cx={22} cy={22} r={r} stroke={C.sage} strokeWidth={4} fill="none" strokeDasharray={`${c * f} ${c}`} strokeLinecap="round" />
      </Svg>
      <Text style={{ fontSize: 13, fontWeight: '700', color: unheard ? C.ink : C.sage }}>{unheard || '✓'}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingBottom: 40 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  modeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.chip, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 12 },
  modeText: { fontSize: 12, fontWeight: '600', color: C.ink },
  tally: { fontSize: 11, color: C.sageText, marginBottom: 12 },
  area: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardLine, padding: 14, marginBottom: 10 },
  areaHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  areaName: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: C.ink, marginBottom: 3 },
  newTag: { fontSize: 10, fontWeight: '700', color: C.ink, backgroundColor: C.yellow },
  story: { paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#eef0e8' },
  listen: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.chip, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 10 },
  listenText: { fontSize: 11, fontWeight: '600', color: C.ink },
  link: { fontSize: 12, color: C.sageText, fontWeight: '500' },
  spotDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#2f4741', alignItems: 'center', justifyContent: 'center' },
  rowActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  map: { height: 460, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.cardLine },
});
