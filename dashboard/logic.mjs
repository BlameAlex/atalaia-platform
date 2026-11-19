// Pure dashboard state logic: no DOM, no fetch.

export const STATUS_ES = {
  pending: 'Pendiente', routed: 'En ruta', picked_up: 'Recogido',
  dropped_off: 'Entregado en', dismissed: 'Descartado',
};
export const MOBILITY_ES = {
  'wheelchair': 'silla de ruedas',
  'limited walking': 'movilidad limitada',
  'bedridden': 'encamado/a',
  'blind or low vision': 'ceguera o baja visión',
  'deaf or hard of hearing': 'sordera o hipoacusia',
  'oxygen or powered equipment': 'oxígeno o equipo eléctrico',
  'other': 'otro',
};
export const REASON_ES = {
  insufficient_capacity: 'sin viajes de vehículo disponibles',
  no_drivable_route: 'sin ruta transitable',
  deferred: 'en espera (límite de planificación)',
};

const byId = (list) => new Map((list ?? []).map((x) => [x.id, x]));
const byIncident = (list) => new Map((list ?? []).map((x) => [x.incidentId, x]));

export function emptyStore() {
  return {
    seq: 0, planVersion: 0,
    places: new Map(), vehicles: new Map(), incidents: new Map(), routes: new Map(), unassigned: new Map(),
    sim: null,
  };
}

export function applySnapshot(store, s) {
  store.seq = s.seq;
  store.planVersion = s.planVersion;
  store.places = byId(s.places);
  store.vehicles = byId(s.vehicles);
  store.incidents = byId(s.incidents);
  store.routes = byId(s.routes);
  store.unassigned = byIncident(s.unassigned);
  store.sim = s.sim ?? null;
  return store;
}

export function applyEvent(store, type, data, seq) {
  if (!(seq > store.seq)) return false;
  switch (type) {
    case 'incident.upserted': store.incidents.set(data.id, data); break;
    case 'vehicle.updated': store.vehicles.set(data.id, data); break;
    case 'routes.replaced':
      for (const [id, r] of store.routes) if (r.status === 'proposed') store.routes.delete(id);
      for (const r of data.routes) store.routes.set(r.id, r);
      store.planVersion = data.planVersion;
      store.unassigned = byIncident(data.unassigned);
      break;
    case 'route.updated':
      if (data.status === 'active' || data.status === 'proposed') store.routes.set(data.id, data);
      else store.routes.delete(data.id);
      break;
    case 'sim.clock': store.sim = data; break;
    default: return false;
  }
  store.seq = seq;
  return true;
}

export function routeKind(store, route) {
  if (route.status === 'active') return 'active';
  const mine = [...store.routes.values()].filter((r) => r.vehicleId === route.vehicleId);
  if (mine.some((r) => r.status === 'active')) return 'forecast';
  const first = mine.filter((r) => r.status === 'proposed')
    .reduce((a, b) => (Date.parse(b.departAt) < Date.parse(a.departAt) ? b : a));
  return first.id === route.id ? 'deployable' : 'forecast';
}

