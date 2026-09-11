/**
 * P4 — RUNNER hàng đợi mục tiêu chạy nền (in-process trong Next server).
 *
 * Chạy tuần tự từng target tới hạn: tạo scrape_jobs row → gọi scraper tương ứng
 * → chờ xong → ghi last_scraped_at → nghỉ giữa target. Trạng thái giữ trong
 * module singleton để UI poll qua API.
 *
 * An toàn khi chạy chung với job thủ công: scrapeLimiter + telegramScrapeLimiter
 * điều tiết slot; account cooldown/daily quota chia sẻ qua DB.
 */
import db, { getSetting } from './db';
import { runFacebookScrapeJob } from './facebook-crawler';
import { runTelegramScrapeJob } from './telegram-crawler';
import {
  QueueTarget,
  pickNextTarget,
  decideAfterOutcome,
  isNoAccountFailure,
} from './scrape-queue';

export type QueueStatus = 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'failed';

export interface ScrapeQueueState {
  status: QueueStatus;
  startedAt: number | null;
  finishedAt: number | null;
  /** target hiện tại đang cào */
  currentTargetId: number | null;
  currentTargetValue: string | null;
  processed: number;
  totalDue: number;
  scraped: number;
  lastMessage: string | null;
  maxRuntimeMs: number;
  minIntervalMs: number;
}

interface QueueConfig {
  workspaceId: number;
  maxRuntimeMs: number;
  minIntervalMs: number;
  maxLimitPerTarget: number;
  scrapeType: string;
  accountIds?: number[];
  parallelSessions?: number;
  sleepBetweenTargetsMs: number;
}

const IDLE: ScrapeQueueState = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  currentTargetId: null,
  currentTargetValue: null,
  processed: 0,
  totalDue: 0,
  scraped: 0,
  lastMessage: null,
  maxRuntimeMs: 0,
  minIntervalMs: 0,
};

let state: ScrapeQueueState = { ...IDLE };
let cancelFlag = { cancelled: false };
let running: Promise<void> | null = null;

/** Chỉ 1 hàng đợi chạy mỗi lúc (singleton per-process). */
export function getScrapeQueueState(): ScrapeQueueState {
  return { ...state };
}

function loadDueTargets(workspaceId: number): QueueTarget[] {
  const rows = db.prepare(`
    SELECT id, platform, target_value, last_scraped_at
    FROM scrape_targets
    WHERE workspace_id = ? AND is_active = 1
      AND platform IN ('facebook', 'messenger', 'telegram')
    ORDER BY COALESCE(last_scraped_at, '') ASC, id ASC
  `).all(workspaceId) as Array<{ id: number; platform: string; target_value: string; last_scraped_at: string | null }>;
  return rows.map(r => ({
    id: r.id,
    platform: r.platform,
    targetValue: r.target_value,
    lastScrapedAt: r.last_scraped_at,
  }));
}

function createScrapeJob(config: QueueConfig, target: QueueTarget): number {
  const res = db.prepare(`
    INSERT INTO scrape_jobs (
      workspace_id, platform, target_group, status, total_count, scraped_count,
      auto_import, target_campaign_id, scrape_type, max_limit, custom_tag, account_id, account_ids
    )
    VALUES (?, ?, ?, 'pending', 0, 0, 1, NULL, ?, ?, ?, ?, ?)
  `).run(
    config.workspaceId,
    target.platform,
    target.targetValue,
    config.scrapeType,
    config.maxLimitPerTarget,
    `Queue_Target_${target.id}`,
    config.accountIds && config.accountIds.length > 0 ? config.accountIds[0] : null,
    config.accountIds && config.accountIds.length > 0 ? JSON.stringify(config.accountIds) : null
  );
  return Number(res.lastInsertRowid);
}

function markTargetScraped(targetId: number): void {
  db.prepare(`UPDATE scrape_targets SET last_scraped_at = CURRENT_TIMESTAMP WHERE id = ?`).run(targetId);
}

