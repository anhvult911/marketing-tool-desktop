/**
 * P1 smoke: chạy runFacebookScrapeJob THẬT qua orchestration pool trong DB test
 * tạm (temp dir) — account không tồn tại / cooldown → job phải fail nhanh với
 * message rõ. Chứng minh pool init, scheduler loop, DB read/write, error path.
 * KHÔNG mở browser, KHÔNG chạm Facebook.
 * Lưu ý: dùng dynamic import sau khi process.chdir(tempdir) — static import
 * sẽ nạp db.ts với DB_DIR của project trước khi chdir kịp chạy.
 * Chạy: npx tsx scripts/smoke-scrape-orchestration.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-smoke-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.chdir(tmp); // db.ts: DB_DIR = cwd/data khi NODE_ENV != production

async function main() {
  const dbMod = await import('../src/lib/db');
  const db = dbMod.default;
  const { runFacebookScrapeJob } = await import('../src/lib/facebook-crawler');

  const mkJob = () => Number(db.prepare(`
    INSERT INTO scrape_jobs (workspace_id, platform, target_group, status, total_count, scraped_count, auto_import, scrape_type, max_limit)
    VALUES (1, 'facebook', 'https://www.facebook.com/testpage', 'pending', 0, 0, 1, 'multi_tier', 500)
  `).run().lastInsertRowid);

  const runJob = (jobId: number, accountId: number) => runFacebookScrapeJob({
    jobId,
    workspaceId: 1,
    platform: 'facebook',
    targetGroup: 'https://www.facebook.com/testpage',
    accountId,
    maxLimit: 500,
    autoImport: true,
    scrapeType: 'multi_tier',
  });

  let pass = true;
  const check = (name: string, cond: boolean, detail?: unknown) => {
    console.log(`${cond ? '  ✓' : '  ✗'} ${name}`);
    if (cond) pass = true && pass; else { pass = false; if (detail !== undefined) console.error('   ', detail); }
  };

  // Case 1: không có account nào trong DB → fail nhanh, message rõ
  const jobId1 = mkJob();
  await runJob(jobId1, 999999);
  const job1 = db.prepare(`SELECT status, error_msg FROM scrape_jobs WHERE id = ?`).get(jobId1) as { status: string; error_msg: string | null };
  console.log('case1 →', job1.status, '|', job1.error_msg);
  check('case1: failed với message "Không có account"', job1.status === 'failed' && (job1.error_msg || '').includes('Không có account'));

  // Case 2: account đang cooldown (datetime UTC từ SQLite) → bị filter, fail với message cooldown
  db.prepare(`
    INSERT INTO social_accounts (id, workspace_id, platform, username, status, cooldown_until)
    VALUES (1, 1, 'facebook', 'smoke_acc', 'live', datetime('now', '+2 hours'))
  `).run();
  const jobId2 = mkJob();
  await runJob(jobId2, 1);
  const job2 = db.prepare(`SELECT status, error_msg FROM scrape_jobs WHERE id = ?`).get(jobId2) as { status: string; error_msg: string | null };
  console.log('case2 →', job2.status, '|', job2.error_msg);
  check('case2: failed, cooldown được nhận diện đúng (UTC parse)', job2.status === 'failed' && (job2.error_msg || '').includes('cooldown'));

  console.log(pass ? '✓ SMOKE PASSED' : '✗ SMOKE FAILED');
  process.exit(pass ? 0 : 1);
}

main().catch(err => { console.error('SMOKE CRASH:', err); process.exit(1); });
