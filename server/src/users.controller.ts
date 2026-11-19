import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { BearerGuard } from './auth';
import { q, tx } from './db';
import { userDto } from './dto';
import { fail, invalid } from './errors';
import { env } from './config';
import { demoAddressFor, demoLine, type DemoAddress } from './demo-address';
import { countyAt, geocodeAddress } from './geocode';
import { CountyUnknown, RiskBridge, RiskUnavailable } from './risk';

const MOBILITY = ['wheelchair', 'limited walking', 'bedridden', 'blind or low vision', 'deaf or hard of hearing', 'oxygen or powered equipment', 'other'];
const str = (v: unknown, min: number, max: number) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

type Fields = {
  fullName?: string; birthDate?: string; addressLine?: string; homeLocation?: { lat: number; lng: number };
  medicalConditions?: { name: string; critical: boolean }[]; mobilityNeeds?: string[]; accessibilityNotes?: string;
};

function parse(b: any, post: boolean): Fields {
  if (!b || typeof b !== 'object') return invalid('fullName');
  const o: Fields = {};
  if (b.fullName !== undefined || post) {
    if (!str(b.fullName, 1, 120)) invalid('fullName');
    o.fullName = b.fullName.trim();
  }
  if (b.birthDate !== undefined || post) {
    const ok = typeof b.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.birthDate) && !isNaN(Date.parse(b.birthDate + 'T00:00:00Z')) &&
      new Date(b.birthDate + 'T00:00:00Z').toISOString().startsWith(b.birthDate) && b.birthDate >= '1900-01-01' && b.birthDate <= new Date().toISOString().slice(0, 10);
    if (!ok) invalid('birthDate');
    o.birthDate = b.birthDate;
  }
  const hasAddr = b.addressLine !== undefined && b.addressLine !== null;
  const hasLoc = b.homeLocation !== undefined && b.homeLocation !== null;
  if (hasAddr && hasLoc) invalid('addressLine');
  if (post && !hasAddr && !hasLoc) invalid('addressLine');
  if (hasAddr) {
    if (!str(b.addressLine, 5, 200)) invalid('addressLine');
    o.addressLine = b.addressLine.trim();
  }
  if (hasLoc) {
    const { lat, lng } = b.homeLocation ?? {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) invalid('homeLocation');
    o.homeLocation = { lat, lng };
  }
  if (b.medicalConditions !== undefined || post) {
    const m = b.medicalConditions ?? [];
    if (!Array.isArray(m) || m.length > 20 || !m.every((c) => c && str(c.name, 1, 80) && typeof c.critical === 'boolean')) invalid('medicalConditions');
    o.medicalConditions = m.map((c: any) => ({ name: c.name.trim(), critical: c.critical }));
  }
  if (b.mobilityNeeds !== undefined || post) {
    const m = b.mobilityNeeds ?? [];
    if (!Array.isArray(m) || m.length > 7 || new Set(m).size !== m.length || !m.every((x) => MOBILITY.includes(x))) invalid('mobilityNeeds');
    o.mobilityNeeds = m;
  }
  if (b.accessibilityNotes !== undefined) {
    if (b.accessibilityNotes === null) b.accessibilityNotes = ''; // optional field: null = empty
    if (typeof b.accessibilityNotes !== 'string' || b.accessibilityNotes.length > 500) invalid('accessibilityNotes');
    o.accessibilityNotes = b.accessibilityNotes;
  }
  return o;
}

/** Demo only (env.demoAddress): swap the typed address for the user's pool address, before any comparison or geocoding. */
function demoSubstitute(f: Fields, phone: string): DemoAddress | null {
  if (!env.demoAddress || f.addressLine === undefined) return null;
  const a = demoAddressFor(phone);
  f.addressLine = demoLine(a);
  return a;
}

@Controller('users')
@UseGuards(BearerGuard)
export class UsersController {
  constructor(private readonly risk: RiskBridge) {}

