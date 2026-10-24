import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HELP_TOPICS, searchHelp } from '../../../src/ui/help';
import { TextButton } from '../ui/Buttons';
import { Search } from '../ui/Card';
import { Html } from '../ui/Html';
import { Icon } from '../ui/Icon';
import { C, T } from '../ui/theme';

/**
 * Help (the web's, same content: src/ui/help.ts): every topic folded, its own search, opened at a topic with
 * `/help?topic=<id>` (the Garage's Voice commands, the empty Journeys page).
 */
export default function Help() {
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(topic ? [topic] : []));
  const topics = q.trim() ? searchHelp(q) : HELP_TOPICS;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[st.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
      <View style={st.head}>
        <View style={{ flex: 1 }}><Text style={[T.eyebrow, { marginBottom: 8 }]}>Help</Text><Text style={[T.h1, { fontSize: 30, lineHeight: 34 }]}>How Betty works.</Text></View>
        <TextButton label="← Garage" onPress={() => router.back()} />
      </View>
      <Text style={[T.sub, { marginBottom: 14 }]}>Tap a topic to open it.</Text>
      <Search value={q} onChange={setQ} placeholder="Search Help" />
      {!topics.length && <Text style={T.sub}>Nothing in Help matches that.</Text>}
      {topics.map((t) => {
        const isOpen = open.has(t.id) || !!q.trim();
        return (
          <View key={t.id} style={st.topic}>
            <Pressable style={st.topicHead} onPress={() => { const s = new Set(open); if (s.has(t.id)) s.delete(t.id); else s.add(t.id); setOpen(s); }} accessibilityState={{ expanded: isOpen }}>
              <Text style={st.topicTitle}>{t.title}</Text>
              <View style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}><Icon name="chev" color="#909b8d" /></View>
            </Pressable>
            {isOpen && <View style={{ paddingTop: 6 }}><Html html={t.html} /></View>}
          </View>
        );
      })}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  topic: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardLine, paddingHorizontal: 16, marginBottom: 8 },
  topicHead: { flexDirection: 'row', alignItems: 'center', minHeight: 54, gap: 10 },
  topicTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: C.ink },
});
