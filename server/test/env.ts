// Runs before each test file's imports: rescue-map's config reads OSRM_URL at import time.
process.env.NODE_ENV = 'development';
process.env.DISPATCH_KEY = 'k-test';
process.env.OSRM_URL = 'http://127.0.0.1:38917';
process.env.CENSUS_URL = 'http://127.0.0.1:38917';
process.env.OTP_COOLDOWN_SEC = '0';
process.env.SIM_TICK_MS = '0'; // tests call tick() directly
process.env.PLAN_DEBOUNCE_MS = '600000'; // tests drive planning with runNow()
const base = process.env.DATABASE_URL ?? 'postgres://atalaia:atalaia@localhost:5432/atalaia';
process.env.TEST_ADMIN_URL = base;
process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/atalaia_test');
