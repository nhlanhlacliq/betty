import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { CONFIG } from '../../../src/config/betty';
import type { OrbMode } from '../../../src/ui/rideView';

/**
 * Betty's companion, as on the web (app.css `.orb`): a butter-yellow blob with two eyes that sways and breathes, faster
 * while she speaks, slow and pale when quiet, with a soft ring while she listens. The blob is the web's border-radius
 * shape (42% 58% 44% 56% / 57% 42% 58% 43%) drawn as a path. Little animations off (Garage) or the phone's Reduce
 * Motion: it stands still.
 */
const BLOB = 'M42 0A58 42 0 0 1 100 42A44 58 0 0 1 56 100A56 43 0 0 1 0 57A42 57 0 0 1 42 0Z';
const COLORS = { lit: ['#fff4b9', '#f3da80', '#c9ae62'], quiet: ['#f6f2dc', '#e3dbbd', '#b7ad8f'] };

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((on) => { reduceMotion = on; });
AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => { reduceMotion = on; });

export function Orb({ mode = 'resting', size = 74, onPress, label }: { mode?: OrbMode; size?: number; onPress?: () => void; label?: string }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!CONFIG.motion || reduceMotion) { t.setValue(0.5); return; }
    const half = mode === 'speaking' ? 325 : mode === 'quiet' ? 4500 : 2500;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [mode, t]);
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '9deg'] });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const [a, b, c] = mode === 'quiet' ? COLORS.quiet : COLORS.lit;
  const mini = size < 45;
  const eyeW = mini ? 2 : 3, eyeH = mode === 'quiet' ? 2 : mini ? 3 : 5, gap = mini ? 6 : 10;
  const id = `orb${size}${mode}`;

  const body = (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {mode === 'listening' && (
        <View style={{ position: 'absolute', width: size + 30, height: size + 30, borderRadius: (size + 30) / 2, backgroundColor: '#c9dfe433' }}>
          <View style={{ position: 'absolute', left: 7, top: 7, right: 7, bottom: 7, borderRadius: (size + 16) / 2, backgroundColor: '#c9dfe477' }} />
        </View>
      )}
      <Animated.View style={{ width: size, height: size, transform: [{ rotate }, { scale }], alignItems: 'center', justifyContent: 'center',
        shadowColor: '#b29c57', shadowOpacity: 0.13, shadowRadius: 13, shadowOffset: { width: 0, height: 5 } }}>
        <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
          <Defs>
            <RadialGradient id={id} cx="32%" cy="23%" r="90%">
              <Stop offset="0.03" stopColor={a} /><Stop offset="0.55" stopColor={b} /><Stop offset="1" stopColor={c} />
            </RadialGradient>
          </Defs>
          <Path d={BLOB} fill={`url(#${id})`} />
        </Svg>
        <View style={{ flexDirection: 'row', gap }}>
          <View style={{ width: eyeW, height: eyeH, borderRadius: 4, backgroundColor: '#716542' }} />
          <View style={{ width: eyeW, height: eyeH, borderRadius: 4, backgroundColor: '#716542' }} />
        </View>
      </Animated.View>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}>{body}</Pressable> : body;
}
