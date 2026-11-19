import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ApiError, getMe, revokeCurrent, revokeOthers, updateMe, type User } from '../api';
import { deletePending, deleteToken, getPending } from '../store';
import { profilePatch, splitAddress, STEPS, validateStep, type Draft } from '../logic';
import { AddressFields, Btn, MobilityFields, PersonalFields, RiskSummary, s } from '../ProfileFields';

const toDraft = (u: User): Draft => ({
  fullName: u.fullName, birthDate: u.birthDate, addressLine: u.addressLine ?? '', addr: splitAddress(u.addressLine ?? ''),
  mobilityNeeds: u.mobilityNeeds, accessibilityNotes: u.accessibilityNotes ?? '',
});

export default function Settings() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [unacked, setUnacked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toSignIn() { await deleteToken(); router.replace('/sign-in'); }

  useEffect(() => {
    void (async () => {
      const p = await getPending();
      setUnacked(!!p && !p.incidentId);
      try { const { user: u } = await getMe(); setUser(u); setDraft(toDraft(u)); }
      catch (e) { if (e instanceof ApiError && e.status === 401) await toSignIn(); else setMsg('No se puede conectar con el servidor'); }
    })();
  }, []);

  if (!user || !draft) return <SafeAreaView style={s.screen}><Text style={[s.body, s.err]}>{msg || 'Cargando…'}</Text></SafeAreaView>;

  const patch = profilePatch(toDraft(user), draft);
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    // address only when edited: users registered by map point have no address line
    const e = Object.assign({}, ...STEPS.filter((st) => st !== 'address' || 'addressLine' in patch).map((st) => validateStep(st, draft!)));
    setErrors(e);
    if (Object.keys(e).length) return setMsg('Revisa los campos marcados.');
    setBusy(true); setMsg('');
    try {
      const r = await updateMe(patch);
      setUser(r.user); setDraft(toDraft(r.user)); setMsg('Cambios guardados');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toSignIn();
      setMsg(err instanceof Error ? err.message : 'Error');
      if (err instanceof ApiError && err.field) setErrors({ [err.field.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())]: err.message });
    } finally { setBusy(false); }
  }

  const confirm = (title: string, run: () => void) =>
    Alert.alert(title, undefined, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Aceptar', onPress: run }]);

  const others = () => confirm('Cerrar sesión en otros dispositivos', async () => {
    try { const r = await revokeOthers(); setMsg(`Se cerró la sesión en ${r.revoked} dispositivo(s)`); }
    catch (e) { if (e instanceof ApiError && e.status === 401) await toSignIn(); else setMsg('No se pudo completar. Revisa tu conexión.'); }
  });

  const current = () => confirm('Cerrar sesión en este dispositivo', async () => {
    try { await revokeCurrent(); }
    catch (e) { if (!(e instanceof ApiError && e.status === 401)) return setMsg('No se pudo cerrar sesión. Revisa tu conexión.'); }
    await deletePending();
    await toSignIn();
  });

  const props = { draft, set: setDraft, errors };
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Ajustes</Text>
        <RiskSummary risk={user.homeRisk} />
        <PersonalFields {...props} />
        <AddressFields {...props} />
        <MobilityFields {...props} />
        {msg ? <Text accessibilityLiveRegion="polite" style={msg === 'Cambios guardados' || msg.startsWith('Se cerró') ? undefined : s.err}>{msg}</Text> : null}
        <Btn title="Guardar" onPress={save} disabled={!dirty || busy} />
        <Btn secondary title="Cerrar sesión en otros dispositivos" onPress={others} />
        <Btn secondary title="Cerrar sesión en este dispositivo" onPress={current} disabled={unacked} />
        <Btn secondary title="Volver" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
