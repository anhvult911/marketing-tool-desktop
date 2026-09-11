/**
 * Unit test cho logic hàng đợi mục tiêu (P4). Chạy: npx tsx scripts/test-scrape-queue.ts
 */
import { parseQueueTime, isTargetDue, pickNextTarget, decideAfterOutcome, isNoAccountFailure, QueueTarget } from '../src/lib/scrape-queue';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? detail : ''); fail++; }
}

const NOW = Date.parse('2026-09-11T10:00:00Z');
const HOUR = 3600_000;

console.log('— parseQueueTime —');
check('null → 0', parseQueueTime(null) === 0);
check('chuỗi rác → 0', parseQueueTime('not-a-date') === 0);
check('SQLite UTC (không Z) parse đúng UTC', parseQueueTime('2026-09-11 09:00:00') === Date.parse('2026-09-11T09:00:00Z'));
check('ISO có Z parse đúng', parseQueueTime('2026-09-11T09:00:00Z') === Date.parse('2026-09-11T09:00:00Z'));

console.log('— isTargetDue —');
check('chưa từng cào → tới hạn', isTargetDue({ id: 1, platform: 'facebook', targetValue: 'x', lastScrapedAt: null }, NOW, 6 * HOUR));
check('mới cào 1h, nghỉ 6h → chưa tới hạn', !isTargetDue({ id: 1, platform: 'facebook', targetValue: 'x', lastScrapedAt: '2026-09-11T09:00:00Z' }, NOW, 6 * HOUR));
check('cào 7h trước, nghỉ 6h → tới hạn', isTargetDue({ id: 1, platform: 'facebook', targetValue: 'x', lastScrapedAt: '2026-09-11T03:00:00Z' }, NOW, 6 * HOUR));
check('đúng mốc nghỉ → tới hạn', isTargetDue({ id: 1, platform: 'facebook', targetValue: 'x', lastScrapedAt: '2026-09-11T04:00:00Z' }, NOW, 6 * HOUR));

console.log('— pickNextTarget —');
const targets: QueueTarget[] = [
  { id: 1, platform: 'facebook', targetValue: 'a', lastScrapedAt: '2026-09-11T09:30:00Z' }, // chưa tới hạn
  { id: 2, platform: 'facebook', targetValue: 'b', lastScrapedAt: '2026-09-10T00:00:00Z' }, // cũ
  { id: 3, platform: 'telegram', targetValue: 'c', lastScrapedAt: null },                    // chưa từng
  { id: 4, platform: 'facebook', targetValue: 'd', lastScrapedAt: '2026-09-11T08:00:00Z' }, // 2h trước, chưa đủ 6h
];
check('bỏ qua target chưa tới hạn', pickNextTarget(targets, NOW, 6 * HOUR, new Set())?.id === 3, pickNextTarget(targets, NOW, 6 * HOUR, new Set()));
check('ưu tiên chưa-từng-cào (cũ nhất) trước', pickNextTarget(targets, NOW, 6 * HOUR, new Set([3]))?.id === 2);
check('đã thử hết target tới hạn → null', pickNextTarget(targets, NOW, 6 * HOUR, new Set([2, 3])) === null);
check('nghỉ 0 → mọi target tới hạn', pickNextTarget(targets, NOW, 0, new Set()) !== null);

console.log('— decideAfterOutcome —');
const base = { cancelled: false, userStopped: false, noAccounts: false, scraped: 10, elapsedMs: 1000, maxRuntimeMs: 8 * HOUR };
check('bình thường → continue', decideAfterOutcome(base) === 'continue');
check('bị cancel → stop', decideAfterOutcome({ ...base, cancelled: true }) === 'stop');
check('user stop job → stop', decideAfterOutcome({ ...base, userStopped: true }) === 'stop');
check('hết account → pause (không chạy tiếp vô ích)', decideAfterOutcome({ ...base, noAccounts: true }) === 'pause');
check('vượt trần thời gian → stop', decideAfterOutcome({ ...base, elapsedMs: 8 * HOUR }) === 'stop');
check('trần 0 = không giới hạn', decideAfterOutcome({ ...base, elapsedMs: 999 * HOUR, maxRuntimeMs: 0 }) === 'continue');
check('vượt trần ưu tiên hơn noAccounts? (noAccounts pause thắng)', decideAfterOutcome({ ...base, noAccounts: true, elapsedMs: 99 * HOUR }) === 'pause');

console.log('— isNoAccountFailure —');
check('khớp message thiếu account của crawler', isNoAccountFailure('Không có account Facebook nào trong hệ thống. Đăng nhập/ấn cookie để cào.'));
check('khớp message pool chết', isNoAccountFailure('Toàn bộ 3 account trong pool bị loại (checkpoint / cookie die / 0 lead liên tiếp) — không thu được lead nào.'));
check('lỗi thường → false', !isNoAccountFailure('Timeout khi mở trang'));
check('null → false', !isNoAccountFailure(null));
check('chuỗi rỗng → false', !isNoAccountFailure(''));

console.log(fail === 0 ? '\n✓ SCRAPE QUEUE PASSED' : `\n✗ SCRAPE QUEUE FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
