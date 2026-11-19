#!/usr/bin/env node
// Carga SOS determinista a través de la API móvil real. Solo stdlib de Node.
// Cada llamada sale de uno de los 50 usuarios simulados registrados (POOL); el riesgo lo calcula solo el servidor.
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BOUNDS = { south: 29.73, west: -95.86, north: 29.96, east: -95.26 };
const M_PER_DEG = 111320;
const CRITICAL = ['insulin-dependent diabetes', 'dialysis', 'oxygen therapy'];
const NON_CRITICAL = ['asthma', 'hypertension'];
export const MOBILITY = ['wheelchair', 'limited walking', 'bedridden'];

// Marca de datos de prueba: bloque ficticio NANP 555-01xx y esta nota de accesibilidad.
export const POOL_MARKER = 'Usuario de demostración (simulación)';
const POOL_SEED = 2026;
const NAMES = [
  'María González', 'James Carter', 'Lucía Hernández', 'Robert Nguyen', 'Ana Martínez',
  'David Thompson', 'Carmen Rodríguez', 'Linda Patel', 'José Ramírez', 'Patricia Johnson',
  'Miguel Torres', 'Barbara Wilson', 'Rosa Flores', 'Kevin Tran', 'Elena Castillo',
  'Susan Miller', 'Jorge Morales', 'Dorothy Brown', 'Sofía Vargas', 'Michael Davis',
  'Gabriela Reyes', 'William Anderson', 'Isabel Mendoza', 'Thomas Lee', 'Adriana Silva',
  'Richard Clark', 'Verónica Ortiz', 'Nancy Lewis', 'Fernando Ruiz', 'Karen Walker',
  'Teresa Jiménez', 'Charles Hall', 'Alejandro Cruz', 'Betty Young', 'Marisol Delgado',
  'Daniel Pham', 'Guadalupe Romero', 'Steven King', 'Beatriz Navarro', 'Margaret Scott',
  'Ricardo Aguilar', 'Helen Green', 'Pilar Herrera', 'Joseph Baker', 'Raúl Medina',
  'Sandra Adams', 'Esperanza Ríos', 'Paul Nelson', 'Natalia Guzmán', 'Brian Hill',
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pick = (arr, u) => arr[Math.floor(u * arr.length)];

// Los 50 usuarios simulados: fijos, nunca dependen de --seed. Domicilio dentro de la zona de demostración.
function buildPool() {
  const rng = mulberry32(POOL_SEED);
  const B = DEFAULT_BOUNDS, inset = 0.002;
  return NAMES.map((fullName, k) => {
    const [rLat, rLng, rAge, uAge, rMon, rDay, rCrit, uCrit, rNon, uNon, rMob, uMob] = Array.from({ length: 12 }, rng);
    const age = rAge < 0.3 ? 70 + Math.floor(uAge * 21) : 19 + Math.floor(uAge * 50);
    const medicalConditions = [];
    if (rCrit < 0.3) medicalConditions.push({ name: pick(CRITICAL, uCrit), critical: true });
    if (rNon < 0.3) medicalConditions.push({ name: pick(NON_CRITICAL, uNon), critical: false });
    const pad = (n) => String(n).padStart(2, '0');
    return {
      fullName,
      phone: `+1281555${String(101 + k).padStart(4, '0')}`,
      birthDate: `${2026 - age}-${pad(1 + Math.floor(rMon * 12))}-${pad(1 + Math.floor(rDay * 28))}`,
      homeLocation: {
        lat: round6(B.south + inset + rLat * (B.north - B.south - 2 * inset)),
        lng: round6(B.west + inset + rLng * (B.east - B.west - 2 * inset)),
      },
      medicalConditions,
      mobilityNeeds: rMob < 0.25 ? [pick(MOBILITY, uMob)] : [],
      accessibilityNotes: POOL_MARKER,
    };
  });
}
export const POOL = buildPool();

export const USO = `uso: node tools/simulate-sos.mjs [opciones]
  --count N        llamadas a simular, 1-500 (10)
  --seed N         semilla entera 0-999 (1)
  --mode M         mixed | spread | cluster (mixed)
  --clusters K     centros de grupo, 1..count (3)
  --radius-m M     radio de grupo en metros, > 0 (300)
  --bounds S,W,N,E zona de las llamadas en grados (la de /health)
  --interval-ms N  pausa entre llamadas, >= 0 (500)
  --api URL        origen de la API (http://localhost:3100)
  --dry-run        solo imprime el plan, sin red
  --help           muestra esta ayuda`;

function idempotencyKey(seed, i) {
  const h = createHash('sha256').update(`sim:${seed}:${i}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Construye toda la lista de llamadas antes de cualquier E/S. Orden de consumo del PRNG fijo.
export function buildCalls({ count, seed, mode, clusters, radiusM }, bounds, poolSize = POOL.length) {
  const rng = mulberry32(seed);
  const latInset = radiusM / M_PER_DEG;
  const midLat = (bounds.south + bounds.north) / 2;
  const lngInset = radiusM / (M_PER_DEG * Math.cos((midLat * Math.PI) / 180));
  const box = { s: bounds.south + latInset, n: bounds.north - latInset, w: bounds.west + lngInset, e: bounds.east - lngInset };
  if (box.s >= box.n || box.w >= box.e) throw new RangeError('radius-m demasiado grande para la zona');

  const centres = Array.from({ length: clusters }, () => {
    const u = rng(), v = rng();
    return { lat: round6(box.s + u * (box.n - box.s)), lng: round6(box.w + v * (box.e - box.w)) };
  });

  // Usuario aleatorio por llamada: barajado del pool, recorrido en ciclo (sin repetir hasta agotar los 50).
  const order = Array.from({ length: poolSize }, (_, k) => k);
  for (let k = poolSize - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }

  const used = new Set();
  const calls = [];
  for (let i = 1; i <= count; i++) {
    const kind = mode === 'mixed' ? (i % 2 ? 'cluster' : 'spread') : mode;
    let lat, lng;
    for (;;) {
      const u = rng(), v = rng();
      if (kind === 'spread') {
        lat = round6(bounds.south + u * (bounds.north - bounds.south));
        lng = round6(bounds.west + v * (bounds.east - bounds.west));
      } else {
        const c = centres[(i - 1) % clusters];
        const theta = 2 * Math.PI * u, r = radiusM * Math.sqrt(v);
        lat = round6(c.lat + (r * Math.cos(theta)) / M_PER_DEG);
        lng = round6(c.lng + (r * Math.sin(theta)) / (M_PER_DEG * Math.cos((c.lat * Math.PI) / 180)));
      }
      lat = clamp(lat, bounds.south, bounds.north);
      lng = clamp(lng, bounds.west, bounds.east);
      const key = `${lat},${lng}`;
      if (!used.has(key)) { used.add(key); break; }
    }
    calls.push({ i, kind, lat, lng, userIdx: order[(i - 1) % poolSize], key: idempotencyKey(seed, i) });
  }
  return calls;
}

// Cuerpo de POST /sos: el mismo contrato que la app móvil. Nunca lleva riesgo.
export const sosBody = (c) => ({ lat: c.lat, lng: c.lng, accuracyM: 10 });

export function formatTable(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => r.map((cell, c) => String(cell).padEnd(widths[c])).join('  ').trimEnd()).join('\n');
}

const BASE_HEAD = ['#', 'teléfono', 'nombre', 'tipo', 'lat', 'lng'];
const baseCols = (c) => [c.i, POOL[c.userIdx].phone, POOL[c.userIdx].fullName, c.kind, c.lat.toFixed(6), c.lng.toFixed(6)];
const LIVE_HEAD = ['usuario', 'http', 'resultado', 'incidente', 'estado', 'riesgo', 'revisar'];

class StepError extends Error {
  constructor(step, status, code) { super(`${step}:${status}:${code}`); this.step = step; this.status = status; }
}

async function call(api, step, path, { method = 'POST', body, token, key } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers['idempotency-key'] = key;
  let res;
  try {
    res = await fetch(`${api}/api/v1${path}`, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new StepError(step, 0, e.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const need = (r, step, ...ok) => { if (!ok.includes(r.status)) throw new StepError(step, r.status, r.json.error ?? 'unknown'); return r; };
const fatal = (m) => Object.assign(new Error(m), { fatal: true });

// Garantiza los 20 usuarios simulados (idempotente) y devuelve una sesión por usuario.
// Solo toca teléfonos del pool; un teléfono del pool con un perfil ajeno detiene la simulación.
export async function ensurePool(api, http = call) {
  const sessions = [];
  let created = 0;
  for (const p of POOL) {
    let r = need(await http(api, 'otp/request', '/auth/otp/request', { body: { phone: p.phone } }), 'otp/request', 202);
    if (!r.json.devCode) throw fatal('el servidor no está en NODE_ENV=development');
    r = need(await http(api, 'otp/verify', '/auth/otp/verify', { body: { phone: p.phone, code: r.json.devCode } }), 'otp/verify', 200);
    const token = r.json.deviceToken;
    let user = r.json.user;
    if (!user) {
      const { phone, ...body } = p;
      user = need(await http(api, 'users', '/users', { token, body }), 'users', 201).json.user;
      created++;
    } else if (user.accessibilityNotes !== POOL_MARKER) {
      throw fatal(`el teléfono ${p.phone} tiene un perfil que no es simulado; no se usa`);
    }
    if (user.phone !== p.phone || !user.id) throw fatal(`respuesta inesperada al registrar ${p.phone}`);
    sessions.push({ userId: user.id, token });
  }
  return { sessions, created };
}

export async function runOne(api, c, session, http = call) {
  const r = need(await http(api, 'sos', '/sos', { token: session.token, key: c.key, body: sosBody(c) }), 'sos', 200, 201);
  const inc = r.json.incident ?? {};
  return [session.userId.slice(0, 8), r.status, r.status === 201 ? 'creado' : 'existente', inc.id ?? '-', inc.status ?? '-', inc.risk ?? '-', inc.requiresReview ? 'sí' : 'no'];
}

export function parseBounds(s) {
  const n = s.split(',').map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) throw new TypeError('--bounds debe ser S,W,N,E');
  const [south, west, north, east] = n;
  if (!(south < north && west < east && Math.abs(south) <= 90 && Math.abs(north) <= 90 && Math.abs(west) <= 180 && Math.abs(east) <= 180))
    throw new TypeError('--bounds: requiere S<N, W<E, latitudes en ±90 y longitudes en ±180');
  return { south, west, north, east };
}

const INT = /^\d+$/;
export function parseOpts(argv) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      count: { type: 'string', default: '10' }, seed: { type: 'string', default: '1' }, mode: { type: 'string', default: 'mixed' },
      clusters: { type: 'string', default: '3' }, 'radius-m': { type: 'string', default: '300' }, 'interval-ms': { type: 'string', default: '500' },
      bounds: { type: 'string' },
      api: { type: 'string', default: 'http://localhost:3100' }, 'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (v.help) return { help: true };
  const bad = (m) => { throw new TypeError(m); };
  if (!INT.test(v.count) || +v.count < 1 || +v.count > 500) bad('--count debe ser un entero entre 1 y 500');
  if (!INT.test(v.seed) || +v.seed > 999) bad('--seed debe ser un entero entre 0 y 999');
  if (!['mixed', 'spread', 'cluster'].includes(v.mode)) bad('--mode debe ser mixed, spread o cluster');
  if (!INT.test(v.clusters) || +v.clusters < 1 || +v.clusters > +v.count) bad('--clusters debe ser un entero entre 1 y count');
  if (!(Number(v['radius-m']) > 0)) bad('--radius-m debe ser mayor que 0');
  if (!(Number(v['interval-ms']) >= 0)) bad('--interval-ms debe ser >= 0');
  return {
    count: +v.count, seed: +v.seed, mode: v.mode, clusters: +v.clusters, radiusM: Number(v['radius-m']), intervalMs: Number(v['interval-ms']),
    bounds: v.bounds === undefined ? null : parseBounds(v.bounds), api: v.api.replace(/\/+$/, ''), dryRun: v['dry-run'],
  };
}

async function main() {
  let o;
  try { o = parseOpts(process.argv.slice(2)); } catch (e) { console.error(`${e.message}\n${USO}`); return 2; }
  if (o.help) { console.log(USO); return 0; }

  let bounds = o.bounds ?? DEFAULT_BOUNDS, source = o.bounds ? '--bounds' : 'predeterminado';
  if (!o.dryRun) {
    try {
      const r = await call(o.api, 'health', '/health', { method: 'GET' });
      if (!r.json.bounds) throw new Error('sin bounds');
      if (!o.bounds) { bounds = r.json.bounds; source = 'health'; }
    } catch (e) { console.error(`no se pudo leer /health en ${o.api}: ${e.message}`); return 1; }
  }
  let calls;
  try { calls = buildCalls(o, bounds); } catch (e) { console.error(`${e.message}\n${USO}`); return 2; }

  const b = [bounds.south, bounds.west, bounds.north, bounds.east].map((n) => n.toFixed(6)).join(',');
  console.log(`simulate-sos seed=${o.seed} mode=${o.mode} count=${o.count} clusters=${o.clusters} radiusM=${o.radiusM} bounds=${b} (${source})`);

  let sessions = [];
  if (!o.dryRun) {
    try {
      const p = await ensurePool(o.api);
      sessions = p.sessions;
      console.log(`pool: ${POOL.length} usuarios simulados (${p.created} creados, ${POOL.length - p.created} existentes)`);
    } catch (e) { console.error(`no se pudo preparar el pool: ${e.message}`); return 1; }
  }

  const rows = [o.dryRun ? BASE_HEAD : [...BASE_HEAD, ...LIVE_HEAD]];
  let ok = 0, fail = 0;
  for (const c of calls) {
    if (o.dryRun) { rows.push(baseCols(c)); continue; }
    try {
      rows.push([...baseCols(c), ...(await runOne(o.api, c, sessions[c.userIdx]))]);
      ok++;
    } catch (e) {
      rows.push([...baseCols(c), sessions[c.userIdx].userId.slice(0, 8), e.status ?? 0, `fallo:${e.message}`, '-', '-', '-', '-']);
      fail++;
    }
    if (o.intervalMs) await new Promise((r) => setTimeout(r, o.intervalMs));
  }
  console.log(formatTable(rows));
  if (o.dryRun) { console.log(`ok=${o.count} fallidos=0`); return 0; }
  console.log(`ok=${ok} fallidos=${fail}  (riesgo = clasificación del servidor; "existente" = el usuario ya tiene un SOS abierto o llave repetida)`);
  return fail ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
