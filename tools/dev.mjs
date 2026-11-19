// Arranca db + servidor + Expo. Al salir mata servidor y Expo; la base de datos sigue corriendo.
// Uso: node tools/dev.mjs [--no-mobile] [--port N]
import { createSocket } from 'node:dgram';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { ROOT, WIN, findCompose, killTree, parseDevArgs, run, start, waitDb } from './lib.mjs';

process.chdir(ROOT);
const salir = (m, code = 1) => { console.error(m); process.exit(code); };

const opts = parseDevArgs(process.argv.slice(2));
if (!opts) salir('uso: node tools/dev.mjs [--no-mobile] [--port N]', 2);
if (!existsSync('.env') || !existsSync('server/node_modules')) salir('ejecuta primero node tools/setup.mjs');
process.loadEnvFile('.env');
if (opts.port) process.env.PORT = opts.port;
const PORT = (process.env.PORT ??= '3100');

const compose = findCompose() ?? salir('falta: docker compose o podman compose');
const free = await new Promise((r) => createServer().once('error', () => r(false)).listen(+PORT, function () { this.close(() => r(true)); }));
if (!free) salir(`el puerto ${PORT} está en uso`);

const [bin, ...sub] = compose;
if (run(bin, [...sub, 'up', '-d', 'db']) !== 0) salir('compose up falló');
if (!(await waitDb(compose, process.env.POSTGRES_USER))) salir('la base de datos no respondió en 60 s');
if (run('npm', ['--prefix', 'server', 'run', 'build']) !== 0) salir('la compilación del servidor falló');

mkdirSync('.dev', { recursive: true });
const MAIN = JSON.parse(readFileSync('server/package.json', 'utf8')).main;
const log = opts.mobile ? openSync('.dev/server.log', 'w') : 'inherit';
// POSIX: grupo propio (detached) para matar el servidor y sus hijos (puente Python) juntos.
// Windows: detached abriría otra consola; killTree usa taskkill /T.
const server = start(process.execPath, [`server/${MAIN}`], { stdio: ['ignore', log, log], detached: !WIN });
let expo;
let closing = false;
async function cleanup(code) {
  if (closing) return;
  closing = true;
  await Promise.all([killTree(server), killTree(expo)]);
  process.exit(code);
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => cleanup(130));

let ready = false;
for (let i = 0; i < 60 && server.exitCode === null; i++) {
  ready = await fetch(`http://localhost:${PORT}/api/v1/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.json()).then((h) => h.db === 'ok' && h.risk === 'ok', () => false);
  if (ready) break;
  await sleep(1000);
}
if (!ready) {
  console.error('el servidor no quedó listo');
  if (opts.mobile) console.error(readFileSync('.dev/server.log', 'utf8').split('\n').slice(-20).join('\n'));
  await cleanup(1);
}

// Demo: registra los usuarios simulados (idempotente) para el botón SOS de la app. Si falla, el botón lo avisa.
if (process.env.DEMO_SKIP_OTP === '1') {
  const { ensurePool } = await import('./simulate-sos.mjs');
  await ensurePool(`http://localhost:${PORT}`).then(
    (p) => console.log(`pool demo: ${p.sessions.length} usuarios simulados`),
    (e) => console.error(`pool demo no preparado: ${e.message}`),
  );
}

// IP de la interfaz de la ruta por defecto (Wi-Fi/Ethernet), no la primera que aparezca: una VPN o un
// puente de docker daría una IP que el teléfono no alcanza. UDP connect no envía paquetes. LAN_IP=… la fuerza.
const LAN_IP = process.env.LAN_IP || await new Promise((r) => {
  const s = createSocket('udp4');
  s.on('error', () => r('localhost'));
  s.connect(53, '1.1.1.1', () => { r(s.address().address); s.close(); });
});
console.log(`API          http://localhost:${PORT}/api/v1`);
console.log(`Panel        http://localhost:${PORT}/dashboard/   (clave de despacho: ${process.env.DISPATCH_KEY})`);
console.log(`Red local    http://${LAN_IP}:${PORT}`);
console.log('Registro     .dev/server.log   (aquí aparecen los códigos OTP de desarrollo)');

if (!opts.mobile) {
  server.on('exit', (c) => cleanup(c ?? 1));
} else {
  console.log('Escanea el QR con Expo Go; el teléfono debe estar en la misma red Wi-Fi');
  expo = start('npx', ['expo', 'start', '--lan'], {
    cwd: 'mobile',
    stdio: 'inherit',
    env: {
      ...process.env,
      REACT_NATIVE_PACKAGER_HOSTNAME: LAN_IP,
      EXPO_PUBLIC_API_URL: `http://${LAN_IP}:${PORT}`,
      EXPO_PUBLIC_DEMO_SKIP_OTP: process.env.DEMO_SKIP_OTP ?? '0',
    },
  });
  expo.on('exit', (c) => cleanup(c ?? 0));
}
