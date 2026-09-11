/**
 * Unit test cho phân tích telemetry + khuyến nghị pacing (P5).
 * Chạy: npx tsx scripts/test-scrape-telemetry.ts
 */
import {
  summarizeByAccount, summarizeByEngine, recommendPacing, withinWindow,
  estimateMeasuredConstants, PACING_DEFAULTS, TelemetryRow,
} from '../src/lib/scrape-telemetry';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); fail++; }
}

const NOW = Date.parse('2026-09-11T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const row = (o: Partial<TelemetryRow>): TelemetryRow => ({
  account_id: 1, engine: 'chain_cursor', requests: 10, leads_new: 50, http_500: 0,
  duration_ms: 600_000, first_500_at_request: 0, created_at: ago(1), ...o,
});

console.log('— summarizeByAccount —');
{
  const rows = [
    row({ account_id: 1, requests: 100, leads_new: 500, http_500: 10, duration_ms: 3600_000 }),
    row({ account_id: 1, requests: 100, leads_new: 300, http_500: 0, duration_ms: 3600_000 }),
    row({ account_id: 2, requests: 50, leads_new: 0, http_500: 0, duration_ms: 600_000 }),
    row({ account_id: 0, requests: 5, leads_new: 0 }),
    row({ account_id: null, requests: 5, leads_new: 0 }),
  ];
  const stats = summarizeByAccount(rows);
  check('bỏ account_id 0/null', stats.length === 2, stats.map(s => s.accountId));
  const a1 = stats.find(s => s.accountId === 1)!;
  check('tổng hợp đúng requests/leads', a1.requests === 200 && a1.leads === 800, a1);
  check('tỷ lệ 500 = 10/200 = 5%', Math.abs(a1.fiveHundredRate - 0.05) < 1e-9, a1.fiveHundredRate);
  check('leads/giờ = 800 / 2h = 400', a1.leadsPerHour === 400, a1.leadsPerHour);
  const a2 = stats.find(s => s.accountId === 2)!;
  check('chain 0 lead → emptyChainRatio = 1', a2.emptyChainRatio === 1, a2);
  check('sắp xếp theo leads giảm dần', stats[0].accountId === 1);
}

console.log('— withinWindow —');
{
  const rows = [row({ created_at: ago(1) }), row({ created_at: ago(200) })]; // 200h ≈ 8.3 ngày
  check('cửa sổ 7 ngày giữ 1 row', withinWindow(rows, NOW, 7 * 24 * 3600_000).length === 1, withinWindow(rows, NOW, 7 * 24 * 3600_000).length);
  check('cửa sổ 0 = không lọc', withinWindow(rows, NOW, 0).length === 2);
}

