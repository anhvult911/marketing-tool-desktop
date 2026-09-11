/**
 * P4 — HÀNG ĐỢI MỤC TIÊU CHẠY NỀN ("chạy qua đêm").
 *
 * Bảng scrape_targets đã có sẵn danh sách mục tiêu (thêm qua /api/spam/targets).
 * Queue lấy lần lượt từng target CHƯA tới hạn chạy lại, gọi scraper tương ứng,
 * ghi last_scraped_at, nghỉ giữa target, dừng khi:
 *   - người dùng bấm dừng / job bị stop
 *   - hết account khả dụng (không đốt tiếp qua danh sách vô ích)
 *   - vượt trần thời gian chạy (mặc định 8 giờ)
 *   - hết target tới hạn
 *
 * Phần dưới là logic CHỌN VIỆC thuần túy (không DB/Playwright) → unit-test được.
 */

export interface QueueTarget {
  id: number;
  platform: string;
  targetValue: string;
  /** ISO/SQLite datetime lần cào gần nhất (null = chưa từng) */
  lastScrapedAt: string | null;
}

export interface QueueOutcome {
  cancelled: boolean;
  /** job kết thúc 'stopped' (người dùng dừng tay) */
  userStopped: boolean;
  /** job failed vì hết account khả dụng — chạy tiếp chỉ tốn thời gian */
  noAccounts: boolean;
  scraped: number;
  elapsedMs: number;
  maxRuntimeMs: number;
}

export type QueueAction = 'continue' | 'stop' | 'pause';

/** Parse datetime SQLite/ISO về ms; giá trị hỏng → 0 (coi như chưa từng chạy). */
export function parseQueueTime(value: string | null | undefined): number {
  if (!value) return 0;
  const t = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const ms = Date.parse(t);
  return isNaN(ms) ? 0 : ms;
}

/** Target tới hạn khi chưa từng cào, hoặc đã qua khoảng nghỉ tối thiểu. */
export function isTargetDue(target: QueueTarget, nowMs: number, minIntervalMs: number): boolean {
  const last = parseQueueTime(target.lastScrapedAt);
  if (last === 0) return true;
  return nowMs - last >= Math.max(0, minIntervalMs);
}

/**
 * Chọn target kế tiếp: tới hạn, chưa thử trong lượt này, ưu tiên target cũ nhất.
 * Trả null khi không còn việc.
 */
export function pickNextTarget(
  targets: QueueTarget[],
  nowMs: number,
  minIntervalMs: number,
  attempted: Set<number>
): QueueTarget | null {
  const due = targets.filter(t => !attempted.has(t.id) && isTargetDue(t, nowMs, minIntervalMs));
  if (due.length === 0) return null;
  // Cũ nhất trước (lastScrapedAt = 0 xếp đầu) → quét đều tay, không đói target nào
  due.sort((a, b) => parseQueueTime(a.lastScrapedAt) - parseQueueTime(b.lastScrapedAt));
  return due[0];
}

/** Quyết định sau mỗi target: chạy tiếp / dừng hẳn / tạm dừng chờ account. */
export function decideAfterOutcome(outcome: QueueOutcome): QueueAction {
  if (outcome.cancelled || outcome.userStopped) return 'stop';
  if (outcome.noAccounts) return 'pause';
  if (outcome.maxRuntimeMs > 0 && outcome.elapsedMs >= outcome.maxRuntimeMs) return 'stop';
  return 'continue';
}

/** Nhận diện job fail vì hết account khả dụng (khớp message của crawler). */
export function isNoAccountFailure(errorMsg: string | null | undefined): boolean {
  if (!errorMsg) return false;
  return errorMsg.includes('Không có account') || errorMsg.includes('Toàn bộ') && errorMsg.includes('account');
}
