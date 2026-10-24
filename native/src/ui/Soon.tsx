import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, T } from './theme';

/** A tab that comes in stage 4 of the port (Journeys, Explore, Garage): what it will hold, and anything useful now. */
export function Soon({ eyebrow, title, text, children }: { eyebrow: string; title: string; text: string; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[st.page, { paddingTop: insets.top + 20 }]}>
      <Text style={[T.eyebrow, { marginBottom: 10 }]}>{eyebrow}</Text>
      <Text style={[T.h1, { fontSize: 33, lineHeight: 37 }]}>{title}</Text>
      <Text style={[T.sub, { marginTop: 12 }]}>{text}</Text>
      <View style={{ marginTop: 22 }}>{children}</View>
    </ScrollView>
  );
}
const st = StyleSheet.create({ page: { paddingHorizontal: 22, paddingBottom: 40 } });
