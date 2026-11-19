import { randomUUID } from 'crypto';
import { Client } from 'pg';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main';
import { POOL_MARKER } from '../src/sos.controller';
import * as db from '../src/db';
import { Events } from '../src/events';
import { Planning } from '../src/planning';
import { Sim } from '../src/sim';
import { DispatchController } from '../src/dispatch.controller';
import { RiskBridge } from '../src/risk';
import { BOUNDS } from '../src/config';
import { startStubs, Stub } from './stubs';

const KEY = { 'X-Dispatch-Key': 'k-test' };
let app: INestApplication;
let http: string;
let stub: Stub;
let planning: Planning;
let events: Events;
let risk: RiskBridge;
let sim: Sim;
let dispatch: DispatchController;
const { q } = db;

const api = () => request(http + '/api/v1');
let n = 0;
const phone = () => `+1281555${String(++n).padStart(4, '0')}`;

const HARRIS = { lat: 29.805, lng: -95.77 };
// vuln 0: risk 2 in Harris. vuln 1 (wheelchair): risk 3.
const V0 = { birthDate: '1990-01-01', mobilityNeeds: [] as string[] };
const V1 = { birthDate: '1990-01-01', mobilityNeeds: ['wheelchair'] };
const ANA = { birthDate: '1950-03-14', mobilityNeeds: ['wheelchair'] };

