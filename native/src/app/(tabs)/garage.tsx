import { StyleSheet, Text, View } from 'react-native';
import { useBetty } from '../../state/Betty';
import { Soon } from '../../ui/Soon';
import { C, T } from '../../ui/theme';

/** Garage comes in stage 4; until then it holds the log (what was said, what the voice server heard), for testing. */
export default function Garage() {
  const { lines } = useBetty();
  return (
    <Soon eyebrow="Garage" title="Your settings." text="Personality, voices, names, fuel, reminders, Horizon and Help come to the app in the next stage. Below: this session's log, newest first.">
      <Text style={[T.eyebrow, { marginBottom: 8 }]}>Log</Text>
      {lines.length === 0 && <Text style={T.sub}>Nothing yet. Start a ride.</Text>}
      {lines.map((l) => (
        <View key={l.id} style={st.line}>
          <Text style={st.head}>{new Date(l.at).toLocaleTimeString()} {l.head}{l.item ? ` · ${l.item.fate}` : ''}</Text>
          <Text style={st.text}>{l.text}</Text>
        </View>
      ))}
    </Soon>
  );
}
const st = StyleSheet.create({
  line: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d8cfc2' },
  head: { fontSize: 11, color: C.sageText },
  text: { fontSize: 14, color: C.ink, marginTop: 2 },
});
