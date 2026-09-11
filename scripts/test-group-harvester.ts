/**
 * Regression test cho bug job #48: harvester nhóm báo "còn trang kế" khi thực ra
 * bị CHẶN (login/checkpoint) → kênh group không bao giờ đóng, cursor lưu URL vô
 * dụng, worker quay lại đập cùng endpoint tới khi account bị checkpoint.
 *
 * Chạy: npx tsx scripts/test-group-harvester.ts
 * KHÔNG chạm Facebook — dùng Page giả trả HTML cố định.
 */
import { scrapeGroupMembersViaMbasic } from '../src/lib/facebook-crawler';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); fail++; }
}

/** Page giả tối thiểu: chỉ đủ cho vòng lặp harvester. */
function fakePage(htmlProvider: (url: string, call: number) => string) {
  let call = 0;
  const visited: string[] = [];
  const page = {
    isClosed: () => false,
    goto: async (url: string) => { call++; visited.push(url); return null; },
    waitForTimeout: async () => {},
    content: async () => htmlProvider(visited[visited.length - 1] || '', call),
  };
  return { page: page as unknown as Parameters<typeof scrapeGroupMembersViaMbasic>[0], visited, get calls() { return call; } };
}

const MEMBER_ANCHOR = `<a href="/groups/otofun2021/user/100012345678901/">Nguyễn Văn A</a>`;
const NEXT_LINK = `<a href="/groups/otofun2021/members/?start=50">Xem thêm thành viên</a>`;
const LOGIN_WALL = `<html><body><form id="login_form"><input name="email"></form></body></html>`;
const CHECKPOINT_WALL = `<html><body>checkpoint block</body></html>`;
const JOIN_WALL = `<html><body><a href="/groups/otofun2021/join/">Tham gia nhóm</a><span>Bạn cần là thành viên để xem</span></body></html>`;

async function main() {
  const budget = () => ({ remaining: 100, onSpend: undefined as undefined | (() => void) });
  const noCancel = { cancelled: false };
  const saveBatch = (leads: Array<{ uid: string }>) => leads.length;

  console.log('— Bị chặn (login wall) —');
  {
    const f = fakePage(() => LOGIN_WALL);
    const res = await scrapeGroupMembersViaMbasic(f.page, 'https://www.facebook.com/groups/otofun2021', 500, saveBatch as never, budget(), null);
    check('login wall → KHÔNG trả nextUrl (đừng lưu cursor vô dụng)', res.nextUrl === null, res);
    check('login wall → báo stopReason blocked', res.stopReason === 'blocked', res);
    check('login wall → 0 lead', res.added === 0, res.added);
  }

  console.log('— Bị chặn (checkpoint) —');
  {
    const f = fakePage(() => CHECKPOINT_WALL);
    const res = await scrapeGroupMembersViaMbasic(f.page, 'https://www.facebook.com/groups/otofun2021', 500, saveBatch as never, budget(), null);
    check('checkpoint → KHÔNG trả nextUrl', res.nextUrl === null, res);
    check('checkpoint → stopReason blocked', res.stopReason === 'blocked', res);
  }

  console.log('— Tường "chưa tham gia nhóm" —');
  {
    const f = fakePage(() => JOIN_WALL);
    const res = await scrapeGroupMembersViaMbasic(f.page, 'https://www.facebook.com/groups/otofun2021', 500, saveBatch as never, budget(), null);
    check('join wall → phân biệt được not_member', res.stopReason === 'not_member', res);
    check('join wall → không lưu cursor', res.nextUrl === null, res);
  }

  console.log('— Trang thành viên bình thường —');
  {
    // Trang 1 có thành viên + link trang kế; gọi kế tiếp trả hết phân trang
    const f = fakePage((url) => (url.includes('start=50') ? MEMBER_ANCHOR : MEMBER_ANCHOR + NEXT_LINK));
    const res = await scrapeGroupMembersViaMbasic(f.page, 'https://www.facebook.com/groups/otofun2021', 500, saveBatch as never, budget(), null);
    check('có thành viên → thu được lead', res.added > 0, res.added);
    check('phân trang thật → stopReason exhausted (đã đi hết)', res.stopReason === 'exhausted', res);
    check('đi qua ít nhất 2 trang', f.visited.length >= 2, f.visited);
    check('URL trang 1 đúng dạng slug', f.visited[0].includes('/groups/otofun2021/members/'), f.visited[0]);
  }

  console.log('— Hết ngân sách giữa danh sách —');
  {
    const f = fakePage(() => MEMBER_ANCHOR + NEXT_LINK);
    const b = { remaining: 1 };
    const res = await scrapeGroupMembersViaMbasic(f.page, 'https://www.facebook.com/groups/otofun2021', 500, saveBatch as never, b, null);
    check('hết ngân sách → giữ URL để chạy tiếp (không mất vị trí)', res.nextUrl !== null && res.stopReason === 'budget', res);
  }

  console.log('— Trang không có thành viên (nhóm ẩn/rỗng) —');
  {
    const f = fakePage(() => `<html><body><div>Chưa có thành viên nào</div></body></html>`);
    const res = await scrapeGroupMembersViaMbasic(f.page, 'https://www.facebook.com/groups/otofun2021', 500, saveBatch as never, budget(), null);
    check('trang rỗng hẳn → stopReason empty (khác blocked)', res.stopReason === 'empty', res);
    check('trang rỗng → không lưu cursor', res.nextUrl === null, res);
  }

  console.log(fail === 0 ? '\n✓ GROUP HARVESTER PASSED' : `\n✗ GROUP HARVESTER FAILED (${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
