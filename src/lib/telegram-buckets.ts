/**
 * P3 — TELEGRAM BUCKET ENUMERATION.
 *
 * Ô search thành viên trong group info (web.telegram.org/a) lọc SERVER-SIDE:
 * mỗi tiền tố trả về một lát thành viên khác nhau. Quét a-z + 0-9 + ký tự
 * tiếng Việt phá được trần "scroll 60 lần" của sidebar (chỉ ~vài nghìn đầu).
 *
 * Kèm WorkProgress: tiến độ theo từng hạng mục (target:bucket), lưu vào
 * scrape_jobs.last_cursor để job dừng giữa chừng RESUME đúng chỗ.
 *
 * Pure logic, không phụ thuộc Playwright/DB → unit-test được.
 */

const ASCII_LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '0123456789'.split('');
// Chữ cái tiếng Việt có dấu — tên VN viết đủ dấu vẫn phải vào bucket riêng
// (search của Telegram khớp nguyên ký tự, 'đ' không khớp 'd').
const VN_LETTERS = [
  'ă', 'â', 'đ', 'ê', 'ô', 'ơ', 'ư',
  'á', 'à', 'ả', 'ã', 'ạ', 'ắ', 'ằ', 'ẳ', 'ẵ', 'ặ', 'ấ', 'ầ', 'ẩ', 'ẫ', 'ậ',
  'é', 'è', 'ẻ', 'ẽ', 'ẹ', 'ế', 'ề', 'ể', 'ễ', 'ệ',
  'í', 'ì', 'ỉ', 'ĩ', 'ị',
  'ó', 'ò', 'ỏ', 'õ', 'ọ', 'ố', 'ồ', 'ổ', 'ỗ', 'ộ', 'ớ', 'ờ', 'ở', 'ỡ', 'ợ',
  'ú', 'ù', 'ủ', 'ũ', 'ụ', 'ứ', 'ừ', 'ử', 'ữ', 'ự',
  'ý', 'ỳ', 'ỷ', 'ỹ', 'ỵ',
];

/** Danh sách tiền tố search (đã khử trùng lặp, giữ thứ tự ổn định). */
export function buildSearchBuckets(): string[] {
  const keys = new Set<string>();
  for (const c of ASCII_LOWER) keys.add(c);
  for (const c of DIGITS) keys.add(c);
  for (const c of VN_LETTERS) keys.add(c);
  return Array.from(keys);
}

/** Hạng mục việc dạng "<targetIdx>:<bucket>" — đơn vị resume & chia worker. */
export function workItem(targetIdx: number, bucket: string): string {
  return `${targetIdx}:${bucket}`;
}

export function allWorkItems(targetCount: number, buckets: string[]): string[] {
  const items: string[] = [];
  for (let t = 0; t < targetCount; t++) {
    for (const b of buckets) items.push(workItem(t, b));
  }
  return items;
}

/**
 * Tiến độ công việc: hạng mục đã xong + chia shard cho từng worker.
 * `toJSON` lưu mảng hạng mục đã xong vào scrape_jobs.last_cursor; nạp lại
 * bằng `fromJSON` → job chạy lại chỉ làm phần còn thiếu.
 */
export class WorkProgress {
  private readonly all: string[];
  private readonly done: Set<string>;

  constructor(all: string[], completed: string[] = []) {
    this.all = all;
    const valid = new Set(all);
    this.done = new Set(completed.filter(item => valid.has(item)));
  }

  public isDone(item: string): boolean {
    return this.done.has(item);
  }

  public markDone(item: string): void {
    this.done.add(item);
  }

  public completed(): string[] {
    return this.all.filter(item => this.done.has(item));
  }

  public remainingCount(): number {
    return this.all.filter(item => !this.done.has(item)).length;
  }

  public total(): number {
    return this.all.length;
  }

  /** Hạng mục còn lại của worker thứ `workerIndex` (chia vòng theo tổng worker). */
  public remainingShard(workerIndex: number, workerCount: number): string[] {
    const wc = Math.max(1, workerCount | 0);
    const wi = Math.max(0, Math.min(workerIndex | 0, wc - 1));
    return this.all.filter((item, i) => i % wc === wi && !this.done.has(item));
  }

  public toJSON(): string {
    return JSON.stringify({ items: this.completed() });
  }

  public static fromJSON(all: string[], raw: string | null | undefined): WorkProgress {
    if (!raw) return new WorkProgress(all);
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && 'items' in parsed) {
        const items = parsed.items; // unknown — validated by Array.isArray below
        if (Array.isArray(items)) {
          return new WorkProgress(all, items.filter((x): x is string => typeof x === 'string'));
        }
      }
    } catch {
      // last_cursor cũ định dạng khác (hoặc rỗng) — bắt đầu lại, không crash job
    }
    return new WorkProgress(all);
  }
}

/**
 * Khoá dedup cho lead Telegram: username (không phân biệt hoa thường) là định
 * danh thật; thành viên không có username dùng tên hiển thị chuẩn hoá — ghi vào
 * platform riêng 'telegram_name' nên không thể trùng với lead nhắn được.
 */
export function telegramLeadKey(username: string | null | undefined, displayName: string): string {
  const u = (username || '').replace(/^@/, '').trim().toLowerCase();
  if (u) return `u:${u}`;
  const n = (displayName || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `n:${n}`;
}
