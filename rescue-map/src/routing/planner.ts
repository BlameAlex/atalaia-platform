import { PLAN_DEFAULTS } from '../config';
import { Marker, Risk } from '../scenario';

export type Vehicle = { id: string; capacity: number; startId?: string; freeAtSec?: number };
/** Travel times in seconds, indexed like the markers array; null = no road route. */
export type Matrix = { durations: (number | null)[][]; snapMeters: number[] };
export type PlanOptions = typeof PLAN_DEFAULTS;
export type UnassignedReason = 'no_drivable_route' | 'insufficient_capacity';

type Place = { id: string; label: string; lat: number; lng: number };
export type Plan = {
  /** Sorted by departure. Times are seconds from the snapshot (t = 0). */
  trips: {
    vehicleId: string;
    tripNumber: number;
    capacity: number;
    seatsUsed: number;
    start: Place;
    departSec: number;
    /** onFoot = collected by the team on foot during the previous driven stop (no route change). */
    stops: { callId: string; label: string; risk: Risk; lat: number; lng: number; pickupEtaSec: number; onFoot: boolean }[];
    hospital: Place & { etaSec: number };
    droppedEarly: boolean;
    driveSec: number;
  }[];
  unassigned: { callId: string; label: string; risk: Risk; reason: UnassignedReason }[];
  unreachablePoints: { id: string; reason: 'snap_too_far' | 'no_route'; snapMeters: number }[];
  idleVehicles: string[];
};

type Call = { idx: number; risk: Risk; toHospitalSec: number };
/** One vehicle stop: it parks at `anchor`; the team walks to `walkers`. */
type Stop = { anchor: Call; walkers: Call[]; risk: Risk; walkSec: number };
type TripEval = {
  start: number;
  departSec: number;
  order: Stop[];
  etas: number[]; // per stop: arrival at the anchor
  hospital: number;
  hospitalEta: number;
  driveSec: number;
};

export const WALK_MPS = 1.2; // rescue team walking speed

const callsOf = (s: Stop) => [s.anchor, ...s.walkers];
const allCalls = (order: Stop[]) => order.flatMap(callsOf);
const riskLoad = (order: Stop[]) => allCalls(order).reduce((sum, c) => sum + c.risk, 0);

/** Lexicographic compare of numeric keys; negative = a is better. */
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

const perms = <T>(a: T[]): T[][] =>
  a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));

/** [ΣETA risk3, ΣETA risk2, ΣETA risk1] over every passenger. */
const etaSums = (ev: TripEval) => {
  const s = [0, 0, 0];
  ev.order.forEach((stop, i) => callsOf(stop).forEach((c) => (s[3 - c.risk] += ev.etas[i])));
  return s;
};

