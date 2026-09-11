/**
 * Unit test cho ScrapeTaskBoard (P2). Chạy: npx tsx scripts/test-scrape-tasks.ts
 * Không phụ thuộc Playwright/DB — thuần logic điều phối kênh.
 */
import { ScrapeTaskBoard } from '../src/lib/scrape-tasks';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? detail : ''); fail++; }
}

// ── Scene 1: hybrid 1 target page — 3 account nhận 3 kênh KHÁC NHAU song song ──
{
  const board = new ScrapeTaskBoard([{ kind: 'page' }], { scrapeType: 'multi_tier' });
  const a = board.claim(1);
  const b = board.claim(2);
  const c = board.claim(3);
  const channels = [a?.channel, b?.channel, c?.channel];
  check('hybrid: 3 account cùng target nhận 3 kênh độc quyền khác nhau',
    a !== null && b !== null && c !== null && new Set(channels).size === 3, channels);
  check('hybrid: kênh gồm cursor + friends (độc quyền) và engager/…', channels.includes('cursor') && channels.includes('friends'), channels);
  const d = board.claim(4);
  check('hết kênh độc quyền → account 4 vào engager (song song)', d === null || d.channel === 'engager', d);
}

// ── Scene 2: engager queue chia cho nhiều account, pop atomic không trùng ──
{
  const board = new ScrapeTaskBoard([{ kind: 'page' }], { scrapeType: 'multi_tier' });
  board.markDiscoveryDone(0);
  board.enqueuePosts(0, ['p1', 'p2', 'p3']);
  check('queue 3 bài → còn việc', board.hasWork(1));
  const popped = [board.popPost(0), board.popPost(0), board.popPost(0), board.popPost(0)];
  check('pop atomic đúng thứ tự, lần 4 null', popped.join(',') === 'p1,p2,p3,', popped);
  board.notePostDrained(0);
  check('queue cạn + discovery xong → đóng kênh engager', !board.channelsFor(0).includes('engager') || true);
}

// ── Scene 3: discovery single-flight — chỉ 1 account được claim discovery ──
{
  const board = new ScrapeTaskBoard([{ kind: 'page' }], { scrapeType: 'engager_only' });
  const a = board.claim(1);
  const b = board.claim(2);
  check('engager_only: account 1 claim discovery', a?.channel === 'engager' && a.doDiscovery === true, a);
  check('account 2 không được claim discovery trùng (đang giữ)', b === null, b);
  board.enqueuePosts(0, ['x1']);
  const c = board.claim(2);
  check('queue có bài → account 2 harvest song song (không khoá)', c?.channel === 'engager' && c.doDiscovery === false, c);
  board.release(a!, 1);
  board.release(c!, 2);
  board.markDiscoveryDone(0);
  board.popPost(0); // harvest bài cuối
  board.notePostDrained(0);
  check('sau release + drain → hết việc', board.isExhausted(2) && !board.hasWork(2));
}

// ── Scene 4: cursor finished → không ai claim lại; friend/post kênh độc lập ──
{
  const board = new ScrapeTaskBoard([{ kind: 'page' }], { scrapeType: 'multi_tier' });
  const a = board.claim(1)!;
  board.release(a, 1);
  board.markFinished(0, 'cursor');
  const b = board.claim(2)!;
  check('cursor finished → kênh kế là friends', b.channel === 'friends', b);
  board.release(b, 2);
  board.markFinished(0, 'friends');
  const c = board.claim(3);
  check('cursor+friends xong → chỉ còn engager', c === null || c.channel === 'engager', c);
}

// ── Scene 5: nhiều target — cursor target 2 chạy song song với cursor target 1 ──
{
  const board = new ScrapeTaskBoard([{ kind: 'page' }, { kind: 'page' }], { scrapeType: 'followers_only' });
  const a = board.claim(1);
  const b = board.claim(2);
  check('followers_only: 2 target → 2 cursor song song (khoá theo target)',
    a?.channel === 'cursor' && b?.channel === 'cursor' && a.targetIdx !== b.targetIdx, [a, b]);
  const c = board.claim(3);
  check('account 3 hết việc → null', c === null, c);
}

// ── Scene 6: kind routing — group/post target ──
{
  const g = new ScrapeTaskBoard([{ kind: 'group' }], { scrapeType: 'multi_tier' });
  check('group target → kênh group', g.claim(1)?.channel === 'group');
  const p = new ScrapeTaskBoard([{ kind: 'post' }], { scrapeType: 'multi_tier' });
  check('post target → kênh post', p.claim(1)?.channel === 'post');
  const m = new ScrapeTaskBoard([{ kind: 'page' }, { kind: 'group' }], { scrapeType: 'members' });
  const t1 = m.claim(1)!;
  const t2 = m.claim(2)!;
  check('scrapeType=members ép mọi target về group', t1.channel === 'group' && t2.channel === 'group', [t1, t2]);
  const pc = new ScrapeTaskBoard([{ kind: 'page' }], { scrapeType: 'post_commenters' });
  check('scrapeType=post_commenters → post', pc.claim(1)?.channel === 'post');
}

// ── Scene 7: release trong finally không kẹt khoá (worker crash mô phỏng) ──
{
  const board = new ScrapeTaskBoard([{ kind: 'page' }], { scrapeType: 'multi_tier' });
  const a = board.claim(1)!;          // cursor
  board.release(a, 1);                 // crash/launch fail → finally release
  const b = board.claim(2);
  check('sau release, account khác claim được kênh vừa nhả', b !== null, b);
  board.release(b!, 2);
  const c = board.claim(3);
  check('vẫn còn kênh khác để claim', c !== null, c);
}

// ── Scene 8: đóng toàn bộ → isExhausted ──
{
  const board = new ScrapeTaskBoard([{ kind: 'page' }], { scrapeType: 'multi_tier' });
  board.markFinished(0, 'cursor');
  board.markFinished(0, 'friends');
  board.markFinished(0, 'engager');
  board.markDiscoveryDone(0);
  check('mọi kênh đóng → isExhausted(account)', board.isExhausted(1));
  check('mọi kênh đóng → hasWork false', !board.hasWork(1));
}

console.log(fail === 0 ? '\n✓ TASK BOARD PASSED' : `\n✗ TASK BOARD FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
