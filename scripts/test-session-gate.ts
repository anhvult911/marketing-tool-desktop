/**
 * Smoke: CỔNG KIỂM TRA PHIÊN (Tầng 1 bổ sung) — bằng chứng cho lỗi job #50.
 *
 * Job #50 báo "nhóm chặn xem thành viên" nhưng lỗi THẬT là cả 5 account đã mất cookie
 * đăng nhập. Cổng kiểm tra cookie phải phân biệt được:
 *   - context KHÔNG có cookie c_user  → chặn (account cần nạp lại cookie)
 *   - context CÓ cookie c_user       → cho qua (đã đăng nhập thật)
 *
 * Test này dùng browser thật nhưng CHỈ local: mở context, đọc/ghi cookie, không điều
 * hướng tới Facebook.
 *
 * Chạy: npx tsx scripts/test-session-gate.ts
 */
import { launchRobustBrowser } from '../src/lib/browser-launcher';
import { getViewerAccountId } from '../src/lib/facebook-crawler';

let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 220) : ''); fail++; }
}

const FAKE_USER_ID = '61590906836276';

async function main() {
  let browser: Awaited<ReturnType<typeof launchRobustBrowser>> | null = null;
  try {
    browser = await launchRobustBrowser({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    console.log('— Nhánh CHẶN: context không có cookie đăng nhập —');
    {
      const ctx = await browser.newContext();
      const viewerId = await getViewerAccountId(ctx);
      check('context sạch → viewer id RỖNG (bị chặn)', viewerId === '', { viewerId });
      await ctx.close();
    }

    console.log('— Nhánh CHẶN: chỉ có cookie phụ (đúng ca 5 account job #50) —');
    {
      const ctx = await browser.newContext();
      // Đúng trạng thái thật đo được: chỉ còn 'fr', KHÔNG có c_user/xs
      await ctx.addCookies([
        { name: 'fr', value: '1nTyKWITWWzjKZAWN.AW', domain: '.facebook.com', path: '/' },
        { name: 'datr', value: '21GQahE0LkXMrw4L4xd3EinJ', domain: '.facebook.com', path: '/' },
      ]);
      const viewerId = await getViewerAccountId(ctx);
      check('chỉ có cookie phụ → vẫn RỖNG (bị chặn, không lọt)', viewerId === '', { viewerId });
      await ctx.close();
    }

    console.log('— Nhánh CHO QUA: có cookie c_user —');
    {
      const ctx = await browser.newContext();
      await ctx.addCookies([
        { name: 'c_user', value: FAKE_USER_ID, domain: '.facebook.com', path: '/' },
        { name: 'xs', value: 'fake-xs-token', domain: '.facebook.com', path: '/' },
      ]);
      const viewerId = await getViewerAccountId(ctx);
      check('có c_user → trả về đúng viewer id', viewerId === FAKE_USER_ID, { viewerId });
      await ctx.close();
    }

    console.log('— Nhánh CHO QUA: cookie hết hạn nhưng vẫn tồn tại —');
    {
      const ctx = await browser.newContext();
      // Cookie hết hạn: trình duyệt không gửi cookie này cho facebook.com nữa
      await ctx.addCookies([
        { name: 'c_user', value: FAKE_USER_ID, domain: '.facebook.com', path: '/', expires: Math.floor(Date.now() / 1000) - 3600 },
      ]);
      const viewerId = await getViewerAccountId(ctx);
      check('cookie c_user ĐÃ HẾT HẠN → không tính là đăng nhập', viewerId === '', { viewerId });
      await ctx.close();
    }

    console.log(fail === 0 ? '\n✓ SESSION GATE PASSED' : `\n✗ SESSION GATE FAILED (${fail})`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
