import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG } from '../../../../src/config/betty';
import { fitView } from '../../../../src/core/Explore';
import { findRides, groupByMonth, monthKey, monthLabel, monthNumbers, onThisDay } from '../../../../src/core/Journeys';
import { rideRecords } from '../../../../src/core/Records';
import { RideRecord, fuelSpend, rideMinutes } from '../../../../src/core/RideMemory';
import { JourneyStore } from '../../../../src/adapters/JourneyStore';
import { RideLog } from '../../../../src/adapters/RideLog';
import { RoadStore } from '../../../../src/adapters/RoadStore';
import { SHORT_KM, SHORT_MIN, deleteRideData, duration, rideTitle } from '../../../../src/app/rides';
import { MAP_H, MAP_W, projector } from '../../../../src/ui/mapView';
import { miniTrackSvg } from '../../../../src/ui/miniMap';
import type { MapView } from '../../../../src/ui/mapGestures';
import { useBetty } from '../../state/Betty';
import { Secondary } from '../../ui/Buttons';
import { Card, Search } from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { MapSketch } from '../../ui/MapSketch';
import { Orb } from '../../ui/Orb';
import { C, T } from '../../ui/theme';

const date = (ms: number) => new Date(ms).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const n = (v: number) => v.toLocaleString('en-US');

/**
 * My journeys (the web's, design v3): totals and fuel spend, On this day, this month so far (week bars), Records,
 * Your roads (every ride's road on one map; tap one to open it), and the rides by month (newest open). Search and
 * starred filter the rides. Hold a ride to select several: Short rides, Star, Delete. A ride opens its story.
 * All the sums are the shared core (Journeys, Records); this only lays them out.
 */
