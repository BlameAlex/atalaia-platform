import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalls, ensurePool, formatTable, mulberry32, parseBounds, parseOpts, runOne, sosBody,
  DEFAULT_BOUNDS as B, MOBILITY, POOL, POOL_MARKER,
} from './simulate-sos.mjs';

const opts = { count: 20, seed: 42, mode: 'mixed', clusters: 3, radiusM: 300 };
const hav = (a, b, c, d) => {
  const R = 6371000, r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const inside = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

// API falsa en memoria con las mismas reglas que el servidor: usuario por teléfono, token -> usuario, un SOS abierto por usuario.
function fakeApi() {
  const users = new Map(), tokens = new Map(), sos = [], log = [];
  let n = 0;
  const http = async (_api, _step, path, { body, token, key } = {}) => {
    log.push(path);
    if (path === '/auth/otp/request') return { status: 202, json: { devCode: '123456' } };
    if (path === '/auth/otp/verify') {
      const t = `tok-${++n}`;
      tokens.set(t, body.phone);
      return { status: 200, json: { deviceToken: t, user: users.get(body.phone) ?? null } };
    }
    const phone = tokens.get(token);
    if (!phone) return { status: 401, json: { error: 'unauthorized' } };
    if (path === '/users') {
      if (users.has(phone)) return { status: 409, json: { error: 'already_registered' } };
      const u = { id: `00000000-0000-4000-8000-${String(users.size + 1).padStart(12, '0')}`, phone, ...body };
      users.set(phone, u);
      return { status: 201, json: { user: u } };
    }
    if (path === '/sos') {
      const u = users.get(phone);
      const open = sos.find((s) => s.userId === u.id);
      if (open) return { status: 200, json: { incident: open.incident } };
      const incident = { id: `inc-${sos.length + 1}`, status: 'pending', risk: 2, requiresReview: false };
      sos.push({ userId: u.id, key, body, incident });
      return { status: 201, json: { incident } };
    }
    return { status: 404, json: {} };
  };
  return { http, users, sos, log };
}

test('mulberry32 es determinista', () => {
  assert.equal(mulberry32(5)(), mulberry32(5)());
});

test('pool: 50 usuarios distintos, completos, marcados y dentro de la zona', () => {
  assert.equal(POOL.length, 50);
  assert.equal(new Set(POOL.map((p) => p.phone)).size, 50);
  assert.equal(new Set(POOL.map((p) => p.fullName)).size, 50);
  for (const p of POOL) {
    assert.match(p.phone, /^\+128155501\d\d$/); // bloque ficticio 555-01xx
    assert.match(p.birthDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!isNaN(Date.parse(p.birthDate)));
    assert.ok(inside(p.homeLocation, B));
    assert.equal(p.accessibilityNotes, POOL_MARKER);
    for (const m of p.mobilityNeeds) assert.ok(MOBILITY.includes(m));
    for (const c of p.medicalConditions) assert.equal(typeof c.critical, 'boolean');
  }
});

test('ensurePool es idempotente: 50 altas la primera vez, 0 después, mismos ids', async () => {
  const f = fakeApi();
  const a = await ensurePool('x', f.http);
  assert.equal(a.created, 50);
  assert.equal(f.log.filter((p) => p === '/users').length, 50);
  const b = await ensurePool('x', f.http);
  assert.equal(b.created, 0);
  assert.equal(f.log.filter((p) => p === '/users').length, 50);
  assert.equal(f.users.size, 50);
  assert.deepEqual(a.sessions.map((s) => s.userId), b.sessions.map((s) => s.userId));
});

test('ensurePool no usa un teléfono del pool con perfil ajeno', async () => {
  const f = fakeApi();
  f.users.set(POOL[0].phone, { id: 'real', phone: POOL[0].phone, accessibilityNotes: '' });
  await assert.rejects(ensurePool('x', f.http), /no es simulado/);
  assert.equal(f.log.filter((p) => p === '/users').length, 0);
});

test('cada SOS sale del usuario elegido del pool, sin riesgo en el cuerpo', async () => {
  const f = fakeApi();
  const { sessions } = await ensurePool('x', f.http);
  const calls = buildCalls({ ...opts, count: 50 }, B);
  for (const c of calls) await runOne('x', c, sessions[c.userIdx], f.http);
  assert.equal(f.sos.length, 50);
  assert.equal(new Set(f.sos.map((s) => s.userId)).size, 50); // barajado: los 50, sin repetir
  calls.forEach((c, k) => {
    assert.equal(f.sos[k].userId, sessions[c.userIdx].userId);
    assert.deepEqual(Object.keys(f.sos[k].body).sort(), ['accuracyM', 'lat', 'lng']);
  });
  // la segunda ronda reutiliza usuarios ya existentes: regla de un SOS abierto por usuario
  const more = buildCalls({ ...opts, count: 55 }, B).slice(50);
  for (const c of more) assert.equal((await runOne('x', c, sessions[c.userIdx], f.http))[1], 200);
  assert.equal(f.users.size, 50);
});

test('sosBody solo lleva lat, lng, accuracyM', () => {
  assert.deepEqual(sosBody({ lat: 1, lng: 2, risk: 3, userIdx: 4 }), { lat: 1, lng: 2, accuracyM: 10 });
});

test('misma semilla, mismas llamadas; otra semilla difiere', () => {
  assert.deepEqual(buildCalls(opts, B), buildCalls(opts, B));
  assert.notDeepEqual(buildCalls(opts, B), buildCalls({ ...opts, seed: 43 }, B));
});

test('usuarios siempre del pool', () => {
  for (const c of buildCalls({ ...opts, count: 200, clusters: 3 }, B)) assert.ok(Number.isInteger(c.userIdx) && c.userIdx >= 0 && c.userIdx < 50);
});

test('puntos dentro de la zona (también con --bounds propio), grupos dentro del radio', () => {
  const custom = parseBounds('29.78,-95.84,29.79,-95.82');
  for (const b of [B, custom]) {
    for (const mode of ['spread', 'cluster', 'mixed']) {
      for (const c of buildCalls({ ...opts, mode, clusters: 2, count: 60, radiusM: 100 }, b)) assert.ok(inside(c, b));
    }
  }
  const calls = buildCalls({ ...opts, mode: 'cluster', clusters: 2, count: 40 }, B);
  for (const c of calls) for (const d of calls) if ((c.i - d.i) % 2 === 0) assert.ok(hav(c.lat, c.lng, d.lat, d.lng) <= 600 + 2);
});

test('llaves únicas y válidas', () => {
  const calls = buildCalls({ ...opts, count: 500, clusters: 3 }, B);
  assert.equal(new Set(calls.map((c) => c.key)).size, 500);
  for (const c of calls) assert.match(c.key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('mixed reparte mitades floor/ceil', () => {
  for (const n of [9, 10]) {
    const k = buildCalls({ ...opts, count: n }, B).map((c) => c.kind);
    assert.equal(k.filter((x) => x === 'cluster').length, Math.ceil(n / 2));
    assert.equal(k.filter((x) => x === 'spread').length, Math.floor(n / 2));
  }
});

test('argumentos inválidos lanzan', () => {
  for (const a of [['--mode', 'foo'], ['--count', '0'], ['--seed', '1000'], ['--nope'],
    ['--bounds', '1,2,3'], ['--bounds', '29.8,-95.8,29.7,-95.7'], ['--bounds', '29,-95,30,-96'], ['--bounds', 'a,b,c,d'], ['--bounds', '0,0,91,1']]) {
    assert.throws(() => parseOpts(a), undefined, a.join(' '));
  }
  assert.deepEqual(parseOpts(['--bounds', '29.73,-95.86,29.96,-95.26']).bounds, B);
  assert.equal(parseOpts([]).bounds, null);
});

test('formatTable alinea', () => {
  assert.equal(formatTable([['a', 'bb'], ['ccc', 'd']]), 'a    bb\nccc  d');
});
