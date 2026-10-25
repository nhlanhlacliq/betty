import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG, FLAVOUR_PROMPTS, bettySystemPrompt } from '../../../src/config/betty';
import { bettyLink } from '../../modules/betty-link';
import { useBetty } from '../state/Betty';
import { Primary, Secondary, TextButton } from '../ui/Buttons';
import { Icon } from '../ui/Icon';
import { C, T } from '../ui/theme';

/**
 * VOICE LAB (option C, 2026-10-25, owner: "explore C on the side"): talking to Betty over Betty Link, our own
 * WebSocket audio (native/modules/betty-link, voice/betty_voice/link.py) instead of Daily. One native module owns ALL
 * of the phone's sound: the helmet is in stereo until you hold the button, hands-free only while you talk. Not used by
 * rides; it cannot run during one (the two would fight over the sound). Push-to-talk only for now; the phone's tools
 * answer "not in the lab".
 */
const URL = (process.env.EXPO_PUBLIC_VOICE_URL ?? 'https://voice.forme.africa').replace(/^http/, 'ws') + '/ws-client';
const AUTH = `Basic ${btoa(`${process.env.EXPO_PUBLIC_VOICE_USER ?? 'app'}:${process.env.EXPO_PUBLIC_VOICE_TOKEN ?? ''}`)}`;
const TAIL_MS = 400; // keep the mic open a moment after release, for the last word
let msgId = 0;
const rtvi = (type: string, data: unknown) => JSON.stringify({ label: 'rtvi-ai', type, id: String(++msgId), data });
const clientMessage = (t: string, d: unknown) => rtvi('client-message', { t, d });

type Line = { at: number; who: 'you' | 'betty' | 'lab'; text: string };
type Status = 'off' | 'connecting' | 'ready' | 'opening' | 'listening' | 'speaking';

