import db from '../src/lib/db';
import { parseSpintax } from '../src/lib/spintax';
import localQueue from '../src/lib/queue';
import { browserLimiter } from '../src/lib/concurrency';
import { sendDesktopNotification } from '../src/lib/notify';
import { launchRobustBrowser, launchRobustPersistentContext } from '../src/lib/browser-launcher';
import { BrowserContext, Page } from 'playwright';

export interface ScrapeTargetRow {
  id: number;
  workspace_id: number;
  platform: string;
  target_type: 'user' | 'hashtag' | 'category';
  target_value: string;
  is_active: number;
  last_scraped_id: string | null;
  last_scraped_at: string | null;
  template_id: number | null;
  keyword_filter: string | null;
}

export class SeedingWatcherDaemon {
  private timer: NodeJS.Timeout | null = null;
  private isChecking = false;

  public start(intervalMinutes: number = 3) {
    if (this.timer) clearInterval(this.timer);
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    console.log(`[Seeding Watcher] 📡 Khởi động Daemon Canh bài mới & Tự động Seeding (chu kỳ ${intervalMinutes} phút)...`);

    // Dọn dẹp logs cũ hơn 7 ngày định kỳ
    try {
      db.prepare(`DELETE FROM crawler_logs WHERE created_at < datetime('now', '-7 days')`).run();
    } catch {}

    // Lần quét đầu tiên sau 15 giây từ khi worker khởi động
    setTimeout(() => {
      this.checkActiveTargets().catch((err: unknown) => {
        console.warn('[Seeding Watcher] Lỗi phiên quét đầu tiên:', err instanceof Error ? err.message : String(err));
      });
    }, 15000);

    this.timer = setInterval(() => {
      this.checkActiveTargets().catch((err: unknown) => {
        console.warn('[Seeding Watcher] Lỗi phiên quét định kỳ:', err instanceof Error ? err.message : String(err));
      });
    }, intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Seeding Watcher] ⏹️ Đã dừng Daemon Canh bài mới.');
  }

