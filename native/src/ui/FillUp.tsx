import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { FuelStore } from '../../../src/adapters/FuelStore';
import { noteFillUp } from '../../../src/app/fillUp';
import { useBetty } from '../state/Betty';
import { Primary, Secondary } from './Buttons';
import { Setting, Toggle } from './Card';
import { Sheet } from './Sheet';
import { C, T } from './theme';

/**
 * Filled up: the litres from the pump and whether the tank is full (core/FillUps), so Betty learns his real
 * consumption from full tank to full tank. Without litres it just resets the range, as before.
 */
export function FillUpSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const b = useBetty();
  const [litres, setLitres] = useState('');
  const [full, setFull] = useState(true);
  useEffect(() => { if (open) { setLitres(''); setFull(true); } }, [open]);
  const n = Number(litres.replace(',', '.'));
  const valid = litres.trim() !== '' && n > 0 && n <= 40;
  const save = (withLitres: boolean) => {
    const o = { litres: withLitres && valid ? n : null, full };
    const text = b.ride ? b.ride.ride.filledUp(o).text : noteFillUp(o, FuelStore.load()).text;
    b.toast(text); onClose(); onDone?.();
  };
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Fuel" title="Filled up.">
      <Text style={[T.sub, { marginBottom: 10 }]}>The litres from the pump teach Betty your real consumption, from one full tank to the next.</Text>
      <View style={st.row}>
        <TextInput value={litres} onChangeText={setLitres} placeholder="Litres, e.g. 9.2" keyboardType="decimal-pad" style={st.input} autoFocus />
        <Text style={T.body}>litres</Text>
      </View>
      <Setting label="Filled to the brim" sub="Off for a top-up: the range then goes up by what the litres last." last>
        <Toggle value={full} onChange={setFull} />
      </Setting>
      <View style={st.actions}>
        <Secondary label="No litres" onPress={() => save(false)} style={{ flex: 1 }} />
        <Primary label="Save" icon={null} disabled={!valid} onPress={() => save(true)} style={{ flex: 1 }} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 18, color: C.ink, backgroundColor: C.card },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
});
