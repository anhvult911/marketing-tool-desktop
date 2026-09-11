/**
 * P1 — SCRAPE SESSION POOL: bộ lập lịch account-session song song cho 1 scrape job.
 *
 * Mô hình:
 * - Mỗi account = 1 "account worker": vòng đời riêng {khởi động → chạy chuỗi
 *   (chain) ≥1 → throttle/hết việc → cooldown → chạy tiếp nếu còn quota}.
 * - Session slot = số browser chạy đồng thời (bound RAM). Account worker không
 *   chiếm slot khi đang nghỉ cooldown — slot nhả cho account khác.
 * - Idle feed = danh sách account đang rảnh, kèm "pass token" xoay vòng để
 *   lượt nghỉ 10 phút giữa pass được phân bổ đều (tránh cả pool nghỉ cùng lúc).
 *
 * Pure logic, không phụ thuộc Playwright/DB — unit-test được.
 */

export interface PoolAccount {
  id: number;
  /** số chuỗi đã chạy trong job hiện tại */
  chains: number;
  /** chuỗi liên tiếp không thu lead mới */
  unproductive: number;
  /** hiện đang chiếm session slot */
  busy: boolean;
  /** đang nghỉ sau chuỗi (đến timestamp ms) */
  restingUntil: number;
  /** token pass hiện tại — worker chỉ chạy khi token khớp lượt của mình */
  passToken: number;
  exhausted: boolean;
}

export interface PoolAccountInit {
  id: number;
}

export interface TryAcquireOptions {
  now: number;
  /** token pass hiện hành của job; account phải khớp token mới được cấp session */
  passToken: number;
}

export interface AcquireResult {
  granted: boolean;
  accountId?: number;
  /** account không chạy được do token chưa đến lượt — ms còn lại đến khi token xoay */
  waitMs?: number;
  reason?: 'all-slots-busy' | 'all-resting' | 'all-exhausted' | 'no-accounts' | 'pass-token-wait' | 'none';
}

export interface PoolStats {
  total: number;
  busy: number;
  resting: number;
  exhausted: number;
  idle: number;
  activeSlots: number;
}

/**
 * Scheduler cho pool account của 1 job.
 * - acquireNext(now, passToken): cấp 1 slot cho account đủ điều kiện, ưu tiên
 *   account có token khớp lượt (idle-fairness), rồi account pass-1 đã nghỉ đủ.
 * - release(accountId, {unproductive}): worker trả slot; hết chuỗi → tự nghỉ
 *   cooldownMs trước khi xin session kế.
 */
export class ScrapeSessionPool {
  private accounts: PoolAccount[] = [];
  private slots: number;

  constructor(accountIds: number[], slots: number) {
    this.accounts = (accountIds || []).map(id => ({
      id,
      chains: 0,
      unproductive: 0,
      busy: false,
      restingUntil: 0,
      passToken: 1,
      exhausted: false,
    }));
    this.slots = Math.max(1, slots | 0);
  }

  public setSlots(n: number): void {
    this.slots = Math.max(1, n | 0);
  }

  public getSlots(): number {
    return this.slots;
  }

  public size(): number {
    return this.accounts.length;
  }

  public hasAccount(id: number): boolean {
    return this.accounts.some(a => a.id === id);
  }

  public getAccount(id: number): PoolAccount | undefined {
    return this.accounts.find(a => a.id === id);
  }

  /** Account đang giữ slot (worker còn sống dù đang nghỉ micro giữa chuỗi). */
  public busyIds(): number[] {
    return this.accounts.filter(a => a.busy).map(a => a.id);
  }

