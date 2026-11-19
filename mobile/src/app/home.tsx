import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSos } from '../useSos';
import { statusText } from '../logic';
import { Btn, s } from '../ProfileFields';

export default function Home() {
  const router = useRouter();
  const { locked, sent, phase, note, onTap, signOutLocal } = useSos();
  const st = statusText(phase, locked, sent);

  useEffect(() => {
    const t = st.text || note;
    if (Platform.OS === 'ios' && t) AccessibilityInfo.announceForAccessibility(t);
  }, [st.text, note]);

  return (
    <SafeAreaView style={s.screen}>
      <View style={[s.row, { justifyContent: 'flex-end', padding: 16 }]}>
        <Pressable accessibilityRole="link" onPress={() => router.push('/settings')}>
          <Text style={{ fontSize: 17, color: '#1a56db' }}>Ajustes</Text>
        </Pressable>
      </View>
      <View style={[s.body, { flex: 1, justifyContent: 'center' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pedir ayuda de emergencia"
          onPress={onTap}
          style={{ minHeight: 200, borderRadius: 24, backgroundColor: st.enabled ? '#c62828' : '#9e9e9e', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 56, fontWeight: '800' }}>SOS</Text>
        </Pressable>
        <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: 6 }}>
          {st.text ? <Text style={{ fontSize: 22, textAlign: 'center' }}>{st.text}</Text> : null}
          {note ? <Text style={s.err}>{note}</Text> : null}
        </View>
        {phase === 'auth' && <Btn title="Iniciar sesión" onPress={signOutLocal} />}
      </View>
    </SafeAreaView>
  );
}