  /** Address or coordinates -> {lat, lng, fips} -> home risk. Runs outside any transaction. */
  private async resolveHome(f: Fields, demo: DemoAddress | null) {
    let geo: { lat: number; lng: number; fips: string };
    if (demo) geo = { lat: demo.lat, lng: demo.lng, fips: demo.fips };
    else if (f.addressLine) geo = await geocodeAddress(f.addressLine);
    else {
      const fips = await countyAt(f.homeLocation!.lat, f.homeLocation!.lng);
      if (!fips) return fail(422, 'address_not_found');
      geo = { ...f.homeLocation!, fips };
    }
    try {
      return { ...geo, pred: await this.risk.predict(geo.fips) };
    } catch (e) {
      if (e instanceof RiskUnavailable) return fail(503, 'risk_unavailable');
      if (e instanceof CountyUnknown) return fail(422, 'address_not_found');
      throw e;
    }
  }

  @Post()
  async create(@Body() body: any, @Req() req: any) {
    const f = parse(body, true);
    if (req.auth.userId) fail(409, 'already_registered');
    if ((await q('SELECT 1 FROM users WHERE phone = $1', [req.auth.phone])).length) fail(409, 'already_registered');
    const h = await this.resolveHome(f, demoSubstitute(f, req.auth.phone));
    const user = await tx(async (c) => {
      let u;
      try {
        [u] = await c(
          `INSERT INTO users(phone, full_name, birth_date, address_line, home_lat, home_lng, home_county_fips, medical_conditions,
             mobility_needs, accessibility_notes, home_risk, home_risk_confidence, home_risk_factors, home_risk_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now()) RETURNING *`,
          [req.auth.phone, f.fullName, f.birthDate, f.addressLine ?? null, h.lat, h.lng, h.fips, JSON.stringify(f.medicalConditions),
           f.mobilityNeeds, f.accessibilityNotes ?? '', h.pred.level, h.pred.confidence, JSON.stringify(h.pred.factors)],
        );
      } catch (e: any) {
        if (e.code === '23505') return fail(409, 'already_registered');
        throw e;
      }
      const bound = await c(`UPDATE devices SET user_id = $1 WHERE id = $2 AND user_id IS NULL RETURNING id`, [u.id, req.auth.deviceId]);
      if (!bound.length) return fail(409, 'already_registered');
      // other unbound tokens of the same phone belong to this user too
      await c(`UPDATE devices SET user_id = $1 WHERE phone = $2 AND user_id IS NULL`, [u.id, req.auth.phone]);
      return u;
    });
    const dto = userDto(user);
    return { user: dto, homeRisk: dto.homeRisk };
  }

  @Get('me')
  async me(@Req() req: any) {
    if (!req.auth.userId) fail(404, 'no_user');
    const [u] = await q('SELECT * FROM users WHERE id = $1', [req.auth.userId]);
    return { user: userDto(u) };
  }

  @Patch('me')
  @HttpCode(200)
  async patch(@Body() body: any, @Req() req: any) {
    if (!req.auth.userId) fail(404, 'no_user');
    const f = parse(body, false);
    const demo = demoSubstitute(f, req.auth.phone);
    const [cur] = await q('SELECT * FROM users WHERE id = $1', [req.auth.userId]);
    const set: Record<string, unknown> = {};
    if (f.fullName !== undefined) set.full_name = f.fullName;
    if (f.birthDate !== undefined) set.birth_date = f.birthDate;
    if (f.medicalConditions !== undefined) set.medical_conditions = JSON.stringify(f.medicalConditions);
    if (f.mobilityNeeds !== undefined) set.mobility_needs = f.mobilityNeeds;
    if (f.accessibilityNotes !== undefined) set.accessibility_notes = f.accessibilityNotes;
    if (f.homeLocation || (f.addressLine !== undefined && f.addressLine !== cur.address_line)) {
      const h = await this.resolveHome(f, demo);
      Object.assign(set, {
        address_line: f.addressLine ?? null, home_lat: h.lat, home_lng: h.lng, home_county_fips: h.fips,
        home_risk: h.pred.level, home_risk_confidence: h.pred.confidence, home_risk_factors: JSON.stringify(h.pred.factors),
        home_risk_at: new Date(),
      });
    }
    const keys = Object.keys(set);
    const sql = `UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 2}`).concat('updated_at = now()').join(', ')} WHERE id = $1 RETURNING *`;
    const [u] = await q(sql, [req.auth.userId, ...keys.map((k) => set[k])]);
    return { user: userDto(u) };
  }
}
