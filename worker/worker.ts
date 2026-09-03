import db from '../src/lib/db';
import localQueue from '../src/lib/queue';
import { browserLimiter } from '../src/lib/concurrency';
import { XAutomation, ZaloAutomation, TelegramAutomation, ThreadsAutomation, MockAutomation, NewF319Automation, FacebookAutomation, WhatsAppAutomation } from './automation';

console.log('===================================================');
console.log('🤖 MKT TOOLS DESKTOP WORKER STARTED (SQLite & Event Queue)');
console.log('===================================================');

// Helper function to execute automation details
async function executeJob(job: any) {
  const account = {
    username: job.username,
    password: job.password,
    email: job.email,
    user_data_dir: job.user_data_dir,
    auth_token: job.auth_token
  };

  const proxy = job.host ? {
    host: job.host,
    port: job.port,
    username: job.proxy_user,
    password: job.proxy_pass,
    protocol: job.proxy_proto
  } : undefined;

  let success = false;
  let postUrl: string | null = null;
  let errorMsg = '';
  const platform = job.platform || 'x';

  try {
    if (job.type === 'check_status') {
      let accStatus: 'live' | 'checkpoint' | 'die' | 'unknown' = 'unknown';
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
        result = await NewF319Automation.post(account, proxy, job.target_url, job.post_content, mediaPaths);
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
      } else {
        result = await MockAutomation.comment(platform, account, proxy, job.target_url, job.post_content);
      }
      
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    }
    else if (job.type === 'zalo_message') {
      const result = await ZaloAutomation.sendMessage(account, proxy, job.target_url, job.post_content);
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    }
    else if (job.type === 'telegram_message') {
      const result = await TelegramAutomation.sendMessage(account, proxy, job.target_url, job.post_content, []);
      if (result) {
        success = true;
        if (typeof result === 'string') postUrl = result;
      }
    }
  } catch (err: any) {
    errorMsg = err.message || 'Lỗi không xác định khi tự động hóa';
    success = false;
    console.error(`[Worker Error] Job #${job.id}:`, errorMsg);
  }

  if (success) {
    localQueue.markCompleted(job.id, postUrl);
    console.log(`[Worker] Job #${job.id} completed successfully.`);
  } else {
    localQueue.markFailed(job.id, errorMsg);
  }
}

// Lắng nghe sự kiện xử lý job từ localQueue (Có điều tiết Concurrency)
localQueue.on('process-job', async (job) => {
  const stats = browserLimiter.getStats();
  console.log(`[Worker] Nhận job #${job.id} (${job.type}) cho @${job.username || 'System'}. (Đang chạy: ${stats.active}/${stats.max}, Đang chờ: ${stats.queued})`);
  
  browserLimiter.run(async () => {
    console.log(`[Worker] Bắt đầu thực thi job #${job.id} (${job.type})`);
    await executeJob(job);
  }).catch((err: any) => {
    console.error(`[Worker Limiter Error] Job #${job.id}:`, err.message);
  });
});

// Khởi động vòng lặp polling hàng đợi
localQueue.startWorker(3000);
console.log('[Worker] Queue polling loop active (every 3000ms).');

// Xử lý đóng an toàn
process.on('SIGINT', () => {
  console.log('[Worker] Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Worker] Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});
