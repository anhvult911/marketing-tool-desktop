import { BrowserContext, Page } from 'playwright';
import fs from 'fs';
import db, { getSetting } from './db';
import { telegramScrapeLimiter, ConcurrencyLimiter } from './concurrency';
import { extractVietnamesePhones } from './lead-utils';
import { normalizeLeadValue } from './lead-normalize';
import { buildSearchBuckets, allWorkItems, WorkProgress, telegramLeadKey } from './telegram-buckets';
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
  parallelSessions?: number;
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
 * P3 — Run Telegram Scrape Job using Web A.
 *
 * Thay engine "scroll sidebar 60 lần" bằng ENUMERATE THEO BUCKET:
 *   - Ô search thành viên trong group info lọc server-side → mỗi tiền tố
 *     (a-z, 0-9, ký tự tiếng Việt) trả về một lát thành viên khác nhau.
 *   - Tiến độ từng bucket lưu vào scrape_jobs.last_cursor → dừng giữa chừng
 *     chạy lại chỉ làm phần còn thiếu.
 *   - Chia bucket cho nhiều account chạy song song (mỗi account 1 browser).
 *   - IndexedDB dump chạy đầu phiên (nguồn "miễn phí", giữ nguyên từ bản cũ).
 *   - Thành viên KHÔNG có username ghi vào platform 'telegram_name' (export được,
 *     KHÔNG lọt vào campaign gửi tin vì automation chỉ lọc platform='telegram').
 *   - Bóc SĐT từ tin nhắn/bio → lead Zalo (kênh riêng, không đụng lead Telegram).
 *   - Limiter riêng (telegramScrapeLimiter) — không tranh slot với job đăng bài.
 */
