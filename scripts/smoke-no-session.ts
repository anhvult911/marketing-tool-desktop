/**
 * Smoke end-to-end cho lỗi job #50: chạy runFacebookScrapeJob THẬT với account đã mất
 * cookie đăng nhập (đúng trạng thái hiện tại trên máy), trên DB TẠM — không đụng DB thật.
 *
 * Kỳ vọng:
 *   1. Cổng cookie chặn TRƯỚC khi điều hướng tới Facebook (không tốn request nào).
 *   2. Job FAILED với thông báo đúng nguyên nhân: "KHÔNG có cookie đăng nhập".
 *      KHÔNG còn đổ oan cho nhóm ("nhóm chặn xem thành viên").
 *   3. Account bị đánh dấu cần nạp lại cookie (status die) để không lặp vô hạn.
 *
 * Chạy: npx tsx scripts/smoke-no-session.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-nosession-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.chdir(tmp); // DB_DIR = cwd/data khi NODE_ENV != production

// Profile THẬT (đã xác minh mất cookie) — trỏ tuyệt đối từ repo gốc.
// import() cần file:// URL trên Windows (đường dẫn tuyệt đối 'D:/...' bị coi là scheme).
const REAL_ROOT = 'D:/Projects/marketing-tool-desktop';
const modUrl = (rel: string) => pathToFileURL(path.join(REAL_ROOT, rel)).href;

async function main() {
  const db = (await import(modUrl('src/lib/db'))).default;
  const { runFacebookScrapeJob } = await import(modUrl('src/lib/facebook-crawler'));

  // Profile thật nhưng account_id trong DB tạm là id riêng
  const profile = path.join(REAL_ROOT, 'profiles', 'facebook_61590906836276');
  if (!fs.existsSync(profile)) {
    console.error(`✗ Không thấy profile thật: ${profile}`);
    process.exit(1);
  }

  db.prepare(`INSERT INTO social_accounts (id, workspace_id, platform, username, status, user_data_dir)
              VALUES (1, 1, 'facebook', '61590906836276', 'live', ?)`).run(profile);

  const jobId = Number(db.prepare(`
    INSERT INTO scrape_jobs (workspace_id, platform, target_group, status, total_count, scraped_count, auto_import, scrape_type, max_limit)
    VALUES (1, 'facebook', 'https://www.facebook.com/groups/otofun2021', 'pending', 0, 0, 1, 'multi_tier', 500)
  `).run().lastInsertRowid);

  const t0 = Date.now();
  await runFacebookScrapeJob({
    jobId, workspaceId: 1, platform: 'facebook',
    targetGroup: 'https://www.facebook.com/groups/otofun2021',
    accountId: 1, maxLimit: 500, autoImport: true, scrapeType: 'multi_tier',
    parallelSessions: 1,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const job = db.prepare(`SELECT status, error_msg, scraped_count FROM scrape_jobs WHERE id = ?`).get(jobId) as { status: string; error_msg: string | null; scraped_count: number };
  const acc = db.prepare(`SELECT status, cooldown_until FROM social_accounts WHERE id = 1`).get() as { status: string; cooldown_until: string | null };
  const tel = db.prepare(`SELECT engine, requests, leads_new FROM scrape_telemetry WHERE job_id = ?`).all(jobId) as Array<{ engine: string; requests: number; leads_new: number }>;
  const logs = db.prepare(`SELECT action_type, SUBSTR(message,1,130) m FROM crawler_logs ORDER BY id DESC LIMIT 3`).all() as Array<{ action_type: string; m: string }>;

  console.log(`\nThời gian chạy: ${elapsed}s`);
  console.log('jobs:', JSON.stringify(job));
  console.log('account:', JSON.stringify(acc));
  console.log('telemetry:', JSON.stringify(tel));
  console.log('crawler_logs:', JSON.stringify(logs, null, 1));

  let fail = 0;
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) console.log(`  ✓ ${name}`);
    else { console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 240) : ''); fail++; }
  };

  console.log('\n— Kết quả —');
  check('job FAILED (không báo completed 0 lead)', job.status === 'failed', job);
  check('thông báo nêu ĐÚNG nguyên nhân: thiếu cookie đăng nhập',
    (job.error_msg || '').includes('cookie đăng nhập') || (job.error_msg || '').includes('c_user'),
    job.error_msg);
  check('KHÔNG đổ oan cho nhóm (không còn "nhóm chặn xem thành viên")',
    !(job.error_msg || '').includes('nhóm chặn xem thành viên'), job.error_msg);
  check('account bị đánh dấu cần nạp lại cookie (status=die)', acc.status === 'die', acc);
  check('account có cooldown (không bị chọn lặp tức thì)', !!acc.cooldown_until, acc);
  check('KHÔNG tốn request Facebook nào (cổng chặn trước khi điều hướng)',
    tel.length === 0 || tel.every(t => t.requests === 0), tel);
  check('có ghi log chẩn đoán no_session_cookie',
    logs.some(l => l.action_type === 'no_session_cookie'), logs);

  console.log(fail === 0 ? '\n✓ NO-SESSION SMOKE PASSED' : `\n✗ NO-SESSION SMOKE FAILED (${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
