import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { env } from './config';
import { q, Q, tx } from './db';
import { fail } from './errors';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export type Auth = { deviceId: string; phone: string; userId: string | null };

@Injectable()
export class BearerGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!m) return fail(401, 'unauthorized');
    const [d] = await q(
      `UPDATE devices SET last_seen_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, phone, user_id`,
      [sha256(m[1])],
    );
    if (!d) return fail(401, 'unauthorized');
    req.auth = { deviceId: d.id, phone: d.phone, userId: d.user_id } satisfies Auth;
    return true;
  }
}

@Injectable()
export class DispatchGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const key = (req.headers['x-dispatch-key'] as string | undefined) ?? (req.method === 'GET' ? (req.query.key as string | undefined) : undefined);
    if (!env.dispatchKey || typeof key !== 'string' || !same(key, env.dispatchKey)) return fail(401, 'unauthorized');
    return true;
  }
}

const codeHash = (phone: string, code: string) => sha256(`${phone}:${code}`);

export async function requestOtp(phone: string): Promise<string> {
  const cool = env.otpCooldownSec;
  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  await tx(async (c) => {
    const [row] = await c(`SELECT expires_at > now() + make_interval(secs => $2) AS hot FROM otp_codes WHERE phone = $1 FOR UPDATE`, [phone, 300 - cool]);
    if (row?.hot) fail(429, 'otp_cooldown');
    await c(
      `INSERT INTO otp_codes(phone, code_hash, expires_at, attempts) VALUES ($1, $2, now() + interval '5 minutes', 0)
       ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
      [phone, codeHash(phone, code)],
    );
  });
  if (env.dev) console.log(`[otp] ${phone}: ${code}`);
  return code;
}

/** New device token for a phone, bound to its user if one exists. Shared by OTP and demo sign-in. */
async function issueDevice(c: Q, phone: string) {
  const token = randomBytes(32).toString('base64url');
  const [u] = await c(`SELECT id FROM users WHERE phone = $1`, [phone]);
  await c(`INSERT INTO devices(phone, user_id, token_hash) VALUES ($1, $2, $3)`, [phone, u?.id ?? null, sha256(token)]);
  return { token, userId: (u?.id as string) ?? null };
}

/** Demo-only sign-in without OTP. Callers must check env.demoSkipOtp. */
export const demoSignIn = (phone: string) => tx((c) => issueDevice(c, phone));

/** Returns {token, userId}. Wrong codes count attempts (committed even though the request fails). */
export async function verifyOtp(phone: string, code: string): Promise<{ token: string; userId: string | null }> {
  const res = await tx(async (c) => {
    const [row] = await c(`SELECT code_hash, attempts, expires_at > now() AS live FROM otp_codes WHERE phone = $1 FOR UPDATE`, [phone]);
    if (!row || !row.live) return { err: 'otp_invalid' as const };
    if (row.attempts >= 5) return { err: 'otp_locked' as const };
    if (!same(row.code_hash, codeHash(phone, code))) {
      await c(`UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1`, [phone]);
      return { err: 'otp_invalid' as const };
    }
    await c(`DELETE FROM otp_codes WHERE phone = $1`, [phone]);
    return issueDevice(c, phone);
  });
  if ('err' in res) return res.err === 'otp_locked' ? fail(429, 'otp_locked') : fail(401, 'otp_invalid');
  return res;
}
