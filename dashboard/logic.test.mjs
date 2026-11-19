import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyStore, applySnapshot, applyEvent, routeKind, sortIncidents, isTerminal,
  incidentRoute, canArrive, canCancel, STATUS_ES, MOBILITY_ES, groupIncidents, vehicleRoutes,
} from './logic.mjs';

const stop = (incidentId, skipped = false, seq = 1) => ({ seq, incidentId, pickupEta: 't', onFoot: false, skipped });
const route = (id, vehicleId, status, departAt, stops = []) =>
  ({ id, vehicleId, status, planVersion: 1, refugeId: 'r1', departAt, refugeEta: departAt, geometry: [], stops });
const inc = (id, status, risk = 1, createdAt = '2026-01-01T00:00:00Z') => ({ id, status, risk, createdAt });
const snap = (o = {}) => ({ seq: 5, planVersion: 1, places: [], vehicles: [], incidents: [], routes: [], unassigned: [], ...o });

test('event with seq <= store.seq is ignored', () => {
  const s = applySnapshot(emptyStore(), snap());
  assert.equal(applyEvent(s, 'incident.upserted', inc('a', 'pending'), 5), false);
  assert.equal(applyEvent(s, 'incident.upserted', inc('a', 'pending'), 4), false);
  assert.equal(s.incidents.size, 0);
  assert.equal(applyEvent(s, 'incident.upserted', inc('a', 'pending'), 6), true);
  assert.equal(s.seq, 6);
});

test('routes.replaced drops old proposed, keeps active', () => {
  const s = applySnapshot(emptyStore(), snap({ routes: [
    route('act', 'v1', 'active', '2026-01-01T00:00:00Z'),
    route('old', 'v2', 'proposed', '2026-01-01T00:00:00Z'),
  ] }));
  applyEvent(s, 'routes.replaced', {
    planVersion: 2, routes: [route('new', 'v2', 'proposed', '2026-01-01T00:00:00Z')],
    unassigned: [{ incidentId: 'x', reason: 'deferred' }],
  }, 6);
  assert.deepEqual([...s.routes.keys()].sort(), ['act', 'new']);
  assert.equal(s.planVersion, 2);
  assert.equal(s.unassigned.get('x').reason, 'deferred');
});

test('route.updated completed removes route; active upserts', () => {
  const s = applySnapshot(emptyStore(), snap({ routes: [route('a', 'v1', 'active', 't')] }));
  applyEvent(s, 'route.updated', route('a', 'v1', 'completed', 't'), 6);
  assert.equal(s.routes.size, 0);
  applyEvent(s, 'route.updated', route('b', 'v1', 'active', 't'), 7);
  assert.equal(s.routes.size, 1);
});

test('routeKind', () => {
  const s = applySnapshot(emptyStore(), snap({ routes: [
    route('p2', 'v1', 'proposed', '2026-01-01T02:00:00Z'),
    route('p1', 'v1', 'proposed', '2026-01-01T01:00:00Z'),
    route('q1', 'v2', 'proposed', '2026-01-01T01:00:00Z'),
    route('a2', 'v2', 'active', '2026-01-01T00:00:00Z'),
  ] }));
  assert.equal(routeKind(s, s.routes.get('p1')), 'deployable');
  assert.equal(routeKind(s, s.routes.get('p2')), 'forecast');
  assert.equal(routeKind(s, s.routes.get('q1')), 'forecast');
  assert.equal(routeKind(s, s.routes.get('a2')), 'active');
});

test('sortIncidents: status, risk desc, createdAt asc; dismissed last', () => {
  const out = sortIncidents([
    inc('dis', 'dismissed', 3), inc('drop', 'dropped_off', 3), inc('r', 'routed', 3),
    inc('p1old', 'pending', 1, '2026-01-01T00:00:00Z'), inc('p1new', 'pending', 1, '2026-01-01T01:00:00Z'),
    inc('p3', 'pending', 3, '2026-01-01T05:00:00Z'),
  ]).map((i) => i.id);
  assert.deepEqual(out, ['p3', 'p1old', 'p1new', 'r', 'drop', 'dis']);
});

test('canArrive / canCancel', () => {
  const r = route('a', 'v1', 'active', 't', [stop('i1'), stop('i2', true, 2)]);
  const s = applySnapshot(emptyStore(), snap({ routes: [r], incidents: [inc('i1', 'picked_up'), inc('i2', 'pending')] }));
  assert.equal(canArrive(s, r), true);
  assert.equal(canCancel(s, r), false);
  s.incidents.set('i1', inc('i1', 'routed'));
  assert.equal(canArrive(s, r), false);
  assert.equal(canCancel(s, r), true);
});

