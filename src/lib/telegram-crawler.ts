import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import db from './db';
import { browserLimiter } from './concurrency';
import { sendDesktopNotification } from './notify';
import { unlockProfileDir } from './profile-lock';
import { launchRobustPersistentContext, launchRobustBrowser } from './browser-launcher';

export interface TelegramScrapeOptions {
  jobId: number;
  workspaceId: number;
  platform: string;
  targetGroup: string;
  accountId?: number;
  accountIds?: number[];
  maxLimit: number;
  autoImport: boolean;
  scrapeType: string;
  customTag?: string;
  targetCampaignId?: string;
}

const activeTelegramSignals = new Map<number, { cancelled: boolean }>();

export function stopTelegramScrapeJob(jobId: number) {
  const sig = activeTelegramSignals.get(jobId);
  if (sig) {
    sig.cancelled = true;
  }
}

/**
 * Parse group target into clean identifier / link
 */
export function parseTelegramTarget(input: string): { cleanLink: string; identifier: string } {
  let target = input.trim();
  if (target.startsWith('@')) {
    target = `https://t.me/${target.replace('@', '')}`;
  } else if (!target.startsWith('http')) {
    target = `https://t.me/${target}`;
  }

  let id = target.split('/').pop()?.split('?')[0].replace(/^@/, '') || 'telegram_group';
  return { cleanLink: target, identifier: id };
}

/**
 * Run Telegram Scrape Job using Web A
 */
