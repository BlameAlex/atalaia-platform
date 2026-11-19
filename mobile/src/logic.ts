// Pure helpers (type-only imports, so node can run logic.check.ts directly).
import type { Incident, IncidentStatus, MobilityNeed, ProfileInput } from './api';

export type Step = 'personal' | 'address' | 'mobility' | 'review';
export const STEPS: Step[] = ['personal', 'address', 'mobility', 'review'];
export const CLOSED: IncidentStatus[] = ['dropped_off', 'dismissed'];
export const isClosed = (s: IncidentStatus) => CLOSED.includes(s);

export const MOBILITY_LABELS: Record<MobilityNeed, string> = {
  'wheelchair': 'silla de ruedas',
  'limited walking': 'movilidad limitada',
  'bedridden': 'encamado/a',
  'blind or low vision': 'ceguera o baja visión',
  'deaf or hard of hearing': 'sordera o hipoacusia',
  'oxygen or powered equipment': 'oxígeno o equipo eléctrico',
  'other': 'otro',
};

export function toE164(input: string): string | null {
  const d = input.replace(/\D/g, '');
  const p = d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : '';
  return /^\+1\d{10}$/.test(p) ? p : null;
}

export function validBirthDate(s: string, today = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return s >= '1900-01-01' && s <= t;
}

export function ageOn(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  let a = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) a--;
  return a;
}

// Demo build (EXPO_PUBLIC_DEMO_SKIP_OTP=1): OTP skipped, the server swaps typed addresses for US test addresses,
// and each SOS press asks the server to file one for a random simulated user at a random point (POST /sos/demo).
export const DEMO = process.env.EXPO_PUBLIC_DEMO_SKIP_OTP === '1';

/** Risk shown to users: the final class only, no confidence or model factors. */
export const riskText = (label: 'Bajo' | 'Medio' | 'Alto') => `Riesgo ${label.toLowerCase()}`;

// Birth date wheels. Month is 1-12.
export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export type Ymd = { y: number; m: number; d: number };
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = ({ y, m, d }: Ymd) => `${y}-${pad(m)}-${pad(d)}`;
export function fromIso(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
/** Snap a wheel selection to a real date between 1900-01-01 and today (same range as validBirthDate). */
export function clampBirth({ y, m, d }: Ymd, today = new Date()): Ymd {
  const ty = today.getFullYear(), tm = today.getMonth() + 1, td = today.getDate();
  y = Math.min(Math.max(y, 1900), ty);
  m = Math.min(Math.max(m, 1), y === ty ? tm : 12);
  d = Math.min(Math.max(d, 1), y === ty && m === tm ? td : daysInMonth(y, m));
  return { y, m, d };
}

// Structured address, joined into the one-line format the server geocodes ("street, city, state cp").
export type AddressParts = { street: string; city: string; state: string; cp: string };
export const joinAddress = (p: AddressParts) =>
  `${p.street.trim()}, ${p.city.trim()}, ${p.state.trim()} ${p.cp.trim()}`.trim();
export function splitAddress(line: string): AddressParts {
  const m = /^(.+?),\s*([^,]+),\s*([^,]+?)\s+(\d{5})$/.exec(line.trim());
  return m ? { street: m[1], city: m[2], state: m[3], cp: m[4] } : { street: line.trim(), city: '', state: '', cp: '' };
}

// Draft = ProfileInput as typed in the form (rows may be empty, notes may be ''); addr = the four address fields.
export type Draft = ProfileInput & { addr?: AddressParts };

export function validateStep(step: Step, d: Draft): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 'personal') {
    const n = d.fullName.trim();
    if (n.length < 1 || n.length > 100) e.fullName = 'Escribe tu nombre completo.';
    if (!validBirthDate(d.birthDate.trim())) e.birthDate = 'Fecha no válida.';
  } else if (step === 'address') {
    const p = d.addr ?? splitAddress(d.addressLine);
    if (p.street.trim().length < 3) e.street = 'Escribe calle y número.';
    if (p.city.trim().length < 2) e.city = 'Escribe la ciudad.';
    if (p.state.trim().length < 2) e.state = 'Escribe el estado.';
    if (!/^\d{5}$/.test(p.cp.trim())) e.cp = 'CP de 5 dígitos.';
    const a = d.addressLine.trim();
    if (!Object.keys(e).length && (a.length < 5 || a.length > 200)) e.addressLine = 'Escribe tu domicilio completo.';
  } else if (step === 'mobility') {
    if ((d.accessibilityNotes ?? '').length > 500) e.accessibilityNotes = 'Máximo 500 caracteres.';
  }
  return e;
}

export function profileBody(d: Draft): ProfileInput {
  return {
    fullName: d.fullName.trim(),
    birthDate: d.birthDate.trim(),
    addressLine: d.addressLine.trim(),
    mobilityNeeds: [...d.mobilityNeeds].sort(),
    accessibilityNotes: (d.accessibilityNotes ?? '').trim() || null,
  };
}

export function profilePatch(orig: Draft, draft: Draft): Partial<ProfileInput> {
  const a = profileBody(orig) as Record<string, unknown>;
  const b = profileBody(draft) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k];
  return out as Partial<ProfileInput>;
}

const FIELD_STEP: Record<string, Step> = {
  invalid_full_name: 'personal', invalid_birth_date: 'personal',
  invalid_address_line: 'address', address_not_found: 'address',
  invalid_mobility_needs: 'mobility', invalid_accessibility_notes: 'mobility',
};
export const stepForError = (code: string): Step | null => FIELD_STEP[code] ?? null;

export const backoffMs = (attempt: number) => [1, 2, 4, 8, 15, 30][Math.min(attempt, 5)] * 1000;
// status 0 / null = network error or timeout
export const isRetryable = (status: number | null) =>
  status === null || status === 0 || status === 408 || status === 429 || status >= 500;

// Clear pendingSos only once the server has acknowledged an incident for it (S13, O12).
export function shouldClearPending(incidentId: string | null, current: Incident | null): boolean {
  if (!incidentId) return false;
  return current === null || isClosed(current.status);
}

export type Phase = 'idle' | 'fix' | 'sending' | 'retrying' | 'auth';
/** Submission feedback only. The SOS lifecycle (pending, en ruta, recogido…) is never shown in the app. */
export function statusText(phase: Phase, locked: boolean, sent = false): { text: string; enabled: boolean } {
  if (phase === 'fix') return { text: 'Obteniendo tu ubicación…', enabled: false };
  if (phase === 'sending') return { text: 'Enviando…', enabled: false };
  if (phase === 'retrying') return { text: 'No recibido — reintentando', enabled: false };
  if (phase === 'auth') return { text: 'Inicia sesión de nuevo para enviar tu pedido', enabled: false };
  return { text: sent ? 'SOS enviado ✓' : '', enabled: !locked };
}
