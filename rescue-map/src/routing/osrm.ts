import { ServiceUnavailableException } from '@nestjs/common';
import { OSRM_URL } from '../config';
import { Matrix } from './planner';

export type LngLat = [number, number];

async function osrm(path: string, points: LngLat[], query: string): Promise<any> {
  const coords = points.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  try {
    const res = await fetch(`${OSRM_URL}/${path}/v1/driving/${coords}?${query}`, {
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json();
    if (body.code === 'Ok') return body;
  } catch {
    // fall through
  }
  throw new ServiceUnavailableException('Routing service unavailable');
}

export async function fetchMatrix(points: LngLat[]): Promise<Matrix> {
  const body = await osrm('table', points, 'annotations=duration');
  return { durations: body.durations, snapMeters: body.sources.map((s: { distance: number }) => s.distance) };
}

export async function fetchGeometry(points: LngLat[]): Promise<LngLat[]> {
  const body = await osrm('route', points, 'overview=full&geometries=geojson');
  return body.routes[0].geometry.coordinates;
}
