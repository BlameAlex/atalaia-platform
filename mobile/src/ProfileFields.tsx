import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HomeRisk, MobilityNeed } from './api';
import { DateWheel } from './DateWheel';
import { DEMO, joinAddress, MOBILITY_LABELS, riskText, splitAddress, type AddressParts, type Draft } from './logic';

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  body: { padding: 20, gap: 12 },
  h1: { fontSize: 24, fontWeight: '700', color: '#111' },
  label: { fontSize: 15, color: '#333', marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 12, fontSize: 17, color: '#111' },
  err: { color: '#b00020', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { backgroundColor: '#1a56db', borderRadius: 8, padding: 14, alignItems: 'center' },
  btn2: { backgroundColor: '#e5e7eb' },
  btnOff: { opacity: 0.4 },
  btnTxt: { color: '#fff', fontSize: 17, fontWeight: '600' },
  btn2Txt: { color: '#111' },
  card: { backgroundColor: '#f3f4f6', borderRadius: 8, padding: 14, gap: 4 },
});

export function Btn(p: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={p.disabled} onPress={p.onPress}
      style={[s.btn, p.secondary && s.btn2, p.disabled && s.btnOff]}>
      <Text style={[s.btnTxt, p.secondary && s.btn2Txt]}>{p.title}</Text>
    </Pressable>
  );
}

type Props = { draft: Draft; set: (d: Draft) => void; errors: Record<string, string> };
const Err = ({ m }: { m?: string }) => (m ? <Text style={s.err} accessibilityLiveRegion="polite">{m}</Text> : null);

export function PersonalFields({ draft, set, errors }: Props) {
  return (
    <>
      <Text style={s.label}>Nombre completo</Text>
      <TextInput style={s.input} value={draft.fullName} onChangeText={(v) => set({ ...draft, fullName: v })} autoCapitalize="words" />
      <Err m={errors.fullName} />
      <Text style={s.label}>Fecha de nacimiento</Text>
      <DateWheel value={draft.birthDate} onChange={(v) => set({ ...draft, birthDate: v })} />
      <Err m={errors.birthDate} />
    </>
  );
}

const PH = '#6b7280'; // placeholder grey, 4.8:1 on white

export function AddressFields({ draft, set, errors }: Props) {
  const p = draft.addr ?? splitAddress(draft.addressLine ?? '');
  const upd = (k: keyof AddressParts) => (v: string) => {
    const addr = { ...p, [k]: k === 'cp' ? v.replace(/\D/g, '') : v };
    set({ ...draft, addr, addressLine: joinAddress(addr) });
  };
  return (
    <>
      {DEMO && (
        <View style={s.card}>
          <Text>Modo demostración: el domicilio que escribas se reemplaza por una dirección de prueba de EE. UU.</Text>
        </View>
      )}
      <Text style={s.label}>Calle y Número</Text>
      <TextInput style={s.input} value={p.street} onChangeText={upd('street')} autoCapitalize="words"
        placeholder="Av. Tulum 125" placeholderTextColor={PH} textContentType="streetAddressLine1" />
      <Err m={errors.street} />
      <Text style={s.label}>Ciudad</Text>
      <TextInput style={s.input} value={p.city} onChangeText={upd('city')} autoCapitalize="words"
        placeholder="Cancún" placeholderTextColor={PH} textContentType="addressCity" />
      <Err m={errors.city} />
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 2, gap: 12 }}>
          <Text style={s.label}>Estado</Text>
          <TextInput style={s.input} value={p.state} onChangeText={upd('state')} autoCapitalize="words"
            placeholder="Quintana Roo" placeholderTextColor={PH} textContentType="addressState" />
          <Err m={errors.state} />
        </View>
        <View style={{ flex: 1, gap: 12 }}>
          <Text style={s.label}>CP</Text>
          <TextInput style={s.input} value={p.cp} onChangeText={upd('cp')} keyboardType="number-pad" maxLength={5}
            placeholder="77500" placeholderTextColor={PH} textContentType="postalCode" />
          <Err m={errors.cp} />
        </View>
      </View>
      <Err m={errors.addressLine} />
    </>
  );
}

export function MobilityFields({ draft, set, errors }: Props) {
  return (
    <>
      <Text style={s.label}>Movilidad y accesibilidad</Text>
      {(Object.keys(MOBILITY_LABELS) as MobilityNeed[]).map((k) => {
        const on = draft.mobilityNeeds.includes(k);
        return (
          <Pressable key={k} style={s.row} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
            onPress={() => set({ ...draft, mobilityNeeds: on ? draft.mobilityNeeds.filter((x) => x !== k) : [...draft.mobilityNeeds, k] })}>
            <Text style={{ fontSize: 22 }}>{on ? '☑' : '☐'}</Text>
            <Text style={{ fontSize: 17 }}>{MOBILITY_LABELS[k]}</Text>
          </Pressable>
        );
      })}
      <Text style={s.label}>Notas de accesibilidad (opcional)</Text>
      <TextInput style={s.input} value={draft.accessibilityNotes ?? ''} multiline maxLength={500}
        onChangeText={(v) => set({ ...draft, accessibilityNotes: v })} />
      <Err m={errors.accessibilityNotes} />
    </>
  );
}

export function RiskSummary({ risk, title }: { risk: HomeRisk; title?: string }) {
  return (
    <View style={s.card}>
      <Text style={{ fontSize: 15, color: '#333' }}>{title ?? 'Riesgo de inundación de tu domicilio'}</Text>
      <Text style={{ fontSize: 20, fontWeight: '700', color: '#111' }}>{riskText(risk.label)}</Text>
    </View>
  );
}
