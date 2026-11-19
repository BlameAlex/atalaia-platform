import { Body, Controller, Get, HttpCode, HttpException, MessageEvent, OnModuleDestroy, OnModuleInit, Param, Post, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { BOUNDS, env } from './config';
import { DispatchGuard } from './auth';
import { Actor, logStatus, q, Q, tx } from './db';
import { buildRoutes, dashboardIncidentDto, INCIDENT_SQL, loadIncidents, loadVehicle, loadVehicles } from './dto';
import { fail, invalid, uuid } from './errors';
import { Events } from './events';
import { Planning } from './planning';
import { Sim } from './sim';

const conflict = (expected: string, actual: string): never => fail(409, 'status_conflict', { expected, actual });

function noteOf(b: any): string | null {
  if (b?.note === undefined || b.note === null) return null;
  if (typeof b.note !== 'string' || b.note.length > 500) invalid('note');
  return b.note;
}

@Controller()
@UseGuards(DispatchGuard)
export class DispatchController implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(private readonly events: Events, private readonly planning: Planning, private readonly sim: Sim) {}

  onModuleInit() {
    if (env.demoSim && env.simTickMs > 0) {
      this.timer = setInterval(() => void this.tick(), env.simTickMs);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  @Get('dashboard/state')
  async state() {
    const seq = this.events.seq; // read first: events raised during the snapshot get a higher seq
    const [places, vehicles, incidents, routes] = await Promise.all([
      q('SELECT id, type, label, lat, lng FROM places ORDER BY id'),
      loadVehicles(q),
      q(INCIDENT_SQL + ` WHERE i.status NOT IN ('dropped_off','dismissed') ORDER BY i.created_at`),
      buildRoutes(q, this.planning.version),
    ]);
    return {
      seq,
      planVersion: this.planning.version,
      serverTime: new Date().toISOString(),
      bounds: BOUNDS,
      places,
      vehicles,
      incidents: incidents.map(dashboardIncidentDto),
      routes,
      unassigned: this.planning.lastUnassigned,
      sim: this.sim.dto(),
    };
  }

  @Sse('dashboard/events')
  stream(): Observable<MessageEvent> {
    return new Observable((sub) => {
      const s = this.events.subject.subscribe((m) => sub.next({ type: m.type, id: m.id, data: m.data }));
      return () => s.unsubscribe();
    });
  }

  /** Common tail of every transition: emit after COMMIT, then replan. */
  private async publish(e: { incidents?: string[]; routes?: string[]; vehicles?: string[] }) {
    if (e.routes?.length) await this.planning.emitRoutes(e.routes);
    for (const i of await loadIncidents(q, e.incidents ?? [])) this.events.emit('incident.upserted', dashboardIncidentDto(i));
    for (const id of e.vehicles ?? []) this.events.emit('vehicle.updated', await loadVehicle(q, id));
    this.planning.schedule();
  }

  @Post('routes/:id/deploy')
  @HttpCode(200)
  async deploy(@Param('id') id: string, @Body() body: any) {
    uuid(id);
    if (!Number.isInteger(body?.planVersion)) invalid('planVersion');
    const out = await tx(async (c: Q) => {
      const [r] = await c('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [id]);
      if (!r) return fail(404, 'not_found');
      if (r.status !== 'proposed' || r.plan_version !== body.planVersion || r.plan_version !== this.planning.version) return fail(409, 'plan_changed');
      const [busy] = await c(`SELECT 1 FROM routes WHERE vehicle_id = $1 AND status = 'active'`, [r.vehicle_id]);
      const [first] = await c(`SELECT id FROM routes WHERE vehicle_id = $1 AND status = 'proposed' ORDER BY depart_at, created_at LIMIT 1`, [r.vehicle_id]);
      if (busy || first.id !== id) return fail(409, 'not_deployable');
      const stops = (await c('SELECT incident_id FROM route_stops WHERE route_id = $1 AND NOT skipped', [id])).map((s: any) => s.incident_id);
      const moved = await c(
        `UPDATE incidents SET status = 'routed', route_id = $2, routed_at = now() WHERE id = ANY($1) AND status = 'pending' RETURNING id`,
        [stops, id],
      );
      if (moved.length !== stops.length) return conflict('pending', 'other');
      for (const s of stops) await logStatus(c, { incidentId: s, routeId: id, from: 'pending', to: 'routed', actor: 'dispatcher' });
      try {
        await c(`UPDATE routes SET status = 'active', deployed_at = now(), sim_deployed_ms = $2 WHERE id = $1`, [id, this.sim.simMs()]);
      } catch (e: any) {
        if (e.code === '23505') return fail(409, 'not_deployable');
        throw e;
      }
      return { stops, vehicleId: r.vehicle_id as string };
    });
    await this.publish({ routes: [id], incidents: out.stops, vehicles: [out.vehicleId] });
    return { route: (await buildRoutes(q, this.planning.version, [id]))[0] };
  }

  @Post('routes/:id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    uuid(id);
    const out = await tx(async (c: Q) => {
      const [r] = await c('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [id]);
      if (!r) return fail(404, 'not_found');
      if (r.status !== 'active') return conflict('active', r.status);
      const inc: any[] = await c(`SELECT i.id, i.status FROM route_stops s JOIN incidents i ON i.id = s.incident_id WHERE s.route_id = $1 AND NOT s.skipped FOR UPDATE OF i`, [id]);
      if (inc.some((i) => i.status === 'picked_up')) return conflict('routed', 'picked_up');
      const back = inc.filter((i) => i.status === 'routed').map((i) => i.id as string);
      await c(`UPDATE incidents SET status = 'pending', route_id = NULL, routed_at = NULL WHERE id = ANY($1)`, [back]);
      for (const i of back) await logStatus(c, { incidentId: i, routeId: id, from: 'routed', to: 'pending', actor: 'dispatcher' });
      await c(`UPDATE routes SET status = 'cancelled' WHERE id = $1`, [id]);
      return { back, vehicleId: r.vehicle_id as string };
    });
    await this.publish({ routes: [id], incidents: out.back, vehicles: [out.vehicleId] });
    return { route: (await buildRoutes(q, this.planning.version, [id]))[0] };
  }

  /** Locks one incident, checks it is in one of `from`, and applies the transition. */
  private async incidentTx(id: string, from: string[], to: string, note: string | null, extra: (c: Q, inc: any) => Promise<void>, actor: Actor = 'dispatcher') {
    uuid(id);
    const out = await tx(async (c: Q) => {
      const [i] = await c('SELECT * FROM incidents WHERE id = $1 FOR UPDATE', [id]);
      if (!i) return fail(404, 'not_found');
      if (!from.includes(i.status)) return conflict(from.join('|'), i.status);
      await extra(c, i);
      await logStatus(c, { incidentId: id, routeId: i.route_id, from: i.status, to, actor, note });
      return i;
    });
    await this.publish({ incidents: [id], routes: out.route_id && to !== 'picked_up' ? [out.route_id] : [] });
    return { incident: dashboardIncidentDto((await loadIncidents(q, [id]))[0]) };
  }

  @Post('incidents/:id/picked-up')
  @HttpCode(200)
  pickedUp(@Param('id') id: string) {
    return this.pickUp(id, 'dispatcher');
  }
  private pickUp(id: string, actor: Actor) {
    return this.incidentTx(id, ['routed'], 'picked_up', null, async (c) => void (await c(`UPDATE incidents SET status = 'picked_up', picked_up_at = now() WHERE id = $1`, [id])), actor);
  }

  @Post('incidents/:id/not-found')
  @HttpCode(200)
  notFound(@Param('id') id: string, @Body() body: any) {
    return this.markNotFound(id, noteOf(body), 'dispatcher');
  }
  private markNotFound(id: string, note: string | null, actor: Actor) {
    return this.incidentTx(id, ['routed'], 'pending', note, async (c, i) => {
      await c(`UPDATE incidents SET status = 'pending', route_id = NULL, routed_at = NULL WHERE id = $1`, [id]);
      await c(`UPDATE route_stops SET skipped = true WHERE route_id = $1 AND incident_id = $2`, [i.route_id, id]);
    }, actor);
  }

  @Post('incidents/:id/dismiss')
  @HttpCode(200)
  dismiss(@Param('id') id: string, @Body() body: any) {
    return this.incidentTx(id, ['pending', 'routed'], 'dismissed', noteOf(body), async (c, i) => {
      await c(`UPDATE incidents SET status = 'dismissed' WHERE id = $1`, [id]);
      if (i.status === 'routed') await c(`UPDATE route_stops SET skipped = true WHERE route_id = $1 AND incident_id = $2`, [i.route_id, id]);
    });
  }

  @Post('routes/:id/arrived')
  @HttpCode(200)
  arrived(@Param('id') id: string) {
    return this.arrive(id, 'dispatcher');
  }
  private async arrive(id: string, actor: Actor) {
    uuid(id);
    const out = await tx(async (c: Q) => {
      const [r] = await c('SELECT * FROM routes WHERE id = $1 FOR UPDATE', [id]);
      if (!r) return fail(404, 'not_found');
      if (r.status !== 'active') return conflict('active', r.status);
      const inc: any[] = await c(`SELECT i.id, i.status FROM route_stops s JOIN incidents i ON i.id = s.incident_id WHERE s.route_id = $1 AND NOT s.skipped FOR UPDATE OF i`, [id]);
      const bad = inc.find((i) => i.status !== 'picked_up');
      if (bad) return conflict('picked_up', bad.status);
      const ids = inc.map((i) => i.id as string);
      await c(`UPDATE incidents SET status = 'dropped_off', refuge_id = $2, dropped_off_at = now() WHERE id = ANY($1)`, [ids, r.refuge_id]);
      for (const i of ids) await logStatus(c, { incidentId: i, routeId: id, from: 'picked_up', to: 'dropped_off', actor });
      await c(`UPDATE routes SET status = 'completed', completed_at = now() WHERE id = $1`, [id]);
      await c(`UPDATE vehicles v SET lat = p.lat, lng = p.lng FROM places p WHERE p.id = $2 AND v.id = $1`, [r.vehicle_id, r.refuge_id]);
      return { ids, vehicleId: r.vehicle_id as string };
    });
    await this.publish({ routes: [id], incidents: out.ids, vehicles: [out.vehicleId] });
    return { route: (await buildRoutes(q, this.planning.version, [id]))[0] };
  }

  @Post('sim/speed')
  @HttpCode(200)
  async speed(@Body() body: any) {
    if (!env.demoSim) return fail(404, 'not_found');
    const v = body?.speed;
    if (!Number.isInteger(v) || v < 1 || v > 5) invalid('speed');
    await this.sim.setSpeed(v);
    return { sim: this.sim.dto() };
  }

  /**
   * Demo driver: advances every simulated active route to the sim clock. Stops due by now are resolved in
   * order (99% picked up, 1% not found), then the refuge arrival completes the trip. Only this loop acts, and
   * every transition re-checks state under a row lock, so a stop is never processed twice; a dispatcher who
   * acted first just makes our call a 409, which we skip.
   */
  async tick(now = Date.now()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const t = this.sim.simMs(now);
      const routes: any[] = await q(`SELECT id, depart_at, refuge_eta, sim_deployed_ms FROM routes WHERE status = 'active' AND sim_deployed_ms IS NOT NULL`);
      if (!routes.length) return;
      const stops: any[] = await q(
        `SELECT s.route_id, s.incident_id, s.pickup_eta, s.skipped, i.status FROM route_stops s JOIN incidents i ON i.id = s.incident_id
          WHERE s.route_id = ANY($1) ORDER BY s.pickup_eta, s.seq`,
        [routes.map((r) => r.id)],
      );
      for (const r of routes) {
        const depart = +new Date(r.depart_at);
        const elapsed = t - Number(r.sim_deployed_ms);
        const live = stops.filter((s) => s.route_id === r.id && !s.skipped);
        for (const s of live) {
          if (s.status !== 'routed' || +new Date(s.pickup_eta) - depart > elapsed) continue;
          const found = this.sim.rand() < 0.99;
          if (await this.quiet(() => (found ? this.pickUp(s.incident_id, 'system') : this.markNotFound(s.incident_id, 'simulación', 'system')))) {
            s.status = found ? 'picked_up' : 'pending';
          }
        }
        const done = live.every((s) => s.status === 'picked_up' || s.status === 'pending');
        if (done && elapsed >= +new Date(r.refuge_eta) - depart) await this.quiet(() => this.arrive(r.id, 'system'));
      }
    } catch (e) {
      console.error('sim tick failed', e);
    } finally {
      this.ticking = false;
    }
  }

  /** Runs a transition; a 404/409 means someone else already moved it, so it's skipped. */
  private async quiet(fn: () => Promise<unknown>) {
    try {
      await fn();
      return true;
    } catch (e) {
      if (e instanceof HttpException && [404, 409].includes(e.getStatus())) return false;
      throw e;
    }
  }
}
