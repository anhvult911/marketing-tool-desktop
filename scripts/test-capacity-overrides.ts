/**
 * Unit test capacity + override từ telemetry (P5).
 * Chạy: npx tsx scripts/test-capacity-overrides.ts
 */
import { planCapacity, MEASURED } from '../src/lib/capacity';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); fail++; }
}

// Mặc định (không override) — giữ nguyên hành vi cũ
{
  const p = planCapacity({ liveAccounts: 5, spareProxies: 5, targetLeads: 5000 });
  const expected = Math.floor(MEASURED.CHAIN_LEADS * MEASURED.PASSIVE_SUCCESS_RATE); // 115
  check('không override → leads/account/giờ dùng hằng số cũ (≈575)', p.leadsPerAccountPerHour === Math.floor(60 / 12 * expected), p.leadsPerAccountPerHour);
  check('không override → không có note telemetry', !p.notes.some(n => n.includes('ĐO THỰC')), p.notes);
}

// Override từ telemetry: chuỗi ngắn hơn → năng suất thấp hơn, có note giải thích
{
  const p = planCapacity({
    liveAccounts: 5, spareProxies: 5, targetLeads: 5000,
    overrides: { chainLeads: 60, sessionMin: 6, successRate: 0.5 },
  });
  const p0 = planCapacity({ liveAccounts: 5, spareProxies: 5, targetLeads: 5000 });
  check('override → năng suất giảm so với hằng số cũ', p.leadsPerAccountPerHour < p0.leadsPerAccountPerHour, { tuned: p.leadsPerAccountPerHour, base: p0.leadsPerAccountPerHour });
  check('override → có note nêu số đo thực', p.notes.some(n => n.includes('ĐO THỰC') && n.includes('60 leads/chuỗi')), p.notes);
}

// Override tốt hơn → năng suất tăng (chứng minh override thực sự được dùng)
{
  const p = planCapacity({
    liveAccounts: 5, spareProxies: 5, targetLeads: 5000,
    overrides: { chainLeads: 300, sessionMin: 7, successRate: 1 },
  });
  const p0 = planCapacity({ liveAccounts: 5, spareProxies: 5, targetLeads: 5000 });
  check('override cao → năng suất tăng thật', p.leadsPerAccountPerHour > p0.leadsPerAccountPerHour, { tuned: p.leadsPerAccountPerHour, base: p0.leadsPerAccountPerHour });
}

// Dữ liệu bẩn bị kẹp (không tạo kế hoạch ảo)
{
  const nan = planCapacity({ liveAccounts: 3, spareProxies: 3, targetLeads: 1000, overrides: { chainLeads: NaN, sessionMin: NaN, successRate: NaN } });
  check('NaN → kẹp về biên (không NaN/Infinity trong kết quả)', Number.isFinite(nan.leadsPerAccountPerHour) && Number.isFinite(nan.hoursToTarget), nan);
  const absurd = planCapacity({ liveAccounts: 1, spareProxies: 0, targetLeads: 100, overrides: { chainLeads: 999999, sessionMin: -5, successRate: 5 } });
  check('giá trị vô lý → kết quả hữu hạn, không Infinity/NaN', Number.isFinite(absurd.leadsPerAccountPerHour) && Number.isFinite(absurd.hoursToTarget) && Number.isFinite(absurd.recommendedAccounts), absurd);
  check('chainLeads kẹp trần 2000 trong note', String(absurd.notes).includes('2000 leads/chuỗi'), absurd.notes);
  check('successRate kẹp trần 100% trong note', String(absurd.notes).includes('100%'), absurd.notes);
  check('sessionMin âm → kẹp về 1 phút', String(absurd.notes).includes('1.0 phút'), absurd.notes);
}

// Override một phần: chỉ chainLeads thì sessionMin vẫn mặc định
{
  const p = planCapacity({ liveAccounts: 2, spareProxies: 2, targetLeads: 1000, overrides: { chainLeads: 100 } });
  check('override một phần vẫn có note', p.notes.some(n => n.includes('ĐO THỰC')), p.notes);
  check('override một phần → session mặc định 7 phút', String(p.notes).includes('7.0 phút'), p.notes);
}

console.log(fail === 0 ? '\n✓ CAPACITY OVERRIDES PASSED' : `\n✗ CAPACITY OVERRIDES FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
