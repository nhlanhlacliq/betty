import { ReactNode, useEffect, useRef } from 'react';
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, T } from './theme';

/**
 * A sheet from the bottom, as on the web (app.css `.sheet`): dimmed backdrop, handle, × in the corner, an eyebrow and
 * a title. Tap outside, ×, or drag it down past 110 px (or a quick flick) to close.
 */
export function Sheet({ open, onClose, eyebrow, title, children }: { open: boolean; onClose: () => void; eyebrow?: string; title?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (open) y.setValue(0); }, [open, y]);
  const drag = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 110 || g.vy > 1.2) onCloseRef.current();
      else Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    },
  })).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={st.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View style={[st.sheet, { paddingBottom: 30 + insets.bottom, transform: [{ translateY: y }] }]}>
          <View {...drag.panHandlers} style={st.grab}><View style={st.handle} /></View>
          <Pressable style={st.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
            <Text style={st.closeText}>×</Text>
          </Pressable>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {eyebrow ? <Text style={[T.eyebrow, { marginTop: 14, marginBottom: 2 }]}>{eyebrow}</Text> : null}
            {title ? <Text style={T.sheetTitle}>{title}</Text> : null}
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** One line in a sheet: label on the left, value on the right (the web's `.sheet-row`). */
export function SheetRow({ label, value, bad, icon }: { label: string; value: string; bad?: boolean; icon?: ReactNode }) {
  return (
    <View style={st.row}>
      <View style={st.rowLabel}>{icon}<Text style={st.rowLabelText}>{label}</Text></View>
      <Text style={[st.rowValue, bad && { color: C.danger, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#243a3844' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 24, paddingTop: 0, maxHeight: '92%',
    shadowColor: '#233a39', shadowOpacity: 0.12, shadowRadius: 30, shadowOffset: { width: 0, height: -10 } },
  grab: { paddingTop: 11, paddingBottom: 14, alignItems: 'center' },
  handle: { width: 33, height: 4, borderRadius: 4, backgroundColor: '#d6dbd0' },
  close: { position: 'absolute', right: 15, top: 18, width: 29, height: 29, borderRadius: 15, backgroundColor: '#e8ece0', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  closeText: { fontSize: 21, lineHeight: 23, color: '#8b9783' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#e6eade' },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 0 },
  rowLabelText: { fontSize: 13, fontWeight: '500', color: C.ink },
  rowValue: { fontSize: 12, color: C.muted, textAlign: 'right', flexShrink: 1 },
});