/** Xoá last_cursor của job mới để không resume nhầm cursor job cũ. */
function resetJobCursor(jobId: number): void {
  db.prepare(`UPDATE scrape_jobs SET last_cursor = NULL, resume_target_idx = 0 WHERE id = ?`).run(jobId);
}

async function runQueue(config: QueueConfig): Promise<void> {
  const attempted = new Set<number>();
  const startedAt = Date.now();

  while (!cancelFlag.cancelled) {
    const elapsedMs = Date.now() - startedAt;
    if (config.maxRuntimeMs > 0 && elapsedMs >= config.maxRuntimeMs) {
      state = { ...state, status: 'completed', finishedAt: Date.now(), lastMessage: 'Đã đạt trần thời gian chạy — dừng hàng đợi.' };
      return;
    }

    const all = loadDueTargets(config.workspaceId);
    const next = pickNextTarget(all, Date.now(), config.minIntervalMs, attempted);
    if (!next) {
      state = {
        ...state,
        status: 'completed',
        finishedAt: Date.now(),
        currentTargetId: null,
        currentTargetValue: null,
        lastMessage: attempted.size === 0
          ? 'Không có mục tiêu nào tới hạn — tất cả vừa được cào gần đây.'
          : `Đã xử lý ${attempted.size} mục tiêu tới hạn.`,
      };
      return;
    }

    state = {
      ...state,
      status: 'running',
      currentTargetId: next.id,
      currentTargetValue: next.targetValue,
      lastMessage: `Đang cào: ${next.platform} · ${next.targetValue}`,
    };

    const jobId = createScrapeJob(config, next);
    // Job mới phải bắt đầu từ đầu danh sách (không resume cursor của job khác)
    resetJobCursor(jobId);

    try {
      if (next.platform === 'telegram') {
        // Telegram queue: 1 mục tiêu/target, dùng bucket enumeration đầy đủ
        await runTelegramScrapeJob({
          jobId,
          workspaceId: config.workspaceId,
          platform: 'telegram',
          targetGroup: next.targetValue,
          accountIds: config.accountIds,
          maxLimit: config.maxLimitPerTarget,
          autoImport: true,
          scrapeType: 'members',
          customTag: `Queue_Target_${next.id}`,
          parallelSessions: config.parallelSessions,
        });
      } else {
        await runFacebookScrapeJob({
          jobId,
          workspaceId: config.workspaceId,
          platform: next.platform,
          targetGroup: next.targetValue,
          accountIds: config.accountIds,
          maxLimit: config.maxLimitPerTarget,
          autoImport: true,
          scrapeType: config.scrapeType,
          customTag: `Queue_Target_${next.id}`,
          parallelSessions: config.parallelSessions,
        });
      }
    } catch (err: unknown) {
      console.error(`[ScrapeQueue] Target #${next.id} lỗi:`, err instanceof Error ? err.message : err);
    }

    attempted.add(next.id);
    const job = db.prepare(`SELECT status, scraped_count, error_msg FROM scrape_jobs WHERE id = ?`).get(jobId) as
      { status: string; scraped_count: number; error_msg: string | null } | undefined;
    const jobScraped = job?.scraped_count || 0;

    state = {
      ...state,
      processed: attempted.size,
      scraped: state.scraped + jobScraped,
      currentTargetId: null,
      currentTargetValue: null,
    };

    // Ghi mốc đã cào — kể cả khi 0 lead: tránh vòng lặp cào lại ngay target đó
    markTargetScraped(next.id);

    const action = decideAfterOutcome({
      cancelled: cancelFlag.cancelled,
      userStopped: job?.status === 'stopped',
      noAccounts: job?.status === 'failed' && isNoAccountFailure(job?.error_msg),
      scraped: jobScraped,
      elapsedMs: Date.now() - startedAt,
      maxRuntimeMs: config.maxRuntimeMs,
    });

    if (action === 'stop') {
      state = {
        ...state,
        status: cancelFlag.cancelled || job?.status === 'stopped' ? 'stopped' : 'completed',
        finishedAt: Date.now(),
        lastMessage: job?.status === 'stopped'
          ? 'Job bị dừng — kết thúc hàng đợi.'
          : 'Đã dừng hàng đợi.',
      };
      return;
    }
    if (action === 'pause') {
      state = {
        ...state,
        status: 'paused',
        finishedAt: Date.now(),
        lastMessage: `Tạm dừng: ${job?.error_msg || 'hết account khả dụng'}`,
      };
      return;
    }

    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, Math.max(0, config.sleepBetweenTargetsMs));
    await promise;
  }

  state = { ...state, status: 'stopped', finishedAt: Date.now(), lastMessage: 'Hàng đợi đã dừng.' };
}

