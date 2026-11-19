import { PLAN_DEFAULTS } from '../config';
import { Marker, Risk } from '../scenario';
import { Matrix, planRoutes, Vehicle } from './planner';

// Points on a plane; 1 unit = 60 s of driving.
type P = { id: string; type: Marker['type']; x: number; y: number; risk?: Risk };
const markersOf = (ps: P[]): Marker[] =>
  ps.map((p) => ({ id: p.id, type: p.type, label: p.id, latitude: p.y, longitude: p.x, risk: p.risk }));
const matrixOf = (ps: P[], snap: Record<string, number> = {}): Matrix => ({
  durations: ps.map((a) => ps.map((b) => Math.hypot(a.x - b.x, a.y - b.y) * 60)),
  snapMeters: ps.map((p) => snap[p.id] ?? 5),
});
const run = (ps: P[], vehicles: Vehicle[], opts = {}, snap = {}) =>
  planRoutes(markersOf(ps), vehicles, matrixOf(ps, snap), { ...PLAN_DEFAULTS, ...opts });
const ids = (plan: ReturnType<typeof run>) => plan.trips.map((t) => t.stops.map((s) => s.callId));

const base: P[] = [
  { id: 'hq', type: 'hq', x: 0, y: 0 },
  { id: 'H1', type: 'hospital', x: 10, y: 5 }, // nearest to r3
  { id: 'H2', type: 'hospital', x: 16, y: 0 }, // nearest to r2
  { id: 'r3', type: 'sos', x: 10, y: 0, risk: 3 },
  { id: 'r2', type: 'sos', x: 12, y: 0, risk: 2 },
  { id: 'r1', type: 'sos', x: 0, y: -10, risk: 1 },
];
const one2 = [{ id: 'V1', capacity: 2 }];