const STATUS_RANK = { pending: 0, routed: 1, picked_up: 2, dropped_off: 3, dismissed: 4 };
export function sortIncidents(list) {
  return [...list].sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    b.risk - a.risk ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export const isTerminal = (status) => status === 'dropped_off' || status === 'dismissed';

export const liveStops = (route) => route.stops.filter((s) => !s.skipped);

// Active route first, else proposed. Skipped stops never count.
export function incidentRoute(store, incidentId) {
  let found = null;
  for (const route of store.routes.values()) {
    if (!route.stops.some((s) => s.incidentId === incidentId && !s.skipped)) continue;
    if (route.status === 'active') return { route, kind: 'active' };
    if (route.status === 'proposed') found ??= route;
  }
  return found ? { route: found, kind: routeKind(store, found) } : null;
}

export const canArrive = (store, route) =>
  route.stops.every((s) => s.skipped || store.incidents.get(s.incidentId)?.status === 'picked_up');
export const canCancel = (store, route) =>
  !route.stops.some((s) => store.incidents.get(s.incidentId)?.status === 'picked_up');

// Queue sections in display order; terminal incidents share "closed" until their 3 s removal.
const SECTION_OF = { pending: 'pending', routed: 'routed', picked_up: 'picked_up', dropped_off: 'closed', dismissed: 'closed' };
export const SECTIONS = ['pending', 'routed', 'picked_up', 'closed'];
export function groupIncidents(list) {
  const groups = new Map(SECTIONS.map((k) => [k, []]));
  for (const i of sortIncidents(list)) groups.get(SECTION_OF[i.status]).push(i);
  return SECTIONS.map((key) => ({ key, items: groups.get(key) }));
}

// A vehicle's routes: the active one first, then proposals by departure.
export const vehicleRoutes = (store, vehicleId) => [...store.routes.values()]
  .filter((r) => r.vehicleId === vehicleId)
  .sort((a, b) => (b.status === 'active') - (a.status === 'active') || Date.parse(a.departAt) - Date.parse(b.departAt));

// --- trip log time axis: AHORA is fixed at NOW_AT of the track; trips move past it ---
export const SPAN = 2 * 3600e3; // NOTE: fixed 2 h window, trips past +96 min clip at the right edge
export const NOW_AT = 0.2;
export function timeScale(now) {
  const lo = now - NOW_AT * SPAN;
  return { lo, hi: lo + SPAN, x: (t) => Math.min(100, Math.max(0, ((t - lo) / SPAN) * 100)) };
}

// Display times from server timestamps only (no accumulated movement, same after refresh).
// Active: shifted to its deployment, so it then slides past AHORA with real time.
// Proposed (deployable/forecast): scheduled times while in the future, pinned at AHORA once stale.
// Simulated active trips (elapsed given): placed so AHORA sits exactly where the car is on the sim clock.
export function tripTimes(route, kind, now, elapsed = null) {
  const depart = Date.parse(route.departAt);
  const shift = kind === 'active' && elapsed != null ? now - elapsed - depart
    : kind === 'active' ? Math.max(0, (route.deployedAt ? Date.parse(route.deployedAt) : depart) - depart)
    : Math.max(0, now - depart);
  let last = depart;
  const stops = route.stops.map((s) => (last = s.onFoot ? last : Date.parse(s.pickupEta)) + shift);
  return { t0: depart + shift, t1: Date.parse(route.refugeEta) + shift, stops };
}

// --- demo simulation: positions come from the server's sim clock, never from accumulated frames ---
export const simNow = (sim, realNow) => sim.simMs + (realNow - Date.parse(sim.realAt)) * sim.speed;
/** Sim ms a deployed route has been driving, or null when it is not simulated. */
export const routeElapsed = (sim, route, realNow) =>
  sim?.enabled && route.status === 'active' && route.simDeployedMs != null
    ? Math.max(0, simNow(sim, realNow) - route.simDeployedMs) : null;

const RAD = Math.PI / 180;
const metres = ([aLat, aLng], [bLat, bLng]) =>
  Math.hypot((bLat - aLat) * 111320, (bLng - aLng) * 111320 * Math.cos(aLat * RAD));
const bearing = ([aLat, aLng], [bLat, bLng]) =>
  (Math.atan2((bLng - aLng) * Math.cos(aLat * RAD), bLat - aLat) / RAD + 360) % 360;

/**
 * Where the car of `route` is after `elapsed` sim ms: driven along its geometry, reaching each driven stop
 * (skipped ones too, it still drove there) at its pickupEta and the refuge at refugeEta.
 * Returns {lat, lng, heading (deg clockwise from north), done}, or null without geometry.
 */
export function carPose(route, elapsed) {
  const pts = (route.geometry ?? []).map(([lng, lat]) => [lat, lng]);
  if (!pts.length) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1], pts[i]));
  const depart = Date.parse(route.departAt);
  const T = [0], D = [0];
  let j = 0;
  for (const s of route.stops.filter((x) => !x.onFoot && x.lat != null)) {
    let best = j;
    for (let k = j; k < pts.length; k++) if (metres(pts[k], [s.lat, s.lng]) < metres(pts[best], [s.lat, s.lng])) best = k;
    j = best;
    T.push(Math.max(T[T.length - 1], Date.parse(s.pickupEta) - depart));
    D.push(cum[j]);
  }
  T.push(Math.max(T[T.length - 1], Date.parse(route.refugeEta) - depart));
  D.push(cum[cum.length - 1]);
  const e = Math.max(0, elapsed);
  let leg = 0;
  while (leg < T.length - 2 && e >= T[leg + 1]) leg++;
  const span = T[leg + 1] - T[leg];
  const f = span > 0 ? Math.min(1, Math.max(0, (e - T[leg]) / span)) : 1;
  const d = D[leg] + f * (D[leg + 1] - D[leg]);
  let i = 0;
  while (i < pts.length - 2 && cum[i + 1] < d) i++;
  const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
  const seg = cum[Math.min(i + 1, pts.length - 1)] - cum[i];
  const g = seg > 0 ? (d - cum[i]) / seg : 0;
  // Heading from the first non-zero segment at or after the car.
  let h = 0;
  for (let k = i; k < pts.length - 1; k++) if (cum[k + 1] > cum[k]) { h = bearing(pts[k], pts[k + 1]); break; }
  return { lat: a[0] + (b[0] - a[0]) * g, lng: a[1] + (b[1] - a[1]) * g, heading: h, done: e >= T[T.length - 1] };
}
