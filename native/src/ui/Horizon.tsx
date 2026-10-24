import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { CONFIG } from '../../../src/config/betty';
import { BROWSE_MS, Glance, GlanceAction, IslandState, freshIsland, islandView } from '../../../src/ui/rideView';
import { Icon } from './Icon';
import { C } from './theme';

/**
 * Horizon, the dark card at the top of the ride map (the web's island; what it shows is the shared `islandView`):
 * a compact pill that grows for 10 s when the most pressing cue changes, tap to grow (and keep) or shrink, swipe
 * sideways to browse the other cues (dots; back to the most pressing after 20 s), swipe up to dismiss traffic, one
 * button per card. Each part follows its Garage switch (CONFIG.island).
 */
export function Horizon({ cues, top, onAction, onDismiss }: { cues: Glance[]; top: number; onAction: (k: GlanceAction, g: Glance) => void; onDismiss: (key: string) => void }) {
  const st = useRef<IslandState>(freshIsland());
  const [, redraw] = useState(0);
  const glow = useRef(new Animated.Value(0)).current;
  const away = useRef(new Animated.Value(0)).current;
  const v = islandView(cues, st.current, Date.now());
  const news = !!st.current.topKey && v.next.topKey !== st.current.topKey && cues[0]?.id !== 'riding';
  st.current = v.next;

  // Wake up when a grown card should shrink back, or browsing should return to the most pressing cue.
  useEffect(() => {
    const wake = [st.current.expandUntil, st.current.browseUntil].filter((t) => t > Date.now()).sort((a, b) => a - b)[0];
    if (!wake) return;
    const t = setTimeout(() => redraw((n) => n + 1), wake - Date.now() + 30);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    if (!news || !CONFIG.motion) return;
    glow.setValue(1);
    Animated.timing(glow, { toValue: 0, duration: 1200, useNativeDriver: false }).start();
  }, [news, glow]);

  const cuesRef = useRef(cues); cuesRef.current = cues;
  const dismiss = () => {
    const key = islandView(cuesRef.current, st.current, Date.now()).glance?.dismiss;
    if (!key) return;
    Animated.timing(away, { toValue: 1, duration: 220, useNativeDriver: true }).start(() => {
      away.setValue(0);
      st.current = { ...st.current, pinned: false, index: 0, browseUntil: 0 };
      onDismissRef.current(key);
    });
  };
  const onDismissRef = useRef(onDismiss); onDismissRef.current = onDismiss;
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 20 || g.dy < -20,
    onPanResponderRelease: (_e, g) => {
      const list = cuesRef.current;
      if (g.dy < -40 && Math.abs(g.dy) > Math.abs(g.dx)) { dismiss(); return; }
      if (!CONFIG.island.browse || list.length < 2 || Math.abs(g.dx) < 40 || Math.abs(g.dy) > Math.abs(g.dx)) return;
      const i = (st.current.index + (g.dx < 0 ? 1 : -1) + list.length) % list.length;
      st.current = { ...st.current, index: i, browseUntil: Date.now() + BROWSE_MS };
      redraw((n) => n + 1);
    },
  })).current;

  if (!v.glance) return null;
  const g = v.glance, cfg = CONFIG.island, open = v.expanded;
  const tap = () => {
    if (!cfg.tapExpand) return;
    st.current = { ...st.current, pinned: !open, expandUntil: open ? 0 : st.current.expandUntil, browseUntil: open ? 0 : st.current.browseUntil };
    redraw((n) => n + 1);
  };
  const ring = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 7] });

  return (
    <Animated.View {...swipe.panHandlers} style={[s.wrap, { top }, open ? s.open : s.compact,
      { transform: [{ translateY: away.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }) }], opacity: away.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: open ? 20 : 22, borderWidth: ring, borderColor: '#f4dc8566' }]} pointerEvents="none" />
      <Pressable style={[s.row, { gap: open ? 18 : 10 }]} onPress={tap} accessibilityRole="button" accessibilityLabel={`Horizon: ${g.label}, ${g.title}. Tap to grow or shrink, swipe for more`}>
        <Icon name={g.icon} size={open ? 36 : 20} color={C.onDark} width={1.6} />
        <View style={{ flex: open ? 1 : 0, minWidth: 0, flexShrink: 1 }}>
          {open && <Text style={s.label} numberOfLines={1}>{g.label}</Text>}
          <Text style={open ? s.title : s.titleCompact} numberOfLines={1}>{open ? g.title : g.short ?? g.title}</Text>
          {open && g.value ? <Text style={s.value} numberOfLines={1}>{g.value}</Text> : null}
          {cfg.progress && open && g.progress !== undefined && (
            <View style={s.progress}><View style={[s.progressFill, { width: `${Math.round(g.progress * 100)}%` }]} /></View>
          )}
        </View>
        {cfg.actions && open && g.action && (
          <Pressable style={s.action} onPress={() => onAction(g.action!.kind, g)} accessibilityRole="button"><Text style={s.actionText}>{g.action.label}</Text></Pressable>
        )}
      </Pressable>
      {open && g.dismiss && (
        <Pressable style={s.dismiss} onPress={dismiss} accessibilityLabel="Dismiss this from Horizon" hitSlop={8}><Text style={s.dismissText}>×</Text></Pressable>
      )}
      {cfg.browse && open && v.count > 1 && (
        <View style={s.dots} pointerEvents="none">
          {Array.from({ length: Math.min(v.count, 8) }, (_, i) => <View key={i} style={[s.dot, i === v.index && s.dotOn]} />)}
        </View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, zIndex: 4, backgroundColor: C.inkDeep, shadowColor: '#203931', shadowOpacity: 0.13, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
  open: { right: 20, borderRadius: 20, paddingVertical: 20, paddingHorizontal: 22 },
  compact: { maxWidth: '64%', borderRadius: 22, paddingVertical: 10, paddingLeft: 12, paddingRight: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: C.onDarkMuted, marginBottom: 4 },
  title: { fontSize: 25, fontWeight: '500', letterSpacing: -0.7, color: C.onDark },
  titleCompact: { fontSize: 15, letterSpacing: -0.2, color: C.onDark, fontWeight: '500' },
  value: { fontSize: 12, color: C.onDarkMuted, marginTop: 3 },
  action: { backgroundColor: '#fffdf1', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 13 },
  actionText: { color: C.inkDeep, fontSize: 12, fontWeight: '600' },
  dismiss: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: '#ffffff1a', alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: C.onDark, fontSize: 18, lineHeight: 20 },
  progress: { height: 4, borderRadius: 2, backgroundColor: '#ffffff26', marginTop: 10, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.accent, borderRadius: 2 },
  dots: { position: 'absolute', left: 0, right: 0, bottom: 7, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#ffffff40' },
  dotOn: { backgroundColor: C.onDark },
});