export async function runTelegramScrapeJob(options: TelegramScrapeOptions): Promise<void> {
  return telegramScrapeLimiter.run(async () => {
    const { jobId, workspaceId, targetGroup, maxLimit, autoImport, customTag, scrapeType } = options;

    const cancelSignal = { cancelled: false };
    activeTelegramSignals.set(jobId, cancelSignal);

    db.prepare(`UPDATE scrape_jobs SET status = 'processing', error_msg = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);

    const targetList = targetGroup.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
    if (targetList.length === 0) {
      db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_msg = ? WHERE id = ?`).run('Thiếu nhóm Telegram mục tiêu.', jobId);
      return;
    }
    const firstTarget = parseTelegramTarget(targetList[0]);
    const targetTag = customTag && customTag.trim() ? customTag.trim() : `TG_${firstTarget.identifier}`;

    let scrapedCount = 0;
    let phoneCount = 0;
    let nameOnlyCount = 0;
    const collectedKeys = new Set<string>();
    const collectedPhones = new Set<string>();

    const insertLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO scraped_job_leads (job_id, workspace_id, platform, uid, display_name, avatar_url, profile_url, interaction_type, post_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // P4 — chèn kèm khoá chuẩn hoá + chặn trùng ngữ nghĩa (@User vs t.me/user,
    // 090… vs +8490…). WHERE NOT EXISTS dùng index idx_spam_leads_norm.
    // Username thật → platform 'telegram' (automation gửi tin được).
    const insertUsernameLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (workspace_id, platform, lead_type, value, display_name, avatar_url, status, source, normalized_value)
      SELECT ?, 'telegram', 'username', ?, ?, ?, 'pending', ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM spam_leads WHERE workspace_id = ? AND normalized_value = ?
      )
    `);
    // Không username → platform 'telegram_name': export/CSV được nhưng KHÔNG bị
    // automation nhắm tới (campaign lọc platform='telegram') → không gửi nhầm người.
    const insertNameOnlyLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (workspace_id, platform, lead_type, value, display_name, avatar_url, status, source, normalized_value)
      SELECT ?, 'telegram_name', 'member_name', ?, ?, ?, 'pending', ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM spam_leads WHERE workspace_id = ? AND normalized_value = ?
      )
    `);
    const insertPhoneLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (workspace_id, platform, lead_type, value, display_name, avatar_url, status, source, normalized_value)
      SELECT ?, 'zalo', 'phone', ?, ?, NULL, 'pending', ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM spam_leads WHERE workspace_id = ? AND normalized_value = ?
      )
    `);

    interface TgMember {
      username?: string | null;
      displayName: string;
      avatarUrl?: string;
      leadType?: string;
    }

    const saveBatch = (members: TgMember[]): number => {
      if (members.length === 0) return 0;
      let inserted = 0;
      const tx = db.transaction(() => {
        for (const m of members) {
          const username = (m.username || '').replace(/^@/, '').trim();
          const displayName = (m.displayName || username || '').trim();
          if (!displayName) continue;

          const key = telegramLeadKey(username, displayName);
          if (collectedKeys.has(key)) continue;
          collectedKeys.add(key);

          if (username) {
            insertLeadStmt.run(jobId, workspaceId, 'telegram', username, displayName, m.avatarUrl || null, `https://t.me/${username}`, m.leadType || 'member', null);
            if (autoImport) {
              const unameNorm = normalizeLeadValue('telegram', username);
              insertUsernameLeadStmt.run(workspaceId, `@${username}`, displayName, m.avatarUrl || null, targetTag, unameNorm, workspaceId, unameNorm);
            }
          } else {
            // key 'n:' + tên — lưu vào cột uid để UNIQUE(job_id, uid) dedup đúng
            insertLeadStmt.run(jobId, workspaceId, 'telegram_name', key, displayName, m.avatarUrl || null, null, m.leadType || 'member_name', null);
            if (autoImport) {
              const nameNorm = normalizeLeadValue('telegram_name', displayName);
              insertNameOnlyLeadStmt.run(workspaceId, displayName, displayName, m.avatarUrl || null, targetTag, nameNorm, workspaceId, nameNorm);
            }
            nameOnlyCount++;
          }
          inserted++;
        }
      });
      tx();

      if (inserted > 0) {
        scrapedCount += inserted;
        db.prepare(`UPDATE scrape_jobs SET total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(scrapedCount, scrapedCount, jobId);
      }
      return inserted;
    };

    const savePhones = (texts: string[]): number => {
      const found = new Set<string>();
      for (const t of texts) {
        for (const p of extractVietnamesePhones(t)) found.add(p);
      }
      let inserted = 0;
      const tx = db.transaction(() => {
        for (const phone of found) {
          if (collectedPhones.has(phone)) continue;
          collectedPhones.add(phone);
          phoneCount++;
          inserted++;
          if (autoImport) {
            const phoneNorm = normalizeLeadValue('zalo', phone);
            insertPhoneLeadStmt.run(workspaceId, phone, `Khách hàng ${phone} (Telegram)`, `${targetTag}_SĐT`, phoneNorm, workspaceId, phoneNorm);
          }
        }
      });
      tx();
      return inserted;
    };

    // ── Account queue: telegram live, ưu tiên account chỉ định ──
    const rows = options.accountIds && options.accountIds.length > 0
      ? db.prepare(`
          SELECT id, username, user_data_dir, auth_token, proxy_id FROM social_accounts
          WHERE id IN (${options.accountIds.map(() => '?').join(',')}) AND platform = 'telegram'
        `).all(...options.accountIds)
      : db.prepare(`
          SELECT id, username, user_data_dir, auth_token, proxy_id FROM social_accounts
          WHERE workspace_id = ? AND platform = 'telegram' AND status IN ('live', 'ready', 'active')
          ORDER BY id ASC LIMIT 4
        `).all(workspaceId);
    const accountQueue = rows as Array<{ id: number; username: string; user_data_dir: string | null; auth_token: string | null; proxy_id: number | null }>;

    if (accountQueue.length === 0) {
      const msg = 'Không tìm thấy tài khoản Telegram Live nào để thực hiện cào dữ liệu.';
      db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_msg = ? WHERE id = ?`).run(msg, jobId);
      sendDesktopNotification('Cào Telegram thất bại ⚠️', msg);
      return;
    }

    // ── Kế hoạch bucket + resume từ last_cursor ──
    const buckets = buildSearchBuckets();
    const items = allWorkItems(targetList.length, buckets);
    const lastCursor = (db.prepare(`SELECT last_cursor FROM scrape_jobs WHERE id = ?`).get(jobId) as { last_cursor: string | null } | undefined)?.last_cursor;
    const progress = WorkProgress.fromJSON(items, lastCursor);

    const configuredSlots = Math.max(1, Math.min(6,
      options.parallelSessions && options.parallelSessions > 0
        ? options.parallelSessions
        : parseInt(getSetting('max_scrape_sessions', '3'), 10) || 3
    ));
    const workerCount = Math.min(accountQueue.length, configuredSlots);
    const slots = new ConcurrencyLimiter(workerCount);

    console.log(`[Telegram Scraper] Job #${jobId}: ${targetList.length} target, ${buckets.length} bucket/target, ${workerCount}/${accountQueue.length} account song song. Còn ${progress.remainingCount()}/${items.length} hạng mục.`);
    if (progress.remainingCount() < items.length) {
      console.log(`[Telegram Scraper] ♻️ Resume: ${items.length - progress.remainingCount()} hạng mục đã xong từ lần chạy trước — bỏ qua.`);
    }

    const persistProgress = () => {
      db.prepare(`UPDATE scrape_jobs SET last_cursor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(progress.toJSON(), jobId);
    };

    /**
     * Mở phiên Telegram cho 1 account + vào 1 target (launch, login, join,
     * IndexedDB dump, mở group info). Trả null nếu account chết.
     */
    const openSession = async (
      acc: { id: number; username: string; user_data_dir: string | null; auth_token: string | null; proxy_id: number | null },
      target: { cleanLink: string; identifier: string }
    ): Promise<{ context: BrowserContext; page: Page } | null> => {
      const proxyRow = acc.proxy_id
        ? db.prepare(`SELECT host, port, username, password, protocol FROM proxies WHERE id = ?`).get(acc.proxy_id) as { host: string; port: number; username: string | null; password: string | null; protocol: string | null } | undefined
        : undefined;
      const proxyConfig = proxyRow
        ? {
            server: `${proxyRow.protocol || 'http'}://${proxyRow.host}:${proxyRow.port}`,
            username: proxyRow.username || undefined,
            password: proxyRow.password || undefined,
          }
        : undefined;

      unlockProfileDir(acc.user_data_dir || '');
      const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

      let context: BrowserContext;
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

      await page.goto('https://web.telegram.org/a/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);

      // Nhận diện chưa đăng nhập theo DOM THẬT của web.telegram.org/a (đo 2026-09):
      // trang auth render `.is-auth` + `#auth-qr-form`/.auth-form, text
      // "Log in to Telegram by QR Code". Selector cũ (.login-header/.input-wrapper)
      // không còn tồn tại → phiên chưa login bị coi là hợp lệ và quét 0 lead vô ích.
      const detectAuth = async () => page.evaluate(() => {
        const hasChatUi = !!document.querySelector('.chat-list, #telegram-search-input, .ListItem-button, .chat-info, .messages-container');
        const hasAuthMarkers = !!document.querySelector('.is-auth, #auth-qr-form, #auth-pages, .auth-form, #auth-phone-number-form, .auth-phone-number-form');
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const asksLogin = bodyText.includes('log in to telegram') || bodyText.includes('sign in to telegram') ||
          bodyText.includes('đăng nhập');
        return { hasChatUi, needsAuth: (hasAuthMarkers || asksLogin) && !hasChatUi };
      });

      let authState = await detectAuth();
      if (!authState.hasChatUi && !authState.needsAuth) {
        // App chưa render xong — chờ thêm rồi kiểm tra lại trước khi kết luận
        await page.waitForTimeout(3500);
        authState = await detectAuth();
      }

      if (authState.needsAuth) {
        db.prepare(`UPDATE social_accounts SET status = 'die' WHERE id = ?`).run(acc.id);
        console.warn(`[Telegram Scraper] ⛔ Account @${acc.username} chưa đăng nhập (trang auth) — loại khỏi job.`);
        await context.close().catch(() => {});
        return null;
      }

      console.log(`[Telegram Scraper] @${acc.username} → ${target.cleanLink}`);
      await page.goto(`https://web.telegram.org/a/#${target.identifier}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3500);

      const hasChatLoaded = await page.evaluate(() => !!document.querySelector('.chat-info, .chat-background, .messages-container'));
      if (!hasChatLoaded) {
        try {
          const searchInput = await page.$('#telegram-search-input, input.input-field-input');
          if (searchInput) {
            await searchInput.fill(target.identifier);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(2500);
            const firstResult = await page.$('.chat-list .chatlist-chat');
            if (firstResult) await firstResult.click();
            await page.waitForTimeout(2500);
          }
        } catch {}
      }

      // Join nếu chưa là thành viên (cần để thấy danh sách thành viên)
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

      // IndexedDB dump — nguồn miễn phí, chạy 1 lần/phiên
      try {
        const idbUsers = await page.evaluate(async () => {
          return new Promise<Array<{ username: string; displayName: string }>>((resolve) => {
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
                  const results: Array<{ username: string; displayName: string }> = [];
                  for (const u of rawList) {
                    if (u && u.username) {
                      results.push({
                        username: u.username,
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
          console.log(`[Telegram Scraper] ⚡ IndexedDB: ${idbUsers.length} user có username.`);
          saveBatch(idbUsers.map(u => ({ username: u.username, displayName: u.displayName, leadType: 'idb_cache' })));
        }
      } catch (e: unknown) {
        console.log(`[Telegram Scraper] IndexedDB dump skipped:`, e instanceof Error ? e.message : e);
      }

      // Mở group info để lộ ô search thành viên
      try {
        await page.evaluate(() => {
          const chatInfo = document.querySelector('.chat-info, .sidebar-header');
          if (chatInfo) (chatInfo as HTMLElement).click();
        });
        await page.waitForTimeout(2000);
      } catch {}

      return { context, page };
    };

    /**
     * Bóc thành viên đang hiển thị trong panel group info.
     * CHỈ quét trong cột phải (group info) — query toàn trang sẽ bắt cả danh sách
     * chat bên trái và biến chat khác thành "thành viên" (lead rác).
     * Không tìm thấy panel → trả [] (coi như phiên không đọc được, giữ tiến độ).
     * Chỉ lấy username THẬT (@handle) hoặc tên hiển thị — không bịa handle từ tên.
     */
    const readMemberRows = async (page: Page): Promise<TgMember[]> => {
      return await page.evaluate(() => {
        const scope = document.querySelector('.right-column') || document.querySelector('.sidebar-content');
        if (!scope) return [];
        const list: Array<{ username: string | null; displayName: string; avatarUrl?: string }> = [];
        const rows = scope.querySelectorAll('.chatlist-chat, .user-item, .peer-title, .ListItem-button, .row');
        rows.forEach((r) => {
          const raw = (r.textContent || '').trim();
          const name = raw.split('\n')[0].trim();
          if (!name || name.length < 2 || name.length > 80) return;
          const lower = name.toLowerCase();
          if (['members', 'subscribers', 'thành viên', 'quản trị viên', 'admin', 'owner', 'add members', 'search members', 'tìm kiếm'].some(k => lower === k || lower.startsWith(k + ' '))) return;

          const usernameEl = r.querySelector('.user-status, .subtitle, .username');
          const usernameText = (usernameEl?.textContent || '').trim();
          const handle = usernameText.startsWith('@') ? usernameText.replace('@', '').trim() : null;
          const img = r.querySelector('img');
          list.push({ username: handle, displayName: name, avatarUrl: (img as HTMLImageElement | null)?.src });
        });
        return list;
      }) as TgMember[];
    };

    /** Ô search thành viên trong group info (nhiều selector dự phòng theo version web). */
    const findMemberSearchInput = async (page: Page) => {
      const selectors = [
        '.right-column .SearchInput input',
        '.right-column input.input-field-input',
        '.sidebar .SearchInput input',
        '.participants-search input',
        '.RightColumn input[type="text"]',
      ];
      for (const sel of selectors) {
        const el = await page.$(sel);
        if (el) return el;
      }
      return null;
    };

    /**
     * Quét thành viên theo 1 bucket (tiền tố) + cuộn hết danh sách đã lọc.
     * Trả { status: 'ok' | 'no-search' | 'empty', added } — 'empty' nghĩa là
     * KHÔNG đọc được thành viên nào (phiên hỏng/nhóm chặn) → giữ tiến độ để chạy lại.
     */
    const harvestBucket = async (page: Page, bucket: string): Promise<{ status: 'ok' | 'no-search' | 'empty'; added: number }> => {
      const input = await findMemberSearchInput(page);
      if (!input) return { status: 'no-search', added: 0 };

      let added = 0;
      let sawRows = false;
      await input.click();
      await input.fill('');
      await page.waitForTimeout(400);
      await input.type(bucket, { delay: 120 });
      await page.waitForTimeout(1600);

      let scrolls = 0;
      let stalls = 0;
      let lastCount = 0;
      while (!cancelSignal.cancelled && scrapedCount < maxLimit && scrolls < 40 && stalls < 3) {
        const rows = await readMemberRows(page);
        if (rows.length > 0) sawRows = true;
        added += saveBatch(rows);
        if (scrapedCount === lastCount) stalls++;
        else { stalls = 0; lastCount = scrapedCount; }

        await page.evaluate(() => {
          const container = document.querySelector('.right-column .scrollable, .sidebar-content, .chat-list');
          if (container) container.scrollBy(0, 900);
          else window.scrollBy(0, 900);
        });
        await page.waitForTimeout(900 + Math.floor(Math.random() * 500));
        scrolls++;
      }

      // Xoá filter trước bucket kế
      await input.fill('').catch(() => {});
      await page.waitForTimeout(300);
      return { status: sawRows ? 'ok' : 'empty', added };
    };

    /** Cuộn thành viên KHÔNG filter — fallback khi không tìm thấy ô search. */
    const harvestPlainScroll = async (page: Page): Promise<{ usable: boolean; added: number }> => {
      let added = 0;
      let sawRows = false;
      let scrolls = 0;
      let stalls = 0;
      let lastCount = 0;
      while (!cancelSignal.cancelled && scrapedCount < maxLimit && scrolls < 300 && stalls < 5) {
        const rows = await readMemberRows(page);
        if (rows.length > 0) sawRows = true;
        added += saveBatch(rows);
        if (scrapedCount === lastCount) stalls++;
        else { stalls = 0; lastCount = scrapedCount; }
        await page.evaluate(() => {
          const container = document.querySelector('.right-column .scrollable, .sidebar-content, .chat-list');
          if (container) container.scrollBy(0, 800);
          else window.scrollBy(0, 800);
        });
        await page.waitForTimeout(900 + Math.floor(Math.random() * 500));
        scrolls++;
      }
      return { usable: sawRows, added };
    };

    /** Quét lịch sử chat: bóc SĐT trong tin nhắn + tác giả có username thật. */
    const harvestChatHistory = async (page: Page, targetIdx: number): Promise<void> => {
      let scrolls = 0;
      let stalls = 0;
      let lastCount = scrapedCount;
      console.log(`[Telegram Scraper] 💬 Quét lịch sử chat target [${targetIdx + 1}] (SĐT + tác giả)...`);

      while (!cancelSignal.cancelled && scrapedCount < maxLimit && scrolls < 120 && stalls < 6) {
        const snapshot = await page.evaluate(() => {
          const texts: string[] = [];
          const members: Array<{ username: string | null; displayName: string }> = [];
          document.querySelectorAll('.message, .bubble, .Message, .text-content').forEach((node) => {
            const text = (node.textContent || '').trim();
            if (text && text.length < 2000) texts.push(text);
          });
          document.querySelectorAll('.message .peer-title, .bubble .peer-title, .Message .peer-title, .user-name').forEach((node) => {
            const raw = (node.textContent || '').trim();
            if (!raw) return;
            const at = raw.match(/@([A-Za-z0-9_]{4,32})/);
            members.push({ username: at ? at[1] : null, displayName: raw.split('\n')[0].trim() });
          });
          return { texts, members };
        });

        saveBatch(snapshot.members.map(m => ({ username: m.username, displayName: m.displayName, leadType: 'chat_author' })));
        savePhones(snapshot.texts);

        if (scrapedCount === lastCount && phoneCount === 0) stalls++;
        else { stalls = 0; lastCount = scrapedCount; }

        await page.evaluate(() => {
          const container = document.querySelector('.messages-container, .MessageList, .bubbles');
          if (container) container.scrollBy(0, -900);
        });
        await page.waitForTimeout(1100 + Math.floor(Math.random() * 500));
        scrolls++;
      }
      console.log(`[Telegram Scraper] 💬 Chat history target [${targetIdx + 1}]: ${phoneCount} SĐT, tổng ${scrapedCount} lead.`);
    };

    /**
     * Worker: ĐÚNG 1 worker/account. Mở 1 phiên/target rồi làm hết shard bucket
     * của mình (tiết kiệm launch), sau đó sang target kế.
     */
    const runWorker = async (acc: typeof accountQueue[number], workerIndex: number): Promise<void> => {
      const releaseSlot = await slots.acquire();
      try {
        for (let targetIdx = 0; targetIdx < targetList.length; targetIdx++) {
          if (cancelSignal.cancelled || scrapedCount >= maxLimit) break;
          const myItems = progress.remainingShard(workerIndex, workerCount)
            .filter(item => item.startsWith(`${targetIdx}:`));
          if (myItems.length === 0) continue;

          const target = parseTelegramTarget(targetList[targetIdx]);
          const session = await openSession(acc, target);
          if (!session) return; // account chết → dừng worker

          let sessionUsable = true;
          try {
            for (const item of myItems) {
              if (cancelSignal.cancelled || scrapedCount >= maxLimit) break;
              const bucket = item.slice(item.indexOf(':') + 1);

              const res = await harvestBucket(session.page, bucket);

              if (res.status === 'no-search') {
                // Không có ô search → cuộn thường; nếu cũng không đọc được ai thì
                // phiên không dùng được (chưa login / nhóm chặn) → GIỮ tiến độ.
                const plain = await harvestPlainScroll(session.page);
                if (!plain.usable) {
                  console.warn(`[Telegram Scraper] ⚠️ Phiên @${acc.username} không đọc được thành viên (chưa đăng nhập / nhóm chặn) — giữ ${myItems.length} hạng mục để chạy lại.`);
                  sessionUsable = false;
                  break;
                }
                for (const rest of myItems) progress.markDone(rest);
                persistProgress();
                break;
              }

              if (res.status === 'empty') {
                console.warn(`[Telegram Scraper] ⚠️ Bucket "${bucket}" không đọc được thành viên nào — giữ hạng mục để chạy lại.`);
                sessionUsable = false;
                break;
              }

              console.log(`[Telegram Scraper] 🔤 @${acc.username} bucket "${bucket}" target [${targetIdx + 1}]: +${res.added} lead.`);
              progress.markDone(item);
              persistProgress();
            }

            if (sessionUsable && !cancelSignal.cancelled && scrapedCount < maxLimit && (scrapeType === 'chat_history' || scrapeType === 'hybrid')) {
              await harvestChatHistory(session.page, targetIdx);
            }
          } finally {
            await session.context.close().catch(() => {});
          }

          if (!sessionUsable) return; // phiên hỏng → dừng worker, không thử target kế
        }
      } finally {
        releaseSlot();
      }
    };

    try {
      const workers = accountQueue
        .slice(0, workerCount)
        .map((acc, idx) => runWorker(acc, idx).catch(err => {
          console.error(`[Telegram Scraper] Worker @${acc.username} lỗi:`, err instanceof Error ? err.message : err);
        }));
      await Promise.allSettled(workers);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Telegram Scraper] Job #${jobId} fatal:`, msg);
      db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        msg || 'Lỗi không xác định khi cào Telegram.',
        jobId
      );
      return;
    } finally {
      activeTelegramSignals.delete(jobId);
    }

    const finalStatus = cancelSignal.cancelled ? 'stopped' : (scrapedCount === 0 && progress.remainingCount() > 0 ? 'failed' : 'completed');
    db.prepare(`UPDATE scrape_jobs SET status = ?, total_count = ?, scraped_count = ?, error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      finalStatus,
      scrapedCount,
      scrapedCount,
      finalStatus === 'failed' ? `Không thu được lead nào (${progress.remainingCount()} hạng mục còn lại). Kiểm tra account còn đăng nhập được không.` : null,
      jobId
    );

    console.log(`[Telegram Scraper] Job #${jobId} ${finalStatus}: ${scrapedCount} lead (${phoneCount} SĐT, ${nameOnlyCount} tên không username). Còn ${progress.remainingCount()}/${items.length} hạng mục.`);
    sendDesktopNotification(
      finalStatus === 'failed' ? 'Cào Telegram thất bại ⚠️' : 'Hoàn tất cào Telegram ✅',
      finalStatus === 'failed'
        ? `Job #${jobId}: không thu được lead. Kiểm tra tài khoản Telegram còn đăng nhập.`
        : `Job #${jobId}: ${scrapedCount} lead (${phoneCount} SĐT). Còn ${progress.remainingCount()} hạng mục — chạy lại để tiếp tục.`
    );
  });
}