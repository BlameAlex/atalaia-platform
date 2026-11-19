import { closePool, tx } from './db';

/** Deletes every SOS call plus the routes/stops/history built from them. Users, vehicles and places stay. */
export async function clearSos(): Promise<number> {
  return tx(async (c) => {
    await c('DELETE FROM status_updates');
    await c('DELETE FROM route_stops');
    const n = (await c('DELETE FROM incidents RETURNING 1')).length;
    await c('DELETE FROM routes');
    return n;
  });
}

if (require.main === module) {
  clearSos()
    .then((n) => console.log(`cleared ${n} SOS call(s)`))
    .then(closePool)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
