import { router } from 'expo-router';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatLog } from '../../../src/core/LineLog';
import { LineLogStore } from '../../../src/adapters/LineLogStore';
import { RideLog } from '../../../src/adapters/RideLog';
import { useBetty } from '../state/Betty';
import { Secondary, TextButton } from '../ui/Buttons';
import { C, T } from '../ui/theme';

/**
 * The log (the web's Workshop LOG, for road tests): this session's lines newest first, with their fate, and Share for
 * the whole saved log (every ride) as plain text, the main tool for judging a ride afterwards.
 */
export default function Log() {
  const { lines, logger } = useBetty();
  const insets = useSafeAreaInsets();
  const shareAll = () => { logger.save(); void Share.share({ message: formatLog(LineLogStore.load(), RideLog.load()), title: 'Betty log' }); };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[st.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]}>
      <View style={st.head}>
        <View style={{ flex: 1 }}><Text style={[T.eyebrow, { marginBottom: 8 }]}>Workshop</Text><Text style={[T.h1, { fontSize: 30, lineHeight: 34 }]}>The log.</Text></View>
        <TextButton label="← Garage" onPress={() => router.back()} />
      </View>
      <Text style={[T.sub, { marginBottom: 12 }]}>Everything she said this session, what she heard and what the voice server did, newest first. Share sends every saved ride's log as text.</Text>
      <Secondary label="Share the whole log" icon="share" onPress={shareAll} style={{ marginBottom: 14 }} />
      {lines.length === 0 && <Text style={T.sub}>Nothing yet this session. Start a ride.</Text>}
      {lines.map((l) => (
        <View key={l.id} style={st.line}>
          <Text style={st.lineHead}>{new Date(l.at).toLocaleTimeString()} {l.head}{l.item ? ` · ${l.item.fate}` : ''}</Text>
          <Text style={st.lineText}>{l.text}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  line: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d8cfc2' },
  lineHead: { fontSize: 11, color: C.sageText },
  lineText: { fontSize: 14, color: C.ink, marginTop: 2 },
});
