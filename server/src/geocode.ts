import { readFileSync } from 'fs';
import { join } from 'path';
import { REPO, env } from './config';
import { fail } from './errors';

type Geo = { lat: number; lng: number; fips: string };

/** Home address -> coordinates + county (Census onelineaddress). */
export async function geocodeAddress(line: string): Promise<Geo> {
  const url =
    `${env.censusUrl}/geocoder/geographies/onelineaddress?address=${encodeURIComponent(line)}` +
    `&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
  let body: any;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    body = await res.json();
  } catch {
    return fail(503, 'geocoder_unavailable');
  }
  const m = body?.result?.addressMatches?.[0];
  const fips = m?.geographies?.Counties?.[0]?.GEOID;
  if (!m || !fips) return fail(422, 'address_not_found');
  return { lat: m.coordinates.y, lng: m.coordinates.x, fips };
}

// County lookup: local point-in-polygon over Census TIGER boundaries (won the bake-off against the
// Census coordinates endpoint: p95 0.035 ms vs 3001 ms, 0 vs 35 failures in 200 points).
// NOTE: only knows the demo counties; a point outside returns null (callers fall back to the home county).
type Ring = [number, number][];
type Poly = { fips: string; rings: Ring[]; box: [number, number, number, number] };
const polys: Poly[] = [];
for (const f of JSON.parse(readFileSync(join(REPO, 'server', 'data', 'counties.geojson'), 'utf8')).features) {
  const list: Ring[][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const rings of list) {
    const xs = rings[0].map((p) => p[0]);
    const ys = rings[0].map((p) => p[1]);
    polys.push({ fips: f.properties.GEOID, rings, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
}
const inRing = (x: number, y: number, r: Ring) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  return inside;
};

const exactCounty = (lat: number, lng: number) => {
  for (const p of polys) {
    if (lng < p.box[0] || lng > p.box[2] || lat < p.box[1] || lat > p.box[3]) continue;
    if (inRing(lng, lat, p.rings[0]) && !p.rings.slice(1).some((h) => inRing(lng, lat, h))) return p.fips;
  }
  return null;
};

// The simplified boundaries leave ~50 m slivers along shared county edges; on a miss, take a county ~110 m away.
const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [a * 0.001, b * 0.001]);

export async function countyAt(lat: number, lng: number): Promise<string | null> {
  return exactCounty(lat, lng) ?? NEAR.reduce<string | null>((f, [dy, dx]) => f ?? exactCounty(lat + dy, lng + dx), null);
}
