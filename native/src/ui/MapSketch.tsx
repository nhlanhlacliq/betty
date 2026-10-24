import { ComponentRef, memo, useMemo, useRef, useState } from 'react';
import { Animated, GestureResponderEvent, LayoutChangeEvent, PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop, SvgXml } from 'react-native-svg';
import { MapInput, mapSvg } from '../../../src/ui/mapView';
import { MapView, viewAfter } from '../../../src/ui/mapGestures';
import { C } from './theme';

/** The sketch itself: redrawn only when the drawing changes (react-native-svg parses the whole string). */
const Art = memo(function Art({ xml }: { xml: string }) {
  return <SvgXml xml={xml} width="100%" height="100%" />;
});

/**
 * The web's map sketch (src/ui/mapView `mapSvg`, the same drawing) with its pan and zoom (src/ui/mapGestures
 * `viewAfter`, the same maths): one finger drags, two pinch, a double tap zooms in. While fingers move, only the drawn
 * picture is shifted and scaled; when they lift, `onView` gets the new view and the sketch is drawn again, sharp.
 * `fade` is the web's soft wash at the top, so the words over the map stay readable.
 */
export function MapSketch({ input, label, onView, fade = 'home' }: { input: MapInput; label?: string; onView?: (v: MapView) => void; fade?: 'home' | 'ride' }) {
  const xml = useMemo(() => mapSvg(input, label, fade), [input, label, fade]);
  const box = useRef({ w: 1, h: 1, x: 0, y: 0 });
  const host = useRef<ComponentRef<typeof View>>(null);
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const zoom = useRef(new Animated.Value(1)).current;
  const g = useRef({ start: [] as { x: number; y: number }[], origin: { x: 0, y: 0 }, dist: 0, scale: 1, move: { x: 0, y: 0 }, lastTap: 0, moved: false });
  const [, redraw] = useState(0);
  const view = (): MapView | null => (input.center ? { center: input.center, spanKm: input.spanKm } : null);

  // From the screen, not the touched SVG piece (locationX is relative to whatever the finger is on).
  const pts = (e: GestureResponderEvent) => e.nativeEvent.touches.map((t) => ({ x: t.pageX - box.current.x, y: t.pageY - box.current.y }));
  const finish = (v: MapView | null) => {
    pan.setValue({ x: 0, y: 0 }); zoom.setValue(1);
    if (v && onView) onView(v); else redraw((n) => n + 1);
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!onView,
    onMoveShouldSetPanResponder: () => !!onView,
    onPanResponderGrant: (e) => {
      const p = pts(e);
      g.current = { ...g.current, start: p, origin: p[0] ?? { x: 0, y: 0 }, dist: 0, scale: 1, move: { x: 0, y: 0 }, moved: false };
    },
    onPanResponderMove: (e) => {
      const s = g.current, p = pts(e);
      if (p.length >= 2) {
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        if (!s.dist) { s.dist = d; s.origin = mid; s.start = [mid]; }
        s.scale = Math.max(0.2, Math.min(8, d / s.dist));
        s.move = { x: mid.x - s.start[0].x, y: mid.y - s.start[0].y };
      } else if (p.length === 1 && !s.dist) {
        s.move = { x: p[0].x - s.start[0].x, y: p[0].y - s.start[0].y };
      }
      if (Math.hypot(s.move.x, s.move.y) > 8 || s.scale !== 1) s.moved = true;
      // Scale about the gesture's origin: RN scales about the middle of the box, so shift to make up for it.
      const { w, h } = box.current;
      pan.setValue({ x: s.move.x + (s.origin.x - w / 2) * (1 - s.scale), y: s.move.y + (s.origin.y - h / 2) * (1 - s.scale) });
      zoom.setValue(s.scale);
    },
    onPanResponderRelease: () => {
      const s = g.current, v = view(), { w, h } = box.current;
      if (!s.moved) {
        // A double tap zooms in 2x where he tapped.
        const now = Date.now();
        if (v && now - s.lastTap < 300) { s.lastTap = 0; finish(viewAfter(v, w, h, s.origin, 2, { x: 0, y: 0 })); return; }
        s.lastTap = now; finish(null); return;
      }
      finish(v ? viewAfter(v, w, h, s.origin, s.scale, s.move) : null);
    },
    onPanResponderTerminate: () => finish(null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [input, onView]);

  return (
    <View ref={host} style={StyleSheet.absoluteFill} onLayout={(e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      host.current?.measureInWindow((x: number, y: number) => { box.current = { w: width, h: height, x, y }; });
    }}
      {...responder.panHandlers} accessibilityLabel={label ?? 'Sketch of the ride: not for navigation'}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.map }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: zoom }] }]}>
        <Art xml={xml} />
      </Animated.View>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id={`fade-${fade}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#e7eadf" stopOpacity={fade === 'home' ? 0.87 : 0.67} />
            <Stop offset={fade === 'home' ? '0.27' : '0.3'} stopColor="#e7eadf" stopOpacity={fade === 'home' ? 0.5 : 0} />
            <Stop offset="0.52" stopColor="#e7eadf" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#fade-${fade})`} />
      </Svg>
    </View>
  );
}
