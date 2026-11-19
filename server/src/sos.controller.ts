import { Body, Controller, Get, Headers, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { BearerGuard } from './auth';
import { q, tx, logStatus } from './db';
import { dashboardIncidentDto, incidentDto, INCIDENT_SQL, loadIncident } from './dto';
import { Events } from './events';
import { fail } from './errors';
import { BOUNDS, env } from './config';
import { countyAt } from './geocode';
import { Planning } from './planning';
import { incidentRisk, RiskBridge, vulnerability } from './risk';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const OPEN = `status NOT IN ('dropped_off','dismissed')`;
// Simulated-user marker, same string as POOL_MARKER in tools/simulate-sos.mjs (its ensurePool registers them).
export const POOL_MARKER = 'Usuario de demostración (simulación)';
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

@Controller('sos')
@UseGuards(BearerGuard)
export class SosController {
  constructor(private readonly risk: RiskBridge, private readonly events: Events, private readonly planning: Planning) {}

  private async existing(userId: string, key: string) {
    const [a] = await q(`SELECT id FROM incidents WHERE user_id = $1 AND client_request_id = $2`, [userId, key]);
    const [b] = a ? [a] : await q(`SELECT id FROM incidents WHERE user_id = $1 AND ${OPEN}`, [userId]);
    return b ? incidentDto(await loadIncident(q, b.id)) : null;
  }

  @Post()
  async create(@Body() body: any, @Headers('idempotency-key') key: string | undefined, @Req() req: any, @Res({ passthrough: true }) res: any) {
    if (!key || !UUID.test(key)) fail(400, 'invalid_idempotency_key');
    if (!req.auth.userId) fail(403, 'no_user');
    return this.createFor(req.auth.userId, key, body, res);
  }

  /** Demo only: SOS for a random free pool user at a random point in BOUNDS, through the normal pipeline. */
  @Post('demo')
  async demo(@Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: any) {
    if (!env.demoSkipOtp) fail(404, 'not_found');
    if (!key || !UUID.test(key)) fail(400, 'invalid_idempotency_key');
    const [prev] = await q(
      `SELECT i.user_id FROM incidents i JOIN users u ON u.id = i.user_id WHERE i.client_request_id = $1 AND u.accessibility_notes = $2`,
      [key, POOL_MARKER],
    );
    if (prev) return this.createFor(prev.user_id, key, {}, res); // retry of the same press: same user, same incident
    const [u] = await q(
      `SELECT id FROM users u WHERE accessibility_notes = $1
         AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.user_id = u.id AND i.${OPEN}) ORDER BY random() LIMIT 1`,
      [POOL_MARKER],
    );
    if (!u) {
      const [any] = await q(`SELECT 1 FROM users WHERE accessibility_notes = $1 LIMIT 1`, [POOL_MARKER]);
      fail(409, any ? 'demo_pool_busy' : 'demo_pool_missing');
    }
    const b = BOUNDS;
    const point = { lat: r6(b.south + Math.random() * (b.north - b.south)), lng: r6(b.west + Math.random() * (b.east - b.west)), accuracyM: 10 };
    return this.createFor(u.id, key, point, res);
  }

  private async createFor(userId: string, key: string, body: any, res: any) {
    const found = await this.existing(userId, key);
    if (found) {
      res.status(200);
      return { incident: found };
    }

    const [u] = await q('SELECT * FROM users WHERE id = $1', [userId]);
    const { lat, lng, accuracyM } = body ?? {};
    const fix = num(lat) && num(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (!num(accuracyM) || accuracyM <= 100);
    let at = { lat: u.home_lat as number, lng: u.home_lng as number, fips: u.home_county_fips as string };
    let source: 'device' | 'home' = 'home';
    let countyRisk: number = u.home_risk;
    let review: boolean = u.home_risk_confidence < 70;
    if (fix) {
      source = 'device';
      at = { lat, lng, fips: u.home_county_fips };
      review = true; // stays true unless both lookups succeed
      try {
        const fips = await countyAt(lat, lng);
        if (fips) {
          const p = await this.risk.predict(fips);
          at.fips = fips;
          countyRisk = p.level;
          review = p.requiresReview;
        }
      } catch {
        // no lookup failure ever fails an SOS: keep the device fix, use the home county
      }
    }
    const vuln = vulnerability({ birthDate: u.birth_date, medicalConditions: u.medical_conditions, mobilityNeeds: u.mobility_needs });
    const risk = incidentRisk(countyRisk, vuln);

    const created = await tx(async (c) => {
      const [row] = await c(
        `INSERT INTO incidents(user_id, client_request_id, lat, lng, location_source, county_fips, county_risk, vulnerability, risk, requires_review)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`,
        [userId, key, at.lat, at.lng, source, at.fips, countyRisk, vuln, risk, review],
      );
      if (!row) return null;
      await logStatus(c, { incidentId: row.id, from: null, to: 'pending', actor: 'mobile' });
      return row.id as string;
    });
    if (!created) {
      const again = await this.existing(userId, key);
      if (!again) fail(409, 'status_conflict');
      res.status(200);
      return { incident: again };
    }
    const [row] = await q(INCIDENT_SQL + ' WHERE i.id = $1', [created]);
    this.events.emit('incident.upserted', dashboardIncidentDto(row));
    this.planning.schedule();
    res.status(201);
    return { incident: incidentDto(row) };
  }

  @Get('current')
  @HttpCode(200)
  async current(@Req() req: any) {
    if (!req.auth.userId) fail(403, 'no_user');
    const [row] = await q(
      INCIDENT_SQL +
        ` WHERE i.user_id = $1 AND (i.status NOT IN ('dropped_off','dismissed')
            OR (i.status = 'dropped_off' AND i.dropped_off_at > now() - interval '12 hours')
            OR (i.status = 'dismissed' AND EXISTS (SELECT 1 FROM status_updates s WHERE s.incident_id = i.id AND s.to_status = 'dismissed' AND s.at > now() - interval '12 hours')))
          ORDER BY (i.status NOT IN ('dropped_off','dismissed')) DESC, i.created_at DESC LIMIT 1`,
      [req.auth.userId],
    );
    return { incident: row ? incidentDto(row) : null };
  }
}
