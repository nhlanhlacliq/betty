import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RideLog } from '../../../src/adapters/RideLog';
import { FillUpStore } from '../../../src/adapters/FuelStore';
import { describeFills, tanks } from '../../../src/core/FillUps';
import { Trend, trends } from '../../../src/core/RideHealth';
import { useBetty } from '../state/Betty';
import { TextButton } from '../ui/Buttons';
import { Card } from '../ui/Card';
import { C, T } from '../ui/theme';

/**
 * Garage > Bike health & riding (owner, 2026-10-27): every summary value over his rides (core/RideHealth): the newest
 * ride, his usual (median of the rides before), whether it has drifted, and a little bar per ride. Fuel from fill-ups.
 */
const fmt = (v: number, unit: string) => `${Math.round(v * 100) / 100}${unit ? ` ${unit}` : ''}`;
const TAG: Record<NonNullable<Trend['drift']>, [string, string]> = { worse: ['worth a look', C.warn], better: ['better', C.sage], changed: ['different', C.muted] };

export default function Health() {
  const insets = useSafeAreaInsets();
  const { data } = useBetty();
  const all = useMemo(() => trends(RideLog.load()), [data]);
  const fills = FillUpStore.load();
  const t = tanks(fills).slice(-6);
  const health = all.filter((x) => x.metric.of === 'health'), riding = all.filter((x) => x.metric.of === 'riding');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[st.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}>
      <View style={st.head}>
        <View style={{ flex: 1 }}><Text style={[T.eyebrow, { marginBottom: 8 }]}>Over time</Text><Text style={[T.h1, { fontSize: 30, lineHeight: 34 }]}>Bike health & riding.</Text></View>
        <TextButton label="← Garage" onPress={() => router.back()} />
      </View>
      <Text style={T.sub}>Each ride is summed up as it goes: the bike from the OBD2 reader, your riding from GPS and the reader. Your usual is the middle of your recent rides; she mentions a bike value in her briefing when it drifts the wrong way.</Text>
      <Card title="Fuel" sub={describeFills(fills).replace('From his fill-ups', 'From your fill-ups')}>
        {t.map((x) => <Row key={x.to} label={new Date(x.to).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} value={`${x.lPer100} L/100 km`} sub={`${x.litres} L over ${Math.round(x.km)} km${x.by === 'counter' ? ' (bike count)' : ''}`} />)}
      </Card>
      <Section title="The bike" list={health} empty="Ride with the OBD2 reader connected and this fills in." />
      <Section title="Your riding" list={riding} empty="Ride a little and this fills in." />
    </ScrollView>
  );
}

function Section({ title, list, empty }: { title: string; list: Trend[]; empty: string }) {
  return (
    <Card title={title}>
      {!list.length && <Text style={T.sub}>{empty}</Text>}
      {list.map((x) => {
        const max = Math.max(...x.series.map(Math.abs)), min = Math.min(...x.series);
        return (
          <View key={x.metric.id} style={st.row}>
            <View style={{ flex: 1 }}>
              <Text style={st.label}>{x.metric.label}</Text>
              <Text style={st.sub}>{x.usual == null ? `${x.rides} ride${x.rides === 1 ? '' : 's'} so far` : `usually ${fmt(x.usual, x.metric.unit)}`}{x.drift ? <Text style={{ color: TAG[x.drift][1] }}> · {TAG[x.drift][0]}</Text> : null}</Text>
              <View style={st.bars}>{x.series.map((v, i) => <View key={i} style={[st.bar, { height: 3 + 15 * (max === min ? 1 : (v - Math.min(0, min)) / (max - Math.min(0, min) || 1)) }, i === x.series.length - 1 && { backgroundColor: C.ink }]} />)}</View>
            </View>
            <Text style={st.value}>{fmt(x.latest, x.metric.unit)}</Text>
          </View>
        );
      })}
    </Card>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <View style={st.row}><View style={{ flex: 1 }}><Text style={st.label}>{label}</Text>{sub ? <Text style={st.sub}>{sub}</Text> : null}</View><Text style={st.value}>{value}</Text></View>;
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  label: { fontSize: 14, color: C.ink },
  sub: { fontSize: 11, color: C.muted, marginTop: 2 },
  value: { fontSize: 15, color: C.ink, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18, marginTop: 5 },
  bar: { width: 5, borderRadius: 1, backgroundColor: C.sage },
});
