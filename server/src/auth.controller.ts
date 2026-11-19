import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { BearerGuard, demoSignIn, requestOtp, verifyOtp } from './auth';
import { env } from './config';
import { q } from './db';
import { userDto } from './dto';
import { fail, invalid } from './errors';

const PHONE = /^\+1\d{10}$/;

@Controller()
export class AuthController {
  @Post('auth/otp/request')
  @HttpCode(202)
  async request(@Body() b: any) {
    if (typeof b?.phone !== 'string' || !PHONE.test(b.phone)) invalid('phone');
    const code = await requestOtp(b.phone);
    return process.env.NODE_ENV === 'development' ? { devCode: code } : {};
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  async verify(@Body() b: any) {
    if (typeof b?.phone !== 'string' || !PHONE.test(b.phone)) invalid('phone');
    if (typeof b?.code !== 'string' || !/^\d{6}$/.test(b.code)) invalid('code');
    const { token, userId } = await verifyOtp(b.phone, b.code);
    const [u] = userId ? await q('SELECT * FROM users WHERE id = $1', [userId]) : [];
    return { deviceToken: token, user: u ? userDto(u) : null };
  }

  /** Demo bypass (DEMO_SKIP_OTP=1, never in production): same response as otp/verify, no code. */
  @Post('auth/demo/sign-in')
  @HttpCode(200)
  async demo(@Body() b: any) {
    if (!env.demoSkipOtp) fail(404, 'not_found');
    if (typeof b?.phone !== 'string' || !PHONE.test(b.phone)) invalid('phone');
    const { token, userId } = await demoSignIn(b.phone);
    const [u] = userId ? await q('SELECT * FROM users WHERE id = $1', [userId]) : [];
    return { deviceToken: token, user: u ? userDto(u) : null };
  }

  @Post('devices/revoke-others')
  @HttpCode(200)
  @UseGuards(BearerGuard)
  async revokeOthers(@Req() req: any) {
    const rows = await q(
      `UPDATE devices SET revoked_at = now() WHERE phone = $1 AND id <> $2 AND revoked_at IS NULL RETURNING id`,
      [req.auth.phone, req.auth.deviceId],
    );
    return { revoked: rows.length };
  }

  @Post('devices/revoke-current')
  @HttpCode(204)
  @UseGuards(BearerGuard)
  async revokeCurrent(@Req() req: any) {
    await q(`UPDATE devices SET revoked_at = now() WHERE id = $1`, [req.auth.deviceId]);
  }
}
