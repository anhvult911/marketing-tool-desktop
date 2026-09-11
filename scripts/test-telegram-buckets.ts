/**
 * Unit test cho Telegram bucket planner + WorkProgress (P3).
 * Chạy: npx tsx scripts/test-telegram-buckets.ts
 */
import { buildSearchBuckets, workItem, allWorkItems, WorkProgress, telegramLeadKey } from '../src/lib/telegram-buckets';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? detail : ''); fail++; }
}

// ── Buckets: đủ a-z, 0-9, có ký tự tiếng Việt, không trùng ──
{
  const b = buildSearchBuckets();
  check('có đủ 26 chữ a-z', 'abcdefghijklmnopqrstuvwxyz'.split('').every(c => b.includes(c)));
  check('có đủ 10 chữ số', '0123456789'.split('').every(c => b.includes(c)));
  check('có ký tự tiếng Việt (đ, ư, ơ, ă)', ['đ', 'ư', 'ơ', 'ă'].every(c => b.includes(c)));
  check('không trùng lặp', new Set(b).size === b.length, b.length);
  check('kích thước hợp lý (> 60 bucket)', b.length > 60, b.length);
}

// ── allWorkItems: đủ target × bucket ──
{
  const buckets = ['a', 'b'];
  const items = allWorkItems(3, buckets);
  check('3 target × 2 bucket = 6 hạng mục', items.length === 6, items);
  check('hạng mục đúng định dạng "<target>:<bucket>"',
    items[0] === workItem(0, 'a') && items[5] === workItem(2, 'b'), items);
}

// ── Shard: worker chia đều, không trùng, hợp lại đủ ──
{
  const items = allWorkItems(1, buildSearchBuckets());
  const p = new WorkProgress(items);
  const w0 = p.remainingShard(0, 3);
  const w1 = p.remainingShard(1, 3);
  const w2 = p.remainingShard(2, 3);
  check('3 shard không trùng nhau', new Set([...w0, ...w1, ...w2]).size === items.length);
  check('3 shard hợp lại = toàn bộ', w0.length + w1.length + w2.length === items.length);
  check('chia lệch tối đa 1 hạng mục', Math.max(w0.length, w1.length, w2.length) - Math.min(w0.length, w1.length, w2.length) <= 1);
}

// ── Resume: markDone → JSON → nạp lại đúng phần còn thiếu ──
{
  const items = allWorkItems(1, ['a', 'b', 'c', 'd', 'e']);
  const p = new WorkProgress(items);
  p.markDone(workItem(0, 'a'));
  p.markDone(workItem(0, 'c'));
  check('remainingCount = 3 sau khi xong 2', p.remainingCount() === 3, p.remainingCount());

  const p2 = WorkProgress.fromJSON(items, p.toJSON());
  check('resume: bỏ qua hạng mục đã xong', !p2.remainingShard(0, 1).includes(workItem(0, 'a')));
  check('resume: vẫn còn hạng mục chưa xong', p2.remainingShard(0, 1).length === 3, p2.remainingShard(0, 1));
  check('resume: completed giữ đủ 2', p2.completed().length === 2);
}

// ── fromJSON chống dữ liệu rác (last_cursor cũ/hỏng) ──
{
  const items = allWorkItems(1, ['a', 'b']);
  check('JSON rỗng → chạy từ đầu', WorkProgress.fromJSON(items, null).remainingCount() === 2);
  check('JSON hỏng → chạy từ đầu, không crash', WorkProgress.fromJSON(items, '{oops').remainingCount() === 2);
  check('JSON sai shape → chạy từ đầu', WorkProgress.fromJSON(items, '"a-string"').remainingCount() === 2);
  const stale = WorkProgress.fromJSON(items, JSON.stringify({ items: ['1:zzz', '0:a'] }));
  check('hạng mục lạ bị bỏ, hạng mục hợp lệ được giữ', stale.remainingCount() === 1, stale.remainingCount());
}

// ── Multi-target: cùng bucket khác target là hạng mục khác ──
{
  const items = allWorkItems(2, ['a', 'b']);
  const p = new WorkProgress(items);
  p.markDone(workItem(0, 'a'));
  check('xong bucket a của target 0 không ảnh hưởng target 1',
    p.remainingShard(0, 1).includes(workItem(1, 'a')) && p.remainingCount() === 3);
}

// ── telegramLeadKey: username là định danh thật, tên chỉ là khoá phụ ──
{
  check('username khác hoa thường → cùng khoá',
    telegramLeadKey('@NguyenVanA', 'x') === telegramLeadKey('nguyenvana', 'y'));
  check('không username → khoá theo tên chuẩn hoá',
    telegramLeadKey(null, '  Nguyễn   Văn A ') === telegramLeadKey('', 'nguyễn văn a'));
  check('có username ≠ không username (không lẫn lead nhắn được với tên)',
    telegramLeadKey('abc', 'Nguyễn Văn A') !== telegramLeadKey(null, 'Nguyễn Văn A'));
}

console.log(fail === 0 ? '\n✓ TELEGRAM BUCKETS PASSED' : `\n✗ TELEGRAM BUCKETS FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