test('incidentRoute ignores skipped stops, prefers active', () => {
  const s = applySnapshot(emptyStore(), snap({ routes: [
    route('a', 'v1', 'active', 't', [stop('i1', true)]),
    route('p', 'v2', 'proposed', 't', [stop('i1')]),
  ] }));
  assert.equal(incidentRoute(s, 'i1').route.id, 'p');
  s.routes.get('p').stops[0].skipped = true;
  assert.equal(incidentRoute(s, 'i1'), null);
});

test('isTerminal', () => {
  for (const [st, want] of Object.entries({ pending: false, routed: false, picked_up: false, dropped_off: true, dismissed: true })) {
    assert.equal(isTerminal(st), want);
  }
});

test('label tables complete', () => {
  for (const k of ['wheelchair', 'limited walking', 'bedridden', 'blind or low vision',
    'deaf or hard of hearing', 'oxygen or powered equipment', 'other']) assert.ok(MOBILITY_ES[k], k);
  for (const k of ['pending', 'routed', 'picked_up', 'dropped_off', 'dismissed']) assert.ok(STATUS_ES[k], k);
});

test('groupIncidents: fixed section order, terminal statuses share closed, sorted inside', () => {
  const g = groupIncidents([inc('d', 'dismissed'), inc('a', 'pending', 1), inc('b', 'pending', 3),
    inc('c', 'routed'), inc('e', 'dropped_off')]);
  assert.deepEqual(g.map((s) => s.key), ['pending', 'routed', 'picked_up', 'closed']);
  assert.deepEqual(g.map((s) => s.items.map((i) => i.id)), [['b', 'a'], ['c'], [], ['e', 'd']]);
});

test('vehicleRoutes: only that vehicle, active first, then by departure', () => {
  const s = applySnapshot(emptyStore(), snap({ routes: [
    route('late', 'v1', 'proposed', '2026-01-01T02:00:00Z'),
    route('act', 'v1', 'active', '2026-01-01T03:00:00Z'),
    route('early', 'v1', 'proposed', '2026-01-01T01:00:00Z'),
    route('other', 'v2', 'active', '2026-01-01T00:00:00Z'),
  ] }));
  assert.deepEqual(vehicleRoutes(s, 'v1').map((r) => r.id), ['act', 'early', 'late']);
});

test('timeScale: AHORA always at NOW_AT, one scale for all', async () => {
  const { timeScale, NOW_AT, SPAN } = await import('./logic.mjs');
  for (const now of [0, 1.7e12, 1.7e12 + 12345]) {
    const sc = timeScale(now);
    assert.equal(sc.x(now), NOW_AT * 100);
    assert.equal(sc.x(now + SPAN / 10) - sc.x(now), 10);
  }
});

test('tripTimes: proposals stay ahead of now, active moves from deployment', async () => {
  const { tripTimes } = await import('./logic.mjs');
  const T = (m) => Date.parse('2026-01-01T00:00:00Z') + m * 60e3;
  const iso = (m) => new Date(T(m)).toISOString();
  const r = { departAt: iso(10), refugeEta: iso(40), deployedAt: null,
    stops: [{ pickupEta: iso(20), onFoot: false }, { pickupEta: iso(99), onFoot: true }] };
  // future proposal: scheduled times unchanged
  assert.deepEqual(tripTimes(r, 'deployable', T(0)), { t0: T(10), t1: T(40), stops: [T(20), T(20)] });
  // stale proposal: pinned at now, never behind it
  for (const now of [T(15), T(25)]) {
    const t = tripTimes(r, 'forecast', now);
    assert.equal(t.t0, now);
    assert.equal(t.t1 - t.t0, 30 * 60e3);
  }
  // deployed late at +15: anchored at deployment, independent of now (no reset on rerender/refresh)
  const a = { ...r, deployedAt: iso(15) };
  assert.deepEqual(tripTimes(a, 'active', T(16)), tripTimes(a, 'active', T(60)));
  assert.equal(tripTimes(a, 'active', T(60)).t0, T(15));
});

test('deploy event applied twice keeps one route, no Desplegar on it', () => {
  const s = applySnapshot(emptyStore(), snap({ routes: [route('a', 'v1', 'proposed', '2026-01-01T01:00:00Z')] }));
  const act = { ...route('a', 'v1', 'active', '2026-01-01T01:00:00Z'), deployedAt: '2026-01-01T01:05:00Z' };
  applyEvent(s, 'route.updated', act, 6);
  applyEvent(s, 'route.updated', act, 7);
  assert.equal(s.routes.size, 1);
  assert.equal(routeKind(s, s.routes.get('a')), 'active');
});

