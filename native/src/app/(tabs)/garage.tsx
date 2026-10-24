import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CLOUD_VOICES, CONFIG, TALK_PRESETS, TalkPreset, applyMode, applyTalkPreset, chirpVoice, cleanBikeName, cleanRiderName, currentMode, currentTalkPreset, mixSummary } from '../../../../src/config/betty';
import { loadConfig, saveConfig } from '../../../../src/config/persist';
import { describeBackup, mergeSharePack, parseBackup } from '../../../../src/app/backup';
import { describePack, parsePack } from '../../../../src/core/Share';
import { JourneyStore } from '../../../../src/adapters/JourneyStore';
import { exportAll, pickFile, restoreAll } from '../../adapters/Backup';
import { kmToReserve } from '../../../../src/core/Fuel';
import { BIKES, Reminder, ServiceBook, alignToOdometer, canUndo, dueInfo, dueList, dueText, markDone, undoDone } from '../../../../src/core/Reminders';
import { FuelStore } from '../../../../src/adapters/FuelStore';
import { ASK_ABOUT_ME, ProfileStore } from '../../../../src/adapters/ProfileStore';
import { ServiceStore } from '../../../../src/adapters/ServiceStore';
import { serverFetch } from '../../../../src/adapters/server';
import { CHANGELOG } from '../../../../src/changelog';
import { LocalSeen, allIds, seenSet, unreadCount } from '../../../../src/app/whatsNew';
import { TALK_LABELS, sampleLine } from '../../../../src/ui/copy';
import { useBetty } from '../../state/Betty';
import { Primary, Secondary } from '../../ui/Buttons';
import { Card, Choice, Field, Setting, Stepper, Toggle } from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { C, T } from '../../ui/theme';
import { fuelText } from '../../ui/fuel';

const ISLAND: Array<[keyof typeof CONFIG.island, string, string]> = [
  ['compact', 'Compact', 'A small pill that grows when something new comes up.'],
  ['tapExpand', 'Tap to grow', 'Tap it to open or close the full card.'],
  ['browse', 'Swipe to browse', 'Swipe sideways for rain, route, sunset, the area...'],
  ['actions', 'Card buttons', 'Filled up, Tell me a story, Up ahead and more.'],
  ['progress', 'Progress bars', 'How far along the route, the fuel range, the light left.'],
];
const num = (v: string) => { const n = Number(v.replace(',', '.').replace(/[\s]/g, '').replace(/km$/i, '')); return v.trim() && Number.isFinite(n) && n >= 0 ? n : null; };
/** "Every 600 km", "Every 2 weeks", "Every 10,000 km or a year" (the web's Reminders card). */
function interval(r: Reminder): string {
  const t = r.everyDays == null ? null : r.everyDays % 365 === 0 ? (r.everyDays === 365 ? 'year' : `${r.everyDays / 365} years`)
    : r.everyDays % 30 === 0 ? (r.everyDays === 30 ? 'month' : `${r.everyDays / 30} months`) : r.everyDays % 7 === 0 ? (r.everyDays === 7 ? 'week' : `${r.everyDays / 7} weeks`) : `${r.everyDays} days`;
  const km = r.everyKm != null ? `${r.everyKm.toLocaleString('en-US')} km` : null;
  return `Every ${[km, km && t && !/\d/.test(t) ? `a ${t}` : t].filter(Boolean).join(' or ')}`;
}

/**
 * The Garage (the web's, design v3): Help and What's new, Betty's personality (narration, humour, character, little
 * animations, what she knows about you, her voice), Horizon, voice and loudness, your names, fuel and the ride
 * numbers, reminders, talking to her, the log. Every change is saved at once (the shared CONFIG and stores) and a
 * running ride uses it from her next line.
 */