describe('planRoutes', () => {
  it('acceptance: r3 then r2 to the hospital nearest r2; r1 on trip 2 from that hospital', () => {
    const plan = run(base, one2);
    expect(ids(plan)).toEqual([['r3', 'r2'], ['r1']]);
    const [t1, t2] = plan.trips;
    expect(t1.start.id).toBe('hq');
    expect(t1.stops.map((s) => s.pickupEtaSec)).toEqual([600, 840]);
    expect(t1.hospital).toMatchObject({ id: 'H2', etaSec: 1200 });
    expect(t2).toMatchObject({ tripNumber: 2, start: { id: 'H2' }, departSec: 1200 + PLAN_DEFAULTS.dropoffTimeSec });
    expect(plan.unassigned).toEqual([]);
  });

  it('acceptance: one trip allowed leaves r1 unassigned for capacity', () => {
    const plan = run(base, one2, { maxTripsPerVehicle: 1 });
    expect(ids(plan)).toEqual([['r3', 'r2']]);
    expect(plan.unassigned).toEqual([{ callId: 'r1', label: 'r1', risk: 1, reason: 'insufficient_capacity' }]);
  });

  it('acceptance: over the delay limit, r3 goes straight to its nearest hospital', () => {
    const plan = run(base, one2, { maxHospitalDelaySec: 100 });
    expect(ids(plan)).toEqual([['r3'], ['r2'], ['r1']]);
    expect(plan.trips[0].hospital.id).toBe('H1');
    expect(plan.trips[1].start.id).toBe('H1');
  });

  it('drops off first when a hospital is nearer than the next pickup with risk 3 aboard; same vehicle continues', () => {
    const ps: P[] = [
      { id: 'hq', type: 'hq', x: 0, y: 0 },
      { id: 'H', type: 'hospital', x: 11, y: 0.3 }, // nearer to a than b is
      { id: 'a', type: 'sos', x: 10, y: 0, risk: 3 },
      { id: 'b', type: 'sos', x: 12, y: 0, risk: 2 },
    ];
    const plan = run(ps, [{ id: 'V1', capacity: 2 }, { id: 'V2', capacity: 2 }]);
    expect(ids(plan)).toEqual([['a'], ['b']]);
    expect(plan.trips[0]).toMatchObject({ vehicleId: 'V1', droppedEarly: true, hospital: { id: 'H' } });
    expect(plan.trips[1]).toMatchObject({ vehicleId: 'V1', tripNumber: 2, start: { id: 'H' } });
    expect(plan.idleVehicles).toEqual(['V2']);
  });

  it('with only lower risk aboard, drops off first only if the hospital is not farther from the next pickup', () => {
    const at = (hx: number, hy: number): P[] => [
      { id: 'hq', type: 'hq', x: 0, y: 0 },
      { id: 'H', type: 'hospital', x: hx, y: hy },
      { id: 'a', type: 'sos', x: 10, y: 0, risk: 2 },
      { id: 'b', type: 'sos', x: 12, y: 0, risk: 1 },
    ];
    const behind = run(at(9, 0), one2); // nearer than b, but takes us away from b
    expect(ids(behind)).toEqual([['a', 'b']]);
    const between = run(at(11, 0.5), one2);
    expect(ids(between)).toEqual([['a'], ['b']]);
    expect(between.trips[0].droppedEarly).toBe(true);
  });

  // Walking cases: coordinates are degrees, 0.001° ≈ 111 m.
  const walkBase: P[] = [
    { id: 'hq', type: 'hq', x: 0, y: 0 },
    { id: 'H', type: 'hospital', x: 10, y: 12 },
    { id: 'a', type: 'sos', x: 10, y: 0, risk: 3 },
  ];

  it('collects calls within walking distance at the same stop, without rerouting', () => {
    const plan = run([...walkBase, { id: 'w', type: 'sos', x: 10.001, y: 0, risk: 1 }], [{ id: 'V1', capacity: 4 }]);
    expect(plan.trips).toHaveLength(1);
    const [a, w] = plan.trips[0].stops;
    expect([a.callId, a.onFoot, w.callId, w.onFoot]).toEqual(['a', false, 'w', true]);
    expect(w.pickupEtaSec).toBe(a.pickupEtaSec);
    expect(plan.trips[0].seatsUsed).toBe(2);
  });

  it('walking pickups ignore the risk cap but block further driven pickups', () => {
    const ps: P[] = [
      ...walkBase,
      { id: 'w1', type: 'sos', x: 10.001, y: 0, risk: 3 },
      { id: 'w2', type: 'sos', x: 10, y: 0.001, risk: 3 },
      { id: 'w3', type: 'sos', x: 10.001, y: 0.001, risk: 3 },
      { id: 'd', type: 'sos', x: 10.5, y: 0, risk: 1 }, // 30 s drive, far beyond walking
    ];
    const plan = run(ps, [{ id: 'V6', capacity: 6 }]);
    expect(plan.trips[0].stops.map((s) => s.onFoot)).toEqual([false, true, true, true]);
    expect(ids(plan)[1]).toEqual(['d']);
  });

  it('walking pickups are limited by seats, highest risk first', () => {
    const ps: P[] = [
      ...walkBase,
      { id: 'w1', type: 'sos', x: 10.001, y: 0, risk: 2 },
      { id: 'w2', type: 'sos', x: 10, y: 0.001, risk: 1 },
    ];
    const plan = run(ps, one2);
    expect(ids(plan)[0]).toEqual(['a', 'w1']);
    expect(ids(plan).flat()).toContain('w2');
    expect(plan.trips.findIndex((t) => t.stops.some((s) => s.callId === 'w2'))).toBeGreaterThan(0);
  });

  const clusterOf = (risks: Risk[]): P[] => [
    { id: 'hq', type: 'hq', x: 0, y: 0 },
    { id: 'H', type: 'hospital', x: 10, y: 12 },
    ...risks.map((risk, i) => ({ id: `c${i}`, type: 'sos' as const, x: 10 + (i % 2) * 0.3, y: Math.floor(i / 2) * 0.3, risk })),
  ];
  const clusterAt = (n: number, risk: Risk): P[] => clusterOf(Array(n).fill(risk));
  const seats = (plan: ReturnType<typeof run>) => plan.trips.map((t) => [t.vehicleId, t.seatsUsed]);
  const big6small2 = [
    { id: 'big', capacity: 6 },
    { id: 'small', capacity: 2 },
  ];

  it('sends the vehicle whose capacity fits the cluster', () => {
    expect(seats(run(clusterAt(2, 3), big6small2))).toEqual([['small', 2]]);
    expect(seats(run(clusterAt(5, 1), big6small2))).toEqual([['big', 5]]);
  });

  it("caps driven pickups once the passengers' summed risk reaches 7", () => {
    const big = [{ id: 'V6', capacity: 6 }];
    expect(seats(run(clusterAt(4, 3), big))).toEqual([['V6', 3], ['V6', 1]]); // 3+3+3 = 9
    expect(seats(run(clusterAt(5, 2), big))).toEqual([['V6', 4], ['V6', 1]]); // 2+2+2+2 = 8
    const mixed = run(clusterOf([3, 3, 2, 1]), big); // 3+3+2 = 8, R1 waits
    expect(mixed.trips.map((t) => t.stops.map((s) => s.risk))).toEqual([[3, 3, 2], [1]]);
  });

  it('sizes the vehicle by what the risk cap lets one trip carry', () => {
    const plan = run(clusterAt(4, 3), [{ id: 'big', capacity: 6 }, { id: 'mid', capacity: 4 }]);
    expect(seats(plan)[0]).toEqual(['mid', 3]);
  });

  it('splits a cluster bigger than any vehicle across vehicles', () => {
    const plan = run(clusterAt(6, 1), [{ id: 'V4', capacity: 4 }, { id: 'V2', capacity: 2 }]);
    expect(seats(plan)).toEqual([['V4', 4], ['V2', 2]]);
    expect(plan.unassigned).toEqual([]);
  });

  it('dispatches the next call to the vehicle that frees up first, from its hospital', () => {
    const ps: P[] = [
      { id: 'hq', type: 'hq', x: 0, y: 0 },
      { id: 'H1', type: 'hospital', x: 0, y: 2 },
      { id: 'H2', type: 'hospital', x: 16, y: 0 },
      { id: 'a', type: 'sos', x: 1, y: 0, risk: 3 },
      { id: 'b', type: 'sos', x: 15, y: 0, risk: 3 },
      { id: 'c', type: 'sos', x: 0, y: 9, risk: 1 },
    ];
    const plan = run(ps, [{ id: 'V1', capacity: 2 }, { id: 'V2', capacity: 2 }]);
    const c = plan.trips.find((t) => t.stops.some((s) => s.callId === 'c'))!;
    expect(c).toMatchObject({ vehicleId: 'V1', tripNumber: 2, start: { id: 'H1' } });
  });

  it('visits higher risk first even when a lower-risk call is closer', () => {
    const ps: P[] = [
      { id: 'hq', type: 'hq', x: 0, y: 0 },
      { id: 'H', type: 'hospital', x: 12, y: 8 },
      { id: 'near1', type: 'sos', x: 9, y: 0, risk: 1 },
      { id: 'far3', type: 'sos', x: 10, y: 0, risk: 3 },
    ];
    const plan = run(ps, [{ id: 'V1', capacity: 6 }]);
    expect(ids(plan)).toEqual([['far3', 'near1']]);
  });

  it('picks up a lower-risk call near the second risk 3, not just near the first', () => {
    const ps: P[] = [
      { id: 'hq', type: 'hq', x: 0, y: 0 },
      { id: 'H', type: 'hospital', x: 19, y: 5 },
      { id: 'a', type: 'sos', x: 10, y: 0, risk: 3 },
      { id: 'a2', type: 'sos', x: 14, y: 0, risk: 3 },
      { id: 'c', type: 'sos', x: 18, y: 0, risk: 1 },
    ];
    const plan = run(ps, [{ id: 'V1', capacity: 4 }]);
    expect(ids(plan)).toEqual([['a', 'a2', 'c']]);
  });

  it('flags points too far from a road and never routes to them', () => {
    const plan = run(base, [{ id: 'V1', capacity: 6 }], {}, { r1: 900, H2: 900 });
    expect(plan.unreachablePoints.map((u) => u.id).sort()).toEqual(['H2', 'r1']);
    expect(plan.unassigned.find((u) => u.callId === 'r1')?.reason).toBe('no_drivable_route');
    expect(plan.trips.every((t) => t.hospital.id !== 'H2')).toBe(true);
  });

  it('keeps fleet invariants over random scenarios', () => {
    for (let n = 0; n < 50; n++) {
      const rnd = () => Math.random() * 20 - 10;
      const ps: P[] = [
        { id: 'hq', type: 'hq', x: 0, y: 0 },
        ...[1, 2, 3].map((i) => ({ id: `H${i}`, type: 'hospital' as const, x: rnd(), y: rnd() })),
        ...Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, type: 'sos' as const, x: rnd(), y: rnd(), risk: (1 + (i % 3)) as Risk })),
      ];
      const vehicles = Array.from({ length: 1 + Math.floor(Math.random() * 4) }, (_, i) => ({
        id: `V${i}`,
        capacity: 2 + Math.floor(Math.random() * 5),
      }));
      const plan = run(ps, vehicles);
      const served = plan.trips.flatMap((t) => t.stops.map((s) => s.callId));
      expect(new Set(served).size).toBe(served.length);
      expect(served.length + plan.unassigned.length).toBe(20);
      for (const t of plan.trips) {
        expect(t.seatsUsed).toBeLessThanOrEqual(t.capacity);
        expect(t.seatsUsed).toBe(t.stops.length);
        const risks = t.stops.filter((s) => !s.onFoot).map((s) => s.risk);
        expect(risks).toEqual([...risks].sort((a, b) => b - a));
        // Every driven passenger but one boarded while the summed risk was below the cap.
        expect(risks.reduce((s, r) => s + r, 0) - Math.max(...risks)).toBeLessThan(PLAN_DEFAULTS.maxRiskLoad);
      }
      for (const v of vehicles) {
        const mine = plan.trips.filter((t) => t.vehicleId === v.id).sort((a, b) => a.tripNumber - b.tripNumber);
        expect(mine.length).toBeLessThanOrEqual(PLAN_DEFAULTS.maxTripsPerVehicle);
        mine.forEach((t, i) => {
          expect(t.tripNumber).toBe(i + 1);
          if (i === 0) return expect(t.start.id).toBe('hq');
          expect(t.start.id).toBe(mine[i - 1].hospital.id);
          expect(t.departSec).toBeGreaterThanOrEqual(mine[i - 1].hospital.etaSec + PLAN_DEFAULTS.dropoffTimeSec - 1);
        });
      }
      // Calls are only left over once every vehicle has used all its trips.
      if (plan.unassigned.some((u) => u.reason === 'insufficient_capacity'))
        expect(plan.trips.length).toBe(vehicles.length * PLAN_DEFAULTS.maxTripsPerVehicle);
    }
  });
});

describe('planRoutes vehicle start (startId / freeAtSec)', () => {
  it('starts a vehicle at the given marker, free at freeAtSec', () => {
    const plan = run(base, [{ id: 'V1', capacity: 2, startId: 'H2', freeAtSec: 500 }]);
    expect(plan.trips[0]).toMatchObject({ start: { id: 'H2' }, departSec: 500 });
  });

  it('gives the risk-3 call to the idle vehicle when the other is busy', () => {
    const plan = run(base, [
      { id: 'V1', capacity: 2, startId: 'H1', freeAtSec: 3000 },
      { id: 'V2', capacity: 2 },
    ]);
    const first = plan.trips.find((t) => t.stops.some((s) => s.callId === 'r3'))!;
    expect(first.vehicleId).toBe('V2');
  });

  it('throws on an unknown startId', () => {
    expect(() => run(base, [{ id: 'V1', capacity: 2, startId: 'nope' }])).toThrow(/unknown startId/);
  });
});
