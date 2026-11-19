import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ApiError, createUser, getMe, type HomeRisk } from '../api';
import { deleteToken } from '../store';
import { DEMO, profileBody, stepForError, STEPS, validateStep, type Draft, type Step } from '../logic';
import { AddressFields, Btn, MobilityFields, PersonalFields, RiskSummary, s } from '../ProfileFields';

const TITLES: Record<Step, string> = {
  personal: 'Datos personales', address: 'Domicilio',
  mobility: 'Movilidad y accesibilidad', review: 'Revisar',
};
const EMPTY: Draft = { fullName: '', birthDate: '', addressLine: '', mobilityNeeds: [], accessibilityNotes: '' };

export default function Onboarding() {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [risk, setRisk] = useState<HomeRisk | null>(null);
  const [savedAddress, setSavedAddress] = useState<string | null>(null);
  const step = STEPS[i];

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (i > 0 && !risk) { setI(i - 1); return true; }
      return false;
    });
    return () => sub.remove();
  }, [i, risk]);

  function next() {
    const e = validateStep(step, draft);
    setErrors(e);
    if (!Object.keys(e).length) setI(i + 1);
  }

  async function submit() {
    setBusy(true); setBanner('');
    try {
      const r = await createUser(profileBody(draft));
      setSavedAddress(r.user.addressLine);
      setRisk(r.homeRisk);
    } catch (e) {
      if (!(e instanceof ApiError)) return setBanner('Error');
      if (e.status === 401) { await deleteToken(); return router.replace('/sign-in'); }
      if (e.error === 'already_registered') { try { await getMe(); return router.replace('/home'); } catch {} }
      const target = stepForError(e.error);
      if (target) {
        setI(STEPS.indexOf(target));
        const f = e.field ? e.field.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()) : e.error === 'address_not_found' ? 'addressLine' : '';
        setErrors(f ? { [f]: e.message } : {});
        setBanner(e.message || (e.error === 'address_not_found' ? 'No encontramos este domicilio. Revisa calle, ciudad, estado y código postal.' : ''));
      } else if (e.status === 503) {
        setBanner(e.message || 'El servicio no está disponible. Tu perfil no se guardó. Intenta de nuevo.');
      } else setBanner(e.message);
    } finally { setBusy(false); }
  }

  if (risk) {
    return (
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.body}>
          <Text style={s.h1}>Listo</Text>
          {DEMO && savedAddress ? (
            <View style={s.card}>
              <Text style={{ fontSize: 17, fontWeight: '600' }}>Domicilio de prueba asignado</Text>
              <Text>{savedAddress}</Text>
            </View>
          ) : null}
          <RiskSummary risk={risk} />
          <Btn title="Continuar" onPress={() => router.replace('/home')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const props = { draft, set: setDraft, errors };
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>{TITLES[step]} ({i + 1}/{STEPS.length})</Text>
        {step === 'personal' && <PersonalFields {...props} />}
        {step === 'address' && <AddressFields {...props} />}
        {step === 'mobility' && <MobilityFields {...props} />}
        {step === 'review' && (
          <View style={s.card}>
            <Text>{draft.fullName.trim()} · {draft.birthDate}</Text>
            <Text>{draft.addressLine.trim()}</Text>
            <Text>Movilidad: {draft.mobilityNeeds.join(', ') || '—'}</Text>
          </View>
        )}
        {banner ? <Text style={s.err} accessibilityLiveRegion="polite">{banner}</Text> : null}
        {step === 'review'
          ? <Btn title="Enviar" onPress={submit} disabled={busy} />
          : <Btn title="Siguiente" onPress={next} />}
        {i > 0 && <Btn secondary title="Atrás" onPress={() => setI(i - 1)} />}
      </ScrollView>
    </SafeAreaView>
  );
}
