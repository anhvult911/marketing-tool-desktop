/**
 * P2 — TASK BOARD: điều phối kênh thu lead song song trên nhiều target.
 *
 * P1 khoá cả target cho 1 account → 1 target chỉ chạy được 1 chain/lúc, nên
 * "hybrid" (vừa cursor followers vừa engager trên cùng fanpage) không thể song song.
 * P2 tách quyền theo KÊNH:
 *
 *   - cursor  : chuỗi phân trang followers — TUẦN TỰ (khoá độc quyền/target)
 *   - group   : phân trang thành viên mbasic — TUẦN TỰ (khoá độc quyền/target)
 *   - post    : 1 bài viết đơn — TUẦN TỰ (khoá độc quyền/target)
 *   - friends : danh sách bạn bè DOM — TUẦN TỰ (khoá độc quyền/target)
 *   - engager : reaction/comment theo từng bài — SONG SONG qua post queue.
 *               Discovery (quét timeline lấy post ID) là single-flight (khoá),
 *               harvest (bóc reaction từng bài) không khoá — nhiều account pop
 *               queue chia nhau, không ai quét trùng.
 *
 * Nhờ vậy 1 target vẫn nhận nhiều account cùng lúc: 1 chạy cursor, 1 chạy engager,
 * 1 chạy friends — đúng mục tiêu "tối đa hoá lead".
 *
 * Pure logic, không phụ thuộc Playwright/DB → unit-test được.
 */

export type ScrapeChannel = 'cursor' | 'engager' | 'group' | 'post' | 'friends';
export type TargetKind = 'page' | 'group' | 'post';

export interface TaskTargetSpec {
  kind: TargetKind;
}

export interface ScrapeTaskBoardOptions {
  /** Giá trị scrapeType của job — quyết định kênh nào mở cho target page */
  scrapeType: string;
}

export interface ClaimedTask {
  targetIdx: number;
  channel: ScrapeChannel;
  /** engager: chain này phải chạy discovery timeline trước khi harvest */
  doDiscovery: boolean;
}

/** Kênh cần khoá độc quyền theo target (engager harvest thì không). */
const EXCLUSIVE_CHANNELS: readonly ScrapeChannel[] = ['cursor', 'group', 'post', 'friends'];
const ALL_CHANNELS: readonly ScrapeChannel[] = ['cursor', 'engager', 'group', 'post', 'friends'];

interface TargetState {
  kind: TargetKind;
  /** account đang giữ khoá từng kênh (null = rảnh) */
  locks: Record<ScrapeChannel, number | null>;
  finished: Record<ScrapeChannel, boolean>;
  discoveryDone: boolean;
  /** Post ID chờ harvest — pop atomic, chia cho mọi account */
  postQueue: string[];
  /** số task đang chạy trên target này (mọi kênh) */
  active: number;
}

export class ScrapeTaskBoard {
  private targets: TargetState[];
  private readonly scrapeType: string;

  constructor(specs: TaskTargetSpec[], opts: ScrapeTaskBoardOptions) {
    this.scrapeType = opts.scrapeType;
    this.targets = specs.map(s => ({
      kind: s.kind,
      locks: { cursor: null, engager: null, group: null, post: null, friends: null },
      finished: { cursor: false, engager: false, group: false, post: false, friends: false },
      discoveryDone: false,
      postQueue: [],
      active: 0,
    }));
  }

  public targetCount(): number {
    return this.targets.length;
  }

  public kindOf(targetIdx: number): TargetKind {
    return this.targets[targetIdx].kind;
  }

  /** Kênh mở cho 1 target theo loại target + scrapeType của job. */
  public channelsFor(targetIdx: number): ScrapeChannel[] {
    const t = this.targets[targetIdx];
    if (!t) return [];
    const st = this.scrapeType;

    // scrapeType ép luồng cho MỌI target (giữ hành vi cũ: members/post_commenters)
    if (st === 'members') return ['group'];
    if (st === 'post_commenters') return ['post'];

    if (t.kind === 'group') return ['group'];
    if (t.kind === 'post') return ['post'];

    // page / profile
    if (st === 'followers_only') return ['cursor'];
    if (st === 'engager_only') return ['engager'];
    // multi_tier / hybrid / kol_followers / chat_history → đa tầng thật sự:
    // followers + engager (reaction/comment) + friends song song.
    return ['cursor', 'engager', 'friends'];
  }

