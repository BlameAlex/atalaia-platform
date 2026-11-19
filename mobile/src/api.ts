import { getToken } from './store';

export type MedicalCondition = { name: string; critical: boolean };
export type MobilityNeed =
  | 'wheelchair' | 'limited walking' | 'bedridden' | 'blind or low vision'
  | 'deaf or hard of hearing' | 'oxygen or powered equipment' | 'other';
export type HomeRisk = {
  level: 1 | 2 | 3; label: 'Bajo' | 'Medio' | 'Alto'; confidence: number; // 0–100
  requiresReview: boolean; factors: string[]; computedAt: string;
};
export type ProfileInput = {
  fullName: string; birthDate: string; addressLine: string;
  mobilityNeeds: MobilityNeed[]; accessibilityNotes?: string | null;
};
export type User = ProfileInput & {
  medicalConditions: MedicalCondition[]; // server default []; no longer edited in the app
  id: string; phone: string; home: { lat: number; lng: number; countyFips: string };
  accessibilityNotes: string | null; homeRisk: HomeRisk; createdAt: string; updatedAt: string;
};
export type IncidentStatus = 'pending' | 'routed' | 'picked_up' | 'dropped_off' | 'dismissed';
export type Incident = {
  id: string; status: IncidentStatus; risk: 1 | 2 | 3; requiresReview: boolean;
  locationSource: 'device' | 'home'; createdAt: string; refuge: { id: string; label: string } | null;
};
export type SosBody = { lat?: number; lng?: number; accuracyM?: number };

export class ApiError extends Error {
  // status 0 = network error / timeout
  constructor(public status: number, public error: string, message: string, public field?: string) {
    super(message);
  }
}

const BASE = (process.env.EXPO_PUBLIC_API_URL ?? '') + '/api/v1';

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const token = await getToken();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'No se puede conectar con el servidor');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Error del servidor', data.field);
  return data as T;
}

export const requestOtp = (phone: string) =>
  request<{ devCode?: string }>('POST', '/auth/otp/request', { phone });
export const verifyOtp = (phone: string, code: string) =>
  request<{ deviceToken: string; user: User | null }>('POST', '/auth/otp/verify', { phone, code });
export const demoSignIn = (phone: string) =>
  request<{ deviceToken: string; user: User | null }>('POST', '/auth/demo/sign-in', { phone });
export const createUser = (body: ProfileInput) =>
  request<{ user: User; homeRisk: HomeRisk }>('POST', '/users', body);
export const getMe = () => request<{ user: User }>('GET', '/users/me');
export const updateMe = (patch: Partial<ProfileInput>) => request<{ user: User }>('PATCH', '/users/me', patch);
export const revokeOthers = () => request<{ revoked: number }>('POST', '/devices/revoke-others', {});
export const revokeCurrent = () => request<void>('POST', '/devices/revoke-current', {});
export const sendSos = (key: string, body: SosBody) =>
  request<{ incident: Incident }>('POST', '/sos', body, { 'Idempotency-Key': key });
// Demo only: the server files the SOS for a random simulated user at a random point (see POST /sos/demo).
export const sendDemoSos = (key: string) =>
  request<{ incident: Incident }>('POST', '/sos/demo', {}, { 'Idempotency-Key': key });
export const getCurrentSos = () => request<{ incident: Incident | null }>('GET', '/sos/current');
