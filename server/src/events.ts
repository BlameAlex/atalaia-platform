import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type SseMessage = { type: string; id: string; data: Record<string, unknown> };

@Injectable()
export class Events {
  seq = 0;
  readonly subject = new Subject<SseMessage>();
  /** Call only after COMMIT. */
  emit(type: string, payload: object) {
    this.seq++;
    this.subject.next({ type, id: String(this.seq), data: { seq: this.seq, ...payload } });
  }
}
