import { Q } from './db';
import { ageAt } from './risk';

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const LABEL = { 1: 'Bajo', 2: 'Medio', 3: 'Alto' } as const;

export function userDto(u: any) {
  return {
    id: u.id,
    phone: u.phone,
    fullName: u.full_name,
    birthDate: u.birth_date,
    addressLine: u.address_line ?? null,
    home: { lat: r6(u.home_lat), lng: r6(u.home_lng), countyFips: u.home_county_fips },
    medicalConditions: u.medical_conditions,
    mobilityNeeds: u.mobility_needs,
    accessibilityNotes: u.accessibility_notes,
    homeRisk: homeRiskDto(u),
    createdAt: iso(u.created_at),
    updatedAt: iso(u.updated_at),
  };
}

export const homeRiskDto = (u: any) => ({
  level: u.home_risk,
  label: LABEL[u.home_risk as 1 | 2 | 3],
  confidence: u.home_risk_confidence,
  requiresReview: u.home_risk_confidence < 70,
  factors: u.home_risk_factors,
  computedAt: iso(u.home_risk_at),
});

/** First word of the name + initial of the last word: "Ana Pérez" -> "Ana P." */
export const personLabel = (full: string) => {
  const w = full.trim().split(/\s+/);
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0].toUpperCase()}.` : w[0];
};

// Incident rows come from INCIDENT_SQL (joined with user, refuge and proposal).
export const INCIDENT_SQL = `
  SELECT i.*, u.full_name, u.birth_date, u.phone, u.mobility_needs,
         p.id AS ref_id, p.label AS ref_label,
         (SELECT rs.route_id FROM route_stops rs JOIN routes pr ON pr.id = rs.route_id
           WHERE rs.incident_id = i.id AND pr.status = 'proposed' LIMIT 1) AS proposed_route_id
    FROM incidents i
    JOIN users u ON u.id = i.user_id
    LEFT JOIN routes r ON r.id = i.route_id
    LEFT JOIN places p ON p.id = COALESCE(i.refuge_id, CASE WHEN i.status IN ('routed','picked_up') THEN r.refuge_id END)`;

export function incidentDto(i: any) {
  return {
    id: i.id,
    status: i.status,
    risk: i.risk,
    countyRisk: i.county_risk,
    vulnerability: i.vulnerability,
    requiresReview: i.requires_review,
    locationSource: i.location_source,
    lat: r6(i.lat),
    lng: r6(i.lng),
    countyFips: i.county_fips,
    routeId: i.route_id ?? null,
    refuge: i.ref_id ? { id: i.ref_id, label: i.ref_label } : null,
    createdAt: iso(i.created_at),
    routedAt: iso(i.routed_at),
    pickedUpAt: iso(i.picked_up_at),
    droppedOffAt: iso(i.dropped_off_at),
  };
}

export const dashboardIncidentDto = (i: any) => ({
  ...incidentDto(i),
  person: { label: personLabel(i.full_name), age: ageAt(i.birth_date, new Date()), phone: i.phone, mobilityNeeds: i.mobility_needs },
  proposedRouteId: i.proposed_route_id ?? null,
  refugeId: i.ref_id ?? null,
});

export const loadIncident = async (c: Q, id: string) => (await c(INCIDENT_SQL + ' WHERE i.id = $1', [id]))[0];
export const loadIncidents = (c: Q, ids: string[]) => (ids.length ? c(INCIDENT_SQL + ' WHERE i.id = ANY($1)', [ids]) : Promise.resolve([]));

export const vehicleDto = (v: any, activeRouteId: string | null) => ({
  id: v.id,
  label: v.label,
  capacity: v.capacity,
  lat: r6(v.lat),
  lng: r6(v.lng),
  activeRouteId,
});

export async function loadVehicles(c: Q) {
  const [vs, active] = await Promise.all([
    c('SELECT * FROM vehicles ORDER BY id'),
    c(`SELECT id, vehicle_id FROM routes WHERE status = 'active'`),
  ]);
  return vs.map((v: any) => vehicleDto(v, active.find((r: any) => r.vehicle_id === v.id)?.id ?? null));
}
export async function loadVehicle(c: Q, id: string) {
  return (await loadVehicles(c)).find((v: any) => v.id === id)!;
}

/**
 * Routes as DTOs. Loads every active/proposed route (needed to derive `start` and `deployable`) plus
 * `extraIds`; returns `ids` if given, otherwise all active + proposed.
 */
export async function buildRoutes(c: Q, version: number, ids?: string[]) {
  const want = ids ?? [];
  const rows: any[] = await c(
    `SELECT r.*, v.capacity FROM routes r JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.status IN ('active','proposed') OR r.id = ANY($1) ORDER BY r.depart_at`,
    [want],
  );
  const [places, vehicles, stops] = await Promise.all([
    c('SELECT * FROM places'),
    c('SELECT * FROM vehicles'),
    c(
      `SELECT s.*, i.risk, i.lat, i.lng FROM route_stops s JOIN incidents i ON i.id = s.incident_id
        WHERE s.route_id = ANY($1) ORDER BY s.pickup_eta, s.seq`,
      [rows.map((r) => r.id)],
    ),
  ]);
  const place = (id: string) => {
    const p = places.find((x: any) => x.id === id);
    return { id: p.id, label: p.label, lat: r6(p.lat), lng: r6(p.lng) };
  };
  const active = new Map(rows.filter((r) => r.status === 'active').map((r) => [r.vehicle_id, r]));
  const prevRefuge = new Map<string, string>(); // route id -> refuge of the vehicle's previous proposed trip
  const firstProposed = new Map<string, string>(); // vehicle -> earliest proposed route id
  const lastByVehicle = new Map<string, any>();
  for (const r of rows.filter((x) => x.status === 'proposed')) {
    const prev = lastByVehicle.get(r.vehicle_id);
    if (prev) prevRefuge.set(r.id, prev.refuge_id);
    else firstProposed.set(r.vehicle_id, r.id);
    lastByVehicle.set(r.vehicle_id, r);
  }
  const startOf = (r: any) => {
    if (r.status !== 'proposed') return null;
    if (prevRefuge.has(r.id)) return place(prevRefuge.get(r.id)!);
    const act = active.get(r.vehicle_id);
    if (act) return place(act.refuge_id);
    const v = vehicles.find((x: any) => x.id === r.vehicle_id);
    return place((places.find((p: any) => p.lat === v.lat && p.lng === v.lng) ?? places.find((p: any) => p.type === 'hq')).id);
  };
  const dtos = rows.map((r) => {
    const st = stops.filter((s: any) => s.route_id === r.id);
    const live = st.filter((s: any) => !s.skipped);
    const start = startOf(r);
    return {
      id: r.id,
      vehicleId: r.vehicle_id,
      status: r.status,
      planVersion: r.plan_version,
      deployable: r.status === 'proposed' && r.plan_version === version && !active.has(r.vehicle_id) && firstProposed.get(r.vehicle_id) === r.id,
      refuge: place(r.refuge_id),
      refugeId: r.refuge_id,
      start,
      departAt: iso(r.depart_at),
      refugeEta: iso(r.refuge_eta),
      seatsUsed: live.length,
      capacity: r.capacity,
      riskLoad: live.reduce((n: number, s: any) => n + s.risk, 0),
      stops: st.map((s: any) => ({
        seq: s.seq,
        incidentId: s.incident_id,
        risk: s.risk,
        pickupEta: iso(s.pickup_eta),
        onFoot: s.on_foot,
        skipped: s.skipped,
        lat: r6(s.lat),
        lng: r6(s.lng),
      })),
      geometry: r.geometry,
      deployedAt: iso(r.deployed_at),
      simDeployedMs: r.sim_deployed_ms == null ? null : Number(r.sim_deployed_ms),
      completedAt: iso(r.completed_at),
    };
  });
  return ids ? dtos.filter((d) => ids.includes(d.id)) : dtos;
}
