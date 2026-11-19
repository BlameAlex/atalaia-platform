import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PLAN_DEFAULTS } from '../config';
import { Marker } from '../scenario';
import { fetchGeometry, fetchMatrix, LngLat } from './osrm';
import { Plan, PlanOptions, planRoutes, Vehicle } from './planner';

type PlanBody = { markers: Marker[]; vehicles: Vehicle[]; options?: Partial<PlanOptions> };

function validate(body: any): { markers: Marker[]; vehicles: Vehicle[]; opts: PlanOptions } {
  const fail = (msg: string): never => {
    throw new BadRequestException(msg);
  };
  const { markers, vehicles, options = {} } = (body ?? {}) as PlanBody;

  if (!Array.isArray(markers) || markers.length < 3 || markers.length > 100) fail('markers: 3-100 items required');
  const ids = new Set<string>();
  for (const m of markers) {
    if (typeof m?.id !== 'string' || ids.has(m.id)) fail('markers: unique string id required');
    ids.add(m.id);
    if (!['hq', 'hospital', 'sos'].includes(m.type)) fail(`marker ${m.id}: bad type`);
    if (!Number.isFinite(m.latitude) || Math.abs(m.latitude) > 90) fail(`marker ${m.id}: bad latitude`);
    if (!Number.isFinite(m.longitude) || Math.abs(m.longitude) > 180) fail(`marker ${m.id}: bad longitude`);
    if (m.type === 'sos' && ![1, 2, 3].includes(m.risk as number)) fail(`marker ${m.id}: risk must be 1-3`);
    if (typeof m.label !== 'string') fail(`marker ${m.id}: label required`);
  }
  if (markers.filter((m) => m.type === 'hq').length !== 1) fail('markers: exactly one hq required');
  if (!markers.some((m) => m.type === 'hospital')) fail('markers: at least one hospital required');

  if (!Array.isArray(vehicles) || vehicles.length < 1 || vehicles.length > 20) fail('vehicles: 1-20 items required');
  const vIds = new Set<string>();
  for (const v of vehicles) {
    if (typeof v?.id !== 'string' || !v.id || vIds.has(v.id)) fail('vehicles: unique non-empty id required');
    vIds.add(v.id);
    if (!Number.isInteger(v.capacity) || v.capacity < 2 || v.capacity > 6) fail(`vehicle ${v.id}: capacity must be 2-6`);
  }

  const opts = { ...PLAN_DEFAULTS };
  for (const [k, v] of Object.entries(options ?? {})) {
    if (!(k in opts)) fail(`options.${k}: unknown option`);
    if (typeof v !== 'number' || !(v >= 0) || !Number.isFinite(v)) fail(`options.${k}: must be a number >= 0`);
    opts[k as keyof PlanOptions] = v as number;
  }
  if (![1, 2, 3].includes(opts.maxTripsPerVehicle)) fail('options.maxTripsPerVehicle: must be 1, 2 or 3');
  return {
    markers: markers.map(({ id, type, label, latitude, longitude, risk }) => ({ id, type, label, latitude, longitude, risk })),
    vehicles: vehicles.map(({ id, capacity }) => ({ id, capacity })),
    opts,
  };
}

@Controller('api')
export class PlanController {
  @Post('plan')
  @HttpCode(200)
  async plan(@Body() body: unknown): Promise<Plan & { trips: { geometry: LngLat[] }[] }> {
    const { markers, vehicles, opts } = validate(body);
    const matrix = await fetchMatrix(markers.map((m) => [m.longitude, m.latitude]));
    const plan = planRoutes(markers, vehicles, matrix, opts);
    const trips = [];
    for (const t of plan.trips) {
      // Sequential on purpose: keeps load on the public OSRM demo server low.
      const pts: LngLat[] = [[t.start.lng, t.start.lat], ...t.stops.filter((s) => !s.onFoot).map((s): LngLat => [s.lng, s.lat]), [t.hospital.lng, t.hospital.lat]];
      trips.push({ ...t, geometry: await fetchGeometry(pts) });
    }
    return { ...plan, trips };
  }
}
