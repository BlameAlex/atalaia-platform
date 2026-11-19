import { Injectable, OnModuleInit } from '@nestjs/common';
import { PLAN_DEFAULTS } from '../../rescue-map/src/config';
import { fetchGeometry, fetchMatrix, LngLat } from '../../rescue-map/src/routing/osrm';
import { planRoutes, Vehicle, WALK_MPS } from '../../rescue-map/src/routing/planner';
import { Marker } from '../../rescue-map/src/scenario';
import { logStatus, q, Q, tx } from './db';
import { buildRoutes, dashboardIncidentDto, loadIncidents } from './dto';
import { Events } from './events';

const OSRM_TABLE_MAX = 100; // public OSRM table limit; places take slots first (S13)
const DEBOUNCE_MS = () => Number(process.env.PLAN_DEBOUNCE_MS ?? 2000);

const haversine = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * rad) / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLng - aLng) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

type Unassigned = { incidentId: string; reason: string };

@Injectable()
export class Planning implements OnModuleInit {
  version = 0;
  lastUnassigned: Unassigned[] = [];
  osrm: 'ok' | 'down' | 'unknown' = 'unknown';
  private timer?: NodeJS.Timeout;
  private running = false;
  private dirty = false;
  private geoCache = new Map<string, LngLat[]>();

  constructor(private readonly events: Events) {}

  async onModuleInit() {
    const [r] = await q('SELECT COALESCE(max(plan_version), 0) AS v FROM routes');
    this.version = r.v;
    this.schedule();
  }

  /** Debounced. NOTE: in-memory lock, single instance only (S15). */
  schedule(delayMs = DEBOUNCE_MS()) {
    if (this.running) {
      this.dirty = true;
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delayMs);
    this.timer.unref();
  }

  /** Test hook: forget timers and per-run state. */
  reset() {
    clearTimeout(this.timer);
    this.dirty = false;
    this.lastUnassigned = [];
  }

