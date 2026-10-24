import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBetty } from '../state/Betty';
import { C } from './theme';

/** The web's toast: a dark pill at the top that springs in, and goes on its own (or on a tap). */
export function Toast() {
  const { toastMsg } = useBetty();
  const insets = useSafeAreaInsets();
  const a = useRef(new Animated.Value(0)).current;
  const shown = useRef<string | null>(null);
  if (toastMsg) shown.current = toastMsg;
  useEffect(() => {
    Animated.spring(a, { toValue: toastMsg ? 1 : 0, useNativeDriver: true, speed: 18, bounciness: toastMsg ? 8 : 0 }).start();
  }, [toastMsg, a]);
  return (
    <Animated.View pointerEvents={toastMsg ? 'auto' : 'none'} style={[st.wrap, { top: insets.top + 8, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }, { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
      <Pressable onPress={() => a.setValue(0)}><Text style={st.text}>{shown.current}</Text></Pressable>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center', zIndex: 100 },
  text: { backgroundColor: C.inkDeep, color: '#fffdf1', fontSize: 13, lineHeight: 18, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 16, overflow: 'hidden', textAlign: 'center',
    shadowColor: '#203931', shadowOpacity: 0.2, shadowRadius: 18 },
});