export default function Journeys() {
  const b = useBetty();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [openMonths, setOpenMonths] = useState<Set<string> | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [roadsView, setRoadsView] = useState<MapView | null>(null);
  const [roadsBox, setRoadsBox] = useState({ w: 360, h: 260 });
  const [, bump] = useState(0);

  const rides = useMemo(() => (b.ready ? [...RideLog.load()].reverse() : []), [b.ready, b.data]);
  const roads = useMemo(() => (b.ready ? RoadStore.all() : {}), [b.ready, b.data]);
  const months = useMemo(() => groupByMonth(rides, CONFIG.ridingTimeOnly), [rides]);
  const open = openMonths ?? new Set(months[0] ? [months[0].key] : []);
  const finding = !!q.trim() || starredOnly;
  const hits = finding ? findRides(rides, q, rideTitle).filter((r) => !starredOnly || JourneyStore.starred(r.startedAt)) : [];

  const openRide = (id: number) => router.push(`/story/${id}`);
  const tapRow = (id: number) => {
    if (!selecting) { openRide(id); return; }
    const next = new Set(picked); if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next); setConfirm(false);
  };
  const holdRow = (id: number) => { if (selecting) return; setSelecting(true); setPicked(new Set([id])); };
  const stop = () => { setSelecting(false); setPicked(new Set()); setConfirm(false); };
  const allStarred = picked.size > 0 && [...picked].every((id) => JourneyStore.starred(id));

  const row = (r: RideRecord) => {
    const on = picked.has(r.startedAt);
    return (
      <Pressable key={r.startedAt} style={[st.row, on && st.rowPicked]} onPress={() => tapRow(r.startedAt)} onLongPress={() => holdRow(r.startedAt)} delayLongPress={450}
        accessibilityRole={selecting ? 'checkbox' : 'button'} accessibilityState={selecting ? { checked: on } : undefined}>
        {selecting ? <View style={[st.pick, on && st.pickOn]}>{on && <Icon name="check" size={14} color={C.ink} width={2.2} />}</View>
          : CONFIG.journeyThumbs ? <View style={st.thumb}><SvgXml xml={miniTrackSvg(roads[String(r.startedAt)] ?? [])} width={56} height={56} /></View> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[T.eyebrow, { marginBottom: 5 }]}>{JourneyStore.starred(r.startedAt) ? '★ ' : ''}{date(r.startedAt)}</Text>
          <Text style={st.rowTitle} numberOfLines={1}>{rideTitle(r)}</Text>
          <Text style={T.sub} numberOfLines={1}>{r.weather ?? 'Out with Betty'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={st.rowKm}>{r.distanceKm} km</Text>
          <Text style={T.sub}>{duration(rideMinutes(r, CONFIG.ridingTimeOnly))}</Text>
        </View>
      </Pressable>
    );
  };

  const km = Math.round(rides.reduce((a, r) => a + r.distanceKm, 0));
  const min = rides.reduce((a, r) => a + rideMinutes(r, CONFIG.ridingTimeOnly), 0);
  const spend = fuelSpend(rides, Date.now());
  const thisMonth = monthKey(Date.now());
  const roadList = Object.entries(roads).filter(([id, t]) => t.length > 1 && rides.some((r) => String(r.startedAt) === id));
  const roadsFit = roadsView ?? (roadList.length ? fitView(roadList.flatMap(([, t]) => t.map(([lat, lon]) => ({ lat, lon }))), roadsBox.w, roadsBox.h) : null);
  // A tap on Your roads: the nearest road within ~14 px opens its ride (the web's hit test).
  const tapRoads = (p: { x: number; y: number }, box: { w: number; h: number }) => {
    if (!roadsFit) return;
    const k = Math.max(box.w / MAP_W, box.h / MAP_H) || 1;
    const tap = { x: (p.x - (box.w - MAP_W * k) / 2) / k, y: (p.y - (box.h - MAP_H * k) / 2) / k };
    const at = projector(roadsFit.center, roadsFit.spanKm);
    const seg = (a: { x: number; y: number }, c: { x: number; y: number }) => {
      const dx = c.x - a.x, dy = c.y - a.y, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((tap.x - a.x) * dx + (tap.y - a.y) * dy) / l)) : 0;
      return Math.hypot(tap.x - (a.x + t * dx), tap.y - (a.y + t * dy));
    };
    let best: { id: string; d: number } | null = null;
    for (const [id, t] of roadList) {
      const pts = t.map(([lat, lon]) => at({ lat, lon }));
      for (let i = 1; i < pts.length; i++) { const d = seg(pts[i - 1], pts[i]); if (!best || d < best.d) best = { id, d }; }
    }
    if (best && best.d * k < 14) openRide(Number(best.id));
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[st.page, { paddingTop: insets.top + 20, paddingBottom: selecting ? 150 : 40 }]} keyboardShouldPersistTaps="handled">
        <View style={st.head}>
          <View style={{ flex: 1 }}>
            <Text style={[T.eyebrow, { marginBottom: 10 }]}>The roads stay with you</Text>
            <Text style={[T.h1, { fontSize: 33, lineHeight: 37 }]}>My journeys</Text>
            <Text style={[T.sub, { marginTop: 8 }]}>Little escapes. Good roads. Stories worth keeping.</Text>
          </View>
          <Pressable style={[st.pencil, selecting && { backgroundColor: C.ink }]} onPress={() => (selecting ? stop() : setSelecting(true))} accessibilityLabel={selecting ? 'Done selecting' : 'Select rides'}>
            <Icon name="pencil" size={15} color={selecting ? '#fffbe8' : C.ink} />
          </Pressable>
        </View>
        <Text style={st.privacy}>Private · on this phone</Text>

        <Search value={q} onChange={setQ} placeholder="Find a ride: a place, a day, a month…"
          right={<Pressable onPress={() => setStarredOnly(!starredOnly)} accessibilityLabel="Starred rides only" hitSlop={8}><Text style={{ fontSize: 18, color: C.ink }}>{starredOnly ? '★' : '☆'}</Text></Pressable>} />

        {finding ? (
          <>
            <Text style={[T.sub, { marginBottom: 8 }]}>{hits.length ? `${hits.length} ride${hits.length === 1 ? '' : 's'}` : starredOnly && !q ? 'No starred rides yet. Open a ride and tap Star.' : 'No ride matches that.'}</Text>
            {hits.map(row)}
          </>
        ) : !rides.length ? (
          <View style={st.empty}>
            <Orb />
            <Text style={[T.h2, { textAlign: 'center' }]}>Your story starts on the road.</Text>
            <Text style={[T.sub, { textAlign: 'center', marginTop: 8 }]}>Rides of three minutes or a kilometre and up land here, quietly organised by journey.</Text>
            <Pressable onPress={() => router.push('/help?topic=start')} style={{ marginTop: 12 }}><Text style={st.link}>How Betty works</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={st.totals}>
              <Total value={String(rides.length)} label={`ride${rides.length === 1 ? '' : 's'}`} />
              <Total value={`${km} km`} label="together" />
              <Total value={duration(min)} label="in the saddle" />
            </View>
            {spend.perKmR != null && (
              <Text style={st.spend}>{spend.monthRides ? `R${spend.monthR} on fuel this month over ${spend.monthRides} ride${spend.monthRides === 1 ? '' : 's'}` : 'No fuel spent this month yet'} · about R{spend.perKmR.toFixed(2)} a km</Text>
            )}
            <OnThisDay rides={rides} open={openRide} />
            <MonthSoFar rides={rides} />
            <Records rides={rides} roads={roads} open={openRide} />
            {roadList.length > 0 && roadsFit && (
              <Card title="Your roads" sub="Every ride you have kept. Darker roads are the ones you ride most. Tap one to open it."
                right={<Pressable onPress={() => setRoadsView(null)} accessibilityLabel="Fit every road" hitSlop={8}><Icon name="target" /></Pressable>}>
                <View style={st.roads} onLayout={(e) => setRoadsBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
                  <MapSketch id="roads" fade="none" label="Your roads: every ride you have kept" onView={setRoadsView} onTap={tapRoads}
                    input={{ center: roadsFit.center, spanKm: roadsFit.spanKm, here: null, headingDeg: null, track: [], places: [], incidents: [], marks: [], roads: roadList.map(([, t]) => t) }} />
                </View>
              </Card>
            )}
            {months.map((m) => {
              const isOpen = open.has(m.key);
              const bits = [`${m.rides.length} ride${m.rides.length === 1 ? '' : 's'}`, `${Math.round(m.km)} km`, duration(m.minutes), m.costR != null ? `R${m.costR} fuel` : ''].filter(Boolean).join(' · ');
              const allPicked = m.rides.every((r) => picked.has(r.startedAt));
              return (
                <View key={m.key} style={{ marginBottom: 8 }}>
                  <View style={st.monthHeadRow}>
                    <Pressable style={st.monthHead} onPress={() => { const s2 = new Set(open); if (isOpen) s2.delete(m.key); else s2.add(m.key); setOpenMonths(s2); }} accessibilityState={{ expanded: isOpen }}>
                      <View style={{ flex: 1 }}><Text style={st.monthTitle}>{m.key === thisMonth ? 'This month' : m.label}</Text><Text style={T.sub}>{bits}</Text></View>
                      <View style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}><Icon name="chev" color="#909b8d" /></View>
                    </Pressable>
                    {selecting && isOpen && (
                      <Pressable onPress={() => { const s2 = new Set(picked); for (const r of m.rides) { if (allPicked) s2.delete(r.startedAt); else s2.add(r.startedAt); } setPicked(s2); }}>
                        <Text style={st.link}>{allPicked ? 'Select none' : 'Select all'}</Text>
                      </Pressable>
                    )}
                  </View>
                  {isOpen && m.rides.map(row)}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {selecting && (
        <View style={st.bar}>
          {confirm ? (
            <>
              <Text style={st.barText}><Text style={{ fontWeight: '700' }}>Delete {picked.size} ride{picked.size === 1 ? '' : 's'}?</Text> {picked.size === 1 ? 'Its' : 'Their'} maps, numbers and lines go from this phone. Fuel and odometer stay.</Text>
              <View style={st.barActions}>
                <Secondary label="Keep" onPress={() => setConfirm(false)} style={{ flex: 1 }} />
                <Secondary label="Delete" onPress={() => {
                  let gone = 0, kept = 0;
                  for (const id of picked) {
                    if (b.ride && b.ride.ride.engine.rideSnapshot().startedAt === id) { kept++; continue; }
                    b.logger.forgetRide(id); deleteRideData(id); gone++;
                  }
                  b.toast(`${gone} ride${gone === 1 ? '' : 's'} deleted.${kept ? ' The one still running was kept.' : ''}`);
                  stop(); b.touch();
                }} style={{ flex: 1, backgroundColor: C.end, borderColor: 'transparent' }} />
              </View>
            </>
          ) : (
            <>
              <View style={st.barTop}><Text style={st.barText}><Text style={{ fontWeight: '700' }}>{picked.size} selected</Text></Text>
                <Pressable onPress={stop} hitSlop={8}><Text style={[st.link, { color: C.yellow }]}>Done</Text></Pressable></View>
              <View style={st.barActions}>
                <Pressable style={st.barLink} onPress={() => {
                  const s2 = new Set(picked); let added = 0;
                  for (const r of rides) if (rideMinutes(r, false) < SHORT_MIN || r.distanceKm < SHORT_KM) { if (!s2.has(r.startedAt)) added++; s2.add(r.startedAt); }
                  setPicked(s2);
                  b.toast(added ? `Ticked ${added} ride${added === 1 ? '' : 's'} under ${SHORT_MIN} minutes or ${SHORT_KM} km.` : `No more rides under ${SHORT_MIN} minutes or ${SHORT_KM} km.`);
                }}><Text style={[st.link, { color: '#fffdf1' }]}>Short rides</Text></Pressable>
                <Secondary label={allStarred ? '☆ Unstar' : '★ Star'} disabled={!picked.size} onPress={() => {
                  const on = !allStarred; for (const id of picked) JourneyStore.setStar(id, on);
                  b.toast(`${picked.size} ride${picked.size === 1 ? '' : 's'} ${on ? 'starred' : 'unstarred'}.`); stop(); bump((x) => x + 1);
                }} />
                <Secondary label={`Delete${picked.size ? ` ${picked.size}` : ''}`} disabled={!picked.size} onPress={() => setConfirm(true)} style={{ backgroundColor: C.end, borderColor: 'transparent' }} />
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const Total = ({ value, label }: { value: string; label: string }) => (
  <View style={{ flex: 1, alignItems: 'center' }}><Text style={st.totalValue}>{value}</Text><Text style={st.totalLabel}>{label}</Text></View>
);

/** On this day: rides on this date 1, 3, 6 and 12 months ago. */
function OnThisDay({ rides, open }: { rides: RideRecord[]; open: (id: number) => void }) {
  const hits = onThisDay(rides, Date.now());
  if (!hits.length) return null;
  return (
    <Card title="On this day">
      {hits.map((h) => (
        <Pressable key={h.ride.startedAt} style={st.dayRow} onPress={() => open(h.ride.startedAt)}>
          <Text style={T.eyebrow}>{h.label}</Text>
          <Text style={st.rowTitle}>{rideTitle(h.ride)}</Text>
          <Text style={T.sub}>{h.ride.distanceKm} km{h.ride.places.length ? ` · ${h.ride.places.slice(0, 2).join(', ')}` : ''}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

/** This month so far against last month at the same point, and km a week for the last 8 weeks. */
function MonthSoFar({ rides }: { rides: RideRecord[] }) {
  const m = monthNumbers(rides, CONFIG.ridingTimeOnly, Date.now());
  const top = Math.max(1, ...m.weeks.map((w) => w.km));
  const change = m.change == null ? '' : m.change === 0 ? `Level with ${m.lastLabel} so far` : `${m.change > 0 ? '+' : ''}${m.change}% on ${m.lastLabel} at this point`;
  return (
    <Card title={`${monthLabel(m.key).split(' ')[0]} so far`}>
      <View style={st.totals}>
        <Total value={String(m.thisMonth.km)} label="km" />
        <Total value={String(m.thisMonth.rides)} label={`ride${m.thisMonth.rides === 1 ? '' : 's'}`} />
        <Total value={duration(m.thisMonth.minutes)} label="riding" />
        {m.thisMonth.costR != null && <Total value={`R${m.thisMonth.costR}`} label="fuel" />}
      </View>
      {change ? <Text style={[T.sub, { marginTop: 8 }]}>{change}</Text> : null}
      <View style={st.weeks} accessibilityLabel="Km a week, the last 8 weeks">
        {m.weeks.map((w, i) => (
          <View key={i} style={st.week}>
            <View style={st.weekTrack}><View style={[st.weekBar, { height: `${Math.max(3, Math.round((w.km / top) * 100))}%` }, i === m.weeks.length - 1 && { backgroundColor: C.yellow }]} /></View>
            <Text style={st.weekKm}>{w.km || ''}</Text>
          </View>
        ))}
      </View>
      <Text style={[T.sub, { fontSize: 10 }]}>Km a week, the last 8 weeks</Text>
    </Card>
  );
}

/** Records and the next milestone (core/Records). */
function Records({ rides, roads, open }: { rides: RideRecord[]; roads: Record<string, Array<[number, number]>>; open: (id: number) => void }) {
  const rec = rideRecords(rides, roads, CONFIG.ridingTimeOnly, Date.now());
  const tiles: Array<{ label: string; value: string; sub: string; ride?: number }> = [];
  if (rec.longest) tiles.push({ label: 'Longest ride', value: `${rec.longest.km} km`, sub: date(rec.longest.ride.startedAt), ride: rec.longest.ride.startedAt });
  if (rec.longestTime) tiles.push({ label: 'Longest in the saddle', value: duration(rec.longestTime.minutes), sub: date(rec.longestTime.ride.startedAt), ride: rec.longestTime.ride.startedAt });
  if (rec.furthest && rec.furthest.km >= 1) tiles.push({ label: 'Furthest out', value: `${rec.furthest.km} km`, sub: 'from where you set off', ride: rec.furthest.ride.startedAt });
  if (rec.highest) tiles.push({ label: 'Highest point', value: `${n(rec.highest.m)} m`, sub: date(rec.highest.ride.startedAt), ride: rec.highest.ride.startedAt });
  if (rec.bestMonth) tiles.push({ label: 'Best month', value: `${rec.bestMonth.km} km`, sub: rec.bestMonth.label });
  if (rec.streak || rec.bestStreak) tiles.push({ label: 'Weeks in a row', value: String(rec.streak), sub: rec.bestStreak > rec.streak ? `best ${rec.bestStreak}` : rec.streak ? 'with a ride every week' : 'ride this week to start one' });
  const next = rec.nextKm;
  const pct = next ? Math.round(((rec.totalKm - next.from) / (next.at - next.from)) * 100) : 100;
  return (
    <Card title="Records">
      <View style={st.tiles}>
        {tiles.map((t) => (
          <Pressable key={t.label} style={st.tile} disabled={!t.ride} onPress={() => t.ride && open(t.ride)}>
            <Text style={T.eyebrow}>{t.label}</Text><Text style={st.tileValue}>{t.value}</Text><Text style={T.sub} numberOfLines={1}>{t.sub}</Text>
          </Pressable>
        ))}
      </View>
      {next && (
        <View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={st.label}>{n(rec.totalKm)} of {n(next.at)} km with Betty</Text><Text style={T.sub}>{n(next.left)} km to go</Text>
          </View>
          <View style={st.track}><View style={[st.fill, { width: `${pct}%` }]} /></View>
        </View>
      )}
      {rec.nextRides && <Text style={[T.sub, { marginTop: 8 }]}>{rec.rides} ride{rec.rides === 1 ? '' : 's'} so far · {rec.nextRides.left} more to your {rec.nextRides.at}th</Text>}
    </Card>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pencil: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' },
  privacy: { alignSelf: 'flex-start', fontSize: 10, color: C.sageText, backgroundColor: C.sageSoft, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 12, overflow: 'hidden', marginTop: 12, marginBottom: 16 },
  totals: { flexDirection: 'row', marginBottom: 10 },
  totalValue: { fontSize: 20, fontWeight: '600', letterSpacing: -0.5, color: C.ink, fontVariant: ['tabular-nums'] },
  totalLabel: { fontSize: 10, color: C.muted, marginTop: 4 },
  spend: { fontSize: 11, color: C.sageText, textAlign: 'center', marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardLine, padding: 12, marginBottom: 8 },
  rowPicked: { borderColor: C.sage, backgroundColor: '#f3f6ee' },
  thumb: { width: 56, height: 56, borderRadius: 12, overflow: 'hidden', backgroundColor: C.map },
  pick: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#c9d1c1', alignItems: 'center', justifyContent: 'center', marginHorizontal: 15 },
  pickOn: { backgroundColor: C.yellow, borderColor: C.yellow },
  rowTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: C.ink, marginBottom: 3 },
  rowKm: { fontSize: 15, fontWeight: '600', color: C.ink },
  empty: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  link: { fontSize: 12, color: C.sageText, fontWeight: '500' },
  monthHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthHead: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  monthTitle: { fontSize: 15, fontWeight: '600', color: C.ink, marginBottom: 2 },
  dayRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#eef0e8', gap: 3 },
  weeks: { flexDirection: 'row', gap: 6, height: 90, marginTop: 14, marginBottom: 6 },
  week: { flex: 1, alignItems: 'center' },
  weekTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  weekBar: { width: '100%', borderRadius: 4, backgroundColor: '#c5d2bc' },
  weekKm: { fontSize: 9, color: C.muted, marginTop: 4, height: 12 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: C.bg, borderRadius: 14, padding: 12, gap: 4 },
  tileValue: { fontSize: 20, fontWeight: '600', letterSpacing: -0.5, color: C.ink },
  label: { fontSize: 12, fontWeight: '600', color: C.ink },
  track: { height: 6, borderRadius: 3, backgroundColor: '#e4e8dd', marginTop: 8, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.yellow, borderRadius: 3 },
  roads: { height: 260, borderRadius: 16, overflow: 'hidden' },
  bar: { position: 'absolute', left: 12, right: 12, bottom: 10, backgroundColor: C.inkDeep, borderRadius: 18, padding: 14, gap: 10,
    shadowColor: '#203931', shadowOpacity: 0.2, shadowRadius: 18 },
  barTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barText: { color: '#fffdf1', fontSize: 13, lineHeight: 18 },
  barActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  barLink: { flex: 1, minHeight: 44, justifyContent: 'center' },
});
