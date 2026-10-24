import { Tabs, router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG } from '../../../../src/config/betty';
import type { IconName } from '../../../../src/ui/icons';
import { useBetty } from '../../state/Betty';
import { Icon } from '../../ui/Icon';
import { C } from '../../ui/theme';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** The four tabs (owner, 2026-10-17): Ride, Journeys, Explore, Garage. */
const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Ride', icon: 'ride' },
  journeys: { label: 'Journeys', icon: 'journeys' },
  explore: { label: 'Explore', icon: 'explore' },
  garage: { label: 'Garage', icon: 'garage' },
};

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}` : `${min} min`);

/** The web's tab bar, plus the ride-in-progress bar above it while a ride runs (tap = back to the ride). */
function TabBar({ state, navigateToTab }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { ride, ending } = useBetty();
  const riding = !!ride && !ending;
  const snap = ride?.ride.engine.rideSnapshot();
  const min = snap ? Math.floor(CONFIG.ridingTimeOnly ? snap.movingMin : snap.minutesOut) : 0;
  return (
    <View>
      {riding && snap && (
        <Pressable style={st.rideBar} onPress={() => router.push('/ride')} accessibilityRole="button" accessibilityLabel="Back to the ride">
          <View style={st.liveDot} />
          <Text style={st.rideBarText} numberOfLines={1}>Riding · {Math.round(snap.distanceKm)} km · {hm(min)}</Text>
          <Text style={st.rideBarBack}>Back to ride</Text>
        </Pressable>
      )}
      <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {state.routes.map((r, i) => {
          const t = TABS[r.name];
          if (!t) return null;
          const on = state.index === i;
          // While a ride runs, the Ride tab goes to the ride, not the start page.
          const go = () => (r.name === 'index' && riding ? router.push('/ride') : navigateToTab(r.key));
          return (
            <Pressable key={r.key} style={st.tab} onPress={go} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}>
              <View>
                <Icon name={t.icon} size={22} color={on ? '#2d493e' : '#92998f'} width={on ? 2 : 1.5} />
                {r.name === 'index' && riding && <View style={st.tabLive} />}
              </View>
              <Text style={[st.tabText, on && { color: '#2d493e' }]}>{t.label}</Text>
              {on && <View style={st.tabDot} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="journeys" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="garage" />
    </Tabs>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: '#f9f9f3', borderTopWidth: 1, borderTopColor: '#dde2d6', paddingTop: 11, paddingHorizontal: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 6, minHeight: 47 },
  tabText: { fontSize: 10, fontWeight: '500', color: '#92998f' },
  tabDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.ink, marginTop: -2 },
  tabLive: { position: 'absolute', top: -2, right: -6, width: 7, height: 7, borderRadius: 4, backgroundColor: C.live, borderWidth: 2, borderColor: '#f9f9f3' },
  rideBar: { marginHorizontal: 10, marginBottom: 6, height: 40, borderRadius: 14, backgroundColor: C.inkDeep, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14,
    shadowColor: '#203931', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.live },
  rideBarText: { flex: 1, color: '#fffdf1', fontSize: 13, fontVariant: ['tabular-nums'] },
  rideBarBack: { color: C.yellow, fontWeight: '600', fontSize: 13 },
});
