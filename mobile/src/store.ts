import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { SosBody } from './api';

export type PendingSos = { key: string; createdAt: string; body: SosBody | null; incidentId: string | null };

// expo-secure-store has no web implementation; fall back to localStorage there.
const storage = Platform.OS === 'web'
  ? {
      getItemAsync: async (k: string) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
      setItemAsync: async (k: string, v: string) => { try { globalThis.localStorage?.setItem(k, v); } catch {} },
      deleteItemAsync: async (k: string) => { try { globalThis.localStorage?.removeItem(k); } catch {} },
    }
  : SecureStore;

export const getToken = () => storage.getItemAsync('deviceToken');
export const setToken = (t: string) => storage.setItemAsync('deviceToken', t);
export const deleteToken = () => storage.deleteItemAsync('deviceToken');

export async function getPending(): Promise<PendingSos | null> {
  const raw = await storage.getItemAsync('pendingSos');
  if (!raw) return null;
  try { return JSON.parse(raw) as PendingSos; } catch { return null; }
}
export const setPending = (p: PendingSos) => storage.setItemAsync('pendingSos', JSON.stringify(p));
export const deletePending = () => storage.deleteItemAsync('pendingSos');