export function planRoutes(
  markers: Marker[],
  vehicles: Vehicle[],
  matrix: Matrix,
  opts: PlanOptions = PLAN_DEFAULTS,
): Plan {
  const d = (i: number, j: number) => matrix.durations[i]?.[j] ?? null;
  const snapOk = (i: number) => matrix.snapMeters[i] <= opts.maxSnapMeters;
  const hq = markers.findIndex((m) => m.type === 'hq');
  const idx = (type: Marker['type']) => markers.flatMap((m, i) => (m.type === type ? [i] : []));

  const unreachablePoints: Plan['unreachablePoints'] = [];
  const flag = (i: number, reason: 'snap_too_far' | 'no_route') =>
    unreachablePoints.push({ id: markers[i].id, reason, snapMeters: Math.round(matrix.snapMeters[i]) });

  if (!snapOk(hq)) flag(hq, 'snap_too_far');
  const hospitals = idx('hospital').filter((h) => {
    if (!snapOk(h)) return flag(h, 'snap_too_far'), false;
    if (markers.every((_, i) => i === h || d(i, h) === null)) return flag(h, 'no_route'), false;
    return true;
  });
  // Nearest reachable hospital by driving time from point i.
  const nearestHospital = (i: number) => {
    let best: { h: number; sec: number } | null = null;
    for (const h of hospitals) {
      const sec = d(i, h);
      if (sec !== null && (!best || sec < best.sec)) best = { h, sec };
    }
    return best;
  };

  const unassigned: Plan['unassigned'] = [];
  const unassign = (i: number, reason: UnassignedReason) =>
    unassigned.push({ callId: markers[i].id, label: markers[i].label, risk: markers[i].risk!, reason });

  let pool: Call[] = [];
  for (const i of idx('sos')) {
    const pickup = snapOk(hq) ? d(hq, i) : null;
    const nh = nearestHospital(i);
    if (!snapOk(i)) flag(i, 'snap_too_far');
    else if (snapOk(hq) && (pickup === null || !nh)) flag(i, 'no_route');
    if (!snapOk(i) || pickup === null || !nh) unassign(i, 'no_drivable_route');
    else pool.push({ idx: i, risk: markers[i].risk!, toHospitalSec: nh.sec });
  }

  const haversine = (i: number, j: number) => {
    const rad = Math.PI / 180;
    const a = markers[i];
    const b = markers[j];
    const h =
      Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
      Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  };

  /** Stop at `anchor`, collecting waiting calls within walking distance (any risk) while seats last. */
  const makeStop = (anchor: Call, seatsLeft: number, taken: Set<Call>): Stop => {
    const walkers = pool
      .filter((c) => c !== anchor && !taken.has(c) && haversine(anchor.idx, c.idx) <= opts.walkRadiusMeters)
      .sort((a, b) => b.risk - a.risk || haversine(anchor.idx, a.idx) - haversine(anchor.idx, b.idx))
      .slice(0, Math.max(0, seatsLeft - 1));
    const farthest = Math.max(0, ...walkers.map((c) => haversine(anchor.idx, c.idx)));
    return {
      anchor,
      walkers,
      risk: Math.max(anchor.risk, ...walkers.map((c) => c.risk)) as Risk,
      walkSec: (2 * farthest) / WALK_MPS,
    };
  };

  /**
   * Vehicle leaves `start` at `departSec`, makes each stop, ends at `forcedHospital` or the nearest
   * hospital from the last stop. null if unroutable or a passenger is delayed past the limits compared
   * with this vehicle driving straight to them (and on to their nearest hospital).
   */
  const evalTrip = (start: number, departSec: number, order: Stop[], forcedHospital?: number): TripEval | null => {
    let t = departSec;
    let drive = 0;
    let prev = start;
    const etas: number[] = [];
    for (const stop of order) {
      const sec = d(prev, stop.anchor.idx);
      if (sec === null) return null;
      t += sec;
      drive += sec;
      etas.push(t);
      t += opts.serviceTimeSec + stop.walkSec;
      prev = stop.anchor.idx;
    }
    const forcedSec = forcedHospital === undefined ? null : d(prev, forcedHospital);
    const end = forcedSec !== null ? { h: forcedHospital!, sec: forcedSec } : nearestHospital(prev);
    if (!end) return null;
    const hospitalEta = t + end.sec;
    const ok = order.every((stop, i) =>
      callsOf(stop).every((c) => {
        const direct = d(start, c.idx);
        if (direct === null) return false;
        const directPickup = departSec + direct;
        return (
          etas[i] - directPickup <= opts.maxPickupDelaySec &&
          hospitalEta - (directPickup + opts.serviceTimeSec + c.toHospitalSec) <= opts.maxHospitalDelaySec
        );
      }),
    );
    return ok ? { start, departSec, order, etas, hospital: end.h, hospitalEta, driveSec: drive + end.sec } : null;
  };

  /** Best feasible order: stop risk blocks 3 -> 2 -> 1, every permutation inside each block (≤ 6! total). */
  const bestOrder = (start: number, departSec: number, stops: Stop[]): TripEval | null => {
    const blocks = ([3, 2, 1] as Risk[]).map((r) => perms(stops.filter((s) => s.risk === r)));
    const orders = blocks.reduce<Stop[][]>((acc, ps) => acc.flatMap((a) => ps.map((p) => [...a, ...p])), [[]]);
    let best: TripEval | null = null;
    for (const o of orders) {
      const ev = evalTrip(start, departSec, o);
      if (ev && (!best || cmp([...etaSums(ev), ev.driveSec], [...etaSums(best), best.driveSec]) < 0)) best = ev;
    }
    return best;
  };

  /**
   * Drop off first when a hospital is nearer than the next pickup. With a risk-3 passenger on board
   * that alone decides (nearest hospital); otherwise the hospital must also not take the vehicle
   * farther from the next pickup. Returns the cut trip and the stops still to visit.
   */
  const dropOffFirst = (ev: TripEval): { ev: TripEval; rest: Stop[] } => {
    for (let i = 0; i < ev.order.length - 1; i++) {
      const a = ev.order[i].anchor.idx;
      const b = ev.order[i + 1].anchor.idx;
      const ab = d(a, b);
      if (ab === null) continue;
      const risk3Aboard = allCalls(ev.order.slice(0, i + 1)).some((c) => c.risk === 3);
      let best: { h: number; sec: number } | null = null;
      for (const h of hospitals) {
        const ah = d(a, h);
        const hb = d(h, b);
        if (ah === null || ah >= ab) continue;
        if (!risk3Aboard && (hb === null || hb > ab)) continue;
        if (!best || ah < best.sec) best = { h, sec: ah };
      }
      if (!best) continue;
      const cut = evalTrip(ev.start, ev.departSec, ev.order.slice(0, i + 1), best.h);
      if (cut) return { ev: cut, rest: ev.order.slice(i + 1) };
    }
    return { ev, rest: [] };
  };

  type FleetEntry = { v: Vehicle; pos: number; freeAt: number; trips: number };

  /**
   * One trip for `f` starting with `initial` stops: fill seats with calls near an on-board passenger of
   * equal or higher risk (higher risk first, then closest) while delay limits hold and the risk load is
   * below maxRiskLoad (the passenger who reaches it is the last driven pickup), then apply drop-off-first.
   */
  const buildTrip = (f: FleetEntry, initial: Stop[]) => {
    const { pos: start, freeAt: depart } = f;
    const alone: Stop = { anchor: initial[0].anchor, walkers: [], risk: initial[0].anchor.risk, walkSec: 0 };
    let ev = bestOrder(start, depart, initial) ?? bestOrder(start, depart, [initial[0]]) ?? bestOrder(start, depart, [alone]);
    if (!ev) return null;
    const tried = new Set<Call>(allCalls(initial));
    while (allCalls(ev.order).length < f.v.capacity && riskLoad(ev.order) < opts.maxRiskLoad) {
      const onTrip = allCalls(ev.order);
      const taken = new Set(onTrip);
      const near = (c: Call) => Math.min(...onTrip.filter((s) => s.risk >= c.risk).map((s) => d(s.idx, c.idx) ?? Infinity));
      const next = pool
        .filter((c) => !taken.has(c) && !tried.has(c) && near(c) <= opts.clusterRadiusSec)
        .sort((a, b) => b.risk - a.risk || near(a) - near(b))[0];
      if (!next) break;
      tried.add(next);
      const stop = makeStop(next, f.v.capacity - onTrip.length, taken);
      ev = bestOrder(start, depart, [...ev.order, stop]) ?? ev;
    }
    return dropOffFirst(ev);
  };

  // Event-driven dispatch: highest-risk call first, served by the vehicle that can reach it first
  // (vehicles free up at the hospital where their last trip ended).
  // NOTE: greedy dispatch without lookahead swaps; add relocate/swap moves if plans look poor.
  const fleet: FleetEntry[] = vehicles.map((v) => {
    const pos = v.startId === undefined ? hq : markers.findIndex((m) => m.id === v.startId);
    if (pos < 0) throw new Error(`vehicle ${v.id}: unknown startId ${v.startId}`);
    return { v, pos, freeAt: v.freeAtSec ?? 0, trips: 0 };
  });
  const trips: { vehicle: Vehicle; tripNumber: number; ev: TripEval; early: boolean }[] = [];
  const arrival = (f: FleetEntry, c: Call) => {
    const sec = d(f.pos, c.idx);
    return sec === null ? null : f.freeAt + sec;
  };

  for (;;) {
    const avail = fleet.filter((f) => f.trips < opts.maxTripsPerVehicle);
    if (!pool.length || !avail.length) break;

    // 1. Seed: highest risk, then the call some vehicle can reach soonest.
    const soonest = (c: Call) => Math.min(...avail.map((f) => arrival(f, c) ?? Infinity));
    const seed = pool.reduce((a, b) => (b.risk > a.risk || (b.risk === a.risk && soonest(b) < soonest(a)) ? b : a));
    if (soonest(seed) === Infinity) {
      unassign(seed.idx, 'no_drivable_route');
      pool = pool.filter((c) => c !== seed);
      continue;
    }

    // 2. Cluster around the seed; how many of it one trip could carry (seats aside, the risk-load
    //    cap) picks the vehicle (capacity fit).
    let clusterSize = 0;
    let clusterLoad = 0;
    for (const c of pool
      .filter((c) => (d(seed.idx, c.idx) ?? Infinity) <= opts.clusterRadiusSec)
      .sort((a, b) => b.risk - a.risk || d(seed.idx, a.idx)! - d(seed.idx, b.idx)!)) {
      if (clusterLoad >= opts.maxRiskLoad) break;
      clusterLoad += c.risk;
      clusterSize++;
    }

    // 3. Vehicle: earliest arrival wins; near-ties go to the best capacity fit for the cluster.
    const ranked = avail
      .map((f) => ({ f, at: arrival(f, seed) }))
      .filter((x): x is { f: FleetEntry; at: number } => x.at !== null)
      .sort((a, b) => a.at - b.at);
    const close = ranked.filter((x) => x.at <= ranked[0].at + opts.dispatchSlackSec).map((x) => x.f);
    const fits = close.filter((f) => f.v.capacity >= clusterSize);
    const pick = fits.length
      ? fits.reduce((a, b) => (b.v.capacity < a.v.capacity ? b : a))
      : close.reduce((a, b) => (b.v.capacity > a.v.capacity ? b : a));

    // 4. Build and commit trips. After a drop-off-first, the same vehicle goes on from that hospital
    //    to the passengers it skipped (its next trip). Uncommitted calls stay in the pool.
    let initial = [makeStop(seed, pick.v.capacity, new Set())];
    for (let first = true; ; first = false) {
      const built = buildTrip(pick, initial);
      if (!built) {
        if (first) {
          unassign(seed.idx, 'no_drivable_route');
          pool = pool.filter((c) => c !== seed);
        }
        break;
      }
      const served = new Set(allCalls(built.ev.order));
      pool = pool.filter((c) => !served.has(c));
      pick.pos = built.ev.hospital;
      pick.freeAt = built.ev.hospitalEta + opts.dropoffTimeSec;
      pick.trips++;
      trips.push({ vehicle: pick.v, tripNumber: pick.trips, ev: built.ev, early: built.rest.length > 0 });
      if (!built.rest.length || pick.trips >= opts.maxTripsPerVehicle) break;
      initial = built.rest;
    }
  }
  for (const c of pool) unassign(c.idx, 'insufficient_capacity');

  const place = (i: number): Place => {
    const m = markers[i];
    return { id: m.id, label: m.label, lat: m.latitude, lng: m.longitude };
  };
  return {
    trips: trips
      .sort((a, b) => a.ev.departSec - b.ev.departSec)
      .map(({ vehicle, tripNumber, ev, early }) => ({
        vehicleId: vehicle.id,
        tripNumber,
        capacity: vehicle.capacity,
        seatsUsed: allCalls(ev.order).length,
        start: place(ev.start),
        departSec: Math.round(ev.departSec),
        stops: ev.order.flatMap((stop, i) =>
          callsOf(stop).map((c, k) => {
            const { id, label, lat, lng } = place(c.idx);
            return { callId: id, label, risk: c.risk, lat, lng, pickupEtaSec: Math.round(ev.etas[i]), onFoot: k > 0 };
          }),
        ),
        hospital: { ...place(ev.hospital), etaSec: Math.round(ev.hospitalEta) },
        droppedEarly: early,
        driveSec: Math.round(ev.driveSec),
      })),
    unassigned,
    unreachablePoints,
    idleVehicles: fleet.filter((f) => f.trips === 0).map((f) => f.v.id),
  };
}
