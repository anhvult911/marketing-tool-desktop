import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { chromium as baseChromium } from 'playwright';
import { launchRobustPersistentContext } from '@/lib/browser-launcher';
import { getAuthSession } from '@/lib/auth';
import { killProfileProcesses, getLaunchOptions, parseCookiesToPlaywright, handleFacebookCheckpoints, checkLoginState as checkXLoginState } from '@/../worker/automation';

const chromium = {
  ...baseChromium,
  launchPersistentContext: (userDataDir: string, options?: any) => {
    return launchRobustPersistentContext(userDataDir, options);
  },
};

const PLATFORM_DOMAINS: Record<string, { domain: string; url: string }> = {
  facebook: { domain: '.facebook.com', url: 'https://www.facebook.com/' },
  threads: { domain: '.threads.net', url: 'https://www.threads.net/' },
  instagram: { domain: '.instagram.com', url: 'https://www.instagram.com/' },
  x: { domain: '.x.com', url: 'https://x.com/home' },
  tiktok: { domain: '.tiktok.com', url: 'https://www.tiktok.com/' },
  youtube: { domain: '.google.com', url: 'https://www.youtube.com/' },
  newf319: { domain: '.newf319.com', url: 'https://newf319.com/' },
  zalo: { domain: '.zalo.me', url: 'https://chat.zalo.me/' }
};

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { accountId, cookies: rawCookies } = await request.json();

    if (!accountId || !rawCookies) {
      return NextResponse.json({ success: false, error: 'Vui lòng cung cấp ID tài khoản và nội dung Cookie.' }, { status: 400 });
    }

    const account = db.prepare(`
      SELECT social_accounts.*, 
             proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
      FROM social_accounts
      LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
      WHERE social_accounts.id = ? AND social_accounts.workspace_id = ?
    `).get(accountId, workspaceId) as any;

    if (!account) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy tài khoản.' }, { status: 404 });
    }

    const platformConfig = PLATFORM_DOMAINS[account.platform] || { domain: `.${account.platform}.com`, url: `https://www.${account.platform}.com/` };
    const parsedCookies = parseCookiesToPlaywright(rawCookies, platformConfig.domain);

    if (!parsedCookies || parsedCookies.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Không tìm thấy cookie hợp lệ.' 
      }, { status: 400 });
    }

    killProfileProcesses(account.user_data_dir);
    const proxyConfig = account.host ? {
      host: account.host,
      port: account.port,
      username: account.proxy_user,
      password: account.proxy_pass,
      protocol: account.proxy_proto
    } : undefined;

    const launchOpts = getLaunchOptions(account, proxyConfig);
    const context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
    let isLive = false;

    try {
      await context.addCookies(parsedCookies);
      const page = await context.newPage();
      await page.goto(platformConfig.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      if (account.platform === 'facebook') {
        await handleFacebookCheckpoints(page);
        const url = page.url();
        const hasEmail = await page.$('input[name="email"]');
        const hasPass = await page.$('input[name="pass"]');
        isLive = !hasEmail && !hasPass && !url.includes('checkpoint') && !url.includes('login');
      } else if (account.platform === 'x') {
        isLive = await checkXLoginState(page);
      } else {
        const url = page.url();
        isLive = !url.includes('login') && !url.includes('signin');
      }

      await context.close();
    } catch {
      try { await context.close(); } catch {}
    }

    // Cookie mới nạp → luôn reset trạng thái: nếu validation fail cũng KHÔNG giữ 'die'
    // vĩnh viễn (validate có thể fail do proxy/latency, không hẳn cookie hỏng).
    // 'live' nếu validation pass; 'pending' để pre-flight của scraper re-probe sau.
    db.prepare(`
      UPDATE social_accounts
      SET auth_token = ?, status = ?, last_checked = ?, cooldown_until = NULL,
          daily_reset_at = CURRENT_TIMESTAMP, daily_request_count = 0
      WHERE id = ?
    `).run(rawCookies.trim(), isLive ? 'live' : 'pending', new Date().toISOString(), accountId);

    if (isLive) {
      return NextResponse.json({
        success: true,
        message: `Đã nạp ${parsedCookies.length} cookies thành công! Tài khoản @${account.username} đã LIVE.`
      });
    }
    return NextResponse.json({
      success: false,
      error: 'Validate trực tiếp thất bại (có thể do proxy/latency) — cookie ĐÃ LƯU với status=pending, pre-flight của job scrape sẽ re-probe và tự khôi phục nếu cookie còn sống.'
    }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Lỗi hệ thống.' }, { status: 500 });
  }
}
