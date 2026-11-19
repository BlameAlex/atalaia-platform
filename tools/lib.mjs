// Helpers shared by setup.mjs and dev.mjs. Plain Node, so the same scripts run on Linux, macOS and Windows.
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WIN = process.platform === 'win32';

export const venvPy = (platform = process.platform) =>
  join('atalaia', '.venv', ...(platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));

// npm/npx are .cmd shims on Windows: since Node 20.12 they only start through a shell. Their args here never
// contain spaces, so joining them into one command string is safe (and avoids the DEP0190 args+shell warning).
function spec(cmd, args) {
  return WIN && (cmd === 'npm' || cmd === 'npx') ? [[cmd, ...args].join(' '), [], true] : [cmd, args, false];
}

/** Runs a command attached to the terminal; returns its exit status (null if it could not start). */
export function run(cmd, args, opts = {}) {
  const [c, a, shell] = spec(cmd, args);
  return spawnSync(c, a, { stdio: 'inherit', shell, ...opts }).status;
}
/** Same as run() but silent: true when the command exits 0. */
export const ok = (cmd, args, opts = {}) => run(cmd, args, { stdio: 'ignore', ...opts }) === 0;
export function start(cmd, args, opts = {}) {
  const [c, a, shell] = spec(cmd, args);
  return spawn(c, a, { shell, ...opts });
}

/** ['docker', 'compose'] or ['podman', 'compose'], whichever answers first; null when neither. */
export function findCompose() {
  for (const bin of ['docker', 'podman']) if (ok(bin, ['compose', 'version'])) return [bin, 'compose'];
  return null;
}

/** Waits up to 60 s for pg_isready inside the db container. */
export async function waitDb([bin, ...sub], user) {
  for (let i = 0; i < 60; i++) {
    if (ok(bin, [...sub, 'exec', '-T', 'db', 'pg_isready', '-U', user])) return true;
    await sleep(1000);
  }
  return false;
}

/** Kills a child and everything it spawned: TERM, then KILL after 5 s. POSIX: whole group when the child
 * leads one (spawned detached), else the child alone (npm exec forwards the signal to what it runs). */
export async function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  const sig = (s) => {
    for (const pid of [-child.pid, child.pid]) try { process.kill(pid, s); return true; } catch {}
    return false;
  };
  if (!sig('SIGTERM')) return;
  for (let i = 0; i < 10 && sig(0); i++) await sleep(500);
  sig('SIGKILL');
}

/** dev.mjs flags; null on bad usage. */
export function parseDevArgs(argv) {
  const o = { mobile: true, port: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-mobile') o.mobile = false;
    else if (argv[i] === '--port' && /^[0-9]+$/.test(argv[i + 1] ?? '')) o.port = argv[++i];
    else return null;
  }
  return o;
}
