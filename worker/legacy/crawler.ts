import { chromium } from 'playwright';
import { parseSpintax } from '../src/lib/spintax';
import { enqueueJob } from '../src/lib/queue';

// Crawl latest posts for all targets
export async function crawlTargets(db: any) {
  console.log('[Crawler] Running target check...');
  
  // Prune logs older than 3 days
  try {
    await db`DELETE FROM crawler_logs WHERE created_at < NOW() - INTERVAL '3 days'`;
  } catch (err: any) {
    console.error('[Crawler] Failed to prune old logs:', err.message);
  }
  
  // 1. Fetch active targets
  const targets = await db`SELECT * FROM scrape_targets WHERE status = 'active'` as Array<{
    id: number;
    type: 'username' | 'hashtag';
    value: string;
    platform: string;
    last_scraped_id: string | null;
    workspace_id: number;
  }>;

  if (targets.length === 0) {
    console.log('[Crawler] No active targets found.');
    return;
  }

  // 2. Fetch a logged-in (live) X account to use as the scraper browser context for X targets
  const hasXTargets = targets.some(t => !t.platform || t.platform === 'x');
  let crawlerAccount = null;
  if (hasXTargets) {
    const accounts = await db`
      SELECT social_accounts.*, proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass
      FROM social_accounts 
      LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
      WHERE social_accounts.platform = 'x' AND social_accounts.status = 'live' 
      LIMIT 1
    ` as any[];
    if (accounts && accounts.length > 0) {
      crawlerAccount = accounts[0];
    }

    if (!crawlerAccount) {
      console.log('[Crawler] WARNING: Cannot crawl X targets because there are no active (Live) X accounts.');
      try {
        await db`
          INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
          VALUES ('Hệ thống', 'warning', 'Không thể chạy trình quét X vì không có tài khoản X hoạt động (Live).', 1)
        `;
      } catch (e) {}
    }
  }

  // 3. Launch browser session
  const launchOpts: any = {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  };

  if (crawlerAccount && crawlerAccount.host) {
    launchOpts.proxy = {
      server: `http://${crawlerAccount.host}:${crawlerAccount.port}`
    };
    if (crawlerAccount.proxy_user && crawlerAccount.proxy_pass) {
      launchOpts.proxy.username = crawlerAccount.proxy_user;
      launchOpts.proxy.password = crawlerAccount.proxy_pass;
    }
  }

  let context: any = null;
  let isGuestContext = false;
  try {
    if (crawlerAccount) {
      context = await chromium.launchPersistentContext(crawlerAccount.user_data_dir, launchOpts);
      
      // Inject auth_token if available to ensure session is logged in
      if (crawlerAccount.auth_token) {
        await context.addCookies([
          {
            name: 'auth_token',
            value: crawlerAccount.auth_token,
            domain: '.x.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'None'
          }
        ]);
      }
    } else {
      // Launch standard guest browser context if no X account is available (for newf319 targets)
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
      });
      isGuestContext = true;
    }
    
    const page = await context.newPage();

    // 4. Iterate over targets
    for (const target of targets) {
      const platform = target.platform || 'x';
      if (platform === 'x' && !crawlerAccount) {
        continue; // Skip X target if no live X account is available
      }
      
      try {
        if (platform === 'x') {
          console.log(`[Crawler] Checking X ${target.type} target: ${target.value}...`);
          
          let url = '';
          if (target.type === 'username') {
            const cleanUsername = target.value.replace('@', '');
            url = `https://x.com/${cleanUsername}`;
          } else {
            url = `https://x.com/search?q=${encodeURIComponent(target.value)}&f=live`;
          }

          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(4000); // Wait for tweets to render

          // Find the first tweet card
          const tweetElement = await page.$('article[data-testid="tweet"]');
          if (!tweetElement) {
            console.log(`[Crawler] No tweets found for X target ${target.value}`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'warning', 'Không tìm thấy bài đăng nào hiển thị trên trang X.', ${target.workspace_id})
              `;
            } catch (e) {}
            continue;
          }

          // Get tweet permalink
          const linkElement = await tweetElement.$('a[href*="/status/"]');
          if (!linkElement) {
            console.log(`[Crawler] Could not find status link inside tweet for ${target.value}`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'error', 'Không tìm thấy liên kết bài viết trong tweet.', ${target.workspace_id})
              `;
            } catch (e) {}
            continue;
          }

          const href = await linkElement.getAttribute('href');
          if (!href) continue;

          // Extract status ID
          const match = href.match(/\/status\/(\d+)/);
          const tweetId = match ? match[1] : null;

          if (!tweetId) {
            console.log(`[Crawler] Invalid status ID extracted from href: ${href}`);
            continue;
          }

          const fullTweetUrl = `https://x.com${href.split('?')[0]}`; // Clean query params

          // 5. If it's a new tweet, trigger seeding / comment
          if (tweetId !== target.last_scraped_id) {
            console.log(`[Crawler] ✨ FOUND NEW TWEET from ${target.value}: ${fullTweetUrl}`);

            // Update last_scraped_id
            await db`UPDATE scrape_targets SET last_scraped_id = ${tweetId} WHERE id = ${target.id}`;

            // Fetch active templates
            const templates = await db`SELECT content FROM spam_templates WHERE workspace_id = ${target.workspace_id}` as Array<{ content: string }>;
            
            // Fetch live accounts
            const liveAccounts = await db`SELECT id FROM social_accounts WHERE platform = 'x' AND status = 'live' AND workspace_id = ${target.workspace_id}` as Array<{ id: number }>;

            if (templates.length === 0) {
              console.log('[Crawler] No spam templates available. X seeding job skipped.');
              try {
                await db`
                  INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                  VALUES (${target.value}, 'warning', 'Phát hiện bài viết mới trên X nhưng bỏ qua do chưa có mẫu kịch bản bình luận nào.', ${target.workspace_id})
                `;
              } catch (e) {}
              continue;
            }
            if (liveAccounts.length === 0) {
              console.log('[Crawler] No live accounts available for X seeding. Seeding job skipped.');
              try {
                await db`
                  INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                  VALUES (${target.value}, 'warning', 'Phát hiện bài viết mới trên X nhưng bỏ qua do không có tài khoản X hoạt động (Live) để seeding.', ${target.workspace_id})
                `;
              } catch (e) {}
              continue;
            }

            // Pick random template and account
            const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
            const randomAccount = liveAccounts[Math.floor(Math.random() * liveAccounts.length)];
            const commentContent = parseSpintax(randomTemplate.content);

            // Queue comment job
            const now = new Date();
            const scheduledAt = new Date(now.getTime() + (Math.floor(Math.random() * 60) + 30) * 1000);

            const [inserted] = await db`
              INSERT INTO jobs (account_id, type, target_url, post_content, scheduled_at, status, workspace_id)
              VALUES (${randomAccount.id}, 'comment', ${fullTweetUrl}, ${commentContent}, ${scheduledAt.toISOString()}, 'pending', ${target.workspace_id})
              RETURNING id
            `;

            await enqueueJob(inserted.id, scheduledAt.toISOString());
            console.log(`[Crawler] Queued X auto-comment job for account ID ${randomAccount.id} to status ${tweetId}`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'success', ${`Phát hiện bài viết mới trên X: ${fullTweetUrl}. Đã lên lịch tự động bình luận.`}, ${target.workspace_id})
              `;
            } catch (e) {}
          } else {
            console.log(`[Crawler] No new tweets for X ${target.value} (current: ${tweetId})`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'info', ${`Đã kiểm tra X. Không có bài đăng mới (Bài viết hiện tại: ${tweetId}).`}, ${target.workspace_id})
              `;
            } catch (e) {}
          }
        } 
        else if (platform === 'newf319') {
          console.log(`[Crawler] Checking newf319 target: ${target.value}...`);
          let url = target.value.trim();
          if (!url.startsWith('http')) {
            if (/^\d+$/.test(url)) {
              url = `https://newf319.com/forums/thi-truong-chung-khoan.${url}/`;
            } else {
              url = `https://newf319.com/forums/${url}`;
            }
          }

          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);

          // Find first thread that is not sticky
          const threadItems = await page.$$('ol.discussionListItems li.discussionListItem:not(.sticky)');
          if (threadItems.length === 0) {
            console.log(`[Crawler] No threads found for newf319 target: ${target.value}`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'warning', 'Không tìm thấy chủ đề thảo luận nào trong chuyên mục newf319.', ${target.workspace_id})
              `;
            } catch (e) {}
            continue;
          }

          const firstThread = threadItems[0];
          const linkEl = await firstThread.$('h3.title a.PreviewTooltip, h3.title a');
          if (!linkEl) {
            console.log(`[Crawler] Could not find link inside thread item for target ${target.value}`);
            continue;
          }

          const href = await linkEl.getAttribute('href');
          if (!href) continue;

          // Extract thread ID
          const match = href.match(/threads\/[^\.]+\.(\d+)/) || href.match(/threads\/(\d+)/);
          const threadId = match ? match[1] : null;

          if (!threadId) {
            console.log(`[Crawler] Invalid thread ID extracted from href: ${href}`);
            continue;
          }

          const fullThreadUrl = href.startsWith('http') ? href : `https://newf319.com/${href}`;

          // If new thread found
          if (threadId !== target.last_scraped_id) {
            console.log(`[Crawler] ✨ FOUND NEW THREAD from newf319: ${fullThreadUrl}`);

            // Update last_scraped_id
            await db`UPDATE scrape_targets SET last_scraped_id = ${threadId} WHERE id = ${target.id}`;

            // Fetch active templates
            const templates = await db`SELECT content FROM spam_templates WHERE workspace_id = ${target.workspace_id}` as Array<{ content: string }>;
            
            // Fetch live newf319 accounts
            const liveAccounts = await db`SELECT id FROM social_accounts WHERE platform = 'newf319' AND status = 'live' AND workspace_id = ${target.workspace_id}` as Array<{ id: number }>;

            if (templates.length === 0) {
              console.log('[Crawler] No spam templates available. newf319 seeding job skipped.');
              try {
                await db`
                  INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                  VALUES (${target.value}, 'warning', 'Phát hiện chủ đề mới trên newf319 nhưng bỏ qua do chưa có mẫu kịch bản bình luận nào.', ${target.workspace_id})
                `;
              } catch (e) {}
              continue;
            }
            if (liveAccounts.length === 0) {
              console.log('[Crawler] No live newf319 accounts available. newf319 seeding job skipped.');
              try {
                await db`
                  INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                  VALUES (${target.value}, 'warning', 'Phát hiện chủ đề mới trên newf319 nhưng bỏ qua do không có tài khoản newf319 hoạt động (Live) để seeding.', ${target.workspace_id})
                `;
              } catch (e) {}
              continue;
            }

            // Pick random template and account
            const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
            const randomAccount = liveAccounts[Math.floor(Math.random() * liveAccounts.length)];
            const commentContent = parseSpintax(randomTemplate.content);

            // Queue comment job
            const now = new Date();
            const scheduledAt = new Date(now.getTime() + (Math.floor(Math.random() * 60) + 30) * 1000);

            const [inserted] = await db`
              INSERT INTO jobs (account_id, type, target_url, post_content, scheduled_at, status, workspace_id)
              VALUES (${randomAccount.id}, 'comment', ${fullThreadUrl}, ${commentContent}, ${scheduledAt.toISOString()}, 'pending', ${target.workspace_id})
              RETURNING id
            `;

            await enqueueJob(inserted.id, scheduledAt.toISOString());
            console.log(`[Crawler] Queued newf319 auto-comment job for account ID ${randomAccount.id} to thread ${threadId}`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'success', ${`Phát hiện chủ đề mới trên newf319: ${fullThreadUrl}. Đã lên lịch tự động bình luận.`}, ${target.workspace_id})
              `;
            } catch (e) {}
          } else {
            console.log(`[Crawler] No new threads for newf319 ${target.value} (current: ${threadId})`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'info', ${`Đã kiểm tra newf319. Không có chủ đề mới (Chủ đề hiện tại: ${threadId}).`}, ${target.workspace_id})
              `;
            } catch (e) {}
          }
        }
        else if (platform === 'facebook') {
          console.log(`[Crawler] Checking Facebook target: ${target.value}...`);
          await page.goto(target.value, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(4000);
          
          const postElements = await page.$$('div[role="article"]');
          if (postElements.length === 0) {
            console.log(`[Crawler] No posts found for Facebook target: ${target.value}`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'warning', 'Không tìm thấy bài viết nào trên trang Facebook.', ${target.workspace_id})
              `;
            } catch (e) {}
            continue;
          }
          
          let postUrl = '';
          let postId = '';
          
          const firstPost = postElements[0];
          const links = await firstPost.$$('a');
          for (const link of links) {
            const href = await link.getAttribute('href');
            if (href && (
              href.includes('/posts/') || 
              href.includes('/permalink.php') || 
              href.includes('/photos/') || 
              href.includes('/videos/') || 
              href.includes('pfbid') ||
              href.includes('/share/') ||
              href.includes('/watch') ||
              href.includes('fbid=')
            )) {
              postUrl = href.split('?')[0];
              const urlObj = new URL(href, 'https://www.facebook.com');
              postId = urlObj.pathname.split('/').filter(Boolean).pop() || '';
              if (postId) break;
            }
          }
          
          if (!postId && postUrl) {
            postId = postUrl;
          }
          
          if (!postId) {
            console.log(`[Crawler] Could not extract post ID for Facebook target ${target.value}`);
            continue;
          }
          
          if (postId !== target.last_scraped_id) {
            console.log(`[Crawler] ✨ FOUND NEW FB POST from ${target.value}: ${postUrl || target.value}`);
            
            await db`UPDATE scrape_targets SET last_scraped_id = ${postId} WHERE id = ${target.id}`;
            
            const templates = await db`SELECT content FROM spam_templates WHERE workspace_id = ${target.workspace_id}` as Array<{ content: string }>;
            const liveAccounts = await db`SELECT id FROM social_accounts WHERE platform = 'facebook' AND status = 'live' AND workspace_id = ${target.workspace_id}` as Array<{ id: number }>;
            
            if (templates.length === 0) {
              console.log('[Crawler] No spam templates available. Facebook seeding job skipped.');
              try {
                await db`
                  INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                  VALUES (${target.value}, 'warning', 'Phát hiện bài viết mới trên Facebook nhưng bỏ qua do chưa có mẫu bình luận.', ${target.workspace_id})
                `;
              } catch (e) {}
              continue;
            }
            if (liveAccounts.length === 0) {
              console.log('[Crawler] No live Facebook accounts available. Facebook seeding job skipped.');
              try {
                await db`
                  INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                  VALUES (${target.value}, 'warning', 'Phát hiện bài viết mới trên Facebook nhưng bỏ qua do không có tài khoản FB hoạt động.', ${target.workspace_id})
                `;
              } catch (e) {}
              continue;
            }
            
            const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
            const randomAccount = liveAccounts[Math.floor(Math.random() * liveAccounts.length)];
            const commentContent = parseSpintax(randomTemplate.content);
            
            const now = new Date();
            const scheduledAt = new Date(now.getTime() + (Math.floor(Math.random() * 60) + 30) * 1000);
            
            const [inserted] = await db`
              INSERT INTO jobs (account_id, type, target_url, post_content, scheduled_at, status, workspace_id)
              VALUES (${randomAccount.id}, 'comment', ${postUrl || target.value}, ${commentContent}, ${scheduledAt.toISOString()}, 'pending', ${target.workspace_id})
              RETURNING id
            `;
            
            await enqueueJob(inserted.id, scheduledAt.toISOString());
            console.log(`[Crawler] Queued Facebook auto-comment job for account ID ${randomAccount.id} to post ${postId}`);
            
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'success', ${`Phát hiện bài viết mới trên Facebook: ${postUrl || target.value}. Đã lên lịch tự động bình luận.`}, ${target.workspace_id})
              `;
            } catch (e) {}
          } else {
            console.log(`[Crawler] No new posts for Facebook ${target.value} (current: ${postId})`);
            try {
              await db`
                INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
                VALUES (${target.value}, 'info', ${`Đã kiểm tra Facebook. Không có bài đăng mới (Bài viết hiện tại: ${postId}).`}, ${target.workspace_id})
              `;
            } catch (e) {}
          }
        }
      } catch (err: any) {
        console.error(`[Crawler] Error scraping target ${target.value} on ${platform}:`, err.message);
        try {
          await db`
            INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
            VALUES (${target.value}, 'error', ${`Lỗi khi quét mục tiêu: ${err.message}`}, ${target.workspace_id})
          `;
        } catch (e) {}
      }
    }

    if (isGuestContext) {
      // Close browser for guest context
      await context.browser().close();
    } else {
      await context.close();
    }
  } catch (error: any) {
    console.error('[Crawler] Browser context launch failed:', error.message);
    try {
      await db`
        INSERT INTO crawler_logs (target_value, action_type, message, workspace_id) 
        VALUES ('Hệ thống', 'error', ${`Không thể khởi động trình duyệt quét: ${error.message}`}, 1)
      `;
    } catch (e) {}
    if (context) {
      if (isGuestContext) {
        await context.browser().close().catch(() => {});
      } else {
        await context.close().catch(() => {});
      }
    }
  }
}