console.log('— recommendPacing —');
{
  const none = recommendPacing(undefined);
  check('không dữ liệu → mặc định + không confident', none.pacingMs === PACING_DEFAULTS.basePacingMs && !none.confident, none);

  const few = recommendPacing({ accountId: 1, chains: 2, requests: 99, leads: 0, http500: 99, fiveHundredRate: 1, leadsPerHour: 0, avgFirstFiveHundredAt: 1, emptyChainRatio: 1 });
  check('dưới ngưỡng mẫu (<3 chain) → mặc định', few.pacingMs === PACING_DEFAULTS.basePacingMs && !few.confident, few);

  const healthy = recommendPacing({ accountId: 1, chains: 10, requests: 300, leads: 3000, http500: 0, fiveHundredRate: 0, leadsPerHour: 600, avgFirstFiveHundredAt: 0, emptyChainRatio: 0 });
  check('khoẻ (0 lỗi, 600 lead/giờ) → nghỉ ngắn hơn nhưng ≥ sàn', healthy.cooldownMs >= PACING_DEFAULTS.minCooldownMs && healthy.cooldownMs < PACING_DEFAULTS.quotaCooldownMs, healthy);
  check('khoẻ → pacing không bị siết', healthy.pacingMs === PACING_DEFAULTS.basePacingMs, healthy);
  check('khoẻ → confident', healthy.confident);

  const bad = recommendPacing({ accountId: 2, chains: 8, requests: 200, leads: 100, http500: 60, fiveHundredRate: 0.3, leadsPerHour: 50, avgFirstFiveHundredAt: 5, emptyChainRatio: 0.5 });
  check('500 rất cao (30%) → pacing tối đa', bad.pacingMs === PACING_DEFAULTS.maxPacingMs, bad);
  check('500 rất cao → cooldown ≥ 20 phút', bad.cooldownMs >= 20 * 60_000, bad);
  check('có note giải thích', bad.note.length > 10 && bad.note.includes('500'), bad.note);

  const mid = recommendPacing({ accountId: 3, chains: 5, requests: 100, leads: 400, http500: 15, fiveHundredRate: 0.15, leadsPerHour: 300, avgFirstFiveHundredAt: 0, emptyChainRatio: 0 });
  check('500 vừa (15%) → chậm lại nhưng chưa tối đa', mid.pacingMs > PACING_DEFAULTS.basePacingMs && mid.pacingMs < PACING_DEFAULTS.maxPacingMs, mid);

  const shortChain = recommendPacing({ accountId: 4, chains: 6, requests: 100, leads: 500, http500: 5, fiveHundredRate: 0.05, leadsPerHour: 500, avgFirstFiveHundredAt: 8, emptyChainRatio: 0 });
  check('chuỗi ngắn (500 ở req 8) → chậm thêm 0.8s', shortChain.pacingMs === PACING_DEFAULTS.basePacingMs + 800, shortChain);

  const neverBelowFloor = recommendPacing({ accountId: 5, chains: 20, requests: 1000, leads: 9000, http500: 0, fiveHundredRate: 0, leadsPerHour: 5000, avgFirstFiveHundredAt: 0, emptyChainRatio: 0 });
  check('không bao giờ xuống dưới sàn pacing', neverBelowFloor.pacingMs >= PACING_DEFAULTS.minPacingMs, neverBelowFloor);
  check('không bao giờ xuống dưới sàn cooldown', neverBelowFloor.cooldownMs >= PACING_DEFAULTS.minCooldownMs, neverBelowFloor);
}

console.log('— summarizeByEngine —');
{
  const rows = [
    row({ engine: 'chain_cursor', leads_new: 100, duration_ms: 3600_000 }),
    row({ engine: 'chain_engager', leads_new: 300, duration_ms: 3600_000 }),
  ];
  const e = summarizeByEngine(rows);
  check('gộp theo engine, sắp theo leads', e[0].engine === 'chain_engager' && e[0].leads === 300, e);
  check('leads/giờ theo engine', e[0].leadsPerHour === 300, e[0]);
}

console.log('— estimateMeasuredConstants —');
{
  check('quá ít mẫu → undefined', estimateMeasuredConstants([row({}), row({})]) === undefined);

  const rows = [
    row({ requests: 20, leads_new: 160, http_500: 1, first_500_at_request: 18, duration_ms: 7 * 60_000 }),
    row({ requests: 20, leads_new: 140, http_500: 1, first_500_at_request: 18, duration_ms: 7 * 60_000 }),
    row({ requests: 20, leads_new: 150, http_500: 1, first_500_at_request: 18, duration_ms: 7 * 60_000 }),
  ];
  const est = estimateMeasuredConstants(rows)!;
  check('leads/request ≈ 450/60 = 7.5', Math.abs(est.leadsPerRequest! - 7.5) < 0.01, est);
  check('chainLeads = trung bình chain có 500', est.chainLeads === 150, est);
  check('chainDurationMin ≈ 7 phút', est.chainDurationMin === 7, est);
  check('successRate = 3/3 = 1', est.successRate === 1, est);
}

console.log(fail === 0 ? '\n✓ SCRAPE TELEMETRY PASSED' : `\n✗ SCRAPE TELEMETRY FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
