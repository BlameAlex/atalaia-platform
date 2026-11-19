import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError, getMe } from '../api';
import { deleteToken, getToken } from '../store';
import { Btn, s } from '../ProfileFields';

export default function Boot() {
  const router = useRouter();
  const [offline, setOffline] = useState(false);

  const boot = useCallback(async () => {
    setOffline(false);
    if (!(await getToken())) return router.replace('/sign-in');
    try {
      await getMe();
      router.replace('/home');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) router.replace('/onboarding');
      else if (e instanceof ApiError && e.status === 401) { await deleteToken(); router.replace('/sign-in'); }
      else setOffline(true);
    }
  }, [router]);

  useEffect(() => { void boot(); }, [boot]);

  return (
    <View style={[s.screen, s.body, { justifyContent: 'center' }]}>
      {offline ? (
        <>
          <Text style={s.h1}>No se puede conectar con el servidor</Text>
          <Btn title="Reintentar" onPress={boot} />
        </>
      ) : <ActivityIndicator size="large" />}
    </View>
  );
}
