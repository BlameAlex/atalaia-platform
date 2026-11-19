import { BOUNDS, COUNTS } from './config';
import { generateScenario } from './scenario';

describe('generateScenario', () => {
  it('meets PRD constraints over many runs', () => {
    for (let run = 0; run < 50; run++) {
      const s = generateScenario(BOUNDS, COUNTS);
      expect(s).toHaveLength(24);
      expect(s.filter((m) => m.type === 'hq')).toHaveLength(1);
      expect(s.filter((m) => m.type === 'hospital')).toHaveLength(3);
      const sos = s.filter((m) => m.type === 'sos');
      expect(sos).toHaveLength(20);
      expect(new Set(sos.map((m) => m.risk))).toEqual(new Set([1, 2, 3]));
      expect(s.filter((m) => m.type !== 'sos' && m.risk !== undefined)).toHaveLength(0);
      expect(new Set(s.map((m) => `${m.latitude},${m.longitude}`)).size).toBe(24);
      expect(new Set(s.map((m) => m.id)).size).toBe(24);
      for (const m of s) {
        expect(typeof m.latitude).toBe('number');
        expect(typeof m.longitude).toBe('number');
        expect(m.latitude).toBeGreaterThanOrEqual(BOUNDS.south);
        expect(m.latitude).toBeLessThanOrEqual(BOUNDS.north);
        expect(m.longitude).toBeGreaterThanOrEqual(BOUNDS.west);
        expect(m.longitude).toBeLessThanOrEqual(BOUNDS.east);
      }
    }
  });

  it('rejects duplicate coordinates', () => {
    // rng repeats the same point twice before moving on
    const seq = [0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const rng = () => (i < seq.length ? seq[i++] : Math.random());
    const s = generateScenario(BOUNDS, COUNTS, rng);
    expect(new Set(s.map((m) => `${m.latitude},${m.longitude}`)).size).toBe(24);
  });
});
