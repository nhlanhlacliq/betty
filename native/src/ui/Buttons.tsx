import { ReactNode } from 'react';
import { Pressable, PressableProps, StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { IconName } from '../../../src/ui/icons';
import { Icon } from './Icon';
import { C, shadow } from './theme';

/** Sinks a little while pressed (the web's .primary:active scale .97). */
const press = (base: ViewStyle | ViewStyle[], disabled?: boolean | null) => ({ pressed }: { pressed: boolean }) =>
  [base, pressed && !disabled ? { transform: [{ scale: 0.97 }] } : null, disabled ? { opacity: 0.5 } : null];

/** Butter yellow, the one main action (Let's ride, End & see my story). `wide` puts the arrow at the far end. */
export function Primary({ label, onPress, wide, icon = 'arrow', disabled, style }: { label: string; onPress: () => void; wide?: boolean; icon?: IconName | null; disabled?: boolean; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={press([st.primary, wide ? st.wide : {}, style ?? {}], disabled)}>
      <Text style={st.primaryText}>{label}</Text>
      {icon ? <Icon name={icon} size={20} /> : null}
    </Pressable>
  );
}

/** The quiet button (Lock, Filled up). */
export function Secondary({ label, onPress, icon, style, disabled }: { label: string; onPress: () => void; icon?: IconName; style?: ViewStyle; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={press([st.secondary, style ?? {}], disabled)}>
      {icon ? <Icon name={icon} size={15} /> : null}
      <Text style={st.secondaryText}>{label}</Text>
    </Pressable>
  );
}

/** A round button over the map (menu, quiet, zoom). `on` = dark (quiet is on, the map is off "follow me"). */
export function Round({ icon, onPress, label, on, size = 38, lit, children }: { icon?: IconName; onPress: () => void; label: string; on?: boolean; size?: number; lit?: boolean; children?: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={press([st.round, { width: size, height: size, borderRadius: size / 2 }, on ? { backgroundColor: C.ink } : {}, lit ? { backgroundColor: C.accent } : {}])}>
      {icon ? <Icon name={icon} size={size > 39 ? 20 : 15} color={on ? '#fffbe8' : C.ink} /> : null}
      {children}
    </Pressable>
  );
}

/** A plain text link (the web's .free-button / .text-button). */
export function TextButton({ label, onPress, icon }: { label: string; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={st.text} hitSlop={6}>
      <Text style={st.textText}>{label}</Text>
      {icon ? <Icon name={icon} size={13} color="#71816e" /> : null}
    </Pressable>
  );
}

export const Row = ({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: ViewStyle }) => <View style={[{ flexDirection: 'row', gap }, style]}>{children}</View>;

const st = StyleSheet.create({
  primary: { backgroundColor: C.yellow, paddingVertical: 17, paddingHorizontal: 21, minHeight: 55, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 15 },
  wide: { alignSelf: 'stretch', justifyContent: 'space-between' },
  primaryText: { fontSize: 14, fontWeight: '600', color: C.ink },
  secondary: { backgroundColor: C.chip, borderWidth: 1, borderColor: '#e3e8da', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { fontSize: 13, color: C.ink },
  round: { backgroundColor: '#fffff4e8', alignItems: 'center', justifyContent: 'center', ...shadow },
  text: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  textText: { fontSize: 12, color: '#71816e' },
});
