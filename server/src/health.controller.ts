import { Controller, Get } from '@nestjs/common';
import { BOUNDS } from './config';
import { q } from './db';
import { Planning } from './planning';
import { RiskBridge } from './risk';

@Controller('health')
export class HealthController {
  constructor(private readonly risk: RiskBridge, private readonly planning: Planning) {}
  @Get()
  async health() {
    const db = await q('SELECT 1').then(() => 'ok', () => 'down');
    return { db, risk: this.risk.ready ? 'ok' : 'down', osrm: this.planning.osrm, bounds: BOUNDS };
  }
}