  /**
   * Xin 1 task. Ưu tiên kênh độc quyền (cursor/group/post/friends) trước để
   * chuỗi phân trang chạy sớm; sau đó mới tới engager.
   * Trả null khi không còn việc claim được ngay (đang bận hoặc đã xong).
   */
  public claim(accountId: number): ClaimedTask | null {
    for (const ch of EXCLUSIVE_CHANNELS) {
      for (let i = 0; i < this.targets.length; i++) {
        const t = this.targets[i];
        if (t.finished[ch] || t.locks[ch] !== null) continue;
        if (!this.channelsFor(i).includes(ch)) continue;
        t.locks[ch] = accountId;
        t.active++;
        return { targetIdx: i, channel: ch, doDiscovery: false };
      }
    }

    // engager: harvest song song từ queue (không khoá); discovery thì single-flight
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (t.finished.engager) continue;
      if (!this.channelsFor(i).includes('engager')) continue;
      if (t.postQueue.length > 0) {
        t.active++;
        return { targetIdx: i, channel: 'engager', doDiscovery: false };
      }
      if (!t.discoveryDone && t.locks.engager === null) {
        t.locks.engager = accountId;
        t.active++;
        return { targetIdx: i, channel: 'engager', doDiscovery: true };
      }
    }
    return null;
  }

  /** Trả task sau khi chain kết thúc (kể cả lỗi/launch fail). */
  public release(task: ClaimedTask, accountId: number): void {
    const t = this.targets[task.targetIdx];
    if (!t) return;
    t.active = Math.max(0, t.active - 1);
    // Nhả MỌI khoá target này còn giữ bởi account — chống kẹt khoá khi worker chết
    // giữa chain (release gọi trong finally).
    for (const ch of ALL_CHANNELS) {
      if (t.locks[ch] === accountId) t.locks[ch] = null;
    }
  }

  public markFinished(targetIdx: number, channel: ScrapeChannel): void {
    const t = this.targets[targetIdx];
    if (t) t.finished[channel] = true;
  }

  public enqueuePosts(targetIdx: number, ids: string[]): void {
    const t = this.targets[targetIdx];
    if (!t) return;
    for (const id of ids) {
      if (id && !t.postQueue.includes(id)) t.postQueue.push(id);
    }
    if (t.postQueue.length > 0) t.finished.engager = false;
  }

  /** Pop atomic (JS single-thread) — nhiều account chia nhau bài, không trùng. */
  public popPost(targetIdx: number): string | null {
    const t = this.targets[targetIdx];
    if (!t) return null;
    return t.postQueue.shift() ?? null;
  }

  public discoveryDone(targetIdx: number): boolean {
    return this.targets[targetIdx]?.discoveryDone ?? true;
  }

  public markDiscoveryDone(targetIdx: number): void {
    const t = this.targets[targetIdx];
    if (!t) return;
    t.discoveryDone = true;
    // Discovery xong + queue rỗng → hết việc engager cho target này
    if (t.postQueue.length === 0) t.finished.engager = true;
  }

  /** Gọi sau mỗi lần popPost: queue cạn + discovery xong → đóng kênh engager. */
  public notePostDrained(targetIdx: number): void {
    const t = this.targets[targetIdx];
    if (!t) return;
    if (t.discoveryDone && t.postQueue.length === 0) t.finished.engager = true;
  }

  /** Còn việc claim được ngay (kể cả đang có task chạy dở chờ release không tính). */
  public claimableNow(accountId: number): boolean {
    return this.peekClaimable(accountId);
  }

  /** Còn task nào claim được hoặc đang chạy — dùng để quyết định worker dừng hay chờ. */
  public hasWork(accountId: number): boolean {
    if (this.activeCount() > 0) return true;
    return this.peekClaimable(accountId);
  }

  public isExhausted(accountId: number): boolean {
    return this.activeCount() === 0 && !this.peekClaimable(accountId);
  }

  private activeCount(): number {
    let n = 0;
    for (const t of this.targets) n += t.active;
    return n;
  }

  private peekClaimable(accountId: number): boolean {
    for (const ch of EXCLUSIVE_CHANNELS) {
      for (let i = 0; i < this.targets.length; i++) {
        const t = this.targets[i];
        if (t.finished[ch] || t.locks[ch] !== null) continue;
        if (this.channelsFor(i).includes(ch)) return true;
      }
    }
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      if (t.finished.engager) continue;
      if (!this.channelsFor(i).includes('engager')) continue;
      if (t.postQueue.length > 0) return true;
      if (!t.discoveryDone && t.locks.engager === null) return true;
    }
    return false;
  }
}
