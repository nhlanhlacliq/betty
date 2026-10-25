import { StyleSheet, Text, View } from 'react-native';
import { useBetty } from '../state/Betty';
import { Choice } from './Card';
import { C } from './theme';

/** How he talks to her (owner, 2026-10-25): one of three, never two at once. Home's ride sheet and the ride menu. */
const WHAT = {
  hold: 'Hold the mic button on the screen and talk; let go when you are done.',
  open: 'Say "Betty…" any time; a quick follow-up needs no name. The helmet stays in call mode, so music is at call quality.',
  buttons: 'Play/pause talks, next track repeats her, previous track gives the buttons back. Your music is off while she has them.',
} as const;

export function TalkChoice() {
  const b = useBetty();
  return (
    <View style={st.wrap}>
      <Choice value={b.talk} options={[['hold', 'Hold to talk'], ['open', 'Open mic'], ['buttons', 'Headset buttons']]} onChange={b.setTalk} />
      <Text style={st.sub}>{WHAT[b.talk]}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingVertical: 10 },
  sub: { fontSize: 11, color: C.muted, marginTop: 8 },
});