export default function Garage() {
  const b = useBetty();
  const insets = useSafeAreaInsets();
  const [, bump] = useState(0);
  const [sheet, setSheet] = useState<'voice' | 'news' | 'knowme' | null>(null);
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);
  const changed = () => { saveConfig(); bump((n) => n + 1); };
  const seen = useMemo(() => seenSet(CHANGELOG, LocalSeen), [sheet]);
  const unread = unreadCount(CHANGELOG, seen);
  const preset = currentTalkPreset(), mine = currentMode();
  const presetValue = preset ?? (mine ? `mode:${mine}` : 'custom');
  const presetOptions: Array<[string, string]> = [...(Object.keys(TALK_PRESETS) as TalkPreset[]).map((k) => [k, TALK_LABELS[k]] as [string, string]),
    ...Object.keys(CONFIG.modes).map((n) => [`mode:${n}`, `${n[0].toUpperCase()}${n.slice(1)} (yours)`] as [string, string])];
  const f = CONFIG.fuel;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={[st.page, { paddingTop: insets.top + 20 }]} keyboardShouldPersistTaps="handled">
      <Text style={[T.eyebrow, { marginBottom: 10 }]}>Your garage</Text>
      <Text style={[T.h1, { fontSize: 33, lineHeight: 37, marginBottom: 18 }]}>Make Betty yours.</Text>

      <Card>
        <Link icon="book" title="How Betty works" sub="Getting started, talking to her, every voice command, fuel, routes and fixes." onPress={() => router.push('/help')} />
        <Link icon="mic" title="Voice commands" sub="Everything you can tell her to do." onPress={() => router.push('/help?topic=commands')} />
        <Link icon="spark" title="What's new" sub={unread ? `${unread} new` : 'Latest updates'} badge={unread} onPress={() => setSheet('news')} />
        <Link icon="wrench" title="The log" sub="What she said and heard this session, to share after a ride." onPress={() => router.push('/log')} last />
      </Card>

      <Card title="Betty's personality">
        <Setting label="Narration" sub={`${preset || mine ? '' : 'A custom mix (by voice). '}${mixSummary()} Alerts and answers are not affected.`} stack>
          <Choice value={presetValue} options={presetOptions} onChange={(v) => {
            if (v.startsWith('mode:')) { const m = CONFIG.modes[v.slice(5)]; if (m) applyMode(m); } else applyTalkPreset(v as TalkPreset);
            changed();
          }} />
        </Setting>
        <Setting label="A little dry humour" sub="Facts only → Playful">
          <Stepper value={CONFIG.persona.humour} min={0} max={100} step={10} format={(v) => `${v}%`} onChange={(v) => { CONFIG.persona.humour = v; changed(); }} />
        </Setting>
        <Setting label="Character" sub="JARVIS (polished) → TARS (blunt)">
          <Stepper value={CONFIG.persona.tars} min={0} max={100} step={10} format={(v) => `${v}% TARS`} onChange={(v) => { CONFIG.persona.tars = v; changed(); }} />
        </Setting>
        <Setting label="Little animations" sub="Her orb breathing and the small movements. Off: things just appear.">
          <Toggle value={CONFIG.motion} onChange={(v) => { CONFIG.motion = v; changed(); }} />
        </Setting>
        <Setting label="Let Betty know me" sub={ProfileStore.get() ? 'She uses what you shared, lightly.' : 'Share a little about yourself so she can make it personal.'}>
          <Toggle value={CONFIG.useProfile} onChange={(v) => { CONFIG.useProfile = v; changed(); b.ride?.ride.engine.setProfile(v ? ProfileStore.get() : null); }} />
        </Setting>
        <View style={st.buttons}>
          <Secondary label="What she knows about you" onPress={() => setSheet('knowme')} style={{ flex: 1 }} />
          <Secondary label="Hear Betty's voice" icon="volume" onPress={() => b.hello(sampleLine(CONFIG.persona.humour))} style={{ flex: 1 }} />
        </View>
      </Card>

      <Card title="Horizon">
        <Setting label="Show Horizon" sub="The card at the top of the ride map: one thing worth a glance.">
          <Toggle value={CONFIG.showGlance} onChange={(v) => { CONFIG.showGlance = v; changed(); }} />
        </Setting>
        {ISLAND.map(([k, label, sub], i) => (
          <Setting key={k} label={label} sub={sub} last={i === ISLAND.length - 1}>
            <Toggle value={CONFIG.island[k]} disabled={!CONFIG.showGlance} onChange={(v) => { CONFIG.island[k] = v; changed(); }} />
          </Setting>
        ))}
      </Card>

      <Card title="Voice & audio">
        <Setting label="Her voice" sub="Google Chirp 3 HD, with the phone's voice as backup when there is no signal.">
          <Pressable style={st.pickBtn} onPress={() => setSheet('voice')}><Text style={st.pickText}>{chirpVoice().name}</Text><Icon name="chev" size={15} color="#909b8d" /></Pressable>
        </Setting>
        <Setting label="Louder voice" sub="For wind noise. Turns up her cloud voice; the phone's backup voice cannot go louder." last>
          <Stepper value={CONFIG.voiceBoostDb} min={0} max={16} step={2} format={(v) => (v ? `+${v} dB` : 'Off')} onChange={(v) => { CONFIG.voiceBoostDb = v; changed(); }} />
        </Setting>
      </Card>

      <Card title="In your garage">
        <Setting label="What she calls you">
          <Field value={CONFIG.riderName} width={140} onCommit={(v) => { CONFIG.riderName = cleanRiderName(v); changed(); }} autoCapitalize="words" />
        </Setting>
        <Setting label="Your motorcycle" sub="What she calls the bike.">
          <Field value={CONFIG.bikeName} width={140} onCommit={(v) => { CONFIG.bikeName = cleanBikeName(v); changed(); }} />
        </Setting>
        <Setting label="Fuel range" sub={fuelText(b.ride ? b.ride.ride.engine.kmSinceFill() : FuelStore.load())}>
          <Secondary label="Filled up" onPress={() => { if (b.ride) b.ride.ride.filledUp(); else FuelStore.save(0); b.toast(`Fill-up noted. Range reset to ${Math.round(kmToReserve(CONFIG.fuel))} km.`); bump((n) => n + 1); }} />
        </Setting>
        <Setting label="Tank" sub="Litres, of which reserve.">
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Field value={String(f.tankL)} width={64} keyboardType="decimal-pad" onCommit={(v) => { const n = num(v); if (n != null && n >= 3 && n <= 40) { f.tankL = n; f.reserveL = Math.min(f.reserveL, n); } changed(); }} />
            <Field value={String(f.reserveL)} width={56} keyboardType="decimal-pad" onCommit={(v) => { const n = num(v); if (n != null && n <= 10) f.reserveL = Math.min(n, f.tankL); changed(); }} />
          </View>
        </Setting>
        <Setting label="Average consumption" sub='L/100 km, from the dash. Or say "consumption 4.6".'>
          <Field value={String(f.lPer100)} width={70} keyboardType="decimal-pad" onCommit={(v) => { const n = num(v); if (n != null && n >= 2 && n <= 15) f.lPer100 = n; changed(); }} />
        </Setting>
        <Setting label="Petrol price" sub={`Rand a litre. ${f.priceSource === 'auto' ? 'Looked up' : 'Yours, set'} ${new Date(f.priceAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}.`}>
          <Field value={String(f.pricePerL)} width={76} keyboardType="decimal-pad" onCommit={(v) => { const n = num(v); if (n != null && n >= 5 && n <= 100) { f.pricePerL = n; f.priceSource = 'manual'; f.priceAt = Date.now(); } changed(); }} />
        </Setting>
        <Setting label="Road drawings in My journeys" sub="A little drawing of each ride's road beside it.">
          <Toggle value={CONFIG.journeyThumbs} onChange={(v) => { CONFIG.journeyThumbs = v; changed(); }} />
        </Setting>
        <Setting label="Count riding time only" sub="Ride times leave out parking and breaks. Each ride's story still shows riding and stopped time." last>
          <Toggle value={CONFIG.ridingTimeOnly} onChange={(v) => { CONFIG.ridingTimeOnly = v; changed(); }} />
        </Setting>
      </Card>

      <Reminders onEdit={setEditing} />

      <Card title="Talking to Betty">
        <Setting label="Smarter web answers" sub="Typed questions she looks up use a stronger model: better with sums and comparisons, about 2 seconds slower and a few cents more each." last>
          <Toggle value={CONFIG.smartSearch} onChange={(v) => { CONFIG.smartSearch = v; changed(); }} />
        </Setting>
      </Card>

      <Card title="Your journeys, your business">
        <Text style={T.sub}>Rides, lines and notes stay on this phone.</Text>
      </Card>

      <YourData />

      <Sheet open={sheet === 'voice'} onClose={() => setSheet(null)} eyebrow="Voice" title="Her voice">
        {(['female', 'male'] as const).map((g) => (
          <View key={g} style={{ marginBottom: 12 }}>
            <Text style={[T.eyebrow, { marginBottom: 6 }]}>{g === 'female' ? 'Female voices' : 'Male voices'}</Text>
            {CLOUD_VOICES.filter(([, , gender]) => gender === g).map(([name, desc]) => {
              const on = chirpVoice().name === name;
              return (
                <Pressable key={name} style={st.voiceRow} onPress={() => { CONFIG.cloudVoiceName = name; CONFIG.chirpStandIn = name; changed(); b.hello(`This is ${name}. Shall we ride?`); }}>
                  <Text style={[st.voiceName, on && { fontWeight: '700' }]}>{on ? '● ' : ''}{name}</Text><Text style={T.sub}>{desc}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </Sheet>

      <NewsSheet open={sheet === 'news'} onClose={() => { LocalSeen.set(allIds(CHANGELOG)); setSheet(null); }} seen={seen} />
      <KnowMe open={sheet === 'knowme'} onClose={() => setSheet(null)} />
      <ReminderSheet editing={editing} onClose={() => setEditing(null)} />
    </ScrollView>
  );
}

/**
 * Your data: one file with everything (the same file the web app makes), to move phones or bring the web app's rides
 * here: on the web app, Garage > Export all data > Save to Files; here, Import a backup and pick it. Import REPLACES
 * what is on this phone (it asks first); a friend's shared file is ADDED instead.
 */
function YourData() {
  const b = useBetty();
  const [busy, setBusy] = useState('');
  const ask = (title: string, msg: string, yes: string) => new Promise<boolean>((res) =>
    Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: yes, style: 'destructive', onPress: () => res(true) }]));
  const doExport = async () => {
    setBusy('export');
    try { await exportAll(); } catch (e) { b.toast(`Could not make the backup: ${(e as Error).message}`); }
    finally { setBusy(''); }
  };
  const doImport = async () => {
    if (b.ride) { b.toast('End the ride first, then import.'); return; }
    setBusy('import');
    try {
      const text = await pickFile();
      if (text == null) return;
      const pack = parsePack(text);
      if (pack) {
        if (!(await ask('Add a friend\'s share?', `Add what ${pack.from} shared (${describePack(pack)})? Nothing of yours is replaced.`, 'Add'))) return;
        b.toast(mergeSharePack(pack).text); b.touch();
        return;
      }
      const bk = parseBackup(text);
      if (!(await ask('Replace everything?', `Replace everything Betty has on this phone with this backup (${describeBackup(bk)})?`, 'Replace'))) return;
      await restoreAll(bk);
      loadConfig(); JourneyStore.reset(); b.touch();
      b.toast('Backup restored: your rides, stories and settings are here.');
    } catch (e) { b.toast((e as Error).message); }
    finally { setBusy(''); }
  };
  return (
    <Card title="Your data" sub="Moving phones, or bringing your rides over from the web app? One file with your rides, logs, memory, area stories, settings and her picture.">
      <Text style={[T.sub, { marginBottom: 12 }]}>From the web app: Garage, Export all data, Save to Files. Then here: Import a backup and pick that file. Import replaces what is on this phone; a friend's shared file is added instead.</Text>
      <View style={st.buttons}>
        <Secondary label={busy === 'export' ? 'Making it…' : 'Export all data'} icon="share" disabled={!!busy} onPress={() => void doExport()} style={{ flex: 1 }} />
        <Secondary label={busy === 'import' ? 'Reading…' : 'Import a backup'} disabled={!!busy} onPress={() => void doImport()} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

function Link({ icon, title, sub, onPress, badge, last }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub: string; onPress: () => void; badge?: number; last?: boolean }) {
  return (
    <Pressable style={[st.link, last && { borderBottomWidth: 0 }]} onPress={onPress} accessibilityRole="button">
      <View style={st.linkIcon}><Icon name={icon} size={18} /></View>
      <View style={{ flex: 1 }}><Text style={st.linkTitle}>{title}</Text><Text style={T.sub}>{sub}</Text></View>
      {badge ? <View style={st.badge}><Text style={st.badgeText}>{badge}</Text></View> : null}
      <Icon name="chev" color="#909b8d" />
    </Pressable>
  );
}

/** Reminders (the web's card): the odometer, each item with when it is due (Done / Undo), tap to edit, Add. */
function Reminders({ onEdit }: { onEdit: (r: Reminder | 'new') => void }) {
  const b = useBetty();
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  const book = useMemo(() => (b.ready ? ServiceStore.load() : null), [b.ready, b.data, justDone]);
  if (!book) return null;
  const save = (nb: ServiceBook) => { ServiceStore.save(nb); b.ride?.ride.engine.setServiceBook(nb); b.touch(); };
  const bike = BIKES.find((x) => x.id === book.bike);
  const guessed = book.items.some((r) => r.assumed);
  const list = dueList(book, Date.now());
  return (
    <Card title="Reminders">
      <Setting label="Odometer" sub="Km ridden with Betty. Set it to the bike's reading so a service due at 30,000 km lines up.">
        <Field value={String(Math.round(book.odoKm))} width={100} keyboardType="number-pad" onCommit={(v) => { const n = num(v); if (n != null) save(alignToOdometer(ServiceStore.load(), n)); }} />
      </Setting>
      {bike && <Text style={[T.sub, { marginVertical: 8 }]}>{bike.name} schedule from the handbook{book.odoKm ? '' : '. Set the odometer first so it lines up'}{guessed ? '. "Last done" is a guess until you set it or tap Done.' : '.'}</Text>}
      {list.map((d) => {
        const r = d.r, done = justDone.has(r.id);
        return (
          <Pressable key={r.id} style={st.reminder} onPress={() => onEdit(r)} accessibilityRole="button" accessibilityLabel={`${r.name}, ${dueText(d)}. Tap to edit`}>
            <View style={[st.dueDot, d.state === 'due' ? { backgroundColor: C.danger } : d.state === 'soon' ? { backgroundColor: C.warn } : null]} />
            <View style={{ flex: 1 }}>
              <Text style={st.linkTitle}>{r.name}</Text>
              <Text style={T.sub}>{interval(r)} · {d.state === 'due' ? 'due: ' : ''}{dueText(d)}{r.assumed ? ' · last done: a guess' : ''}</Text>
            </View>
            {done
              ? <Secondary label="Undo" onPress={() => { save(undoDone(ServiceStore.load(), r.id)); const s = new Set(justDone); s.delete(r.id); setJustDone(s); }} />
              : <Secondary label="Done" icon="check" onPress={() => { save(markDone(ServiceStore.load(), r.id, Date.now())); setJustDone(new Set([...justDone, r.id])); b.toast(`${r.name}: done.`); }} />}
          </Pressable>
        );
      })}
      <Secondary label="Add a reminder" icon="plus" onPress={() => onEdit('new')} style={{ marginTop: 12 }} />
    </Card>
  );
}

/** Add or edit a reminder: name, every km and/or every N days/weeks/months/years, done how long ago; Delete; Not done. */
function ReminderSheet({ editing, onClose }: { editing: Reminder | 'new' | null; onClose: () => void }) {
  const b = useBetty();
  const r = editing && editing !== 'new' ? editing : null;
  const book = editing ? ServiceStore.load() : null;
  const unitFor = (days: number) => (days % 365 === 0 ? 365 : days % 30 === 0 ? 30 : days % 7 === 0 ? 7 : 1);
  const [name, setName] = useState('');
  const [km, setKm] = useState('');
  const [every, setEvery] = useState('');
  const [unit, setUnit] = useState<'1' | '7' | '30' | '365'>('30');
  const [ago, setAgo] = useState('0');
  const [note, setNote] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const k = editing ? (r?.id ?? 'new') : null;
  if (k !== key) {
    setKey(k);
    if (editing) {
      const u = r?.everyDays ? unitFor(r.everyDays) : 30;
      setName(r?.name ?? ''); setKm(r?.everyKm != null ? String(r.everyKm) : ''); setUnit(String(u) as '30');
      setEvery(r?.everyDays ? String(r.everyDays / u) : ''); setAgo(String(r && book ? Math.max(0, Math.round(book.odoKm - r.lastKm)) : 0)); setNote('');
    }
  }
  if (!editing || !book) return <Sheet open={false} onClose={onClose}><View /></Sheet>;
  const save = (nb: ServiceBook) => { ServiceStore.save(nb); b.ride?.ride.engine.setServiceBook(nb); b.touch(); };
  const submit = () => {
    const everyKm = num(km), n = num(every), agoKm = num(ago) ?? 0;
    const everyDays = n ? Math.round(n * Number(unit)) : null;
    if (!name.trim() || (!everyKm && !everyDays)) { setNote('Give it a name and a distance or a time.'); return; }
    const rem: Reminder = { ...(r ?? {}), id: r?.id ?? `r${Date.now().toString(36)}`, name: name.trim(), everyKm: everyKm || null, everyDays, lastKm: Math.round(book.odoKm - agoKm), lastAt: r?.lastAt ?? Date.now(), assumed: false };
    save({ ...book, items: r ? book.items.map((x) => (x.id === r.id ? rem : x)) : [...book.items, rem] });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} eyebrow="Reminder" title={r ? r.name : 'Add a reminder'}>
      {r?.note ? <Text style={[T.sub, { marginBottom: 10 }]}>{r.note}</Text> : null}
      <Setting label="Name"><Field value={name} width={170} onCommit={setName} /></Setting>
      <Setting label="Every (km)" sub="Leave empty if it goes by time only."><Field value={km} width={100} keyboardType="number-pad" onCommit={setKm} /></Setting>
      <Setting label="Or every" stack>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Field value={every} width={64} keyboardType="number-pad" onCommit={setEvery} />
          <Choice value={unit} onChange={setUnit} options={[['1', 'days'], ['7', 'weeks'], ['30', 'months'], ['365', 'years']]} />
        </View>
      </Setting>
      <Setting label="Last done (km ago)" last><Field value={ago} width={90} keyboardType="number-pad" onCommit={setAgo} /></Setting>
      {note ? <Text style={[T.sub, { color: C.danger }]}>{note}</Text> : null}
      <View style={st.buttons}>
        {r && <Secondary label="Delete" onPress={() => { save({ ...book, items: book.items.filter((x) => x.id !== r.id) }); onClose(); }} style={{ flex: 1, backgroundColor: C.end, borderColor: 'transparent' }} />}
        <Primary label="Save" icon={null} onPress={submit} style={{ flex: 1 }} />
      </View>
      {r && canUndo(r) && (
        <Secondary label={`Mark as not done${r.prev ? ` (back to ${new Date(r.prev.lastAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })})` : ''}`}
          onPress={() => { save(undoDone(book, r.id)); onClose(); }} style={{ marginTop: 10 }} />
      )}
      {r && <Text style={[T.sub, { marginTop: 10 }]}>Now: {dueText(dueInfo(r, book.odoKm, Date.now()))}</Text>}
    </Sheet>
  );
}

/** What's new: the shared changelog, newest day first; opening it marks everything read. */
function NewsSheet({ open, onClose, seen }: { open: boolean; onClose: () => void; seen: Set<string> }) {
  const label = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' });
  return (
    <Sheet open={open} onClose={onClose} eyebrow="What's new" title="Latest updates">
      {CHANGELOG.slice(0, 8).map((d) => (
        <View key={d.date} style={{ marginBottom: 14 }}>
          <Text style={[T.eyebrow, { marginBottom: 6 }]}>{label(d.date)}</Text>
          {d.items.map((c) => (
            <View key={c.id} style={st.change}>
              <Text style={st.changeKind}>{c.kind === 'new' ? 'New' : c.kind === 'better' ? 'Better' : 'Fixed'}{!seen.has(c.id) && c.kind !== 'fixed' ? ' ·  unread' : ''}</Text>
              <Text style={st.linkTitle}>{c.title}</Text>
              <Text style={T.sub}>{c.text}</Text>
            </View>
          ))}
        </View>
      ))}
    </Sheet>
  );
}

/** Let Betty know me: the question to ask ChatGPT/Claude, paste the answer, Distil (api/profile), edit, Save / Forget. */
function KnowMe({ open, onClose }: { open: boolean; onClose: () => void }) {
  const b = useBetty();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const value = text ?? ProfileStore.get() ?? '';
  const save = (v: string | null) => { ProfileStore.set(v); setText(null); b.ride?.ride.engine.setProfile(CONFIG.useProfile ? ProfileStore.get() : null); };
  const distil = async () => {
    if (!value.trim() || busy) return;
    setBusy(true); setNote('');
    try {
      const res = await serverFetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: value }) });
      const out: any = await res.json().catch(() => ({}));
      if (!res.ok || typeof out?.profile !== 'string') throw new Error(out?.error || `HTTP ${res.status}`);
      setText(out.profile); setNote('Distilled. Read it, change anything, then Save.');
    } catch (e) { setNote(`Could not distil it: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Let Betty know me" title="What she knows about you">
      <Text style={[T.sub, { marginBottom: 10 }]}>Ask ChatGPT or Claude this, paste the answer below and tap Distil. She uses it lightly: never quotes it, never lists it.</Text>
      <Pressable style={st.ask} onPress={() => { void Clipboard.setStringAsync(ASK_ABOUT_ME); b.toast('Question copied.'); }}>
        <Text style={[T.body, { flex: 1 }]}>{ASK_ABOUT_ME}</Text><Text style={st.copy}>Copy</Text>
      </Pressable>
      <TextInput style={st.profile} multiline value={value} onChangeText={setText} placeholder="Paste here, or write a few lines about yourself" placeholderTextColor="#a0a697" textAlignVertical="top" />
      {note ? <Text style={[T.sub, { marginTop: 6 }]}>{note}</Text> : null}
      <View style={st.buttons}>
        <Secondary label={busy ? 'Distilling…' : 'Distil'} onPress={() => void distil()} disabled={busy || !value.trim()} style={{ flex: 1 }} />
        <Primary label="Save" icon={null} onPress={() => { save(value); b.toast('Saved.'); onClose(); }} disabled={!value.trim()} style={{ flex: 1 }} />
      </View>
      {ProfileStore.get() && <Secondary label="Forget it" onPress={() => { save(null); b.toast('Forgotten. She knows nothing about you beyond the ride.'); onClose(); }} style={{ marginTop: 10 }} />}
    </Sheet>
  );
}

const st = StyleSheet.create({
  page: { paddingHorizontal: 20, paddingBottom: 40 },
  buttons: { flexDirection: 'row', gap: 9, marginTop: 14, flexWrap: 'wrap' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eef0e8' },
  linkIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.sageSoft, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontSize: 14, fontWeight: '500', color: C.ink, marginBottom: 2 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#3d3618' },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.chip, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  pickText: { fontSize: 13, fontWeight: '600', color: C.ink },
  voiceRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eef0e8', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  voiceName: { fontSize: 14, color: C.ink },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eef0e8' },
  dueDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.dot },
  change: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eef0e8' },
  changeKind: { fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: C.sageText, marginBottom: 3 },
  ask: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardLine, padding: 12, marginBottom: 12 },
  copy: { fontSize: 12, fontWeight: '600', color: C.sageText },
  profile: { minHeight: 160, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e1e4d8', borderRadius: 14, padding: 12, fontSize: 15, color: C.ink },
});

