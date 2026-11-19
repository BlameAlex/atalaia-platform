import { Injectable, OnModuleInit } from '@nestjs/common';
import { env } from './config';
import { q } from './db';
import { Events } from './events';

type Clock = { realAt: number; simMs: number; speed: number };

/** Demo simulation clock, persisted in sim_clock so refreshes and restarts keep every trip where it was. */
@Injectable()
export class Sim implements OnModuleInit {
  clock: Clock = { realAt: Date.now(), simMs: 0, speed: 1 };
  /** Pickup roll; tests override it. */
  rand = Math.random;

  constructor(private readonly events: Events) {}

  async onModuleInit() {
    await this.load();
  }

  async load() {
    const [r] = await q('SELECT real_at, sim_ms, speed FROM sim_clock WHERE id = 1');
    if (r) this.clock = { realAt: +new Date(r.real_at), simMs: Number(r.sim_ms), speed: r.speed };
  }

  simMs(t = Date.now()) {
    return Math.round(this.clock.simMs + (t - this.clock.realAt) * this.clock.speed);
  }

  dto() {
    return { enabled: env.demoSim, speed: this.clock.speed, realAt: new Date(this.clock.realAt).toISOString(), simMs: this.clock.simMs };
  }

  /** Rebase at now so no trip jumps, then switch speed. */
  async setSpeed(speed: number, t = Date.now()) {
    this.clock = { realAt: t, simMs: this.simMs(t), speed };
    await q('UPDATE sim_clock SET real_at = $1, sim_ms = $2, speed = $3 WHERE id = 1', [new Date(t), this.clock.simMs, speed]);
    this.events.emit('sim.clock', this.dto());
  }
}
