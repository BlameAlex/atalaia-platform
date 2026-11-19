import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { REPO } from './config';
import { closePool, tx } from './db';

const DIR = join(REPO, 'server', 'migrations');

/** Applies migrations/*.sql in name order, one transaction each. Returns how many were applied. */
export async function migrate(): Promise<number> {
  await tx((c) => c(`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`));
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let n = 0;
  for (const f of files) {
    await tx(async (c) => {
      if ((await c('SELECT 1 FROM schema_migrations WHERE name=$1', [f])).length) return;
      await c(readFileSync(join(DIR, f), 'utf8'));
      await c('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      n++;
    });
  }
  return n;
}

if (require.main === module) {
  migrate()
    .then((n) => console.log(`applied ${n} migration(s)`))
    .then(closePool)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
