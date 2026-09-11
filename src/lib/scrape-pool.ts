/**
 * P2 — ACCOUNT POOL: trạng thái account trong 1 scrape job (cooldown, circuit breaker).
 *
 * Sửa mô hình sai của P1: P1 vừa cấp slot vừa là vòng đời worker → scheduler có thể
 * cấp lại cùng account khi account đang chạy chain kế (release set busy=false nhưng
 * worker vẫn loop) → 2 browser cùng profile dir. P2 tách bạch:
 *   - ScrapeAccountPool: CHỈ theo dõi trạng thái account (nghỉ cooldown / cháy circuit).
 *   - Số session song song: ConcurrencyLimiter (slot semaphore) ở tầng job.
 *   - Mỗi account có ĐÚNG 1 worker trong suốt job (spawn 1 lần theo accountQueue).
 */

export interface PoolAccount {
  id: number;
  /** số chain đã chạy trong job */
  chains: number;
  /** số chain liên tiếp không thu lead mới */
  unproductive: number;
  exhausted: boolean;
  /** nghỉ tới timestamp ms (0 = chạy được) */
  restingUntil: number;
}

export interface ChainOutcome {
  now: number;
  cooldownMs: number;
  unproductive: boolean;
  maxUnproductive?: number;
}

export class ScrapeAccountPool {
  private accounts: PoolAccount[];

  constructor(accountIds: number[]) {
    this.accounts = (accountIds || []).map(id => ({
      id,
      chains: 0,
      unproductive: 0,
      exhausted: false,
      restingUntil: 0,
    }));
  }

  public get(id: number): PoolAccount | undefined {
    return this.accounts.find(a => a.id === id);
  }

  public size(): number {
    return this.accounts.length;
  }

  /** ms còn phải nghỉ trước chain kế (0 = sẵn sàng). */
  public cooldownRemaining(id: number, now: number): number {
    const a = this.get(id);
    if (!a) return 0;
    return Math.max(0, a.restingUntil - now);
  }

  public canRun(id: number, now: number): boolean {
    const a = this.get(id);
    return !!a && !a.exhausted && a.restingUntil <= now;
  }

  /** Chain xong: tăng đếm, đặt cooldown; 0-lead liên tiếp đủ ngưỡng → cháy circuit. */
  public noteChainDone(id: number, o: ChainOutcome): void {
    const a = this.get(id);
    if (!a) return;
    a.chains++;
    a.restingUntil = o.now + Math.max(0, o.cooldownMs);
    if (o.unproductive) {
      a.unproductive++;
      if (a.unproductive >= (o.maxUnproductive ?? 2)) a.exhausted = true;
    } else {
      a.unproductive = 0;
    }
  }

  /** Account bị loại vĩnh viễn trong job (checkpoint / cookie die / launch fail). */
  public markExhausted(id: number): void {
    const a = this.get(id);
    if (!a) return;
    a.exhausted = true;
    a.restingUntil = 0;
  }

  public isAlive(): boolean {
    return this.accounts.some(a => !a.exhausted);
  }

  public exhaustedCount(): number {
    return this.accounts.filter(a => a.exhausted).length;
  }
}
