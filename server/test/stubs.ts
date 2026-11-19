import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

const hav = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

export type Stub = {
  server: Server;
  url: string;
  /** Census onelineaddress answer; null = no match. */
  address: { lat: number; lng: number; fips: string } | null;
  osrmDown: boolean;
  latencyMs: number;
  close(): Promise<void>;
};

/** One server answers both Census (/geocoder/...) and OSRM (/table, /route): Euclidean 10 m/s, straight lines. */
export async function startStubs(port = 0): Promise<Stub> {
  const stub: Stub = { address: { lat: 29.805, lng: -95.77, fips: '48201' }, osrmDown: false, latencyMs: 0 } as Stub;
  stub.server = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    const send = (o: unknown, code = 200) => {
      setTimeout(() => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      }, stub.latencyMs);
    };
    if (u.pathname.startsWith('/geocoder/geographies/onelineaddress')) {
      const a = stub.address;
      return send({ result: { addressMatches: a ? [{ coordinates: { x: a.lng, y: a.lat }, geographies: { Counties: [{ GEOID: a.fips }] } }] : [] } });
    }
    const m = /^\/(table|route)\/v1\/driving\/(.+)$/.exec(u.pathname);
    if (!m) return send({}, 404);
    if (stub.osrmDown) return send({ code: 'Error' }, 500);
    const pts = decodeURIComponent(m[2]).split(';').map((p) => p.split(',').map(Number) as [number, number]);
    if (m[1] === 'table')
      return send({
        code: 'Ok',
        durations: pts.map((a) => pts.map((b) => hav(a, b) / 10)),
        sources: pts.map(() => ({ distance: 5 })),
      });
    return send({ code: 'Ok', routes: [{ geometry: { coordinates: pts } }] });
  });
  await new Promise<void>((r) => stub.server.listen(port, '127.0.0.1', r));
  stub.url = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`;
  stub.close = () => new Promise((r) => stub.server.close(() => r()));
  return stub;
}
