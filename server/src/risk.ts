import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChildProcess, spawn } from 'child_process';
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { REPO, VENV_PY } from './config';

export type Risk = 1 | 2 | 3;
export type Prediction = { level: Risk; label: 'Bajo' | 'Medio' | 'Alto'; confidence: number; requiresReview: boolean; factors: string[] };

export class RiskUnavailable extends Error {}
export class CountyUnknown extends Error {}

type Cond = { name: string; critical: boolean };

const ageAt = (birth: string, now: Date) => {
  const b = new Date(birth + 'T00:00:00Z');
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) a--;
  return a;
};
export { ageAt };

/** S3: one point each for age ≥ 70 or ≤ 5, any critical condition, any mobility need. */
export function vulnerability(u: { birthDate: string; medicalConditions: Cond[]; mobilityNeeds: string[] }, now = new Date()): number {
  const age = ageAt(u.birthDate, now);
  return (age >= 70 || age <= 5 ? 1 : 0) + (u.medicalConditions.some((c) => c.critical) ? 1 : 0) + (u.mobilityNeeds.length > 0 ? 1 : 0);
}

export const incidentRisk = (countyRisk: number, vuln: number): Risk => Math.min(3, Math.max(1, countyRisk - 1 + vuln)) as Risk;

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

@Injectable()
export class RiskBridge implements OnModuleInit, OnModuleDestroy {
  ready = false;
  private child?: ChildProcess;
  private pending = new Map<string, Pending>();
  private stopped = false;

  onModuleInit() {
    this.start();
  }
  onModuleDestroy() {
    this.stopped = true;
    this.child?.kill();
  }

  private start() {
    // PYTHONIOENCODING: Windows pipes default to cp1252; the bridge prints UTF-8 JSON (ensure_ascii=False).
    const child = spawn(VENV_PY, [join(REPO, 'atalaia', 'src', 'models', 'stdio.py')], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    this.child = child;
    child.on('error', () => {}); // exit handler does the rest
    createInterface({ input: child.stdout! }).on('line', (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const p = this.pending.get(msg.id_solicitud);
      if (!p) return;
      this.pending.delete(msg.id_solicitud);
      clearTimeout(p.timer);
      p.resolve(msg);
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.ready = false;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new RiskUnavailable('bridge exited'));
        this.pending.delete(id);
      }
      if (!this.stopped) setTimeout(() => this.start(), 1000).unref();
    });
    // Warm-up doubles as the readiness probe (model load takes a few seconds).
    this.predict('48201', 30000).then(() => (this.ready = this.child === child && !child.killed), () => {});
  }

  private call(fips: string, timeoutMs: number): Promise<any> {
    const child = this.child;
    if (!child || child.killed || child.exitCode !== null || !child.stdin?.writable) return Promise.reject(new RiskUnavailable('bridge down'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RiskUnavailable('timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin!.write(JSON.stringify({ id, county_fips: fips }) + '\n', (e) => {
        if (e) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new RiskUnavailable('write failed'));
        }
      });
    });
  }

  async predict(fips: string, timeoutMs = 2000): Promise<Prediction> {
    const out = await this.call(fips, timeoutMs);
    if (out.status !== 'success') throw new CountyUnknown(out.mensaje);
    return {
      level: (out.clase_predicha + 1) as Risk, // model classes are 0..2; S3 scale is 1..3
      label: out.nivel_riesgo,
      confidence: out.confianza,
      requiresReview: out.requiere_revision,
      factors: out.factores_clave,
    };
  }

  /** Test hook. */
  kill() {
    this.child?.kill('SIGKILL');
  }
}
