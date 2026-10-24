import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { C, T } from './theme';

/** The web's `.settings-card`: a white card with a title. */
export function Card({ title, sub, children, style, right }: { title?: string; sub?: string; children?: ReactNode; style?: ViewStyle; right?: ReactNode }) {
  return (
    <View style={[st.card, style]}>
      {title ? <View style={st.cardHead}><Text style={st.cardTitle}>{title}</Text>{right}</View> : null}
      {sub ? <Text style={[T.sub, { marginTop: -6, marginBottom: 10 }]}>{sub}</Text> : null}
      {children}
    </View>
  );
}

/** One setting: label and a line of explanation on the left, its control on the right (or below with `stack`). */
export function Setting({ label, sub, children, stack, last }: { label: string; sub?: string; children?: ReactNode; stack?: boolean; last?: boolean }) {
  return (
    <View style={[st.setting, stack && { flexDirection: 'column', alignItems: 'stretch' }, last && { borderBottomWidth: 0 }]}>
      <View style={{ flex: stack ? 0 : 1, minWidth: 0 }}>
        <Text style={st.label}>{label}</Text>
        {sub ? <Text style={st.sub}>{sub}</Text> : null}
      </View>
      {children ? <View style={stack ? { marginTop: 10 } : { flexShrink: 0 }}>{children}</View> : null}
    </View>
  );
}

export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: C.sage, false: '#d6dbd0' }} />;
}

/** − value + : the native stand-in for the web's sliders (easier with gloves, exact steps). */
export function Stepper({ value, onChange, min, max, step, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
  return (
    <View style={st.stepper}>
      <Pressable style={st.stepBtn} onPress={() => set(value - step)} disabled={value <= min} accessibilityLabel="Less" hitSlop={6}><Icon name="minus" size={15} /></Pressable>
      <Text style={st.stepValue}>{format ? format(value) : String(value)}</Text>
      <Pressable style={st.stepBtn} onPress={() => set(value + step)} disabled={value >= max} accessibilityLabel="More" hitSlop={6}><Icon name="plus" size={15} /></Pressable>
    </View>
  );
}

/** A small text box that commits on Done or leaving it (a number box keeps "31,10" as typed until then). */
export function Field({ value, onCommit, width = 90, ...rest }: { value: string; onCommit: (v: string) => void; width?: number } & Omit<TextInputProps, 'value'>) {
  const [text, setText] = useState<string | null>(null);
  return (
    <TextInput style={[st.field, { width }]} value={text ?? value} onChangeText={setText} placeholderTextColor="#a0a697"
      onEndEditing={() => { if (text !== null) onCommit(text); setText(null); }} returnKeyType="done" {...rest} />
  );
}

/** Pick one of a few (the web's <select> for short lists). */
export function Choice<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <View style={st.choice}>
      {options.map(([v, label]) => (
        <Pressable key={v} style={[st.choiceItem, v === value && st.choiceOn]} onPress={() => onChange(v)} accessibilityRole="radio" accessibilityState={{ checked: v === value }}>
          <Text style={[st.choiceText, v === value && { color: C.ink, fontWeight: '600' }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The first `limit` items, then "Show all N …" / "Show less" (the web's foldList). */
export function Fold<I>({ items, limit, noun, render }: { items: I[]; limit: number; noun: string; render: (i: I, n: number) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const fold = items.length > limit + 1 && !open;
  return (
    <View>
      {(fold ? items.slice(0, limit) : items).map(render)}
      {items.length > limit + 1 && (
        <Pressable style={st.foldBtn} onPress={() => setOpen(!open)} accessibilityRole="button">
          <Text style={st.foldText}>{open ? 'Show less' : `Show all ${items.length} ${noun}`}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A search box like the web's (Journeys, Explore, Garage). */
export function Search({ value, onChange, placeholder, right }: { value: string; onChange: (v: string) => void; placeholder: string; right?: ReactNode }) {
  return (
    <View style={st.search}>
      <Icon name="compass" size={15} color="#929e88" />
      <TextInput style={st.searchInput} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#a0a697" autoCorrect={false} clearButtonMode="while-editing" />
      {right}
    </View>
  );
}

export const st = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.cardLine, padding: 18, marginBottom: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { fontSize: 18, letterSpacing: -0.3, fontWeight: '600', color: C.ink },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eef0e8' },
  label: { fontSize: 14, fontWeight: '500', color: C.ink },
  sub: { fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 58, textAlign: 'center', fontSize: 13, fontWeight: '600', color: C.ink, fontVariant: ['tabular-nums'] },
  field: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e1e4d8', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, fontSize: 16, color: C.ink, textAlign: 'right' },
  choice: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choiceItem: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.chip },
  choiceOn: { backgroundColor: C.yellow },
  choiceText: { fontSize: 12, color: C.muted },
  foldBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4, borderRadius: 14, backgroundColor: C.chip },
  foldText: { fontSize: 12, color: C.sageText, fontWeight: '500' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardLine, borderRadius: 16, paddingHorizontal: 14, minHeight: 46, marginBottom: 14 },
  searchInput: { flex: 1, fontSize: 16, color: C.ink, paddingVertical: 10 },
});