  public async checkActiveTargets(): Promise<number> {
    if (this.isChecking) {
      console.log('[Seeding Watcher] ⏳ Phiên quét trước vẫn đang chạy, bỏ qua lượt này.');
      return 0;
    }

    this.isChecking = true;
    let newPostsCount = 0;

    try {
      const targets = db.prepare(`
        SELECT * FROM scrape_targets 
        WHERE is_active = 1 
        ORDER BY last_scraped_at ASC NULLS FIRST, id ASC
      `).all() as ScrapeTargetRow[];

      if (targets.length === 0) {
        return 0;
      }

      console.log(`[Seeding Watcher] 🔎 Bắt đầu kiểm tra ${targets.length} mục tiêu đang theo dõi...`);

      // Sử dụng browserLimiter để không vượt quá trần tài nguyên máy
      await browserLimiter.run(async () => {
        let browserContext: BrowserContext | null = null;
        let isPersistent = false;

        try {
          // Nếu có target X, ưu tiên dùng persistent context của tài khoản X Live (nếu có)
          const hasX = targets.some(t => t.platform === 'x');
          const xAccount = hasX ? (db.prepare(`
            SELECT social_accounts.*, proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
            FROM social_accounts 
            LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
            WHERE social_accounts.platform = 'x' AND social_accounts.status = 'live' 
            LIMIT 1
          `).get() as any) : null;

          const launchArgs = ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'];

          if (xAccount && xAccount.user_data_dir) {
            const proxyConfig = xAccount.host ? {
              server: `${xAccount.proxy_proto || 'http'}://${xAccount.host}:${xAccount.port}`,
              username: xAccount.proxy_user || undefined,
              password: xAccount.proxy_pass || undefined
            } : undefined;

            browserContext = await launchRobustPersistentContext(xAccount.user_data_dir, {
              headless: true,
              proxy: proxyConfig,
              args: launchArgs
            });
            isPersistent = true;
          } else {
            const browser = await launchRobustBrowser({
              headless: true,
              args: launchArgs
            });
            browserContext = await browser.newContext({
              viewport: { width: 1280, height: 800 },
              locale: 'vi-VN'
            });
            isPersistent = false;
          }

          const page = await browserContext.newPage();
          page.setDefaultTimeout(30000);

          for (const target of targets) {
            try {
              const detected = await this.inspectSingleTarget(page, target);
              if (detected) newPostsCount++;
            } catch (targetErr: unknown) {
              const msg = targetErr instanceof Error ? targetErr.message : String(targetErr);
              console.warn(`[Seeding Watcher] Lỗi kiểm tra mục tiêu #${target.id} (${target.target_value}):`, msg);
              try {
                db.prepare(`
                  INSERT INTO crawler_logs (workspace_id, target_value, action_type, message)
                  VALUES (?, ?, 'error', ?)
                `).run(target.workspace_id, target.target_value, `Lỗi khi quét mục tiêu: ${msg.slice(0, 200)}`);
              } catch {}
            }

            // Nghỉ ngắn 2s giữa các mục tiêu
            await page.waitForTimeout(2000);
          }

          await page.close().catch(() => {});
        } finally {
          if (browserContext) {
            try { await browserContext.close(); } catch {}
          }
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Seeding Watcher] Lỗi chung khi kiểm tra mục tiêu:', msg);
    } finally {
      this.isChecking = false;
    }

    return newPostsCount;
  }

  private async inspectSingleTarget(page: Page, target: ScrapeTargetRow): Promise<boolean> {
    const platform = (target.platform || 'x').toLowerCase();
    let detectedNewPost = false;

    if (platform === 'x') {
      const cleanUsername = target.target_value.replace(/^@/, '').trim();
      const targetUrl = target.target_type === 'hashtag'
        ? `https://x.com/search?q=${encodeURIComponent(target.target_value)}&f=live`
        : `https://x.com/${cleanUsername}`;

      console.log(`[Seeding Watcher] 🐦 Đang kiểm tra X: ${targetUrl}...`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);

      const tweetAnchor = await page.$('article[data-testid="tweet"] a[href*="/status/"]');
      if (!tweetAnchor) {
        return false;
      }

      const href = (await tweetAnchor.getAttribute('href')) || '';
      const match = href.match(/\/status\/(\d+)/);
      const tweetId = match ? match[1] : null;

      if (!tweetId) return false;

      const fullTweetUrl = href.startsWith('http') ? href : `https://x.com${href}`;
      const snippet = await page.evaluate(() => {
        const t = document.querySelector('article[data-testid="tweet"] div[data-testid="tweetText"]');
        return t ? (t.textContent || '').trim().slice(0, 200) : '';
      }).catch(() => '');

      if (tweetId !== target.last_scraped_id) {
        console.log(`[Seeding Watcher] ✨ PHÁT HIỆN TWEET MỚI: ${fullTweetUrl}`);
        await this.handleNewPostDiscovered(target, tweetId, fullTweetUrl, target.target_value, snippet);
        detectedNewPost = true;
      }
    } else if (platform === 'threads') {
      const cleanUsername = target.target_value.replace(/^@/, '').trim();
      const targetUrl = target.target_value.startsWith('http')
        ? target.target_value
        : `https://www.threads.net/@${cleanUsername}`;

      console.log(`[Seeding Watcher] 🧵 Đang kiểm tra Threads: ${targetUrl}...`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);

      const postAnchor = await page.$('a[href*="/post/"]');
      if (!postAnchor) return false;

      const href = (await postAnchor.getAttribute('href')) || '';
      const match = href.match(/\/post\/([A-Za-z0-9_-]+)/);
      const postId = match ? match[1] : null;
      if (!postId) return false;

      const fullPostUrl = href.startsWith('http') ? href : `https://www.threads.net${href}`;
      if (postId !== target.last_scraped_id) {
        console.log(`[Seeding Watcher] ✨ PHÁT HIỆN THREAD MỚI: ${fullPostUrl}`);
        await this.handleNewPostDiscovered(target, postId, fullPostUrl, target.target_value, '');
        detectedNewPost = true;
      }
    } else if (platform === 'newf319') {
      let targetUrl = target.target_value.trim();
      if (!targetUrl.startsWith('http')) {
        targetUrl = /^\d+$/.test(targetUrl)
          ? `https://newf319.com/forums/thi-truong-chung-khoan.${targetUrl}/`
          : `https://newf319.com/forums/${targetUrl}`;
      }

      console.log(`[Seeding Watcher] 📈 Đang kiểm tra NewF319: ${targetUrl}...`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const threadAnchor = await page.$('ol.discussionListItems li.discussionListItem:not(.sticky) h3.title a');
      if (!threadAnchor) return false;

      const href = (await threadAnchor.getAttribute('href')) || '';
      const match = href.match(/threads\/[^\.]+\.(\d+)/) || href.match(/threads\/(\d+)/);
      const threadId = match ? match[1] : null;
      if (!threadId) return false;

      const fullUrl = href.startsWith('http') ? href : `https://newf319.com/${href.replace(/^\//, '')}`;
      const title = (await threadAnchor.textContent()) || '';

      if (threadId !== target.last_scraped_id) {
        console.log(`[Seeding Watcher] ✨ PHÁT HIỆN CHỦ ĐỀ MỚI TRÊN NEWF319: ${fullUrl}`);
        await this.handleNewPostDiscovered(target, threadId, fullUrl, target.target_value, title);
        detectedNewPost = true;
      }
    } else if (platform === 'facebook') {
      let targetUrl = target.target_value.trim();
      if (!targetUrl.startsWith('http')) {
        targetUrl = `https://mbasic.facebook.com/${targetUrl}`;
      } else {
        targetUrl = targetUrl.replace(/^(https?:\/\/)?(www\.|m\.)?facebook\.com/, 'https://mbasic.facebook.com');
      }

      console.log(`[Seeding Watcher] 📘 Đang kiểm tra Facebook: ${targetUrl}...`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);

      const html = await page.content().catch(() => '');
      if (html.includes('login_form') || html.includes('checkpoint')) {
        console.warn(`[Seeding Watcher] Facebook yêu cầu đăng nhập khi truy cập ${targetUrl}.`);
        return false;
      }

      // Bóc tách ID bài viết mới nhất trên timeline mbasic
      const match = html.match(/ft_ent_identifier=(\d{8,25})/) || html.match(/story_fbid=(\d{8,25})/);
      const postId = match ? match[1] : null;
      if (!postId) return false;

      const postUrl = `https://www.facebook.com/${postId}`;
      if (postId !== target.last_scraped_id) {
        console.log(`[Seeding Watcher] ✨ PHÁT HIỆN BÀI VIẾT FACEBOOK MỚI: ${postUrl}`);
        await this.handleNewPostDiscovered(target, postId, postUrl, target.target_value, '');
        detectedNewPost = true;
      }
    }

    return detectedNewPost;
  }

  private async handleNewPostDiscovered(
    target: ScrapeTargetRow,
    postId: string,
    postUrl: string,
    author: string,
    contentSnippet: string
  ): Promise<void> {
    // 1. Cập nhật mục tiêu với post_id mới nhất
    db.prepare(`
      UPDATE scrape_targets 
      SET last_scraped_id = ?, last_scraped_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(postId, target.id);

    // 2. Ghi nhận bài viết vào scraped_posts
    db.prepare(`
      INSERT OR IGNORE INTO scraped_posts (workspace_id, target_id, platform, post_id, post_url, author, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(target.workspace_id, target.id, target.platform, postId, postUrl, author || target.target_value, contentSnippet);

    // 3. Kiểm tra kịch bản bình luận seeding
    let template: { content: string } | undefined;
    if (target.template_id) {
      template = db.prepare(`SELECT content FROM spam_templates WHERE id = ? AND workspace_id = ?`).get(target.template_id, target.workspace_id) as { content: string } | undefined;
    }
    if (!template) {
      template = db.prepare(`SELECT content FROM spam_templates WHERE workspace_id = ? ORDER BY RANDOM() LIMIT 1`).get(target.workspace_id) as { content: string } | undefined;
    }

    if (!template || !template.content.trim()) {
      console.warn(`[Seeding Watcher] Phát hiện bài mới (${postUrl}) nhưng chưa có kịch bản mẫu nào.`);
      db.prepare(`
        INSERT INTO crawler_logs (workspace_id, target_value, action_type, message)
        VALUES (?, ?, 'warning', ?)
      `).run(target.workspace_id, target.target_value, `Phát hiện bài mới (${postUrl}) nhưng chưa có kịch bản mẫu nào.`);
      return;
    }

    // 4. Chọn 1 tài khoản Live của nền tảng này để seeding
    const account = db.prepare(`
      SELECT id, username FROM social_accounts 
      WHERE platform = ? AND status = 'live' 
        AND (cooldown_until IS NULL OR cooldown_until <= CURRENT_TIMESTAMP)
        AND workspace_id = ?
      ORDER BY RANDOM() 
      LIMIT 1
    `).get(target.platform, target.workspace_id) as { id: number; username: string } | undefined;

    if (!account) {
      console.warn(`[Seeding Watcher] Phát hiện bài mới (${postUrl}) nhưng không có tài khoản ${target.platform.toUpperCase()} Live nào để seeding.`);
      db.prepare(`
        INSERT INTO crawler_logs (workspace_id, target_value, action_type, message)
        VALUES (?, ?, 'warning', ?)
      `).run(target.workspace_id, target.target_value, `Phát hiện bài mới (${postUrl}) nhưng không có tài khoản ${target.platform.toUpperCase()} Live nào để seeding.`);
      return;
    }

    // 5. Spin nội dung và lên lịch comment với độ trễ người thật đọc bài (30s - 90s)
    const commentContent = parseSpintax(template.content, { name: author || 'bạn' });
    const randomDelaySeconds = 30 + Math.floor(Math.random() * 60);
    const scheduledAt = new Date(Date.now() + randomDelaySeconds * 1000);
    const campaignId = `AUTO_SEEDING_${target.platform.toUpperCase()}_${Date.now()}`;

    db.prepare(`
      INSERT INTO jobs (account_id, type, target_url, post_content, scheduled_at, status, campaign_id, workspace_id)
      VALUES (?, 'comment', ?, ?, ?, 'pending', ?, ?)
    `).run(account.id, postUrl, commentContent, scheduledAt.toISOString(), campaignId, target.workspace_id);

    // 6. Ghi log thành công vào crawler_logs & thông báo desktop
    db.prepare(`
      INSERT INTO crawler_logs (workspace_id, target_value, action_type, message)
      VALUES (?, ?, 'success', ?)
    `).run(
      target.workspace_id,
      target.target_value,
      `Phát hiện bài viết mới trên ${target.platform.toUpperCase()}: ${postUrl}. Đã lên lịch tự động bình luận cho @${account.username} sau ${randomDelaySeconds}s.`
    );

    sendDesktopNotification(
      'Tự động Seeding bài mới 🎯',
      `Phát hiện bài mới từ ${target.target_value} (${target.platform.toUpperCase()}). Đã giao cho @${account.username} bình luận!`
    );

    // Kích hoạt ngay queue xử lý
    localQueue.triggerProcess();
  }
}

export const seedingWatcher = new SeedingWatcherDaemon();
export default seedingWatcher;