  /**
   * Xin 1 session slot cho account sẵn sàng:
   * - còn slot trống
   * - account không busy, không exhausted, hết cooldown
   * - pass token khớp (idle tài khoản được ưu tiên đúng lượt)
   */
  public acquireNext(opts: TryAcquireOptions): AcquireResult {
    const { now, passToken } = opts;
    if (this.accounts.length === 0) return { granted: false, reason: 'no-accounts' };

    const activeSlots = this.accounts.filter(a => a.busy).length;
    const ready = this.accounts.filter(a => !a.busy && !a.exhausted && a.restingUntil <= now);

    if (activeSlots >= this.slots) return { granted: false, reason: 'all-slots-busy' };
    if (ready.length === 0) {
      const exhaustedAll = this.accounts.every(a => a.exhausted);
      if (exhaustedAll) return { granted: false, reason: 'all-exhausted' };
      return { granted: false, reason: 'all-resting' };
    }

    // Ưu tiên 1: account rảnh có token khớp lượt hiện tại (idle-fairness)
    let candidate = ready.find(a => a.passToken === passToken);
    // Ưu tiên 2: account pass-1 đã nghỉ đủ (không phải skip do token)
    if (!candidate) candidate = ready.find(a => a.passToken === passToken - 1);
    // Ưu tiên 3: bất kỳ account sẵn sàng (pass sâu hơn nhưng pool cần việc làm)
    if (!candidate) {
      const nextTokenAccount = ready
        .filter(a => a.passToken > passToken)
        .sort((a, b) => a.passToken - b.passToken)[0];
      candidate = nextTokenAccount || ready[0];
    }

    candidate.busy = true;
    candidate.chains++;
    return { granted: true, accountId: candidate.id };
  }

  /**
   * Worker trả slot sau phiên. `unproductive` = phiên 0 lead mới.
   * - unproductive → tăng đếm; đạt ngưỡng `maxUnproductive` → đánh dấu exhausted
   *   (circuit per-account, không giết cả job).
   * - Hết chuỗi → nghỉ `cooldownMs` (tính từ thời điểm trả) rồi mới được xin lại.
   */
  public release(accountId: number, opts: { now: number; cooldownMs: number; unproductive: boolean; maxUnproductive?: number }): void {
    const acc = this.accounts.find(a => a.id === accountId);
    if (!acc) return;
    acc.busy = false;
    acc.restingUntil = opts.now + opts.cooldownMs;
    if (opts.unproductive) {
      acc.unproductive++;
      const max = opts.maxUnproductive ?? 2;
      if (acc.unproductive >= max) acc.exhausted = true;
    } else {
      acc.unproductive = 0;
    }
  }

  /** Account bên ngoài (checkpoint/cookie die) bị loại khỏi pool vĩnh viễn trong job. */
  public markExhausted(accountId: number): void {
    const acc = this.accounts.find(a => a.id === accountId);
    if (acc) {
      acc.exhausted = true;
      acc.busy = false;
      acc.restingUntil = 0;
    }
  }

  /**
   * Xoay token pass: account đang rảnh nhận token pass kế tiếp (chạy lượt tiếp).
   * Gọi MỘT lần khi 1 lượt toàn pool đã được phân (trước khi nghỉ 10').
   */
  public rotatePassToken(): void {
    for (const a of this.accounts) {
      if (!a.busy && !a.exhausted) a.passToken++;
    }
  }

  /**
   * Nhấn nhanh lượt nghỉ của account đang rảnh — dùng khi job sắp kết thúc
   * (đã đủ maxLimit) để tính waitMs về 0.
   */
  public skipRests(): void {
    for (const a of this.accounts) a.restingUntil = 0;
  }

  /**
   * Thời gian pool còn "sống": còn account chưa exhausted. Hết → job dừng,
   * kèm lý do để ghi error_msg rõ ràng (khác completed đủ quota).
   */
  public isAlive(): boolean {
    return this.accounts.some(a => !a.exhausted);
  }

  public stats(): PoolStats {
    const now = 0;
    const busy = this.accounts.filter(a => a.busy).length;
    const resting = this.accounts.filter(a => !a.busy && !a.exhausted && a.restingUntil > now).length;
    const exhausted = this.accounts.filter(a => a.exhausted).length;
    return {
      total: this.accounts.length,
      busy,
      resting,
      exhausted,
      idle: this.accounts.filter(a => !a.busy && !a.exhausted).length,
      activeSlots: busy,
    };
  }
}

/** Ms còn lại đến thời điểm pool có account sẵn sàng (0 nếu có ngay). */
export function poolWaitMs(pool: ScrapeSessionPool, now: number): number {
  const rest = pool['accounts'] as PoolAccount[];
  let min = 0;
  for (const a of rest) {
    if (a.busy || a.exhausted) continue;
    const remain = a.restingUntil - now;
    if (remain > min) min = remain;
  }
  return min;
}
