import { Pool, types } from 'pg';
import { env } from './config';

types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD'
types.setTypeParser(1700, (v) => parseFloat(v)); // numeric -> number

let pool: Pool | undefined;
export const getPool = () => (pool ??= new Pool({ connectionString: env.databaseUrl, max: 10 }));
export async function closePool() {
  await pool?.end();
  pool = undefined;
}

/** Query function: returns rows. */
export type Q = <T = any>(sql: string, params?: any[]) => Promise<T[]>;

export const q: Q = async (sql, params) => (await getPool().query(sql, params)).rows;

/**
 * One transaction. Takes the global advisory lock first, so transitions, SOS inserts and plan persists
 * never interleave. NOTE: single instance; scale-out needs a different lock scheme.
 */
export async function tx<T>(fn: (c: Q) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1)');
    const out = await fn(async (sql, params) => (await client.query(sql, params)).rows);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export type Actor = 'system' | 'dispatcher' | 'mobile';
export async function logStatus(
  c: Q,
  u: { incidentId: string; routeId?: string | null; from: string | null; to: string; actor: Actor; note?: string | null },
) {
  await c(
    `INSERT INTO status_updates(incident_id, route_id, from_status, to_status, actor, note) VALUES ($1,$2,$3,$4,$5,$6)`,
    [u.incidentId, u.routeId ?? null, u.from, u.to, u.actor, u.note ?? null],
  );
}