  /** Test hook: run now, after any in-flight run. */
  async runNow() {
    clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 20));
    await this.run();
  }

  async run() {
    if (this.running) return void (this.dirty = true);
    this.running = true;
    let retryMs = 0;
    try {
      await this.insertOnFoot();
      retryMs = await this.plan();
    } catch (e) {
      console.error('planning failed', e);
      retryMs = 30000;
    } finally {
      this.running = false;
      if (retryMs) this.schedule(retryMs);
      else if (this.dirty) {
        this.dirty = false;
        this.schedule();
      }
    }
  }

  /** O8: attach pending incidents to a not-yet-reached stop of an active route as on-foot walkers. */
  private async insertOnFoot() {
    const changed = await tx(async (c) => {
      const routes: any[] = await c(
        `SELECT r.id, v.capacity FROM routes r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.status = 'active' FOR UPDATE OF r`,
      );
      if (!routes.length) return null;
      const pending: any[] = await c(`SELECT id, lat, lng, risk FROM incidents WHERE status = 'pending' ORDER BY risk DESC, created_at ASC`);
      if (!pending.length) return null;
      const stops: any[] = await c(
        `SELECT s.route_id, s.seq, s.incident_id, s.pickup_eta, s.on_foot, s.skipped, i.status, i.lat, i.lng, i.risk
           FROM route_stops s JOIN incidents i ON i.id = s.incident_id WHERE s.route_id = ANY($1)`,
        [routes.map((r) => r.id)],
      );
      const state = new Map(routes.map((r) => {
        const mine = stops.filter((s) => s.route_id === r.id);
        const live = mine.filter((s) => !s.skipped);
        return [r.id as string, { cap: r.capacity as number, seats: live.length, load: live.reduce((n, s) => n + s.risk, 0), maxSeq: Math.max(...mine.map((s) => s.seq)), stops: mine, skipped: new Set(mine.filter((s) => s.skipped).map((s) => s.incident_id)) }];
      }));
      const touchedRoutes = new Set<string>();
      const touchedIncidents: string[] = [];
      for (const inc of pending) {
        let best: { routeId: string; anchor: any; dist: number } | null = null;
        for (const [routeId, st] of state) {
          if (st.seats >= st.cap || st.load + inc.risk >= PLAN_DEFAULTS.maxRiskLoad || st.skipped.has(inc.id)) continue;
          for (const s of st.stops) {
            if (s.on_foot || s.skipped || s.status !== 'routed') continue;
            const dist = haversine(s.lat, s.lng, inc.lat, inc.lng);
            if (dist <= PLAN_DEFAULTS.walkRadiusMeters && (!best || dist < best.dist)) best = { routeId, anchor: s, dist };
          }
        }
        if (!best) continue;
        const st = state.get(best.routeId)!;
        const delta = Math.round((2 * best.dist) / WALK_MPS);
        const anchorEta = new Date(best.anchor.pickup_eta);
        st.maxSeq++;
        await c(`INSERT INTO route_stops(route_id, seq, incident_id, pickup_eta, on_foot) VALUES ($1,$2,$3,$4,true)`, [best.routeId, st.maxSeq, inc.id, anchorEta]);
        await c(
          `UPDATE route_stops SET pickup_eta = pickup_eta + make_interval(secs => $3) WHERE route_id = $1 AND pickup_eta > $2 AND incident_id <> $4`,
          [best.routeId, anchorEta, delta, inc.id],
        );
        await c(`UPDATE routes SET refuge_eta = refuge_eta + make_interval(secs => $2) WHERE id = $1`, [best.routeId, delta]);
        await c(`UPDATE incidents SET status = 'routed', route_id = $2, routed_at = now() WHERE id = $1`, [inc.id, best.routeId]);
        await logStatus(c, { incidentId: inc.id, routeId: best.routeId, from: 'pending', to: 'routed', actor: 'system' });
        for (const s of st.stops) if (new Date(s.pickup_eta) > anchorEta) s.pickup_eta = new Date(+new Date(s.pickup_eta) + delta * 1000);
        st.stops.push({ route_id: best.routeId, seq: st.maxSeq, incident_id: inc.id, pickup_eta: anchorEta, on_foot: true, skipped: false, status: 'routed', lat: inc.lat, lng: inc.lng, risk: inc.risk });
        st.seats++;
        st.load += inc.risk;
        touchedRoutes.add(best.routeId);
        touchedIncidents.push(inc.id);
      }
      return touchedIncidents.length ? { routes: [...touchedRoutes], incidents: touchedIncidents } : null;
    });
    if (!changed) return;
    await this.emitRoutes(changed.routes);
    for (const i of await loadIncidents(q, changed.incidents)) this.events.emit('incident.upserted', dashboardIncidentDto(i));
  }

  async emitRoutes(ids: string[]) {
    for (const r of await buildRoutes(q, this.version, ids)) this.events.emit('route.updated', r);
  }

  /** Snapshot -> OSRM -> planRoutes -> persist. Returns a retry delay in ms (0 = done). */
  private async plan(): Promise<number> {
    const t0 = Date.now();
    const pending: any[] = await q(`SELECT id, lat, lng, risk FROM incidents WHERE status = 'pending' ORDER BY risk DESC, created_at ASC`);
    const places: any[] = await q('SELECT * FROM places ORDER BY id');
    const cap = OSRM_TABLE_MAX - places.length;
    const used = pending.slice(0, cap);
    const deferred = pending.slice(cap).map((i) => ({ incidentId: i.id, reason: 'deferred' }));
    const vehicles: any[] = await q('SELECT * FROM vehicles ORDER BY id');
    const active: any[] = await q(`SELECT id, vehicle_id, refuge_id, refuge_eta FROM routes WHERE status = 'active'`);

    const markers: Marker[] = [
      ...places.map((p): Marker => ({ id: p.id, type: p.type === 'hq' ? 'hq' : 'hospital', label: p.label, latitude: p.lat, longitude: p.lng })),
      ...used.map((i): Marker => ({ id: i.id, type: 'sos', label: 'SOS ' + String(i.id).slice(0, 8), latitude: i.lat, longitude: i.lng, risk: i.risk })),
    ];
    const fleet: Vehicle[] = vehicles.map((v) => {
      const act = active.find((r) => r.vehicle_id === v.id);
      if (act) {
        return { id: v.id, capacity: v.capacity, startId: act.refuge_id, freeAtSec: Math.max(0, (+new Date(act.refuge_eta) - t0) / 1000) + PLAN_DEFAULTS.dropoffTimeSec };
      }
      const at = places.find((p) => p.lat === v.lat && p.lng === v.lng);
      return { id: v.id, capacity: v.capacity, startId: at?.id ?? 'hq' };
    });

    let trips: { vehicleId: string; start: any; departSec: number; hospital: any; stops: any[]; geometry: LngLat[] }[] = [];
    let unassigned: Unassigned[] = [];
    if (used.length) {
      try {
        const matrix = await fetchMatrix(markers.map((m): LngLat => [m.longitude, m.latitude]));
        const plan = planRoutes(markers, fleet, matrix, PLAN_DEFAULTS);
        for (const t of plan.trips) {
          const pts: LngLat[] = [[t.start.lng, t.start.lat], ...t.stops.filter((s) => !s.onFoot).map((s): LngLat => [s.lng, s.lat]), [t.hospital.lng, t.hospital.lat]];
          const key = JSON.stringify(pts);
          let geometry = this.geoCache.get(key);
          if (!geometry) {
            geometry = await fetchGeometry(pts);
            if (this.geoCache.size > 500) this.geoCache.clear();
            this.geoCache.set(key, geometry);
          }
          trips.push({ vehicleId: t.vehicleId, start: t.start, departSec: t.departSec, hospital: t.hospital, stops: t.stops, geometry });
        }
        unassigned = plan.unassigned.map((u) => ({ incidentId: u.callId, reason: u.reason }));
        this.osrm = 'ok';
      } catch (e) {
        console.error('osrm/plan failed:', (e as Error).message);
        this.osrm = 'down';
        return 30000;
      }
    }
    unassigned.push(...deferred);

    const ids = await tx(async (c: Q) => {
      if (used.length) {
        const still = await c(`SELECT id FROM incidents WHERE id = ANY($1) AND status = 'pending'`, [used.map((i) => i.id)]);
        if (still.length !== used.length) return null;
      }
      const act = await c(`SELECT id FROM routes WHERE status = 'active'`);
      if (act.length !== active.length || !act.every((r: any) => active.some((a) => a.id === r.id))) return null;
      await c(`UPDATE routes SET status = 'superseded' WHERE status = 'proposed'`);
      this.version++;
      const out: string[] = [];
      for (const t of trips) {
        const [r] = await c(
          `INSERT INTO routes(vehicle_id, status, plan_version, refuge_id, depart_at, refuge_eta, geometry)
           VALUES ($1,'proposed',$2,$3,$4,$5,$6) RETURNING id`,
          [t.vehicleId, this.version, t.hospital.id, new Date(t0 + t.departSec * 1000), new Date(t0 + t.hospital.etaSec * 1000), JSON.stringify(t.geometry)],
        );
        let seq = 0;
        for (const s of t.stops) {
          await c(`INSERT INTO route_stops(route_id, seq, incident_id, pickup_eta, on_foot) VALUES ($1,$2,$3,$4,$5)`, [r.id, seq++, s.callId, new Date(t0 + s.pickupEtaSec * 1000), s.onFoot]);
        }
        out.push(r.id);
      }
      return out;
    });
    if (!ids) {
      this.dirty = true;
      return 0;
    }
    this.lastUnassigned = unassigned;
    const routes = await buildRoutes(q, this.version, ids);
    this.events.emit('routes.replaced', { planVersion: this.version, routes, unassigned });
    return 0;
  }
}
