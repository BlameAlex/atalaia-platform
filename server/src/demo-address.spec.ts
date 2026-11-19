import { BOUNDS } from './config';
import { DEMO_POOL, demoAddressFor, demoLine } from './demo-address';
import { countyAt } from './geocode';

describe('demo address pool', () => {
  it('has enough unique entries', () => {
    expect(DEMO_POOL.length).toBeGreaterThanOrEqual(15);
    expect(new Set(DEMO_POOL.map(demoLine)).size).toBe(DEMO_POOL.length);
  });

  it.each(DEMO_POOL.map((a) => [demoLine(a), a] as const))('%s is geographically consistent', async (_, a) => {
    expect(a.state).toBe('TX');
    expect(a.country).toBe('United States');
    expect(a.zip).toMatch(/^77\d{3}$/);
    expect(a.lat).toBeGreaterThanOrEqual(BOUNDS.south);
    expect(a.lat).toBeLessThanOrEqual(BOUNDS.north);
    expect(a.lng).toBeGreaterThanOrEqual(BOUNDS.west);
    expect(a.lng).toBeLessThanOrEqual(BOUNDS.east);
    expect(await countyAt(a.lat, a.lng)).toBe(a.fips); // county known to the classifier
  });

  it('is deterministic per phone and spreads across users', () => {
    expect(demoAddressFor('+15551230001')).toBe(demoAddressFor('+15551230001'));
    const picks = new Set(Array.from({ length: 50 }, (_, i) => demoLine(demoAddressFor(`+1555123${String(i).padStart(4, '0')}`))));
    expect(picks.size).toBeGreaterThan(5);
  });
});

describe('demo SOS area', () => {
  it('every point of BOUNDS lies in a county the classifier knows (mobile demo SOS samples it uniformly)', async () => {
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 20; j++) {
        const lat = BOUNDS.south + (i / 20) * (BOUNDS.north - BOUNDS.south);
        const lng = BOUNDS.west + (j / 20) * (BOUNDS.east - BOUNDS.west);
        expect([lat, lng, await countyAt(lat, lng)]).toEqual([lat, lng, expect.stringMatching(/^48(201|157|473|015|481)$/)]);
      }
  });
});
