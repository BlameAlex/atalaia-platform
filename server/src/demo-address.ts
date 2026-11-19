import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { REPO } from './config';

export type DemoAddress = { street: string; city: string; state: string; zip: string; country: string; lat: number; lng: number; fips: string };

/** Curated Census-verified addresses inside the demo area (BOUNDS); see server/data/demo-addresses.json. */
export const DEMO_POOL: DemoAddress[] = JSON.parse(readFileSync(join(REPO, 'server', 'data', 'demo-addresses.json'), 'utf8'));

/** Same phone always gets the same address: stable across requests without storing extra state. */
export function demoAddressFor(phone: string): DemoAddress {
  const n = createHash('sha256').update(phone).digest().readUInt32BE(0);
  return DEMO_POOL[n % DEMO_POOL.length];
}

export const demoLine = (a: DemoAddress) => `${a.street}, ${a.city}, ${a.state} ${a.zip}`;
