import db from './db';
import EventEmitter from 'events';

class LocalQueueManager extends EventEmitter {
  private isProcessing = false;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Không tự động poll trong constructor để tránh xung đột giữa tiến trình Next.js và Worker
  }

  // Khởi động tiến trình xử lý worker
  public startWorker(intervalMs: number = 3000) {
    try {
      // Khôi phục các job bị kẹt ở trạng thái 'processing' khi app bị đóng đột ngột
      const resetResult = db.prepare(`
        UPDATE jobs 
        SET status = 'pending' 
        WHERE status = 'processing'
      `).run();
      if (resetResult.changes > 0) {
        console.log(`[LocalQueue] Đã khôi phục ${resetResult.changes} job bị kẹt về trạng thái 'pending'.`);
      }
    } catch (e: any) {
      console.warn('[LocalQueue] Không thể khôi phục job cũ:', e.message);
    }

    this.startPolling(intervalMs);
    this.triggerProcess();
  }

  // Thêm job mới vào database
  public addJob(data: {
    workspace_id?: number;
    account_id?: number;
    type: string;
    post_content?: string;
    media_paths?: string[];
    target_url?: string;
    scheduled_at?: string;
  }): number {
    const stmt = db.prepare(`
      INSERT INTO jobs (workspace_id, account_id, type, post_content, media_paths, target_url, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    const result = stmt.run(
      data.workspace_id || 1,
      data.account_id || null,
      data.type,
      data.post_content || null,
      data.media_paths ? JSON.stringify(data.media_paths) : null,
      data.target_url || null,
      data.scheduled_at || new Date().toISOString()
    );

    return Number(result.lastInsertRowid);
  }

  public startPolling(intervalMs: number = 3000) {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.triggerProcess();
    }, intervalMs);
  }

  public async triggerProcess() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date().toISOString();
      const job = db.prepare(`
        SELECT jobs.*, 
               social_accounts.platform, social_accounts.username, social_accounts.password, social_accounts.email, social_accounts.user_data_dir, social_accounts.auth_token,
               proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
        FROM jobs
        LEFT JOIN social_accounts ON jobs.account_id = social_accounts.id
        LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
        WHERE jobs.status = 'pending' AND (jobs.scheduled_at IS NULL OR jobs.scheduled_at <= ?)
        ORDER BY jobs.scheduled_at ASC, jobs.id ASC
        LIMIT 1
      `).get(now) as any;

      if (job) {
        db.prepare(`UPDATE jobs SET status = 'processing' WHERE id = ?`).run(job.id);
        this.emit('process-job', job);
      }
    } catch (err: any) {
      console.error('[LocalQueue] Lỗi khi quét hàng đợi:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  public markCompleted(jobId: number, postUrl?: string | null) {
    db.prepare(`
      UPDATE jobs 
      SET status = 'completed', run_at = ?, post_url = ? 
      WHERE id = ?
    `).run(new Date().toISOString(), postUrl || null, jobId);
    this.triggerProcess();
  }

  public markFailed(jobId: number, errorMessage: string) {
    db.prepare(`
      UPDATE jobs 
      SET status = 'failed', run_at = ?, error_log = ? 
      WHERE id = ?
    `).run(new Date().toISOString(), errorMessage, jobId);
    this.triggerProcess();
  }
}

export const localQueue = new LocalQueueManager();

// Hàm tương thích ngược với code cũ
export async function enqueueJob(_jobId: number, _scheduledAt?: string): Promise<void> {
  localQueue.triggerProcess();
}

export const redisConnection = {};

export default localQueue;
