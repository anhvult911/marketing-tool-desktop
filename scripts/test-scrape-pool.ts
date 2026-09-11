/**
 * Unit test cho ScrapeAccountPool (P2) — trạng thái cooldown + circuit breaker.
 * Chạy: npx tsx scripts/test-scrape-pool.ts
 */
import { ScrapeAccountPool } from '../src/lib/scrape-pool';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? detail : ''); fail++; }
}

// ── Cooldown: chain xong → nghỉ đúng thời lượng, hết nghỉ chạy lại ──
{
  const pool = new ScrapeAccountPool([1, 2]);
  const t = 1_000_000;
  check('khởi tạo: chạy được ngay', pool.canRun(1, t) && pool.canRun(2, t));
  pool.noteChainDone(1, { now: t, cooldownMs: 600_000, unproductive: false });
  check('sau chain: account 1 bị chặn bởi cooldown', !pool.canRun(1, t + 1));
  check('cooldownRemaining ≈ 600s - 1ms', pool.cooldownRemaining(1, t + 1) === 599_999);
  check('account 2 không bị ảnh hưởng', pool.canRun(2, t + 1));
  check('hết cooldown → chạy lại được', pool.canRun(1, t + 600_001));
}

// ── Circuit breaker per-account: 2 chain 0 lead liên tiếp → exhausted ──
{
  const pool = new ScrapeAccountPool([10, 11]);
  const t = 0;
  pool.noteChainDone(10, { now: t, cooldownMs: 0, unproductive: true, maxUnproductive: 2 });
  check('1 chain 0 lead: chưa cháy', !pool.get(10)!.exhausted && pool.canRun(10, t));
  pool.noteChainDone(10, { now: t, cooldownMs: 0, unproductive: true, maxUnproductive: 2 });
  check('2 chain 0 lead: cháy circuit', pool.get(10)!.exhausted);
  check('cháy circuit → không chạy lại dù hết cooldown', !pool.canRun(10, t + 999_999_999));
  const healed = new ScrapeAccountPool([20]);
  healed.noteChainDone(20, { now: 0, cooldownMs: 0, unproductive: true, maxUnproductive: 2 });
  healed.noteChainDone(20, { now: 0, cooldownMs: 0, unproductive: false, maxUnproductive: 2 });
  healed.noteChainDone(20, { now: 0, cooldownMs: 0, unproductive: true, maxUnproductive: 2 });
  check('chain có lead ở giữa → reset đếm, không cháy', !healed.get(20)!.exhausted);
}

// ── isAlive: job sống khi còn account chưa cháy ──
{
  const pool = new ScrapeAccountPool([30, 31]);
  const t = 0;
  pool.noteChainDone(30, { now: t, cooldownMs: 1000, unproductive: false });
  pool.noteChainDone(31, { now: t, cooldownMs: 2000, unproductive: false });
  check('vẫn sống (job chờ, không kết thúc)', pool.isAlive());
  pool.markExhausted(30);
  pool.markExhausted(31);
  check('loại hết account → isAlive false', !pool.isAlive());
  check('exhaustedCount đúng', pool.exhaustedCount() === 2);
}

// ── markExhausted nhả cooldown (checkpoint xử lý ngay, không chờ) ──
{
  const pool = new ScrapeAccountPool([40]);
  pool.noteChainDone(40, { now: 0, cooldownMs: 3_600_000, unproductive: false });
  pool.markExhausted(40);
  check('markExhausted xoá cooldown + đánh dấu cháy',
    pool.get(40)!.exhausted && pool.cooldownRemaining(40, 0) === 0);
}

// ── chains counter ──
{
  const pool = new ScrapeAccountPool([50]);
  pool.noteChainDone(50, { now: 0, cooldownMs: 0, unproductive: false });
  pool.noteChainDone(50, { now: 1, cooldownMs: 0, unproductive: false });
  check('chains đếm đúng 2', pool.get(50)!.chains === 2);
}

console.log(fail === 0 ? '\n✓ ACCOUNT POOL PASSED' : `\n✗ ACCOUNT POOL FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
