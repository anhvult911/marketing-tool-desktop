import db from '../src/lib/db';
import localQueue from '../src/lib/queue';
import { browserLimiter } from '../src/lib/concurrency';
import { sendDesktopNotification } from '../src/lib/notify';
import { XAutomation, ZaloAutomation, TelegramAutomation, ThreadsAutomation, MockAutomation, NewF319Automation, FacebookAutomation, WhatsAppAutomation } from './automation';
import { seedingWatcher } from './seeding-watcher';

console.log('===================================================');
console.log('🤖 MKT TOOLS DESKTOP WORKER STARTED (SQLite & Event Queue)');
console.log('===================================================');

export interface WorkerJob {
  id: number;
  workspace_id?: number;
  account_id?: number;
  type: string;
  post_content?: string | null;
  media_paths?: string | null;
  target_url?: string | null;
  status?: string;
  scheduled_at?: string | null;
  run_at?: string | null;
  post_url?: string | null;
  error_log?: string | null;
  campaign_id?: string | null;
  platform?: string;
  username?: string;
  password?: string;
  email?: string;
  user_data_dir?: string;
  auth_token?: string;
  host?: string;
  port?: number;
  proxy_user?: string;
  proxy_pass?: string;
  proxy_proto?: string;
}

// Helper function to format and send desktop notifications based on job type
function notifyJobResult(
  job: WorkerJob,
  success: boolean,
  options: {
    accStatus?: 'live' | 'checkpoint' | 'die' | 'unknown';
    errorMsg?: string;
    postUrl?: string | null;
  }
) {
  const platform = (job.platform || 'x').toUpperCase();
  const username = job.username ? `@${job.username}` : (job.account_id ? `Tài khoản #${job.account_id}` : 'Tài khoản');
  const { accStatus, errorMsg } = options;

  if (job.type === 'check_status') {
    if (success) {
      if (accStatus === 'live') {
        // Tài khoản Live bình thường - Không gửi toast notification để tránh làm phiền người dùng
        console.log(`[Worker] ✅ Kiểm tra tài khoản ${username} (${platform}): Trạng thái Live.`);
      } else if (accStatus === 'checkpoint') {
        sendDesktopNotification(
          'Tài khoản bị Checkpoint ⚠️',
          `Tài khoản ${username} (${platform}) gặp checkpoint, cần xác minh mở khóa.`
        );
      } else if (accStatus === 'die') {
        sendDesktopNotification(
          'Tài khoản bị Khóa/Die ❌',
          `Tài khoản ${username} (${platform}) đã bị vô hiệu hóa hoặc sai thông tin đăng nhập.`
        );
      } else {
        console.log(`[Worker] ℹ️ Kiểm tra tài khoản ${username} (${platform}): Trạng thái ${accStatus}.`);
      }
    } else {
      sendDesktopNotification(
        'Lỗi kiểm tra tài khoản ⚠️',
        `Không thể kiểm tra ${username} (${platform}): ${(errorMsg || 'Lỗi mạng hoặc trình duyệt').slice(0, 80)}`
      );
    }
    return;
  }

  if (job.type === 'post' || job.type === 'threads_post' || String(job.type).endsWith('_post')) {
    if (success) {
      sendDesktopNotification(
        'Đăng bài thành công ✅',
        `Đã xuất bản bài viết #${job.id} lên ${platform} cho ${username}`
      );
    } else {
      sendDesktopNotification(
        'Đăng bài thất bại ❌',
        `Bài #${job.id} (${username} - ${platform}): ${(errorMsg || 'Lỗi không xác định').slice(0, 80)}`
      );
    }
    return;
  }

  if (job.type === 'comment' || String(job.type).endsWith('_comment')) {
    if (success) {
      sendDesktopNotification(
        'Bình luận thành công 💬',
        `Đã hoàn thành bình luận #${job.id} trên ${platform} cho ${username}`
      );
    } else {
      sendDesktopNotification(
        'Bình luận thất bại ❌',
        `Bình luận #${job.id} (${username} - ${platform}): ${(errorMsg || 'Lỗi không xác định').slice(0, 80)}`
      );
    }
    return;
  }

  if (job.type === 'zalo_message' || job.type === 'telegram_message' || String(job.type).endsWith('_message')) {
    let appName = platform;
    if (job.type.includes('zalo')) appName = 'Zalo';
    else if (job.type.includes('telegram')) appName = 'Telegram';
    else if (job.type.includes('facebook') || job.type.includes('messenger')) appName = 'Messenger';
    else if (job.type.includes('whatsapp')) appName = 'WhatsApp';
    const target = job.target_url || 'người nhận';
    if (success) {
      sendDesktopNotification(
        `Gửi tin nhắn ${appName} thành công 📩`,
        `Đã gửi tin nhắn #${job.id} đến ${target}`
      );
    } else {
      sendDesktopNotification(
        `Gửi tin nhắn ${appName} thất bại ❌`,
        `Tin nhắn #${job.id} (${target}): ${(errorMsg || 'Lỗi không xác định').slice(0, 80)}`
      );
    }
    return;
  }

  // Fallback cho các loại tác vụ khác
  if (success) {
    sendDesktopNotification(
      'Tác vụ hoàn tất ✅',
      `Tác vụ #${job.id} (${job.type}) đã hoàn thành cho ${username}`
    );
  } else {
    sendDesktopNotification(
      'Tác vụ thất bại ⚠️',
      `Tác vụ #${job.id} (${job.type}) thất bại: ${(errorMsg || 'Lỗi không xác định').slice(0, 80)}`
    );
  }
}