export default function Lab() {
  const b = useBetty();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('off');
  const [lines, setLines] = useState<Line[]>([]);
  const held = useRef(false);
  const lastOut = useRef({ text: '', at: 0 });
  const add = (who: Line['who'], text: string) => setLines((l) => [{ at: Date.now(), who, text }, ...l].slice(0, 200));

  useEffect(() => {
    if (!bettyLink) return;
    const subs = [
      bettyLink.addListener('onLog', (e) => add('lab', e.msg)),
      bettyLink.addListener('onState', (e) => { if (e.state === 'closed') { setStatus('off'); add('lab', `closed${e.detail ? `: ${e.detail}` : ''}`); } }),
      bettyLink.addListener('onMessage', (e) => onMessage(e.json)),
    ];
    return () => { subs.forEach((s) => s.remove()); bettyLink?.disconnect(); };
  }, []);

  const onMessage = (json: string) => {
    let m: { type?: string; data?: any };
    try { m = JSON.parse(json); } catch { return; }
    const d = m.data ?? {};
    switch (m.type) {
      case 'bot-ready': setStatus('ready'); add('lab', 'Betty is on the line'); break;
      case 'user-transcription': if (d.final && d.text?.trim()) add('you', d.text.trim()); break;
      case 'bot-output': {
        const text = String(d.text ?? '').trim();
        const kind = d.text_type ?? d.aggregated_by;
        if (kind !== 'sentence' || !text) break;
        if (text === lastOut.current.text && Date.now() - lastOut.current.at < 30_000) break; // sent twice: written, spoken
        lastOut.current = { text, at: Date.now() };
        add('betty', text);
        break;
      }
      case 'bot-started-speaking': setStatus((s) => (s === 'listening' ? s : 'speaking')); break;
      case 'bot-stopped-speaking': setStatus((s) => (s === 'speaking' ? 'ready' : s)); break;
      case 'server-message':
        if (d.t === 'tool') { // the phone's tools are not wired into the lab
          bettyLink?.send(clientMessage('tool-result', { id: d.id, result: { error: 'Not available in the voice lab.' } }));
          add('lab', `she asked the phone for ${d.name}: not in the lab`);
        }
        break;
    }
  };

  // Where he is (she asked for a town on the first lab test: there was no saved position). Asked once, kept.
  const here = useRef<Location.LocationObject | null>(null);
  const place = useRef<string | null>(null);
  const locate = async () => {
    if (here.current) return here.current;
    const { status } = await Location.requestForegroundPermissionsAsync().catch(() => ({ status: 'denied' }));
    if (status !== 'granted') return null;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000));
    here.current = (await Location.getLastKnownPositionAsync().catch(() => null))
      ?? await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null), timeout]);
    return here.current;
  };
  const situation = async () => {
    const pos = await locate();
    const lat = pos?.coords.latitude ?? null, lon = pos?.coords.longitude ?? null;
    if (pos && place.current == null) {
      const g = (await Location.reverseGeocodeAsync(pos.coords).catch(() => []))[0];
      place.current = [g?.district ?? g?.subregion, g?.city].filter(Boolean).join(', ');
    }
    const where = place.current ? ` He is at ${place.current}.` : '';
    return { text: `Voice lab test on the phone, not riding.${where} Local time: ${new Date().toTimeString().slice(0, 5)}.`, lat, lon };
  };

  const connect = async () => {
    if (!bettyLink || status !== 'off') return;
    setStatus('connecting');
    const t0 = Date.now();
    try {
      const body = { system: `${bettySystemPrompt(2)}\n\n${(FLAVOUR_PROMPTS as Record<string, string>).rider_query ?? ''}`, greet: false, ptt: true, mode: 'ptt', situation: await situation(), keyterms: [] };
      const where = await bettyLink.connect(URL, AUTH, JSON.stringify({ t: 'start', body }));
      bettyLink.setGain(CONFIG.voiceBoostDb); // Garage > Voice & audio > her loudness
      bettyLink.setMusic(CONFIG.musicWhileSpeaking); // Garage > Voice & audio > your music while she talks
      bettyLink.send(rtvi('client-ready', { version: '2.1.0', about: { library: 'betty-link' } }));
      add('lab', `connected in ${Date.now() - t0} ms; ${where}`);
    } catch (e) {
      setStatus('off'); add('lab', `could not connect: ${(e as Error).message}`);
    }
  };

  const press = async () => {
    if (!bettyLink || status === 'off' || status === 'connecting') return;
    held.current = true;
    bettyLink.send(clientMessage('situation', await situation()));
    bettyLink.send(clientMessage('ptt', { down: true })); // his turn: she stops at once
    setStatus('opening'); // the headset switches to hands-free: speak after the beep
    add('lab', await bettyLink.mic(true));
    if (held.current) setStatus('listening');
    if (!held.current) void release(); // let go while the helmet was switching
  };
  const release = async () => {
    held.current = false;
    if (!bettyLink) return;
    await new Promise((r) => setTimeout(r, TAIL_MS));
    if (held.current) return; // pressed again meanwhile
    add('lab', await bettyLink.mic(false));
    bettyLink.send(clientMessage('ptt', { down: false }));
    setStatus((s) => (s === 'listening' || s === 'opening' ? 'ready' : s));
  };

  const say = () => bettyLink?.send(clientMessage('say', { text: 'This is one of my own lines, through the same voice as my answers.' }));
  const share = () => void Share.share({ title: 'Voice lab log', message: [...lines].reverse().map((l) => `${new Date(l.at).toLocaleTimeString()} ${l.who}: ${l.text}`).join('\n') });

  const busy = !!b.ride;
  const live = status !== 'off' && status !== 'connecting';
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[st.page, { paddingTop: insets.top + 12, paddingBottom: 200 }]}>
        <View style={st.head}>
          <View style={{ flex: 1 }}><Text style={[T.eyebrow, { marginBottom: 8 }]}>Experiment</Text><Text style={[T.h1, { fontSize: 30, lineHeight: 34 }]}>Voice lab.</Text></View>
          <TextButton label="← Garage" onPress={() => router.back()} />
        </View>
        <Text style={[T.sub, { marginBottom: 12 }]}>
          Betty over our own connection instead of the call. The helmet stays in stereo (your music untouched) until you hold the button, and goes hands-free only while you talk. Rides don't use this yet.
        </Text>
        {!bettyLink && <Text style={st.warn}>This build has no Betty Link. Rebuild the app (prebuild first).</Text>}
        {busy && <Text style={st.warn}>End the ride first: the lab and a ride would fight over the sound.</Text>}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          {status === 'off'
            ? <Primary label="Connect" onPress={() => void connect()} disabled={!bettyLink || busy} style={{ flex: 1 }} />
            : <Secondary label={status === 'connecting' ? 'Connecting…' : 'Disconnect'} onPress={() => bettyLink?.disconnect()} style={{ flex: 1 }} />}
          <Secondary label="Her own line" onPress={say} disabled={!live} style={{ flex: 1 }} />
        </View>
        <Secondary label="Share the lab log" icon="share" onPress={share} style={{ marginBottom: 14 }} />
        {lines.map((l, i) => (
          <View key={i} style={st.line}>
            <Text style={st.lineHead}>{new Date(l.at).toLocaleTimeString()} {l.who}</Text>
            <Text style={[st.lineText, l.who === 'lab' && { color: C.muted }]}>{l.text}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={[st.dock, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={st.status}>{({ off: 'Not connected', connecting: 'Connecting…', ready: 'Hold to talk', opening: 'Wait for the beep…', listening: 'Listening… let go when done', speaking: 'Betty is speaking (hold to cut in)' } as const)[status]}</Text>
        <Pressable style={[st.talk, status === 'opening' && st.talkWait, status === 'listening' && st.talkOn, !live && { opacity: 0.4 }]} disabled={!live}
          onPressIn={() => void press()} onPressOut={() => void release()} accessibilityLabel="Hold to talk to Betty">
          <Icon name="mic" size={34} color="#fffbe8" />
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  warn: { color: C.ink, backgroundColor: '#f6e7b8', borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13 },
  line: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e6eade' },
  lineHead: { fontSize: 11, color: C.muted, marginBottom: 2 },
  lineText: { fontSize: 14, color: C.ink },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 14, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: '#e6eade' },
  status: { fontSize: 13, color: C.muted, marginBottom: 10 },
  talk: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#3d4a3a', alignItems: 'center', justifyContent: 'center' },
  talkOn: { backgroundColor: '#739363' },
  talkWait: { backgroundColor: '#b59a45' },
});
