import * as SecureStore from 'expo-secure-store';
import type { SosBody } from './api';

export type PendingSos = { key: string; createdAt: string; body: SosBody | null; incidentId: string | null };

export const getToken = () => SecureStore.getItemAsync('deviceToken');
export const setToken = (t: string) => SecureStore.setItemAsync('deviceToken', t);
export const deleteToken = () => SecureStore.deleteItemAsync('deviceToken');

export async function getPending(): Promise<PendingSos | null> {
  const raw = await SecureStore.getItemAsync('pendingSos');
  if (!raw) return null;
  try { return JSON.parse(raw) as PendingSos; } catch { return null; }
}
export const setPending = (p: PendingSos) => SecureStore.setItemAsync('pendingSos', JSON.stringify(p));
export const deletePending = () => SecureStore.deleteItemAsync('pendingSos');