export async function runTelegramScrapeJob(options: TelegramScrapeOptions): Promise<void> {
  return browserLimiter.run(async () => {
    const { jobId, workspaceId, targetGroup, maxLimit, autoImport, customTag, scrapeType } = options;

    const cancelSignal = { cancelled: false };
    activeTelegramSignals.set(jobId, cancelSignal);

    db.prepare(`UPDATE scrape_jobs SET status = 'processing', error_msg = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);

    const parsed = parseTelegramTarget(targetGroup);
    const targetTag = customTag && customTag.trim() ? customTag.trim() : `TG_${parsed.identifier}`;

    let scrapedCount = 0;
    const collectedUids = new Set<string>();

    const insertLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO scraped_job_leads (job_id, workspace_id, platform, uid, display_name, avatar_url, profile_url, interaction_type, post_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSpamLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (workspace_id, platform, lead_type, value, display_name, avatar_url, status, source)
      VALUES (?, 'telegram', 'username', ?, ?, ?, 'pending', ?)
    `);

    const saveBatch = (leads: Array<{ uid: string; displayName: string; avatarUrl?: string; leadType?: string }>) => {
      if (leads.length === 0) return;
      const tx = db.transaction(() => {
        for (const l of leads) {
          const cleanUid = l.uid.replace(/^@/, '').trim();
          if (!cleanUid || collectedUids.has(cleanUid.toLowerCase())) continue;
          collectedUids.add(cleanUid.toLowerCase());

          const val = `@${cleanUid}`;
          insertLeadStmt.run(
            jobId,
            workspaceId,
            'telegram',
            cleanUid,
            l.displayName || cleanUid,
            l.avatarUrl || null,
            `https://t.me/${cleanUid}`,
            l.leadType || 'group_member',
            null
          );

          if (autoImport) {
            insertSpamLeadStmt.run(
              workspaceId,
              val,
              l.displayName || cleanUid,
              l.avatarUrl || null,
              targetTag
            );
          }

          scrapedCount++;
        }
      });

      tx();

      db.prepare(`UPDATE scrape_jobs SET total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        scrapedCount,
        scrapedCount,
        jobId
      );
    };

    // Find live Telegram account
    let accId = options.accountId || (options.accountIds && options.accountIds.length > 0 ? options.accountIds[0] : null);
    if (!accId) {
      const liveAcc = db.prepare(`
        SELECT id FROM social_accounts 
        WHERE workspace_id = ? AND platform = 'telegram' AND status IN ('live', 'ready', 'active')
        LIMIT 1
      `).get(workspaceId) as any;
      if (liveAcc) accId = liveAcc.id;
    }

    if (!accId) {
      throw new Error('Không tìm thấy tài khoản Telegram Live nào để thực hiện cào dữ liệu.');
    }

    const acc = db.prepare(`
      SELECT social_accounts.*, 
             proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
      FROM social_accounts 
      LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
      WHERE social_accounts.id = ?
    `).get(accId) as any;

    if (!acc) throw new Error('Không tìm thấy thông tin tài khoản Telegram.');

    let proxyConfig: any = undefined;
    if (acc.host && acc.port) {
      proxyConfig = {
        server: `${acc.proxy_proto || 'http'}://${acc.host}:${acc.port}`,
        username: acc.proxy_user || undefined,
        password: acc.proxy_pass || undefined,
      };
    }

    let context: BrowserContext | null = null;
    try {
      unlockProfileDir(acc.user_data_dir);
      const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

      if (acc.user_data_dir && fs.existsSync(acc.user_data_dir)) {
        context = await launchRobustPersistentContext(acc.user_data_dir, {
          headless: true,
          viewport: { width: 1366, height: 768 },
          proxy: proxyConfig,
          args: launchArgs,
        });
      } else {
        const browser = await launchRobustBrowser({ headless: true, proxy: proxyConfig, args: launchArgs });
        context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      }

      const page = await context.newPage();
      page.setDefaultTimeout(35000);

      console.log(`[Telegram Scraper] Loading Telegram Web A for @${acc.username}...`);
      await page.goto('https://web.telegram.org/a/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      // Check login status
      const isLoginRequired = await page.evaluate(() => {
        return !!document.querySelector('.login-header, .input-wrapper, button.btn-primary');
      });

      if (isLoginRequired) {
        db.prepare(`UPDATE social_accounts SET status = 'die' WHERE id = ?`).run(acc.id);
        throw new Error(`Tài khoản Telegram @${acc.username} đã hết phiên đăng nhập.`);
      }

      // Navigate to Target Group
      console.log(`[Telegram Scraper] Navigating to group target: ${parsed.cleanLink}`);
      const directHashUrl = `https://web.telegram.org/a/#${parsed.identifier}`;
      await page.goto(directHashUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3500);

      // Try searching for the group if direct hash didn't open
      const hasChatLoaded = await page.evaluate(() => {
        return !!document.querySelector('.chat-info, .chat-background, .messages-container');
      });

      if (!hasChatLoaded) {
        // Search group via search input
        try {
          const searchInput = await page.$('#telegram-search-input, input.input-field-input');
          if (searchInput) {
            await searchInput.fill(parsed.identifier);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2500);
            const firstResult = await page.$('.chat-list .chatlist-chat');
            if (firstResult) await firstResult.click();
            await page.waitForTimeout(2500);
          }
        } catch {}
      }

      // Join group if Join button exists
      try {
        await page.evaluate(() => {
          const btns = document.querySelectorAll('button, div[role="button"]');
          for (const b of Array.from(btns)) {
            const t = (b.textContent || '').trim().toLowerCase();
            if (t === 'join' || t === 'join group' || t === 'tham gia') {
              (b as HTMLElement).click();
              break;
            }
          }
        });
        await page.waitForTimeout(1500);
      } catch {}

      // Dump users from IndexedDB cache (ultra fast!)
      try {
        console.log(`[Telegram Scraper] Dumping cached users from Telegram IndexedDB...`);
        const idbUsers = await page.evaluate(async () => {
          return new Promise<Array<{ uid: string; displayName: string }>>((resolve) => {
            try {
              const req = indexedDB.open('tt-data');
              req.onerror = () => resolve([]);
              req.onsuccess = () => {
                const idb = req.result;
                if (!idb.objectStoreNames.contains('users')) {
                  resolve([]);
                  return;
                }
                const tx = idb.transaction('users', 'readonly');
                const store = tx.objectStore('users');
                const getAll = store.getAll();
                getAll.onsuccess = () => {
                  const rawList = getAll.result || [];
                  const results: Array<{ uid: string; displayName: string }> = [];
                  for (const u of rawList) {
                    if (u.username) {
                      results.push({
                        uid: u.username,
                        displayName: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username,
                      });
                    }
                  }
                  resolve(results);
                };
                getAll.onerror = () => resolve([]);
              };
            } catch {
              resolve([]);
            }
          });
        });

        if (idbUsers && idbUsers.length > 0) {
          console.log(`[Telegram Scraper] ⚡ Extracted ${idbUsers.length} users from IndexedDB cache.`);
          saveBatch(idbUsers.map(u => ({ uid: u.uid, displayName: u.displayName, leadType: 'idb_cache' })));
        }
      } catch (e: any) {
        console.log(`[Telegram Scraper] IndexedDB dump skipped:`, e.message);
      }

      // Open Group Info Sidebar to scrape members list
      try {
        await page.evaluate(() => {
          const chatInfo = document.querySelector('.chat-info, .sidebar-header');
          if (chatInfo) (chatInfo as HTMLElement).click();
        });
        await page.waitForTimeout(2000);

        let sidebarScrolls = 0;
        let lastMemberCount = scrapedCount;
        let stallCount = 0;

        while (!cancelSignal.cancelled && scrapedCount < maxLimit && sidebarScrolls < 60 && stallCount < 6) {
          const memberList = await page.evaluate(() => {
            const list: Array<{ uid: string; displayName: string; avatarUrl?: string }> = [];
            const rows = document.querySelectorAll('.chatlist-chat, .user-item, .peer-title');
            rows.forEach((r: any) => {
              const name = (r.innerText || '').trim().split('\n')[0];
              const usernameEl = r.querySelector('.user-status, .subtitle');
              const username = (usernameEl?.innerText || '').trim();
              const img = r.querySelector('img');
              if (username && username.startsWith('@')) {
                list.push({ uid: username.replace('@', ''), displayName: name || username, avatarUrl: img?.src });
              } else if (name && !name.includes('members') && !name.includes('subscribers') && name.length > 2) {
                list.push({ uid: name.replace(/\s+/g, '_').toLowerCase(), displayName: name, avatarUrl: img?.src });
              }
            });
            return list;
          });

          saveBatch(memberList);

          if (scrapedCount === lastMemberCount) {
            stallCount++;
          } else {
            stallCount = 0;
            lastMemberCount = scrapedCount;
          }

          // Scroll members container
          await page.evaluate(() => {
            const container = document.querySelector('.sidebar-content, .chat-list, .scrollable');
            if (container) container.scrollBy(0, 800);
            else window.scrollBy(0, 800);
          });

          await page.waitForTimeout(1000 + Math.floor(Math.random() * 500));
          sidebarScrolls++;
        }
      } catch (sidebarErr: any) {
        console.log(`[Telegram Scraper] Sidebar member scraping:`, sidebarErr.message);
      }

      // If hybrid/chat_history selected, scroll chat messages
      if (!cancelSignal.cancelled && scrapedCount < maxLimit && (scrapeType === 'chat_history' || scrapeType === 'hybrid')) {
        console.log(`[Telegram Scraper] Scrolling chat messages for authors and mentions...`);
        let chatScrolls = 0;
        while (!cancelSignal.cancelled && scrapedCount < maxLimit && chatScrolls < 40) {
          const chatAuthors = await page.evaluate(() => {
            const list: Array<{ uid: string; displayName: string }> = [];
            const msgNodes = document.querySelectorAll('.message, .bubble, .user-name');
            msgNodes.forEach((node: any) => {
              const name = (node.innerText || '').trim().split('\n')[0];
              if (name && name.length > 2 && name.length < 40) {
                list.push({ uid: name.replace(/\s+/g, '_').toLowerCase(), displayName: name });
              }
            });
            return list;
          });

          saveBatch(chatAuthors.map(a => ({ uid: a.uid, displayName: a.displayName, leadType: 'chat_author' })));

          // Scroll up in chat
          await page.evaluate(() => {
            const container = document.querySelector('.messages-container, .bubbles');
            if (container) container.scrollBy(0, -900);
          });

          await page.waitForTimeout(1200);
          chatScrolls++;
        }
      }

      const finalStatus = cancelSignal.cancelled ? 'stopped' : 'completed';
      db.prepare(`UPDATE scrape_jobs SET status = ?, total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        finalStatus,
        scrapedCount,
        scrapedCount,
        jobId
      );

      console.log(`[Telegram Scraper] Finished job #${jobId} with status ${finalStatus}. Total leads: ${scrapedCount}`);
      sendDesktopNotification(
        'Hoàn tất cào Telegram ✅',
        `Job #${jobId} đã bóc tách được ${scrapedCount} thành viên Telegram.`
      );

    } catch (err: any) {
      console.error(`[Telegram Scraper] Job #${jobId} error:`, err.message);
      db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        err.message || 'Lỗi không xác định khi cào Telegram.',
        jobId
      );
    } finally {
      activeTelegramSignals.delete(jobId);
      if (context) {
        try { await context.close(); } catch {}
      }
    }
  });
}