// Helper function to execute automation details
async function executeJob(job: WorkerJob) {
  const account = {
    username: job.username,
    password: job.password,
    email: job.email,
    user_data_dir: job.user_data_dir,
    auth_token: job.auth_token
  };

  const proxy = job.host ? {
    host: job.host,
    port: job.port || 80,
    username: job.proxy_user,
    password: job.proxy_pass,
    protocol: job.proxy_proto || 'http'
  } : undefined;

  let success = false;
  let postUrl: string | null = null;
  let errorMsg = '';
  let accStatus: 'live' | 'checkpoint' | 'die' | 'unknown' | undefined = undefined;
  const platform = job.platform || 'x';

  try {
    if (job.type === 'check_status') {
      accStatus = 'unknown';
      if (platform === 'x') {
        accStatus = await XAutomation.checkLive(account, proxy);
      } else if (platform === 'zalo') {
        accStatus = await ZaloAutomation.checkLive(account, proxy);
      } else if (platform === 'whatsapp') {
        accStatus = await WhatsAppAutomation.checkLive(account, proxy);
      } else if (platform === 'telegram') {
        accStatus = await TelegramAutomation.checkLive(account, proxy);
      } else if (platform === 'threads') {
        accStatus = await ThreadsAutomation.checkLive(account, proxy);
      } else if (platform === 'facebook') {
        accStatus = await FacebookAutomation.checkLive(account, proxy);
      } else if (platform === 'newf319') {
        accStatus = await NewF319Automation.checkLive(account, proxy);
      } else {
        accStatus = await MockAutomation.checkLive(platform, account, proxy);
      }
      
      db.prepare(`
        UPDATE social_accounts 
        SET status = ?, last_checked = ? 
        WHERE id = ?
      `).run(accStatus, new Date().toISOString(), job.account_id);
      success = true;
    } 
    else if (job.type === 'post' || job.type === 'threads_post' || job.type.endsWith('_post')) {
      if (!job.post_content) throw new Error('Post content is empty');
      
      let mediaPaths: string[] = [];
      if (job.media_paths) {
        try {
          mediaPaths = JSON.parse(job.media_paths);
        } catch {
          mediaPaths = job.media_paths.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      }
      
      let result: boolean | string = false;
      if (platform === 'x') {
        result = await XAutomation.post(account, proxy, job.post_content, mediaPaths);
      } else if (platform === 'threads') {
        result = await ThreadsAutomation.post(account, proxy, job.post_content, mediaPaths);
      } else if (platform === 'facebook') {
        result = await FacebookAutomation.post(account, proxy, job.post_content, mediaPaths);
      } else if (platform === 'newf319') {
        result = await NewF319Automation.post(account, proxy, job.target_url || '', job.post_content, mediaPaths);
      } else if (platform === 'whatsapp' && (job.type === 'whatsapp_group_post' || job.type.includes('group'))) {
        result = await WhatsAppAutomation.postGroupMessage(account, proxy, job.target_url || '', job.post_content, mediaPaths);
      } else {
        result = await MockAutomation.post(platform, account, proxy, job.post_content, mediaPaths);
      }
      
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    } 
    else if (job.type === 'comment' || job.type.endsWith('_comment')) {
      if (!job.target_url) throw new Error('Target url is empty');
      if (!job.post_content) throw new Error('Post content is empty');
      
      let result: boolean | string = false;
      if (platform === 'x') {
        result = await XAutomation.comment(account, proxy, job.target_url, job.post_content);
      } else if (platform === 'threads') {
        result = await ThreadsAutomation.comment(account, proxy, job.target_url, job.post_content);
      } else if (platform === 'facebook') {
        result = await FacebookAutomation.comment(account, proxy, job.target_url, job.post_content);
      } else if (platform === 'newf319') {
        result = await NewF319Automation.comment(account, proxy, job.target_url, job.post_content);
      } else {
        result = await MockAutomation.comment(platform, account, proxy, job.target_url, job.post_content);
      }
      
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    } 
    else if (job.type === 'zalo_message') {
      const result = await ZaloAutomation.sendMessage(account, proxy, job.target_url || '', job.post_content || '');
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    } 
    else if (job.type === 'telegram_message') {
      const result = await TelegramAutomation.sendMessage(account, proxy, job.target_url || '', job.post_content || '', []);
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    }
    else if (job.type === 'facebook_message' || job.type === 'messenger_message' || (job.type.includes('message') && platform === 'facebook')) {
      const result = await FacebookAutomation.sendMessage(account, proxy, job.target_url || '', job.post_content || '');
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    }
    else if (job.type === 'whatsapp_message' || (job.type.includes('message') && platform === 'whatsapp')) {
      const result = await WhatsAppAutomation.sendMessage(account, proxy, job.target_url || '', job.post_content || '');
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    errorMsg = error.message || 'Lỗi không xác định khi tự động hóa';
    success = false;
    console.error(`[Worker Error] Job #${job.id}:`, errorMsg);
  }

  if (success) {
    localQueue.markCompleted(job.id, postUrl);
    console.log(`[Worker] Job #${job.id} completed successfully.`);
  } else {
    localQueue.markFailed(job.id, errorMsg);
  }

  // Cập nhật trạng thái CRM (spam_leads) nếu job này có target_url từ lead
  if (job.target_url) {
    try {
      if (success) {
        db.prepare(`UPDATE spam_leads SET status = 'sent', last_attempt = CURRENT_TIMESTAMP WHERE value = ?`).run(job.target_url);
      } else {
        db.prepare(`UPDATE spam_leads SET status = 'failed', last_attempt = CURRENT_TIMESTAMP WHERE value = ?`).run(job.target_url);
      }
    } catch {}
  }

  // CIRCUIT BREAKER / AUTO-FAILOVER: Nếu tài khoản bị Checkpoint hoặc Action Blocked,
  // tự động tạm dừng (pause) các job pending còn lại của tài khoản này trong chiến dịch để cứu tài khoản!
  const isCheckpoint = errorMsg.includes('checkpoint') || errorMsg.includes('Chặn tương tác') || errorMsg.includes('Action Blocked') || errorMsg.includes('tạm thời bị khóa') || errorMsg.includes('bị khóa');
  const isDeadSession = errorMsg.includes('chưa được đăng nhập') || errorMsg.includes('hết phiên') || errorMsg.includes('vô hiệu hóa') || errorMsg.includes('login_form');

  if (job.account_id && (isCheckpoint || isDeadSession)) {
    const newStatus = isCheckpoint ? 'checkpoint' : 'die';
    const cooldownHours = isCheckpoint ? 1 : 4;
    console.warn(`[Worker Protection] 🛡️ Tài khoản @${job.username || job.account_id} gặp ${newStatus.toUpperCase()} — bật cơ chế bảo vệ tự động!`);
    try {
      db.prepare(`
        UPDATE social_accounts 
        SET status = ?, cooldown_until = datetime('now', '+' || ? || ' hours'), last_checked = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(newStatus, cooldownHours, job.account_id);

      if (job.campaign_id) {
        const pausedRes = db.prepare(`
          UPDATE jobs 
          SET status = 'paused', error_log = ? 
          WHERE account_id = ? AND campaign_id = ? AND status = 'pending'
        `).run(`Tự động tạm dừng để bảo vệ tài khoản do gặp ${newStatus}: ${errorMsg.slice(0, 150)}`, job.account_id, job.campaign_id);
        
        if (pausedRes.changes > 0) {
          console.warn(`[Worker Protection] 🛡️ Đã tạm dừng an toàn ${pausedRes.changes} tác vụ pending còn lại của @${job.username} trong chiến dịch ${job.campaign_id}.`);
          sendDesktopNotification(
            'Bảo vệ tài khoản chiến dịch 🛡️',
            `Đã tạm dừng an toàn ${pausedRes.changes} tác vụ của @${job.username} để ngăn Facebook khóa tài khoản vĩnh viễn.`
          );
        }
      }
    } catch (e: any) {
      console.error('[Worker Protection] Lỗi khi xử lý auto-failover:', e.message);
    }
  }

  notifyJobResult(job, success, { accStatus, errorMsg, postUrl });
  if (!success) {
    console.error(`[Worker] Job #${job.id} (@${job.username || 'Hệ thống'}) failed:`, errorMsg);
  }
}

// Lắng nghe sự kiện xử lý job từ localQueue (Có điều tiết Concurrency)
localQueue.on('process-job', async (job: WorkerJob) => {
  const stats = browserLimiter.getStats();
  console.log(`[Worker] Nhận job #${job.id} (${job.type}) cho @${job.username || 'System'}. (Đang chạy: ${stats.active}/${stats.max}, Đang chờ: ${stats.queued})`);
  
  browserLimiter.run(async () => {
    console.log(`[Worker] Bắt đầu thực thi job #${job.id} (${job.type})`);
    await executeJob(job);
  }).catch((err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[Worker Limiter Error] Job #${job.id}:`, error.message);
  });
});

// Khởi động vòng lặp polling hàng đợi
localQueue.startWorker(3000);
console.log('[Worker] Queue polling loop active (every 3000ms).');

// Khởi động Daemon Canh bài mới & Tự động Seeding (chu kỳ 3 phút)
seedingWatcher.start(3);

// Xử lý đóng an toàn
process.on('SIGINT', () => {
  console.log('[Worker] Received SIGINT. Shutting down gracefully...');
  seedingWatcher.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM. Shutting down gracefully...');
  seedingWatcher.stop();
  process.exit(0);
});