// --- demo simulation ---
import { simNow, routeElapsed, carPose, tripTimes } from './logic.mjs';

const T0 = Date.parse('2026-01-01T10:00:00Z');
const at = (min) => new Date(T0 + min * 60e3).toISOString();
// L-shaped road: north 0.01° then east 0.01°. One stop at the corner, reached at +10 min; refuge at +20 min.
const simRoute = {
  id: 'r', vehicleId: 'v', status: 'active', departAt: at(0), refugeEta: at(20), simDeployedMs: 1000,
  geometry: [[0, 0], [0, 0.005], [0, 0.01], [0.005, 0.01], [0.01, 0.01]],
  stops: [{ incidentId: 'a', pickupEta: at(10), onFoot: false, skipped: false, lat: 0.01, lng: 0 }],
};

test('carPose follows the geometry, reaches stops on time, heads along the road', () => {
  const p0 = carPose(simRoute, 0);
  assert.deepEqual([p0.lat, p0.lng, p0.heading, p0.done], [0, 0, 0, false]);
  const mid = carPose(simRoute, 5 * 60e3);
  assert.ok(Math.abs(mid.lat - 0.005) < 1e-9 && mid.lng === 0);
  const stop = carPose(simRoute, 10 * 60e3);
  assert.ok(Math.abs(stop.lat - 0.01) < 1e-9 && Math.abs(stop.lng) < 1e-9);
  const east = carPose(simRoute, 15 * 60e3);
  assert.ok(Math.abs(east.lng - 0.005) < 1e-9 && Math.abs(east.heading - 90) < 0.5);
  const end = carPose(simRoute, 99 * 60e3);
  assert.ok(end.done && Math.abs(end.lng - 0.01) < 1e-9);
  assert.equal(carPose({ ...simRoute, geometry: [] }, 0), null);
});

test('sim clock: speed scales elapsed, rebase keeps continuity', () => {
  const s1 = { enabled: true, speed: 1, realAt: at(0), simMs: 0 };
  assert.equal(simNow(s1, T0 + 60e3), 60e3);
  // Speed set to 5 at +1 min: rebased, same instant gives the same sim time.
  const s5 = { enabled: true, speed: 5, realAt: at(1), simMs: simNow(s1, T0 + 60e3) };
  assert.equal(simNow(s5, T0 + 60e3), 60e3);
  assert.equal(simNow(s5, T0 + 120e3), 60e3 + 5 * 60e3);
  assert.equal(routeElapsed(s5, simRoute, T0 + 120e3), 360e3 - 1000);
  assert.equal(routeElapsed({ ...s5, enabled: false }, simRoute, T0), null);
  assert.equal(routeElapsed(s5, { ...simRoute, status: 'proposed' }, T0), null);
});

test('simulated active trip sits on AHORA at its elapsed sim time', () => {
  const now = T0 + 3 * 60e3;
  const tt = tripTimes(simRoute, 'active', now, 10 * 60e3);
  assert.equal(tt.stops[0], now); // car is at the stop right now
  assert.equal(tt.t0, now - 10 * 60e3);
});

test('sim.clock event updates the store once', () => {
  const s = applySnapshot(emptyStore(), snap({ sim: { enabled: true, speed: 1, realAt: at(0), simMs: 0 } }));
  assert.equal(applyEvent(s, 'sim.clock', { enabled: true, speed: 4, realAt: at(1), simMs: 60e3 }, 6), true);
  assert.equal(s.sim.speed, 4);
  assert.equal(applyEvent(s, 'sim.clock', { enabled: true, speed: 2, realAt: at(1), simMs: 60e3 }, 6), false);
  assert.equal(s.sim.speed, 4);
});

test('active trip outranks proposals; next proposal deployable once it completes', () => {
  const s = applySnapshot(emptyStore(), snap({ routes: [
    route('a', 'v', 'active', at(0)), route('p1', 'v', 'proposed', at(20)), route('p2', 'v', 'proposed', at(40))] }));
  assert.equal(routeKind(s, s.routes.get('a')), 'active');
  assert.equal(routeKind(s, s.routes.get('p1')), 'forecast');
  applyEvent(s, 'route.updated', { ...s.routes.get('a'), status: 'completed' }, 6);
  assert.equal(routeKind(s, s.routes.get('p1')), 'deployable');
  assert.equal(routeKind(s, s.routes.get('p2')), 'forecast');
});
