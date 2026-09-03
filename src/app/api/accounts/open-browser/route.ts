import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { chromium } from 'playwright';
import { killProfileProcesses, XAutomation, FacebookAutomation, checkLoginState, dismissOverlays, handleFacebookCheckpoints } from '../../../../../worker/automation';
import { getAuthSession } from '@/lib/auth';

async function checkLoginStateForPlatform(page: any, platform: string): Promise<boolean> {
  try {
    const url = page.url();
    if (platform === 'x') {
      return await checkLoginState(page);
    } else if (platform === 'zalo') {
      return url.includes('chat.zalo.me') && !url.includes('login');
    } else if (platform === 'whatsapp') {
      const hasPane = await page.$('#pane-side, [data-testid="chat-list"], div[contenteditable="true"][data-tab="3"], span[data-icon="chat"]');
      return hasPane !== null;
    } else if (platform === 'telegram') {
      return url.includes('web.telegram.org') && !url.includes('login') && !url.includes('auth');
    } else if (platform === 'threads') {
      return url.includes('threads.net') && !url.includes('login');
    } else if (platform === 'facebook') {
      await handleFacebookCheckpoints(page);
      const currentUrl = page.url();
      const hasEmailInput = await page.$('input[name="email"]');
      const hasPassInput = await page.$('input[name="pass"]');
      return currentUrl.includes('facebook.com') && !hasEmailInput && !hasPassInput && !currentUrl.includes('login') && !currentUrl.includes('checkpoint');
    }
    return false;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { accountId } = await request.json();

    if (!accountId) {
      return NextResponse.json({ success: false, error: 'Thiếu ID tài khoản.' }, { status: 400 });
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

    const launchOpts: any = {
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    };

    if (account.host) {
      const proto = account.proxy_proto || 'http';
      launchOpts.proxy = {
        server: `${proto}://${account.host}:${account.port}`
      };
      if (account.proxy_user && account.proxy_pass) {
        launchOpts.proxy.username = account.proxy_user;
        launchOpts.proxy.password = account.proxy_pass;
      }
    }

    killProfileProcesses(account.user_data_dir);
    const context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    let targetUrl = 'https://x.com/i/flow/login';
    if (account.platform === 'zalo') targetUrl = 'https://chat.zalo.me/';
    else if (account.platform === 'whatsapp') targetUrl = 'https://web.whatsapp.com/';
    else if (account.platform === 'telegram') targetUrl = 'https://web.telegram.org/a/';
    else if (account.platform === 'threads') targetUrl = 'https://www.threads.net/login';
    else if (account.platform === 'facebook') targetUrl = 'https://www.facebook.com/';

    if (account.platform === 'x') {
      if (account.auth_token) {
        await context.addCookies([
          {
            name: 'auth_token',
            value: account.auth_token,
            domain: '.x.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'None'
          }
        ]);
      }
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await dismissOverlays(page);
    } else {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    // Monitoring in background
    let isClosed = false;
    context.on('close', () => { isClosed = true; });

    (async () => {
      while (!isClosed) {
        try {
          if (account.platform === 'x') {
            const cookies = await context.cookies();
            const authTokenCookie = cookies.find(c => c.name === 'auth_token');
            if (authTokenCookie && authTokenCookie.value !== account.auth_token) {
              db.prepare(`
                UPDATE social_accounts 
                SET auth_token = ?, status = 'live', last_checked = ? 
                WHERE id = ?
              `).run(authTokenCookie.value, new Date().toISOString(), account.id);
            }
          }

          const loggedIn = await checkLoginStateForPlatform(page, account.platform);
          if (loggedIn) {
            db.prepare(`
              UPDATE social_accounts 
              SET status = 'live', last_checked = ? 
              WHERE id = ?
            `).run(new Date().toISOString(), account.id);
          }
        } catch {
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    })();

    return NextResponse.json({ success: true, message: 'Đã mở trình duyệt thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
