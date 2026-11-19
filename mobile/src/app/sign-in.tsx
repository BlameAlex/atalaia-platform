import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ApiError, demoSignIn, requestOtp, verifyOtp } from '../api';
import { setToken } from '../store';
import { DEMO, toE164 } from '../logic';
import { Btn, s } from '../ProfileFields';

// DEMO: skip OTP (server also needs DEMO_SKIP_OTP=1; tools/dev.sh passes it through).

export default function SignIn() {
  const router = useRouter();
  const [phoneIn, setPhoneIn] = useState('');
  const [phone, setPhone] = useState<string | null>(null); // set once the code was requested
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(0);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send() {
    const p = toE164(phoneIn);
    if (!p) return setErr('Ingresa un número de EE. UU. de 10 dígitos.');
    setErr(''); setBusy(true);
    if (DEMO) {
      try {
        const r = await demoSignIn(p);
        await setToken(r.deviceToken);
        router.replace(r.user ? '/home' : '/onboarding');
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error');
      } finally { setBusy(false); }
      return;
    }
    try {
      const r = await requestOtp(p);
      setPhone(p); setLocked(false); setCode(r.devCode ?? ''); setDevCode(r.devCode ?? null); setWait(30);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
      if (e instanceof ApiError && e.error === 'otp_cooldown') setWait(30);
    } finally { setBusy(false); }
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) return setErr('El código tiene 6 dígitos.');
    setErr(''); setBusy(true);
    try {
      const r = await verifyOtp(phone!, code);
      await setToken(r.deviceToken);
      router.replace(r.user ? '/home' : '/onboarding');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
      if (e instanceof ApiError && e.error === 'otp_locked') setLocked(true);
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {!phone ? (
          <>
            <Text style={s.h1}>Tu número de teléfono</Text>
            <TextInput style={s.input} value={phoneIn} onChangeText={setPhoneIn} keyboardType="phone-pad"
              textContentType="telephoneNumber" placeholder="(555) 123-4567" />
            {err ? <Text style={s.err}>{err}</Text> : null}
            <Btn title={DEMO ? 'Continuar' : 'Enviar código'} onPress={send} disabled={busy} />
          </>
        ) : (
          <>
            <Text style={s.h1}>Código de 6 dígitos</Text>
            {devCode ? <Text>Código de prueba: {devCode}</Text> : null}
            <TextInput style={s.input} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
              textContentType="oneTimeCode" autoComplete="sms-otp" />
            {err ? <Text style={s.err}>{err}</Text> : null}
            {!locked && <Btn title="Verificar" onPress={verify} disabled={busy} />}
            <Btn secondary title={locked ? 'Pedir un código nuevo' : wait > 0 ? `Reenviar código (${wait} s)` : 'Reenviar código'}
              onPress={() => { setPhoneIn(phone); void send(); }} disabled={busy || (!locked && wait > 0)} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