export interface StartQueueOptions {
  workspaceId: number;
  /** trần thời gian chạy, giờ (0 = không giới hạn) */
  maxRuntimeHours?: number;
  /** khoảng nghỉ tối thiểu giữa 2 lần cào cùng target, giờ */
  minIntervalHours?: number;
  maxLimitPerTarget?: number;
  scrapeType?: string;
  accountIds?: number[];
  parallelSessions?: number;
  sleepBetweenTargetsSec?: number;
}

export function startScrapeQueue(opts: StartQueueOptions): { ok: boolean; message: string; state: ScrapeQueueState } {
  if (state.status === 'running') {
    return { ok: false, message: 'Hàng đợi đang chạy — dừng trước khi bắt đầu lượt mới.', state: getScrapeQueueState() };
  }

  const dueCount = loadDueTargets(opts.workspaceId).length;
  const minIntervalHours = opts.minIntervalHours ?? 6;
  const maxRuntimeHours = opts.maxRuntimeHours ?? 8;

  const config: QueueConfig = {
    workspaceId: opts.workspaceId,
    maxRuntimeMs: maxRuntimeHours > 0 ? maxRuntimeHours * 3600_000 : 0,
    minIntervalMs: Math.max(0, minIntervalHours * 3600_000),
    maxLimitPerTarget: Math.max(50, opts.maxLimitPerTarget ?? 5000),
    scrapeType: opts.scrapeType || 'multi_tier',
    accountIds: opts.accountIds,
    parallelSessions: opts.parallelSessions,
    sleepBetweenTargetsMs: Math.max(5_000, (opts.sleepBetweenTargetsSec ?? 30) * 1000),
  };

  cancelFlag = { cancelled: false };
  state = {
    ...IDLE,
    status: 'running',
    startedAt: Date.now(),
    totalDue: dueCount,
    maxRuntimeMs: config.maxRuntimeMs,
    minIntervalMs: config.minIntervalMs,
    lastMessage: `Bắt đầu hàng đợi: ${dueCount} mục tiêu, nghỉ tối thiểu ${minIntervalHours}h, trần ${maxRuntimeHours}h.`,
  };

  running = runQueue(config)
    .catch(err => {
      console.error('[ScrapeQueue] Fatal:', err instanceof Error ? err.message : err);
      state = { ...state, status: 'failed', finishedAt: Date.now(), lastMessage: err instanceof Error ? err.message : String(err) };
    })
    .finally(() => { running = null; });

  return { ok: true, message: state.lastMessage || 'Đã bắt đầu hàng đợi.', state: getScrapeQueueState() };
}

export function stopScrapeQueue(): ScrapeQueueState {
  cancelFlag.cancelled = true;
  const prev = state.status;
  if (prev === 'paused') {
    // Queue đã tự tạm dừng (hết account) — người dùng bấm dừng = kết thúc hẳn.
    state = { ...state, status: 'stopped', finishedAt: state.finishedAt ?? Date.now(), lastMessage: 'Đã dừng hàng đợi (trước đó tạm dừng do hết account).' };
  } else if (prev === 'running') {
    // Đang cào dở: đánh dấu ý định dừng, vòng lặp sẽ chốt 'stopped' sau target hiện tại.
    state = { ...state, lastMessage: 'Đang dừng sau khi target hiện tại kết thúc...' };
  }
  return getScrapeQueueState();
}
