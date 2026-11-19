export type Bounds = { south: number; west: number; north: number; east: number };
export type Counts = { hq: number; hospital: number; sos: number };
export type Risk = 1 | 2 | 3;
export type Marker = {
  id: string;
  type: 'hq' | 'hospital' | 'sos';
  label: string;
  latitude: number;
  longitude: number;
  risk?: Risk;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// NOTE: bbox boundary; swap to polygon + point-in-polygon if the demo area needs an irregular shape.
export function generateScenario(bounds: Bounds, counts: Counts, rng: () => number = Math.random): Marker[] {
  const used = new Set<string>();
  const point = () => {
    for (;;) {
      const latitude = round6(bounds.south + rng() * (bounds.north - bounds.south));
      const longitude = round6(bounds.west + rng() * (bounds.east - bounds.west));
      const key = `${latitude},${longitude}`;
      if (!used.has(key)) {
        used.add(key);
        return { latitude, longitude };
      }
    }
  };

  const markers: Marker[] = [];
  for (let i = 1; i <= counts.hq; i++)
    markers.push({ id: `hq-${i}`, type: 'hq', label: counts.hq === 1 ? 'HQ' : `HQ ${i}`, ...point() });
  for (let i = 1; i <= counts.hospital; i++)
    markers.push({ id: `hospital-${i}`, type: 'hospital', label: `Hospital ${i}`, ...point() });

  // First three risks guarantee 1, 2, 3; shuffle so they don't always land on SOS 1-3.
  const risks = Array.from({ length: counts.sos }, (_, i) => (i < 3 ? i + 1 : 1 + Math.floor(rng() * 3)) as Risk);
  for (let i = risks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [risks[i], risks[j]] = [risks[j], risks[i]];
  }
  risks.forEach((risk, i) =>
    markers.push({ id: `sos-${i + 1}`, type: 'sos', label: `SOS ${i + 1}`, risk, ...point() }),
  );
  return markers;
}