async function login(ph = phone()) {
  const r = await api().post('/auth/otp/request').send({ phone: ph });
  const v = await api().post('/auth/otp/verify').send({ phone: ph, code: r.body.devCode });
  return { phone: ph, token: v.body.deviceToken as string, user: v.body.user };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function mkUser(p: { birthDate: string; mobilityNeeds: string[] } = V0, extra: object = {}) {
  const s = await login();
  const r = await api().post('/users').set(auth(s.token)).send({
    fullName: 'Ana Pérez', ...p, homeLocation: HARRIS, medicalConditions: [], accessibilityNotes: '', ...extra,
  });
  expect(r.status).toBe(201);
  return { ...s, id: r.body.user.id as string };
}
const sosAt = (t: string, lat: number, lng: number, key = randomUUID()) =>
  api().post('/sos').set(auth(t)).set('Idempotency-Key', key).send({ lat, lng, accuracyM: 10 });

/** New user + SOS at a point. Returns incident id. */
async function call(lat: number, lng: number, p = V1) {
  const u = await mkUser(p);
  const r = await sosAt(u.token, lat, lng);
  expect(r.status).toBe(201);
  return { ...u, incidentId: r.body.incident.id as string };
}
const state = async () => (await api().get('/dashboard/state').set(KEY)).body;
const plan = async () => {
  await planning.runNow();
  return state();
};
const post = (path: string, body: object = {}) => api().post(path).set(KEY).send(body);
const status = async (id: string) => (await q('SELECT status FROM incidents WHERE id = $1', [id]))[0].status;

beforeAll(async () => {
  const admin = new Client({ connectionString: process.env.TEST_ADMIN_URL });
  await admin.connect();
  if (!(await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'atalaia_test'`)).rowCount) await admin.query('CREATE DATABASE atalaia_test');
  await admin.end();
  stub = await startStubs(38917); // fixed port: rescue-map's OSRM_URL is read at import time (test/env.ts)
  app = await createApp();
  await app.listen(0);
  http = (await app.getUrl()).replace('[::1]', 'localhost');
  planning = app.get(Planning);
  events = app.get(Events);
  risk = app.get(RiskBridge);
  sim = app.get(Sim);
  dispatch = app.get(DispatchController);
  for (let i = 0; i < 100 && !risk.ready; i++) await new Promise((r) => setTimeout(r, 200));
});
beforeEach(async () => {
  planning.reset();
  stub.address = { lat: 29.805, lng: -95.77, fips: '48201' };
  stub.osrmDown = false;
  stub.latencyMs = 0;
  process.env.OTP_COOLDOWN_SEC = '0';
  process.env.DEMO_SIM = '1';
  sim.rand = () => 0;
  await sim.setSpeed(1);
  process.env.CENSUS_URL = `http://127.0.0.1:38917`;
  await q(`TRUNCATE users, devices, otp_codes, incidents, routes, route_stops, status_updates RESTART IDENTITY CASCADE`);
  await q(`UPDATE vehicles v SET lat = p.lat, lng = p.lng FROM places p WHERE p.id = CASE WHEN v.id IN ('veh-1','veh-2','veh-3') THEN 'hq' WHEN v.id IN ('veh-4','veh-5','veh-6') THEN 'hq-42' ELSE 'hq-90' END`);
});
afterAll(async () => {
  planning?.reset();
  await app?.close();
  await stub?.close();
  await db.closePool();
});

describe('server', () => {
  it('1 migrations are idempotent', async () => {
    const { migrate } = await import('../src/migrate');
    expect(await migrate()).toBe(0);
    expect((await q('SELECT label FROM places ORDER BY id')).map((r: any) => r.label)).toEqual(['Houston Fire Station 11', 'Houston Fire Station 42', 'Houston Fire Station 90', 'George R. Brown Convention Center', 'Greenhouse International Church', 'Memorial Drive Presbyterian Church', 'M.O. Campbell Education Center']);
    expect((await q('SELECT label FROM vehicles ORDER BY id')).map((r: any) => r.label)).toEqual(Array.from({ length: 9 }, (_, i) => `Vehículo ${i + 1}`));
  });

  it('2 health', async () => {
    const h = await api().get('/health');
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ db: 'ok', risk: 'ok', bounds: BOUNDS });
    stub.osrmDown = true;
    await call(29.79, -95.8);
    await planning.runNow();
    const h2 = await api().get('/health');
    expect(h2.status).toBe(200);
    expect(h2.body.osrm).toBe('down');
  });

  it('3 OTP', async () => {
    const bad = await api().post('/auth/otp/request').send({ phone: '+525512345678' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'invalid_phone', message: 'Dato no válido: phone.' });
    const ph = phone();
    const r = await api().post('/auth/otp/request').send({ phone: ph });
    expect(r.status).toBe(202);
    const wrong = r.body.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await api().post('/auth/otp/verify').send({ phone: ph, code: wrong })).status).toBe(401);
    const locked = await api().post('/auth/otp/verify').send({ phone: ph, code: r.body.devCode });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('otp_locked');
    const s = await login();
    const dev = await q('SELECT token_hash FROM devices WHERE phone = $1', [s.phone]);
    expect(dev).toHaveLength(1);
    expect(dev[0].token_hash).not.toBe(s.token);
    expect(dev[0].token_hash).toHaveLength(64);
    process.env.OTP_COOLDOWN_SEC = '30';
    const ph2 = phone();
    expect((await api().post('/auth/otp/request').send({ phone: ph2 })).status).toBe(202);
    const cool = await api().post('/auth/otp/request').send({ phone: ph2 });
    expect(cool.status).toBe(429);
    expect(cool.body.error).toBe('otp_cooldown');
    process.env.OTP_COOLDOWN_SEC = '0';
    expect((await api().post('/auth/otp/request').send({ phone: ph2 })).status).toBe(202);
  });

  it('3b demo sign-in only behind DEMO_SKIP_OTP, never in production', async () => {
    const ph = phone();
    const demo = () => api().post('/auth/demo/sign-in').send({ phone: ph });
    try {
      delete process.env.DEMO_SKIP_OTP;
      expect((await demo()).status).toBe(404);
      process.env.DEMO_SKIP_OTP = '1';
      process.env.NODE_ENV = 'production';
      expect((await demo()).status).toBe(404);
      process.env.NODE_ENV = 'development';
      expect((await api().post('/auth/demo/sign-in').send({ phone: '+525512345678' })).status).toBe(400);
      const a = await demo();
      expect(a.status).toBe(200);
      expect(a.body.user).toBeNull();
      expect((await api().get('/users/me').set(auth(a.body.deviceToken))).body.error).toBe('no_user');
      const reg = await api().post('/users').set(auth(a.body.deviceToken))
        .send({ fullName: 'Ana Pérez', ...V0, homeLocation: HARRIS, medicalConditions: [] });
      expect(reg.status).toBe(201);
      const b = await demo();
      expect(b.body.user.id).toBe(reg.body.user.id);
      expect((await q('SELECT 1 FROM otp_codes WHERE phone = $1', [ph]))).toHaveLength(0);
    } finally {
      delete process.env.DEMO_SKIP_OTP;
      process.env.NODE_ENV = 'development';
    }
  });

  it('4 onboarding', async () => {
    const s = await login();
    const body = { fullName: 'Ana Pérez', birthDate: '1950-03-14', addressLine: '123 Main St, Katy, TX 77494', medicalConditions: [{ name: 'Diabetes', critical: true }], mobilityNeeds: ['wheelchair'] };
    const r = await api().post('/users').set(auth(s.token)).send(body);
    expect(r.status).toBe(201);
    expect(r.body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.homeRisk).toEqual({ level: expect.any(Number), label: expect.any(String), confidence: expect.any(Number), requiresReview: expect.any(Boolean), factors: expect.any(Array), computedAt: expect.any(String) });
    expect(r.body.homeRisk.level).toBeGreaterThanOrEqual(1);
    expect(r.body.homeRisk.level).toBeLessThanOrEqual(3);
    expect(r.body.homeRisk.factors.length).toBeGreaterThan(0);
    expect(r.body.user.home.countyFips).toBe('48201');
    expect(r.body.user.addressLine).toBe('123 Main St, Katy, TX 77494');
    const again = await api().post('/users').set(auth(s.token)).send(body);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_registered');
    const s2 = await login();
    const loc = await api().post('/users').set(auth(s2.token)).send({ ...body, addressLine: undefined, homeLocation: HARRIS });
    expect(loc.status).toBe(201);
    expect(loc.body.user.addressLine).toBeNull();
    const s3 = await login();
    const both = await api().post('/users').set(auth(s3.token)).send({ ...body, homeLocation: HARRIS });
    expect(both.status).toBe(400);
    expect(both.body.error).toBe('invalid_address_line');
    const jet = await api().post('/users').set(auth(s3.token)).send({ ...body, mobilityNeeds: ['jetpack'] });
    expect(jet.body.error).toBe('invalid_mobility_needs');
  });

  it('5 address errors', async () => {
    const s = await login();
    const body = { fullName: 'Ana Pérez', birthDate: '1950-03-14', addressLine: 'Nowhere 00000', medicalConditions: [], mobilityNeeds: [] };
    stub.address = null;
    const r = await api().post('/users').set(auth(s.token)).send(body);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: 'address_not_found', message: 'Revisa la dirección.' });
    process.env.CENSUS_URL = 'http://127.0.0.1:1';
    const r2 = await api().post('/users').set(auth(s.token)).send(body);
    expect(r2.status).toBe(503);
    expect(r2.body.error).toBe('geocoder_unavailable');
    expect(await q('SELECT 1 FROM users')).toHaveLength(0);
  });

  it('6 PATCH recomputes home risk only on address change', async () => {
    const s = await login();
    const body = { fullName: 'Ana Pérez', birthDate: '1950-03-14', addressLine: '123 Main St, Katy, TX 77494', medicalConditions: [], mobilityNeeds: [] };
    await api().post('/users').set(auth(s.token)).send(body);
    const at = async () => (await q('SELECT home_risk_at FROM users'))[0].home_risk_at.getTime();
    const t0 = await at();
    await new Promise((r) => setTimeout(r, 20));
    const r = await api().patch('/users/me').set(auth(s.token)).send({ fullName: 'Ana M Pérez' });
    expect(r.status).toBe(200);
    expect(r.body.user.fullName).toBe('Ana M Pérez');
    expect(await at()).toBe(t0);
    await api().patch('/users/me').set(auth(s.token)).send({ addressLine: '123 Main St, Katy, TX 77494' });
    expect(await at()).toBe(t0); // same trimmed address
    await api().patch('/users/me').set(auth(s.token)).send({ addressLine: '9 Other Rd, Katy, TX 77494' });
    expect(await at()).toBeGreaterThan(t0);
  });

  it('6a profile without conditions and with empty notes', async () => {
    const s = await login();
    const r = await api().post('/users').set(auth(s.token))
      .send({ fullName: 'Ana Pérez', birthDate: '1950-03-14', homeLocation: HARRIS, mobilityNeeds: [], accessibilityNotes: null });
    expect(r.status).toBe(201);
    expect(r.body.user.medicalConditions).toEqual([]);
    expect(r.body.user.accessibilityNotes).toBe(''); // stored empty, as before
    const p = await api().patch('/users/me').set(auth(s.token)).send({ accessibilityNotes: 'rampa' });
    expect(p.body.user.accessibilityNotes).toBe('rampa');
    const c = await api().patch('/users/me').set(auth(s.token)).send({ accessibilityNotes: null });
    expect(c.status).toBe(200);
    expect(c.body.user.accessibilityNotes).toBe('');
  });

  it('6b demo mode swaps any typed address for a stable pool address, never in production', async () => {
    const { DEMO_POOL, demoAddressFor, demoLine } = await import('../src/demo-address');
    const body = { fullName: 'Ana Pérez', birthDate: '1950-03-14', addressLine: 'Av. Tulum 125, Cancún, Quintana Roo 77500', medicalConditions: [], mobilityNeeds: [] };
    try {
      process.env.DEMO_SKIP_OTP = '1';
      process.env.CENSUS_URL = 'http://127.0.0.1:1'; // demo path must not geocode
      const s = await login();
      const pick = demoAddressFor(s.phone);
      const r = await api().post('/users').set(auth(s.token)).send(body);
      expect(r.status).toBe(201);
      expect(DEMO_POOL).toContain(pick);
      expect(r.body.user.addressLine).toBe(demoLine(pick));
      expect(r.body.user.home).toEqual({ lat: pick.lat, lng: pick.lng, countyFips: pick.fips });
      expect(r.body.homeRisk.factors.length).toBeGreaterThan(0); // classifier ran on the pool county
      const [row] = await q('SELECT address_line, home_risk_at FROM users WHERE phone = $1', [s.phone]);
      expect(row.address_line).toBe(demoLine(pick));
      const p = await api().patch('/users/me').set(auth(s.token)).send({ addressLine: '9 Otra Calle, Mérida, Yucatán 97000' });
      expect(p.status).toBe(200);
      expect(p.body.user.addressLine).toBe(demoLine(pick));
      expect((await q('SELECT home_risk_at FROM users WHERE phone = $1', [s.phone]))[0].home_risk_at.getTime()).toBe(row.home_risk_at.getTime());

      process.env.CENSUS_URL = `http://127.0.0.1:38917`;
      const s2 = await login();
      process.env.NODE_ENV = 'production';
      const prod = await api().post('/users').set(auth(s2.token)).send({ ...body, addressLine: '123 Main St, Katy, TX 77494' });
      expect(prod.status).toBe(201);
      expect(prod.body.user.addressLine).toBe('123 Main St, Katy, TX 77494');
      expect(prod.body.user.home).toEqual({ lat: 29.805, lng: -95.77, countyFips: '48201' }); // Census stub answer
    } finally {
      delete process.env.DEMO_SKIP_OTP;
      process.env.NODE_ENV = 'development';
    }
  });

  it('7 tokens', async () => {
    const a = await mkUser();
    const again = await login(a.phone);
    expect(again.user.id).toBe(a.id);
    const rev = await api().post('/devices/revoke-others').set(auth(again.token));
    expect(rev.status).toBe(200);
    expect(rev.body).toEqual({ revoked: 1 });
    expect((await api().get('/users/me').set(auth(a.token))).status).toBe(401);
    const third = await login(a.phone);
    const cur = await api().post('/devices/revoke-current').set(auth(again.token));
    expect(cur.status).toBe(204);
    expect((await api().get('/users/me').set(auth(again.token))).status).toBe(401);
    expect((await api().get('/users/me').set(auth(third.token))).status).toBe(200);
    const unbound = await login();
    const me = await api().get('/users/me').set(auth(unbound.token));
    expect(me.status).toBe(404);
    expect(me.body.error).toBe('no_user');
    const s = await api().post('/sos').set(auth(unbound.token)).set('Idempotency-Key', randomUUID()).send({});
    expect(s.status).toBe(403);
    expect(s.body.error).toBe('no_user');
    expect((await api().get('/sos/current').set(auth(unbound.token))).status).toBe(403);
  });

  it('8 idempotent SOS and one open incident', async () => {
    const u = await mkUser();
    const key = randomUUID();
    const a = await sosAt(u.token, 29.79, -95.78, key);
    const b = await sosAt(u.token, 29.79, -95.78, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.incident.id).toBe(a.body.incident.id);
    const u2 = await mkUser();
    const rs = await Promise.all(Array.from({ length: 10 }, () => sosAt(u2.token, 29.79, -95.78)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(await q(`SELECT 1 FROM incidents WHERE user_id = $1 AND status NOT IN ('dropped_off','dismissed')`, [u2.id])).toHaveLength(1);
    const bad = await api().post('/sos').set(auth(u.token)).set('Idempotency-Key', 'nope').send({});
    expect(bad.body.error).toBe('invalid_idempotency_key');
    const noFix = await api().post('/sos').set(auth((await mkUser()).token)).set('Idempotency-Key', randomUUID()).send({ lat: 'x' });
    expect(noFix.status).toBe(201);
    expect(noFix.body.incident.locationSource).toBe('home');
  });

  it('8b demo SOS: each press = new incident for a random free pool user, only behind DEMO_SKIP_OTP', async () => {
    const caller = await mkUser();
    const demo = (key = randomUUID()) => api().post('/sos/demo').set(auth(caller.token)).set('Idempotency-Key', key).send({ risk: 1 });
    try {
      delete process.env.DEMO_SKIP_OTP;
      expect((await demo()).status).toBe(404);
      process.env.DEMO_SKIP_OTP = '1';
      expect((await demo()).body.error).toBe('demo_pool_missing');
      const pool = await Promise.all([0, 1, 2].map(() => mkUser(V1, { accessibilityNotes: POOL_MARKER })));
      const key = randomUUID();
      const rs = [await demo(key), await demo(), await demo()];
      expect(rs.map((r) => r.status)).toEqual([201, 201, 201]);
      const ids = rs.map((r) => r.body.incident.id);
      expect(new Set(ids).size).toBe(3);
      const rows = await q(`SELECT user_id, lat, lng, risk FROM incidents WHERE id = ANY($1)`, [ids]);
      expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set(pool.map((p) => p.id)));
      for (const r of rows) {
        expect(r.lat).toBeGreaterThanOrEqual(BOUNDS.south); expect(r.lat).toBeLessThanOrEqual(BOUNDS.north);
        expect(r.lng).toBeGreaterThanOrEqual(BOUNDS.west); expect(r.lng).toBeLessThanOrEqual(BOUNDS.east);
        expect(r.risk).toBeGreaterThanOrEqual(2); // server-computed: vuln 1 lifts every county class; client's risk:1 ignored
      }
      const again = await demo(key); // retry of the first press
      expect(again.status).toBe(200);
      expect(again.body.incident.id).toBe(ids[0]);
      expect((await demo()).body.error).toBe('demo_pool_busy');
      expect(await q(`SELECT 1 FROM incidents WHERE user_id = $1`, [caller.id])).toHaveLength(0);
    } finally {
      delete process.env.DEMO_SKIP_OTP;
    }
  });

  it('9 lookup failure keeps the SOS', async () => {
    const u = await mkUser();
    const r = await sosAt(u.token, 30.5, -95.0); // outside counties.geojson
    expect(r.status).toBe(201);
    expect(r.body.incident).toMatchObject({ requiresReview: true, countyFips: '48201', locationSource: 'device' });
    const u2 = await mkUser();
    risk.kill();
    const r2 = await sosAt(u2.token, 29.79, -95.78);
    expect(r2.status).toBe(201);
    expect(r2.body.incident).toMatchObject({ requiresReview: true, countyFips: '48201' });
    for (let i = 0; i < 50 && risk.ready; i++) await new Promise((r) => setTimeout(r, 100)); // exit seen
    for (let i = 0; i < 150 && !risk.ready; i++) await new Promise((r) => setTimeout(r, 200)); // respawned
    expect(risk.ready).toBe(true);
  });

  it('11 proposals', async () => {
    delete process.env.PLAN_DEBOUNCE_MS; // default 2 s
    stub.latencyMs = 50;
    const got = new Promise<any>((res, rej) => {
      const t = setTimeout(() => rej(new Error('no routes.replaced')), 5000);
      const s = events.subject.subscribe((m) => {
        if (m.type === 'routes.replaced' && (m.data.routes as any[]).length) {
          clearTimeout(t);
          s.unsubscribe();
          res(m.data);
        }
      });
    });
    const pts = [[29.79, -95.78], [29.795, -95.79], [29.8, -95.8], [29.785, -95.81], [29.805, -95.785]];
    for (const [i, p] of pts.entries()) await call(p[0], p[1], i % 2 ? V0 : V1);
    const t0 = Date.now();
    const data = await got;
    expect(Date.now() - t0).toBeLessThan(2000 + 1500);
    process.env.PLAN_DEBOUNCE_MS = '600000';
    expect(data.routes.length).toBeGreaterThan(0);
    for (const r of data.routes) {
      expect(r.seatsUsed).toBeLessThanOrEqual(r.capacity);
      const driven = r.stops.filter((s: any) => !s.onFoot);
      for (let i = 1; i < driven.length; i++) expect(driven[i].risk).toBeLessThanOrEqual(driven[i - 1].risk);
    }
  });

  it('12 stale deploy and forecast trips', async () => {
    for (let i = 0; i < 40; i++) await call(29.775 + (i % 7) * 0.005, -95.85 + Math.floor(i / 7) * 0.05 + (i % 3) * 0.01, i % 2 ? V0 : V1);
    const s = await plan();
    const forecast = s.routes.find((r: any) => r.status === 'proposed' && !r.deployable);
    expect(forecast).toBeDefined();
    const nd = await post(`/routes/${forecast.id}/deploy`, { planVersion: s.planVersion });
    expect(nd.status).toBe(409);
    expect(nd.body.error).toBe('not_deployable');
    const ok = s.routes.find((r: any) => r.deployable);
    const stale = await post(`/routes/${ok.id}/deploy`, { planVersion: s.planVersion - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'plan_changed', message: 'El plan cambió. Revísalo de nuevo.' });
    await planning.runNow(); // supersedes everything
    const old = await post(`/routes/${ok.id}/deploy`, { planVersion: s.planVersion });
    expect(old.body.error).toBe('plan_changed');
  });

  it('13 atomic deploy', async () => {
    await call(29.79, -95.78);
    const s = await plan();
    const route = s.routes.find((r: any) => r.deployable);
    jest.spyOn(db, 'logStatus').mockRejectedValueOnce(new Error('boom'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await post(`/routes/${route.id}/deploy`, { planVersion: s.planVersion });
    expect(r.status).toBe(500);
    jest.restoreAllMocks();
    expect((await q('SELECT status FROM routes WHERE id = $1', [route.id]))[0].status).toBe('proposed');
    expect((await q('SELECT DISTINCT status FROM incidents')).map((x: any) => x.status)).toEqual(['pending']);
    expect(await q(`SELECT 1 FROM routes WHERE status = 'active'`)).toHaveLength(0);
  });

  it('14 full lifecycle', async () => {
    const a = await call(29.79, -95.78);
    const b = await call(29.795, -95.79, V0);
    let s = await plan();
    const route = s.routes.find((r: any) => r.deployable && r.stops.length);
    expect(s.incidents.every((i: any) => i.status === 'pending')).toBe(true);
    const ids = route.stops.map((x: any) => x.incidentId);
    const d = await post(`/routes/${route.id}/deploy`, { planVersion: s.planVersion });
    expect(d.status).toBe(200);
    expect(d.body.route.status).toBe('active');
    for (const id of ids) expect(await status(id)).toBe('routed');
    expect((await state()).vehicles.find((v: any) => v.id === route.vehicleId).activeRouteId).toBe(route.id);
    expect((await post(`/routes/${route.id}/arrived`)).status).toBe(409);
    expect((await post(`/routes/${route.id}/arrived`)).body.error).toBe('status_conflict');
    for (const id of ids) {
      const p = await post(`/incidents/${id}/picked-up`);
      expect(p.status).toBe(200);
      expect((await post(`/incidents/${id}/picked-up`)).status).toBe(409);
    }
    expect((await post(`/routes/${route.id}/cancel`)).status).toBe(409);
    const ar = await post(`/routes/${route.id}/arrived`);
    expect(ar.status).toBe(200);
    expect(ar.body.route.status).toBe('completed');
    const refuge = await q('SELECT * FROM places WHERE id = $1', [route.refuge.id]);
    for (const id of ids) {
      const [i] = await q('SELECT * FROM incidents WHERE id = $1', [id]);
      expect(i.status).toBe('dropped_off');
      expect(i.refuge_id).toBe(route.refuge.id);
      expect((await q('SELECT to_status FROM status_updates WHERE incident_id = $1 ORDER BY id', [id])).map((r: any) => r.to_status)).toEqual(['pending', 'routed', 'picked_up', 'dropped_off']);
    }
    const [v] = await q('SELECT lat, lng FROM vehicles WHERE id = $1', [route.vehicleId]);
    expect(v).toEqual({ lat: refuge[0].lat, lng: refuge[0].lng });
    const cur = await api().get('/sos/current').set(auth(a.token));
    expect(cur.body.incident).toMatchObject({ status: 'dropped_off', refuge: { id: route.refuge.id } });
    void b;
    s = await state();
    expect(s.incidents.filter((i: any) => ids.includes(i.id))).toHaveLength(0);
  });

  it('15 not found', async () => {
    const pts = [[29.79, -95.8], [29.7945, -95.8], [29.799, -95.8]]; // ~500 m apart
    for (const p of pts) await call(p[0], p[1]);
    let s = await plan();
    const route = s.routes.find((r: any) => r.deployable && r.stops.length === 3);
    expect(route).toBeDefined();
    await post(`/routes/${route.id}/deploy`, { planVersion: s.planVersion });
    const [s1, s2, s3] = route.stops.map((x: any) => x.incidentId);
    const nf = await post(`/incidents/${s2}/not-found`, { note: 'no responde' });
    expect(nf.status).toBe(200);
    expect(nf.body.incident.status).toBe('pending');
    expect((await q('SELECT skipped FROM route_stops WHERE incident_id = $1 AND route_id = $2', [s2, route.id]))[0].skipped).toBe(true);
    const upd = await q(`SELECT from_status, to_status, note FROM status_updates WHERE incident_id = $1 AND to_status = 'pending' AND from_status = 'routed'`, [s2]);
    expect(upd).toEqual([{ from_status: 'routed', to_status: 'pending', note: 'no responde' }]);
    expect((await q('SELECT status FROM routes WHERE id = $1', [route.id]))[0].status).toBe('active');
    await post(`/incidents/${s1}/picked-up`);
    expect((await post(`/routes/${route.id}/arrived`)).status).toBe(409);
    await post(`/incidents/${s3}/picked-up`);
    expect((await post(`/routes/${route.id}/arrived`)).status).toBe(200);
    expect(await status(s1)).toBe('dropped_off');
    expect(await status(s3)).toBe('dropped_off');
    expect(await status(s2)).toBe('pending');
    s = await plan();
    expect(s.routes.some((r: any) => r.stops.some((x: any) => x.incidentId === s2))).toBe(true);
  });

  it('15b a not-found person is not walked back into the same route', async () => {
    const a = await call(29.79, -95.8);
    const b = await call(29.7909, -95.8, V1); // ~100 m from A
    let s = await plan();
    const route = s.routes.find((r: any) => r.stops.length === 2);
    expect(route.stops.map((x: any) => x.onFoot).sort()).toEqual([false, true]);
    await post(`/routes/${route.id}/deploy`, { planVersion: s.planVersion });
    const walker = route.stops.find((x: any) => x.onFoot).incidentId;
    await post(`/incidents/${walker}/not-found`);
    s = await plan();
    expect(await status(walker)).toBe('pending');
    expect(s.routes.some((r: any) => r.status === 'proposed' && r.stops.some((x: any) => x.incidentId === walker))).toBe(true);
    void a; void b;
  });

  it('16 on-foot insertion', async () => {
    await q('UPDATE vehicles SET capacity = 6');
    const A = [29.79, -95.8];
    const a = await call(A[0], A[1], V1);
    let s = await plan();
    const route = s.routes.find((r: any) => r.deployable);
    await post(`/routes/${route.id}/deploy`, { planVersion: s.planVersion });
    const eta0 = (await q('SELECT refuge_eta FROM routes WHERE id = $1', [route.id]))[0].refuge_eta.getTime();
    // 300 m away: no insertion
    const far = await call(A[0] + 0.0027, A[1], V0);
    await planning.runNow();
    expect(await status(far.incidentId)).toBe('pending');
    // 100 m away: inserted
    const near = await call(A[0] - 0.0009, A[1], V1);
    await planning.runNow();
    const [row] = await q('SELECT * FROM incidents WHERE id = $1', [near.incidentId]);
    expect(row).toMatchObject({ status: 'routed', route_id: route.id });
    expect((await q('SELECT on_foot FROM route_stops WHERE incident_id = $1 AND route_id = $2', [near.incidentId, route.id]))[0].on_foot).toBe(true);
    expect(await q(`SELECT 1 FROM status_updates WHERE incident_id = $1 AND actor = 'system' AND to_status = 'routed'`, [near.incidentId])).toHaveLength(1);
    const eta1 = (await q('SELECT refuge_eta FROM routes WHERE id = $1', [route.id]))[0].refuge_eta.getTime();
    expect(eta1 - eta0).toBe(167000);
    // load: A risk 3 + near risk 3 = 6; another 100 m call with risk 2 (6+2=8) and risk-1-like would hit 7: not inserted
    const heavy = await call(A[0] + 0.0009, A[1], V0);
    await planning.runNow();
    expect(await status(heavy.incidentId)).toBe('pending');
    void a;
  });

  it('16b nearer stop wins, full route refuses', async () => {
    const A = [29.79, -95.8];
    await call(A[0], A[1], V1);
    let s = await plan();
    const r1 = s.routes.find((r: any) => r.deployable);
    await post(`/routes/${r1.id}/deploy`, { planVersion: s.planVersion });
    await call(A[0] + 0.0027, A[1], V1); // 300 m north of A: not inserted
    s = await plan();
    const r2 = s.routes.find((r: any) => r.deployable && r.stops.length);
    expect(r2.vehicleId).not.toBe(r1.vehicleId);
    await post(`/routes/${r2.id}/deploy`, { planVersion: s.planVersion });
    const c = await call(A[0] + 0.0011, A[1], V0); // ~122 m from A, ~178 m from B
    await planning.runNow();
    const [row] = await q('SELECT route_id FROM incidents WHERE id = $1', [c.incidentId]);
    expect(row.route_id).toBe(r1.id);
    // r1's vehicle has capacity: 2 or more? veh-1 has 2 seats and is now full -> next one nearby is refused
    const full = (await q('SELECT count(*)::int AS n FROM route_stops WHERE route_id = $1', [r1.id]))[0].n;
    const cap = (await q('SELECT capacity FROM vehicles WHERE id = $1', [r1.vehicleId]))[0].capacity;
    expect(full).toBeLessThanOrEqual(cap);
    if (full === cap) {
      const d = await call(A[0] - 0.0005, A[1], V0);
      await planning.runNow();
      expect((await q('SELECT route_id FROM incidents WHERE id = $1', [d.incidentId]))[0].route_id).not.toBe(r1.id);
    }
  });

  it('17 SSE and snapshot', async () => {
    const ana = await mkUser(ANA);
    const s0 = await state();
    const ctl = new AbortController();
    const res = await fetch(`${http}/api/v1/dashboard/events?key=k-test`, { signal: ctl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const sos = await sosAt(ana.token, 29.79, -95.78);
    let buf = '';
    const dec = new TextDecoder();
    while (!buf.includes('\n\n')) buf += dec.decode((await reader.read()).value);
    ctl.abort();
    expect(buf).toContain('event: incident.upserted');
    expect(buf).toContain(`id: ${s0.seq + 1}`);
    const data = JSON.parse(/data: (.*)/.exec(buf)![1]);
    expect(data.seq).toBe(s0.seq + 1);
    expect(data.id).toBe(sos.body.incident.id);
    expect((await api().get('/dashboard/state?key=k-test')).status).toBe(200);
    expect((await api().get('/dashboard/state')).status).toBe(401);
    expect((await api().post('/incidents/' + randomUUID() + '/dismiss?key=k-test')).status).toBe(401);
    const s1 = await state();
    const inc = s1.incidents.find((i: any) => i.id === sos.body.incident.id);
    expect(Object.keys(inc.person).sort()).toEqual(['age', 'label', 'mobilityNeeds', 'phone']);
    expect(inc.person).toMatchObject({ label: 'Ana P.', phone: ana.phone, mobilityNeeds: ['wheelchair'], age: expect.any(Number) });
    expect(inc.risk).toBe(3);
  });

  it('17a dismiss', async () => {
    const a = await call(29.79, -95.8);
    const b = await call(29.7945, -95.8);
    let s = await plan();
    expect(s.routes.some((r: any) => r.stops.some((x: any) => x.incidentId === a.incidentId))).toBe(true);
    const d = await post(`/incidents/${a.incidentId}/dismiss`, { note: 'falsa alarma' });
    expect(d.status).toBe(200);
    expect(d.body.incident.status).toBe('dismissed');
    expect((await state()).incidents.find((i: any) => i.id === a.incidentId)).toBeUndefined();
    s = await plan();
    expect(s.routes.some((r: any) => r.stops.some((x: any) => x.incidentId === a.incidentId))).toBe(false);
    expect((await q(`SELECT note FROM status_updates WHERE incident_id = $1 AND to_status = 'dismissed'`, [a.incidentId]))[0].note).toBe('falsa alarma');
    // a routed stop
    const route = s.routes.find((r: any) => r.deployable && r.stops.some((x: any) => x.incidentId === b.incidentId));
    await post(`/routes/${route.id}/deploy`, { planVersion: s.planVersion });
    const c = await call(29.8, -95.79);
    await planning.runNow();
    if ((await status(c.incidentId)) === 'routed') {
      // got attached on foot or else; dismiss it from its route
    }
    const dr = await post(`/incidents/${b.incidentId}/dismiss`);
    expect(dr.status).toBe(200);
    expect((await q('SELECT skipped FROM route_stops WHERE incident_id = $1 AND route_id = $2', [b.incidentId, route.id]))[0].skipped).toBe(true);
    expect((await q('SELECT status FROM routes WHERE id = $1', [route.id]))[0].status).toBe('active');
    const others = route.stops.map((x: any) => x.incidentId).filter((x: string) => x !== b.incidentId);
    for (const o of others) await post(`/incidents/${o}/picked-up`);
    const live = (await q(`SELECT i.status FROM route_stops s JOIN incidents i ON i.id = s.incident_id WHERE s.route_id = $1 AND NOT s.skipped`, [route.id])).map((r: any) => r.status);
    if (live.every((x: string) => x === 'picked_up')) expect((await post(`/routes/${route.id}/arrived`)).status).toBe(200);
    // dropped_off cannot be dismissed
    if (others.length) {
      const done = await post(`/incidents/${others[0]}/dismiss`);
      expect(done.status).toBe(409);
      expect(done.body.error).toBe('status_conflict');
    }
    // user can send a new SOS, and /sos/current shows the dismissal
    const cur = await api().get('/sos/current').set(auth(a.token));
    expect(cur.body.incident).toMatchObject({ id: a.incidentId, status: 'dismissed' });
    const again = await sosAt(a.token, 29.79, -95.8);
    expect(again.status).toBe(201);
    await q(`UPDATE status_updates SET at = now() - interval '13 hours' WHERE incident_id = $1 AND to_status = 'dismissed'`, [a.incidentId]);
    await q(`UPDATE incidents SET status = 'dismissed' WHERE id = $1`, [again.body.incident.id]);
    await q(`UPDATE status_updates SET at = now() - interval '13 hours' WHERE incident_id = $1`, [again.body.incident.id]);
    await q(`INSERT INTO status_updates(incident_id, from_status, to_status, actor, at) VALUES ($1,'pending','dismissed','dispatcher', now() - interval '13 hours')`, [again.body.incident.id]);
    expect((await api().get('/sos/current').set(auth(a.token))).body.incident).toBeNull();
  });

  it('19 busy vehicle', async () => {
    for (let i = 0; i < 40; i++) await call(29.775 + (i % 7) * 0.005, -95.85 + Math.floor(i / 7) * 0.05 + (i % 3) * 0.01, i % 2 ? V0 : V1);
    let s = await plan();
    const first = s.routes.find((r: any) => r.deployable);
    await post(`/routes/${first.id}/deploy`, { planVersion: s.planVersion });
    s = await plan();
    const act = s.routes.find((r: any) => r.status === 'active');
    const mine = s.routes.filter((r: any) => r.status === 'proposed' && r.vehicleId === act.vehicleId);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r: any) => !r.deployable)).toBe(true);
    const firstTrip = [...mine].sort((a: any, b: any) => a.departAt.localeCompare(b.departAt))[0];
    expect(firstTrip.start.id).toBe(act.refuge.id);
  });

  describe('demo simulation', () => {
    /** Real time at which a deployed route has run `simOffsetMs` of sim time. */
    const at = (route: any, simOffsetMs: number) => sim.clock.realAt + (route.simDeployedMs + simOffsetMs - sim.clock.simMs) / sim.clock.speed;
    const off = (route: any, iso: string) => Date.parse(iso) - Date.parse(route.departAt);
    async function deployed() {
      const pts = [[29.79, -95.8], [29.7945, -95.8], [29.799, -95.8]];
      for (const p of pts) await call(p[0], p[1]);
      const s = await plan();
      const r = s.routes.find((x: any) => x.deployable && x.stops.length === 3);
      const d = await post(`/routes/${r.id}/deploy`, { planVersion: s.planVersion });
      expect(d.status).toBe(200);
      return d.body.route;
    }
    const updates = (id: string) => q(`SELECT to_status, actor FROM status_updates WHERE incident_id = $1 ORDER BY id`, [id]);

    it('S1 deploy once, pickups only on arrival, once each, then complete', async () => {
      const r = await deployed();
      expect(typeof r.simDeployedMs).toBe('number');
      expect((await post(`/routes/${r.id}/deploy`, { planVersion: r.planVersion })).body.error).toBe('plan_changed');
      const [s1, s2] = r.stops;
      const t1 = off(r, s1.pickupEta), t2 = off(r, s2.pickupEta);
      expect(t2).toBeGreaterThan(t1);
      await dispatch.tick(at(r, t1 - 1000));
      expect(await status(s1.incidentId)).toBe('routed');
      await dispatch.tick(at(r, t1 + 1));
      await dispatch.tick(at(r, t1 + 2));
      expect(await status(s1.incidentId)).toBe('picked_up');
      expect(await status(s2.incidentId)).toBe('routed');
      expect(await updates(s1.incidentId)).toEqual([
        { to_status: 'pending', actor: 'mobile' }, { to_status: 'routed', actor: 'dispatcher' }, { to_status: 'picked_up', actor: 'system' }]);
      // a manual pickup that beats the sim is not repeated
      await post(`/incidents/${s2.incidentId}/picked-up`);
      await dispatch.tick(at(r, off(r, r.refugeEta) - 1000));
      expect(await updates(s2.incidentId)).toHaveLength(3);
      expect((await q('SELECT status FROM routes WHERE id = $1', [r.id]))[0].status).toBe('active');
      await dispatch.tick(at(r, off(r, r.refugeEta) + 1));
      expect((await q('SELECT status FROM routes WHERE id = $1', [r.id]))[0].status).toBe('completed');
      for (const st of r.stops) expect(await status(st.incidentId)).toBe('dropped_off');
      expect((await state()).vehicles.find((v: any) => v.id === r.vehicleId).activeRouteId).toBeNull();
    });

    it('S2 1% roll marks not found and the trip carries on', async () => {
      const r = await deployed();
      sim.rand = () => 0.995;
      await dispatch.tick(at(r, off(r, r.stops[0].pickupEta) + 1));
      expect(await status(r.stops[0].incidentId)).toBe('pending');
      expect((await q('SELECT skipped FROM route_stops WHERE route_id = $1 AND incident_id = $2', [r.id, r.stops[0].incidentId]))[0].skipped).toBe(true);
      sim.rand = () => 0;
      await dispatch.tick(at(r, off(r, r.refugeEta) + 1));
      expect((await q('SELECT status FROM routes WHERE id = $1', [r.id]))[0].status).toBe('completed');
    });

    it('S3 speed change rebases without jumping and scales progress', async () => {
      const r = await deployed();
      const t0 = Date.now();
      const before = sim.simMs(t0);
      await sim.setSpeed(5, t0);
      expect(sim.simMs(t0)).toBe(before);
      expect(sim.simMs(t0 + 1000) - before).toBe(5000);
      const t1 = off(r, r.stops[0].pickupEta);
      const real = at(r, t1 + 1);
      await dispatch.tick(real);
      expect(await status(r.stops[0].incidentId)).toBe('picked_up');
      expect((await post('/sim/speed', { speed: 9 })).status).toBe(400);
      const ok = await post('/sim/speed', { speed: 3 });
      expect(ok.status).toBe(200);
      expect(ok.body.sim).toMatchObject({ enabled: true, speed: 3 });
      expect((await state()).sim.speed).toBe(3);
      await sim.load();
      expect(sim.clock.speed).toBe(3);
    });

    it('S4 demo off: no speed control', async () => {
      process.env.DEMO_SIM = '0';
      expect((await post('/sim/speed', { speed: 2 })).status).toBe(404);
      expect((await state()).sim.enabled).toBe(false);
    });
  });
});
