/**
 * Throwaway verification for ScrapeSessionPool (P1). Chạy: npx tsx scripts/test-scrape-pool.ts
 * Không phụ thuộc Playwright/DB — thuần logic scheduler.
 */
import { ScrapeSessionPool, poolWaitMs } from '../src/lib/scrape-pool';

let passed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name}`, detail !== undefined ? detail : ''); process.exitCode = 1; }
}

// ── Scene 1: N account, slots < N — song song đúng slot count ──
{
  const pool = new ScrapeSessionPool([1, 2, 3, 4], 2);
  const t = 1000;
  const a1 = pool.acquireNext({ now: t, passToken: 1 });
  const a2 = pool.acquireNext({ now: t, passToken: 1 });
  const a3 = pool.acquireNext({ now: t, passToken: 1 });
  check('slot 1 cấp cho account đầu tiên', a1.granted && a1.accountId === 1, a1);
  check('slot 2 cấp cho account kế', a2.granted && a2.accountId === 2, a2);
  check('hết slot → từ chối', !a3.granted && a3.reason === 'all-slots-busy', a3);
  check('busy track đúng 2 slot', pool.busyIds().join(',') === '1,2', pool.busyIds());

  // Account 1 trả slot (productive) → phải nghỉ cooldown; account 3 vào ngay
  pool.release(1, { now: t, cooldownMs: 600_000, unproductive: false });
  const a4 = pool.acquireNext({ now: t, passToken: 1 });
  check('account 3 nhận slot ngay khi 1 trả', a4.granted && a4.accountId === 3, a4);
  check('account 1 không được cấp khi còn cooldown', !pool.getAccount(1)!.busy);

  // Unproductive × 2 → exhausted per-account
  pool.release(3, { now: t, cooldownMs: 0, unproductive: true, maxUnproductive: 2 });
  pool.acquireNext({ now: t + 1000, passToken: 1 }); // cấp lại cho 3
  pool.release(3, { now: t + 1000, cooldownMs: 0, unproductive: true, maxUnproductive: 2 });
  check('account 3 exhausted sau 2 phiên 0 lead', pool.getAccount(3)!.exhausted === true);
  const a5 = pool.acquireNext({ now: t + 2000, passToken: 1 });
  check('account 4 nhận việc, 3 bị loại vĩnh viễn', a5.granted && a5.accountId === 4, a5);
}

// ── Scene 2: cooldown toàn pool → waitMs báo đúng, hết nghỉ → cấp lại ──
{
  const pool = new ScrapeSessionPool([10, 11], 4);
  const t = 5000;
  pool.acquireNext({ now: t, passToken: 1 });
  pool.acquireNext({ now: t, passToken: 1 });
  pool.release(10, { now: t, cooldownMs: 120_000, unproductive: false });
  pool.release(11, { now: t, cooldownMs: 60_000, unproductive: false });
  check('all-resting khi cả pool cooldown', pool.acquireNext({ now: t + 10_000, passToken: 2 }).reason === 'all-resting');
  check('waitMs = 110s (cooldown dài nhất còn lại)', poolWaitMs(pool, t + 10_000) === 110_000, poolWaitMs(pool, t + 10_000));
  const after = pool.acquireNext({ now: t + 70_000, passToken: 2 });
  check('hết cooldown 60s → account 11 chạy tiếp', after.granted && after.accountId === 11, after);
}

// ── Scene 3: pass-token fairness — token xoay, idle account theo lượt ──
{
  const pool = new ScrapeSessionPool([20, 21], 1);
  const t = 0;
  // Pass 1: cả 2 nhận token 1; account 20 giữ slot duy nhất
  const r1 = pool.acquireNext({ now: t, passToken: 1 });
  check('pass 1: token 1 → account 20', r1.granted && r1.accountId === 20, r1);
  // Token xoay trước nghỉ giữa pass (chỉ account rảnh không busy)
  pool.release(20, { now: t, cooldownMs: 0, unproductive: false });
  pool.rotatePassToken(); // idle cả 2 → token 2
  const r2 = pool.acquireNext({ now: t + 1, passToken: 2 });
  check('pass 2: token 2 → account 20 (re-ready đầu)', r2.granted && r2.accountId === 20, r2);
  // Giữ 20 busy, xoay lượt cho 21: rotate chỉ nâng token account rảnh
  pool.rotatePassToken(); // 21 (idle) → token 3; 20 busy giữ token 2
  pool.release(20, { now: t + 2, cooldownMs: 0, unproductive: false });
  const r3 = pool.acquireNext({ now: t + 3, passToken: 3 });
  check('lượt sau xoay về account 21 đúng token', r3.granted && r3.accountId === 21, r3);
}

// ── Scene 4: toàn pool exhausted → isAlive false, acquire từ chối vĩnh viễn ──
{
  const pool = new ScrapeSessionPool([30], 2);
  pool.acquireNext({ now: 0, passToken: 1 });
  pool.release(30, { now: 0, cooldownMs: 0, unproductive: true, maxUnproductive: 1 });
  check('exhausted toàn pool → isAlive false', pool.isAlive() === false);
  const r = pool.acquireNext({ now: 999_999, passToken: 5 });
  check('acquire sau exhaust → all-exhausted', !r.granted && r.reason === 'all-exhausted', r);
  pool.skipRests();
  check('skipRests không hồi sinh exhausted', !pool.isAlive() && !pool.acquireNext({ now: 1e9, passToken: 1 }).granted);
}

// ── Scene 5: account riêng bị markExhausted (checkpoint) không chặn pool ──
{
  const pool = new ScrapeSessionPool([40, 41], 2);
  pool.acquireNext({ now: 0, passToken: 1 }); // 40 giữ slot
  pool.markExhausted(41);
  check('pool vẫn sống khi 1 account checkpoint', pool.isAlive() === true);
  pool.markExhausted(40);
  check('checkpoint account đang giữ slot → nhả slot, pool chết', !pool.isAlive() && pool.busyIds().length === 0);
}

console.log(process.exitCode ? `\n❌ FAILED` : `\n✓ PASSED (${passed} checks)`);
