import assert from 'node:assert/strict';
import {
  toE164, validBirthDate, profilePatch, profileBody, backoffMs, isRetryable, shouldClearPending,
  statusText, MOBILITY_LABELS, stepForError, validateStep,
  daysInMonth, clampBirth, toIso, fromIso, joinAddress, splitAddress, MESES, riskText,
} from './logic.ts';

assert.equal(toE164('(555) 123-4567'), '+15551234567');
assert.equal(toE164('1-555-123-4567'), '+15551234567');
assert.equal(toE164('12345'), null);

const today = new Date(2026, 10, 18);
assert.equal(validBirthDate('1950-03-02', today), true);
assert.equal(validBirthDate('2026-11-19', today), false);
assert.equal(validBirthDate('2023-02-30', today), false);
assert.equal(validBirthDate('1899-12-31', today), false);

const orig = { fullName: 'Ana', birthDate: '1950-01-01', addressLine: '1 Main St, Katy, TX 77494',
  mobilityNeeds: ['wheelchair' as const], accessibilityNotes: null };
assert.deepEqual(profilePatch(orig, { ...orig, fullName: 'X' }), { fullName: 'X' });
assert.deepEqual(profilePatch(orig, { ...orig, accessibilityNotes: '' }), {});
assert.deepEqual(profilePatch(orig, { ...orig }), {});
assert.equal('medicalConditions' in profileBody(orig), false); // conditions removed from the form
assert.equal(profileBody({ ...orig, accessibilityNotes: '  ' }).accessibilityNotes, null); // empty notes allowed
assert.deepEqual(validateStep('mobility', { ...orig, accessibilityNotes: '' }), {});
assert.ok(validateStep('personal', { ...orig, fullName: '' }).fullName);

assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(backoffMs), [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000]);
for (const s of [null, 408, 429, 500, 503]) assert.equal(isRetryable(s), true);
for (const s of [400, 401, 403, 404, 422]) assert.equal(isRetryable(s), false);

const inc = (status: any) => ({ id: 'i', status, risk: 3 as const, requiresReview: false, locationSource: 'device' as const,
  createdAt: '2026-11-18T10:05:00', refuge: { id: 'r2', label: 'Refugio 2' } });
assert.equal(shouldClearPending(null, null), false);
assert.equal(shouldClearPending('i', null), true);
assert.equal(shouldClearPending('i', inc('dropped_off')), true);
assert.equal(shouldClearPending('i', inc('dismissed')), true);
assert.equal(shouldClearPending('i', inc('routed')), false);
assert.equal(shouldClearPending('i', inc('pending')), false);

assert.deepEqual(statusText('idle', false), { text: '', enabled: true });
assert.deepEqual(statusText('idle', true), { text: '', enabled: false }); // production: one open SOS locks the button
assert.deepEqual(statusText('idle', false, true), { text: 'SOS enviado ✓', enabled: true }); // demo: stays pressable
assert.equal(statusText('retrying', false).text, 'No recibido — reintentando');
assert.equal(statusText('sending', false).enabled, false); // in-flight press blocks a duplicate
for (const ph of ['idle', 'fix', 'sending', 'retrying', 'auth'] as const)
  for (const l of [true, false]) assert.doesNotMatch(statusText(ph, l, true).text, /Pendiente|En ruta|Recogido|refugio|despachador/i);

assert.equal(Object.keys(MOBILITY_LABELS).length, 7);
assert.equal(stepForError('invalid_address_line'), 'address');
assert.equal(stepForError('invalid_full_name'), 'personal');
console.log('logic ok');

// Date wheels
assert.equal(MESES.length, 12);
assert.deepEqual([daysInMonth(2024, 2), daysInMonth(2023, 2), daysInMonth(1900, 2), daysInMonth(2000, 2), daysInMonth(2023, 4), daysInMonth(2023, 12)], [29, 28, 28, 29, 30, 31]);
assert.deepEqual(clampBirth({ y: 2023, m: 4, d: 31 }, today), { y: 2023, m: 4, d: 30 });
assert.deepEqual(clampBirth({ y: 2023, m: 2, d: 30 }, today), { y: 2023, m: 2, d: 28 });
assert.deepEqual(clampBirth({ y: 2026, m: 12, d: 25 }, today), { y: 2026, m: 11, d: 18 }); // never after today
assert.deepEqual(clampBirth({ y: 1899, m: 1, d: 1 }, today), { y: 1900, m: 1, d: 1 });
for (const iso of ['1950-03-02', '2024-02-29', '1900-01-01']) {
  assert.equal(toIso(fromIso(iso)!), iso);
  assert.equal(validBirthDate(toIso(clampBirth(fromIso(iso)!, today)), today), true);
}
assert.equal(fromIso('21/03/1950'), null);

// Structured address
const parts = { street: 'Av. Tulum 125', city: 'Cancún', state: 'Quintana Roo', cp: '77500' };
assert.equal(joinAddress(parts), 'Av. Tulum 125, Cancún, Quintana Roo 77500');
assert.deepEqual(splitAddress(joinAddress(parts)), parts);
assert.deepEqual(splitAddress('1 Main St, Katy, TX 77494'), { street: '1 Main St', city: 'Katy', state: 'TX', cp: '77494' });
assert.deepEqual(splitAddress('algo raro'), { street: 'algo raro', city: '', state: '', cp: '' });
const addrDraft = { ...orig, addr: parts, addressLine: joinAddress(parts) };
assert.deepEqual(validateStep('address', addrDraft), {});
for (const k of ['street', 'city', 'state', 'cp'] as const)
  assert.ok(validateStep('address', { ...addrDraft, addr: { ...parts, [k]: '' } })[k], k);
assert.ok(validateStep('address', { ...addrDraft, addr: { ...parts, cp: '7750' } }).cp);
assert.equal(profileBody(addrDraft).addressLine, 'Av. Tulum 125, Cancún, Quintana Roo 77500');
assert.equal('addr' in profileBody(addrDraft), false); // backend contract unchanged

// Risk display: final class only
assert.deepEqual((['Bajo', 'Medio', 'Alto'] as const).map(riskText), ['Riesgo bajo', 'Riesgo medio', 'Riesgo alto']);

