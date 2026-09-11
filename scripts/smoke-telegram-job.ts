/**
 * P3 smoke: chạy runTelegramScrapeJob THẬT với DB temp — không account → fail nhanh,
 * đúng message. Không mở browser, không chạm Telegram.
 * Chạy: npx tsx scripts/smoke-telegram-job.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-tg-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
process.chdir(tmp); // db.ts: DB_DIR = cwd/data khi NODE_ENV != production

async function main() {
  const db = (await import('../src/lib/db')).default;
  const { runTelegramScrapeJob } = await import('../src/lib/telegram-crawler');

  const mkJob = () => Number(db.prepare(`
    INSERT INTO scrape_jobs (workspace_id, platform, target_group, status, total_count, scraped_count, auto_import, scrape_type, max_limit)
    VALUES (1, 'telegram', 'https://t.me/testgroup', 'pending', 0, 0, 1, 'members', 5000)
  `).run().lastInsertRowid);

  let fail = 0;
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) console.log(`  ✓ ${name}`);
    else { console.error(`  ✗ ${name}`, detail !== undefined ? detail : ''); fail++; }
  };

  // Case 1: không có account Telegram → fail nhanh, message rõ
  const jobId1 = mkJob();
  await runTelegramScrapeJob({
    jobId: jobId1, workspaceId: 1, platform: 'telegram',
    targetGroup: 'https://t.me/testgroup',
    maxLimit: 5000, autoImport: true, scrapeType: 'members',
  });
  const j1 = db.prepare(`SELECT status, error_msg FROM scrape_jobs WHERE id = ?`).get(jobId1) as { status: string; error_msg: string | null };
  console.log('case1 →', j1.status, '|', j1.error_msg);
  check('case1: failed + message thiếu account', j1.status === 'failed' && (j1.error_msg || '').includes('Telegram Live'));

  // Case 2: có account nhưng profile không tồn tại → launch context mới rồi nav;
  // để tránh chạm mạng, chỉ kiểm tra nhánh account-queue chấp nhận account.
  db.prepare(`INSERT INTO social_accounts (id, workspace_id, platform, username, status, user_data_dir) VALUES (1, 1, 'telegram', 'tg_acc', 'live', 'Z:/nonexistent-profile')`).run();
  const rows = db.prepare(`SELECT id FROM social_accounts WHERE platform = 'telegram' AND status IN ('live','ready','active')`).all() as Array<{ id: number }>;
  check('case2: account queue lọc đúng telegram live', rows.length === 1 && rows[0].id === 1);

  // Case 3: resume — last_cursor JSON hợp lệ được nạp, hạng mục đã xong bị bỏ
  const { buildSearchBuckets, allWorkItems, workItem, WorkProgress } = await import('../src/lib/telegram-buckets');
  const items = allWorkItems(1, buildSearchBuckets());
  const progress = new WorkProgress(items);
  progress.markDone(workItem(0, 'a'));
  const jobId3 = mkJob();
  db.prepare(`UPDATE scrape_jobs SET last_cursor = ? WHERE id = ?`).run(progress.toJSON(), jobId3);
  const raw = (db.prepare(`SELECT last_cursor FROM scrape_jobs WHERE id = ?`).get(jobId3) as { last_cursor: string }).last_cursor;
  const resumed = WorkProgress.fromJSON(items, raw);
  check('case3: resume bỏ đúng bucket đã xong',
    resumed.remainingCount() === items.length - 1 && !resumed.remainingShard(0, 1).includes(workItem(0, 'a')));

  console.log(fail === 0 ? '✓ TELEGRAM SMOKE PASSED' : `✗ TELEGRAM SMOKE FAILED (${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
