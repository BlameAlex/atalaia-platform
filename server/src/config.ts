import { existsSync, statSync } from 'fs';
import { dirname, join } from 'path';

/** Repo root: first ancestor of __dirname that contains atalaia/ (cwd-independent). */
function findRepo(): string {
  for (let d = __dirname; d !== dirname(d); d = dirname(d)) {
    const a = join(d, 'atalaia');
    if (existsSync(a) && statSync(a).isDirectory()) return d;
  }
  throw new Error('repo root (directory containing atalaia/) not found');
}
export const REPO = findRepo();
/** venv interpreter: Scripts\python.exe on Windows, bin/python elsewhere. */
export const VENV_PY = join(REPO, 'atalaia', '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));

// Demo area (S2), finalized by the county bake-off.
export const BOUNDS = { south: 29.73, west: -95.86, north: 29.96, east: -95.26 };

export const env = {
  get databaseUrl() {
    return process.env.DATABASE_URL ?? 'postgres://atalaia:atalaia@localhost:5432/atalaia';
  },
  get port() {
    return Number(process.env.PORT ?? 3100);
  },
  get dispatchKey() {
    return process.env.DISPATCH_KEY ?? '';
  },
  get dev() {
    return process.env.NODE_ENV === 'development';
  },
  /** Demo-only: sign in by phone without OTP. Never on in production. */
  get demoSkipOtp() {
    return process.env.DEMO_SKIP_OTP === '1' && process.env.NODE_ENV !== 'production';
  },
  /** Demo-only: typed home addresses are replaced by a curated US test address (same flag as demoSkipOtp). */
  get demoAddress() {
    return this.demoSkipOtp;
  },
  /** Demo-only: server drives deployed trips (auto pickups, 1×–5× clock). Never on in production. */
  get demoSim() {
    return process.env.DEMO_SIM === '1' && process.env.NODE_ENV !== 'production';
  },
  /** Simulation tick period; 0 disables the loop (tests call tick() directly). */
  get simTickMs() {
    return Number(process.env.SIM_TICK_MS ?? 250);
  },
  get otpCooldownSec() {
    return Number(process.env.OTP_COOLDOWN_SEC ?? 30);
  },
  get censusUrl() {
    return process.env.CENSUS_URL ?? 'https://geocoding.geo.census.gov';
  },
};
