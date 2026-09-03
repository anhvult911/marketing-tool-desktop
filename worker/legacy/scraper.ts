import { TelegramAutomation, FacebookAutomation, WhatsAppAutomation } from './automation';
import { NetworkScraperEngine } from './network-scraper';
import { accountPool } from '../src/lib/account-pool';
import { LeadDeduplicator } from '../src/lib/dedup';
import { chromium } from 'playwright';

// Parse group name from link
function getGroupName(groupLink: string): string {
  try {
    const cleanLink = groupLink.trim().replace(/\/$/, '');
    const parts = cleanLink.split('/');
    const lastPart = parts[parts.length - 1];
    return lastPart.replace(/^@/, '') || 'group';
  } catch (e) {
    return 'group';
  }
}

let isProcessing = false;
let isInitialized = false;

export async function processScrapeJobs(db: any) {
  if (!isInitialized) {
    isInitialized = true;
    try {
      const updated = await db`
        UPDATE scrape_jobs 
        SET status = 'failed', error_msg = 'Tiến trình Worker bị đóng đột ngột (hoặc khởi động lại) khi đang xử lý.', updated_at = NOW() 
        WHERE status = 'processing'
      `;
      if (updated.count > 0) {
        console.log(`[Scraper Worker] Reset ${updated.count} stuck 'processing' jobs to 'failed' state.`);
      }
    } catch (e: any) {
      console.error('[Scraper Worker] Failed to reset stuck processing jobs:', e.message);
    }
  }

  if (isProcessing) {
    return;
  }
  isProcessing = true;
  let currentJobId: number | null = null;
  try {
    // 1. Fetch the oldest pending scrape job
    const [job] = await db`
      SELECT * FROM scrape_jobs 
      WHERE status = 'pending' 
      ORDER BY created_at ASC 
      LIMIT 1
    ` as any[];

    if (!job) {
      return; // No pending jobs
    }

    currentJobId = job.id;
    console.log(`[Scraper Worker] Phát hiện tác vụ quét mới: Job #${job.id} (${job.platform}) - Target: ${job.target_group}`);

    // Update status to processing
    await db`
      UPDATE scrape_jobs 
      SET status = 'processing', updated_at = NOW() 
      WHERE id = ${job.id}
    `;

    const deduplicator = new LeadDeduplicator();
    let scrapedMembers: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];

    // Fetch system accounts to exclude from results
    const queryPlatform = job.platform === 'messenger' ? 'facebook' : job.platform;
    const systemAccounts = await db`
      SELECT id, username, extra_data 
      FROM social_accounts 
      WHERE workspace_id = ${job.workspace_id} AND platform = ${queryPlatform}
    ` as any[];

    const systemUserIdentifiers = new Set<string>();
    systemAccounts.forEach((acc: any) => {
      if (acc.username) {
        systemUserIdentifiers.add(acc.username.toLowerCase());
        if (acc.username.includes('@')) {
          systemUserIdentifiers.add(acc.username.split('@')[0].toLowerCase());
        }
      }
      const peerId = acc.extra_data?.peerId || acc.extra_data?.userId || acc.extra_data?.id || acc.extra_data?.facebookId;
      if (peerId) {
        systemUserIdentifiers.add(peerId.toString().toLowerCase());
      }
    });

    if (job.target_group) {
      const targetClean = job.target_group.trim().replace(/\/$/, '');
      if (targetClean.includes('profile.php?id=')) {
        try {
          const u = new URL(targetClean);
          const id = u.searchParams.get('id');
          if (id) systemUserIdentifiers.add(id.toLowerCase());
        } catch (e) {}
      }
      const peopleMatch = targetClean.match(/\/people\/[^\/]+\/(\d+)/);
      if (peopleMatch) {
        systemUserIdentifiers.add(peopleMatch[1].toLowerCase());
      }
      const numMatch = targetClean.match(/facebook\.com\/(\d{5,25})/);
      if (numMatch) {
        systemUserIdentifiers.add(numMatch[1].toLowerCase());
      }
      const parts = targetClean.split('?')[0].split('/').filter(Boolean);
      for (const part of parts) {
        const pClean = decodeURIComponent(part).toLowerCase().trim();
        if (pClean && !['http:', 'https:', 'facebook.com', 'www.facebook.com', 'x.com', 'twitter.com', 'people', 'followers', 'members', 'sk=followers'].includes(pClean)) {
          systemUserIdentifiers.add(pClean);
          if (pClean.includes('-')) {
            systemUserIdentifiers.add(pClean.replace(/-/g, ' '));
          }
        }
      }
    }

function normalizeAndValidateLead(
  member: { uid: string; displayName: string; avatarUrl: string },
  platform: string
): { uid: string; displayName: string; avatarUrl: string; leadType: string } | null {
  if (!member || !member.uid) return null;
  let uid = member.uid.trim();

  // Strip full domains and query strings
  uid = uid.replace(/^(https?:\/\/)?(www\.|m\.|mbasic\.)?(facebook\.com|x\.com|twitter\.com|threads\.net|t\.me)\//i, '');
  uid = uid.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');

  if (uid.includes('profile.php')) {
    const m = member.uid.match(/[?&]id=(\d+)/);
    if (m) uid = m[1];
  } else if (uid.includes('people/')) {
    const m = member.uid.match(/people\/[^\/]+\/(\d+)/);
    if (m) uid = m[1];
  }

  // Reject garbage/non-user slugs
  const skipKeywords = [
    'groups', 'messages', 'notifications', 'friends', 'marketplace', 'watch',
    'events', 'saved', 'pages', 'ads', 'policies', 'help', 'login', 'recover', 'settings',
    'privacy', 'terms', 'photo.php', 'video.php', 'story.php', 'home.php', 'menu', 'bug', 'r.php',
    'hashtag', 'hashtags', 'places', 'location', 'allactivity', 'browse', 'search', 'sharer.php',
    'about', 'photos', 'videos', 'reels', 'posts', 'permalink', 'feed'
  ];

  if (!uid || uid.startsWith('#') || uid.startsWith('hashtag') || skipKeywords.includes(uid.toLowerCase())) {
    return null;
  }

  const isNumeric = /^\d{5,25}$/.test(uid);
  const isUsername = /^[a-zA-Z0-9._]{3,50}$/.test(uid);
  if (!isNumeric && !isUsername) return null;

  // Clean Display Name & decode Unicode escapes
  let displayName = member.displayName ? member.displayName.trim() : '';
  if (displayName.includes('\\u')) {
    displayName = displayName.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  displayName = displayName.replace(/\\"/g, '"').replace(/\\\//g, '/').trim();

  if (displayName.startsWith('#')) {
    return null;
  }

  if (!displayName || displayName.length < 2 || displayName.toLowerCase().startsWith('fb user') || displayName.toLowerCase().startsWith('facebook user')) {
    if (isUsername) {
      displayName = uid;
    } else if (isNumeric) {
      displayName = `Facebook User`;
    } else {
      return null;
    }
  }

  let leadType = 'username';
  if (platform === 'whatsapp' || platform === 'zalo') {
    leadType = 'phone';
  } else if (isNumeric) {
    leadType = 'uid';
  }

  return {
    uid,
    displayName,
    avatarUrl: member.avatarUrl || '',
    leadType
  };
}

    // SaveChunkCallback for incremental batch saving with validation and normalization
    const saveChunkCallback = async (chunk: Array<{ uid: string; displayName: string; avatarUrl: string }>) => {
      const validChunk: Array<{ uid: string; displayName: string; avatarUrl: string; leadType: string }> = [];
      for (const m of chunk) {
        if (!m || !m.uid) continue;
        const uidLower = m.uid.toLowerCase().trim();
        const dNameLower = (m.displayName || '').toLowerCase().trim();
        if (systemUserIdentifiers.has(uidLower)) continue;
        if (dNameLower && systemUserIdentifiers.has(dNameLower)) continue;

        const normalized = normalizeAndValidateLead(m, job.platform);
        if (normalized) {
          const normUidLower = normalized.uid.toLowerCase().trim();
          const normDNameLower = (normalized.displayName || '').toLowerCase().trim();
          if (systemUserIdentifiers.has(normUidLower)) continue;
          if (normDNameLower && systemUserIdentifiers.has(normDNameLower)) continue;
          validChunk.push(normalized);
        }
      }

      if (validChunk.length === 0) return;

      console.log(`[Scraper Worker] Saving normalized incremental chunk of ${validChunk.length} members for Job #${job.id}...`);
      
      await db.begin(async (sqlTrans: any) => {
        for (const member of validChunk) {
          await sqlTrans`
            INSERT INTO scraped_leads (job_id, workspace_id, platform, uid, display_name, avatar_url)
            VALUES (${job.id}, ${job.workspace_id}, ${job.platform}, ${member.uid}, ${member.displayName}, ${member.avatarUrl})
            ON CONFLICT (platform, uid) 
            DO UPDATE SET 
              display_name = EXCLUDED.display_name, 
              avatar_url = EXCLUDED.avatar_url,
              job_id = EXCLUDED.job_id
          `;

          if (job.auto_import) {
            const targetClean = getGroupName(job.target_group);
            const sourceTag = job.custom_tag || `Group_${targetClean}`;
            let leadValue = member.uid;
            if (job.platform === 'x' && !leadValue.startsWith('@')) {
              leadValue = `@${leadValue}`;
            }

            await sqlTrans`
              INSERT INTO spam_leads (workspace_id, platform, lead_type, value, source, status, extra_data)
              VALUES (
                ${job.workspace_id}, ${job.platform === 'messenger' ? 'facebook' : job.platform}, ${member.leadType}, ${leadValue}, ${sourceTag}, 'pending', ${{ displayName: member.displayName, avatarUrl: member.avatarUrl }}
              )
              ON CONFLICT (value) DO NOTHING
            `;
          }
        }
      });
    };

    // 4. Handle Platform Specific Scrapes
    if (job.platform === 'x') {
      // High-Scale X Follower Scraper with Network Interception & Account Hopping
      const limit = job.max_limit || 10000;
      const availableAccounts = await accountPool.getAvailableAccounts(db, 'x', job.workspace_id);

      let targetUsername = job.target_group.trim().replace(/^@/, '').replace(/\/$/, '');
      if (targetUsername.includes('x.com/') || targetUsername.includes('twitter.com/')) {
        const parts = targetUsername.split('/');
        targetUsername = parts[parts.length - 1] || parts[parts.length - 2];
      }

      const targetUrl = `https://x.com/${targetUsername}/followers`;
      let currentCursor: string | null = job.last_cursor || null;
      let totalCollected = 0;

      if (availableAccounts.length === 0) {
        console.warn('[Scraper Worker] WARNING: No active X accounts available in pool. Attempting guest mode...');
      }

      const accountQueue = availableAccounts.length > 0 ? availableAccounts : [null];

      for (const account of accountQueue) {
        if (totalCollected >= limit) break;

        const launchOpts: any = {
          headless: true,
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
        };

        if (account?.proxy) {
          launchOpts.proxy = {
            server: `http://${account.proxy.host}:${account.proxy.port}`
          };
          if (account.proxy.username && account.proxy.password) {
            launchOpts.proxy.username = account.proxy.username;
            launchOpts.proxy.password = account.proxy.password;
          }
        }

        let context: any = null;
        try {
          if (account) {
            context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
            if (account.auth_token) {
              await context.addCookies([{
                name: 'auth_token',
                value: account.auth_token,
                domain: '.x.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'None'
              }]);
            }
          } else {
            const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
            context = await browser.newContext({
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              viewport: { width: 1280, height: 800 }
            });
          }

          console.log(`[Scraper Worker] Running Active High-Speed X Follower Scraper via Account: ${account?.username || 'Guest'}`);

          const result = await NetworkScraperEngine.scrapeFollowersActiveGraphQL(
            context,
            'x',
            targetUrl,
            job.workspace_id,
            targetUsername,
            limit - totalCollected,
            currentCursor,
            async (scrapedCount, newLeads, nextCursor) => {
              const formattedChunk = newLeads.map(l => ({
                uid: l.lead_value.replace(/^@/, ''),
                displayName: l.display_name || l.lead_value,
                avatarUrl: l.avatar_url || ''
              }));

              scrapedMembers.push(...formattedChunk);
              totalCollected += formattedChunk.length;

              await saveChunkCallback(formattedChunk);
              await accountPool.saveCursorState(db, job.id, nextCursor, totalCollected);
            }
          );

          currentCursor = result.nextCursor;

          if (result.isRateLimited && account) {
            console.warn(`[Scraper Worker] Account ${account.username} hit rate limit. Hopping to next account in pool...`);
            accountPool.markRateLimited(account.id, 900);
          }

          await context.close();

          if (!result.hasMore || !result.isRateLimited) {
            break; // Reached end of followers or completed limit
          }

        } catch (accErr: any) {
          console.error(`[Scraper Worker] Error in account session ${account?.username || 'Guest'}:`, accErr.message);
          if (context) try { await context.close(); } catch (e) {}
        }
      }

    } else if (job.platform === 'telegram') {
      const limit = job.max_limit || 5000; 
      const scrapeType = job.scrape_type || 'members';
      
      let scraperAccounts: any[] = [];
      if (job.account_ids && Array.isArray(job.account_ids) && job.account_ids.length > 0) {
        const parsedIds = job.account_ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
        if (parsedIds.length > 0) {
          scraperAccounts = await db`
            SELECT social_accounts.*, 
                   proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
            FROM social_accounts 
            LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
            WHERE social_accounts.id = ANY(${parsedIds}::int[]) 
              AND LOWER(social_accounts.status) = 'live' 
              AND social_accounts.workspace_id = ${job.workspace_id}
          ` as any[];
        }
      }

      if (!scraperAccounts || scraperAccounts.length === 0) {
        scraperAccounts = await db`
          SELECT social_accounts.*, 
                 proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
          FROM social_accounts 
          LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
          WHERE LOWER(social_accounts.platform) = 'telegram' 
            AND LOWER(social_accounts.status) = 'live' 
            AND social_accounts.workspace_id = ${job.workspace_id}
          LIMIT 1
        ` as any[];
      }

      if (!scraperAccounts || scraperAccounts.length === 0) {
        throw new Error('Không tìm thấy tài khoản Telegram hoạt động nào trong Workspace.');
      }

      const accountConfigs = scraperAccounts.map(acc => ({
        accountConfig: {
          username: acc.username,
          password: acc.password,
          email: acc.email,
          user_data_dir: acc.user_data_dir,
          auth_token: acc.auth_token,
          extra_data: acc.extra_data
        },
        proxyConfig: acc.host ? {
          host: acc.host,
          port: acc.port,
          username: acc.proxy_user,
          password: acc.proxy_pass,
          protocol: acc.proxy_proto
        } : undefined
      }));

      const primaryAcc = accountConfigs[0];

      if (scrapeType === 'hybrid' || scrapeType === 'multi_tier') {
        scrapedMembers = await TelegramAutomation.scrapeGroupMembersHybrid(
          primaryAcc.accountConfig, primaryAcc.proxyConfig, job.target_group, limit, saveChunkCallback
        );
      } else if (scrapeType === 'chat_history') {
        scrapedMembers = await TelegramAutomation.scrapeGroupMembersFromChatHistory(
          primaryAcc.accountConfig, primaryAcc.proxyConfig, job.target_group, limit, saveChunkCallback
        );
      } else {
        scrapedMembers = await TelegramAutomation.scrapeGroupMembers(
          primaryAcc.accountConfig,
          primaryAcc.proxyConfig,
          job.target_group,
          limit,
          saveChunkCallback
        );
      }
    } else if (job.platform === 'facebook') {
      const limit = job.max_limit || 5000;
      const scrapeType = job.scrape_type || 'members';

      let scraperAccounts: any[] = [];
      if (job.account_ids && Array.isArray(job.account_ids) && job.account_ids.length > 0) {
        const parsedIds = job.account_ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
        if (parsedIds.length > 0) {
          scraperAccounts = await db`
            SELECT social_accounts.*, 
                   proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
            FROM social_accounts 
            LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
            WHERE social_accounts.id = ANY(${parsedIds}::int[]) 
              AND LOWER(social_accounts.status) = 'live' 
              AND social_accounts.workspace_id = ${job.workspace_id}
          ` as any[];
        }
      }

      if (!scraperAccounts || scraperAccounts.length === 0) {
        scraperAccounts = await db`
          SELECT social_accounts.*, 
                 proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
          FROM social_accounts 
          LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
          WHERE LOWER(social_accounts.platform) = 'facebook' 
            AND LOWER(social_accounts.status) = 'live' 
            AND social_accounts.workspace_id = ${job.workspace_id}
        ` as any[];
      }

      if (!scraperAccounts || scraperAccounts.length === 0) {
        throw new Error('Không tìm thấy tài khoản Facebook hoạt động nào trong Workspace.');
      }

      console.log(`[Scraper Worker] 🚀 Swarm Engine activated: Loaded ${scraperAccounts.length} live Facebook account(s) for job #${job.id}.`);

      const accountConfigs = scraperAccounts.map(acc => ({
        accountConfig: {
          username: acc.username,
          password: acc.password,
          email: acc.email,
          user_data_dir: acc.user_data_dir,
          auth_token: acc.auth_token
        },
        proxyConfig: acc.host ? {
          host: acc.host,
          port: acc.port,
          username: acc.proxy_user,
          password: acc.proxy_pass,
          protocol: acc.proxy_proto
        } : undefined
      }));

      const accountsWithProxy = accountConfigs.filter(a => !!a.proxyConfig);
      if (accountsWithProxy.length === 0) {
        console.warn(`[Scraper Worker] ⚠️ CẢNH BÁO: Tất cả tài khoản Facebook trong Job #${job.id} đều KHÔNG GẮN PROXY. Trên môi trường VPS Linux, khuyến nghị gán Residential Proxy vào tài khoản để tránh bị Facebook hạn chế số lượng Leads!`);
      } else {
        console.log(`[Scraper Worker] 🛡️ Proxy Protection Active: ${accountsWithProxy.length}/${accountConfigs.length} tài khoản đang chạy qua Proxy.`);
      }

      const primaryAcc = accountConfigs[0];
      const secondaryAcc = accountConfigs[1] || primaryAcc;

      if (scrapeType === 'multi_tier' || scrapeType === 'kol_followers') {
        console.log(`[Scraper Worker] 🚀 Executing High-Capacity Swarm Multi-Tier Scraping (${accountConfigs.length} account(s), Target: ${limit} Leads) for Facebook target: ${job.target_group}...`);
        
        scrapedMembers = await FacebookAutomation.scrapeSwarmKOLFollowers(
          accountConfigs, job.target_group, limit, saveChunkCallback
        );
      } else if (scrapeType === 'post_commenters') {
        scrapedMembers = await FacebookAutomation.scrapePostCommenters(
          primaryAcc.accountConfig, primaryAcc.proxyConfig, job.target_group, limit, saveChunkCallback
        );
      } else {
        scrapedMembers = await FacebookAutomation.scrapeGroupMembers(
          primaryAcc.accountConfig, primaryAcc.proxyConfig, job.target_group, limit, saveChunkCallback
        );
      }
    } else if (job.platform === 'messenger') {
      const limit = job.max_limit || 5000;
      let scraperAccounts: any[] = [];
      if (job.account_ids && Array.isArray(job.account_ids) && job.account_ids.length > 0) {
        const parsedIds = job.account_ids.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));
        if (parsedIds.length > 0) {
          scraperAccounts = await db`
            SELECT social_accounts.*, 
                   proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
            FROM social_accounts 
            LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
            WHERE social_accounts.id = ANY(${parsedIds}::int[]) 
              AND LOWER(social_accounts.status) = 'live' 
              AND social_accounts.workspace_id = ${job.workspace_id}
          ` as any[];
        }
      }

      if (!scraperAccounts || scraperAccounts.length === 0) {
        scraperAccounts = await db`
          SELECT social_accounts.*, 
                 proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
          FROM social_accounts 
          LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
          WHERE LOWER(social_accounts.platform) = 'facebook' 
            AND LOWER(social_accounts.status) = 'live' 
            AND social_accounts.workspace_id = ${job.workspace_id}
          LIMIT 1
        ` as any[];
      }

      const scraperAccount = scraperAccounts[0];

      if (!scraperAccount) throw new Error('Không tìm thấy tài khoản Facebook hoạt động nào cho Messenger.');

      const accountConfig = {
        username: scraperAccount.username,
        password: scraperAccount.password,
        email: scraperAccount.email,
        user_data_dir: scraperAccount.user_data_dir,
        auth_token: scraperAccount.auth_token
      };

      const proxyConfig = scraperAccount.host ? {
        host: scraperAccount.host,
        port: scraperAccount.port,
        username: scraperAccount.proxy_user,
        password: scraperAccount.proxy_pass,
        protocol: scraperAccount.proxy_proto
      } : undefined;

      scrapedMembers = await FacebookAutomation.scrapeMessengerGroupMembers(
        accountConfig, proxyConfig, job.target_group, limit, saveChunkCallback
      );
    } else if (job.platform === 'whatsapp') {
      const limit = job.max_limit || 2000;
      const [scraperAccount] = await db`
        SELECT social_accounts.*, 
               proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
        FROM social_accounts 
        LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
        WHERE social_accounts.platform = 'whatsapp' 
          AND social_accounts.status = 'live' 
          AND social_accounts.workspace_id = ${job.workspace_id}
        LIMIT 1
      ` as any[];

      if (!scraperAccount) throw new Error('Không tìm thấy tài khoản WhatsApp hoạt động (Live) nào trong Workspace để thực hiện quét.');

      const accountConfig = {
        username: scraperAccount.username,
        password: scraperAccount.password,
        email: scraperAccount.email,
        user_data_dir: scraperAccount.user_data_dir,
        auth_token: scraperAccount.auth_token
      };

      const proxyConfig = scraperAccount.host ? {
        host: scraperAccount.host,
        port: scraperAccount.port,
        username: scraperAccount.proxy_user,
        password: scraperAccount.proxy_pass,
        protocol: scraperAccount.proxy_proto
      } : undefined;

      scrapedMembers = await WhatsAppAutomation.scrapeGroupMembers(
        accountConfig, proxyConfig, job.target_group, limit, saveChunkCallback
      );
    } else {
      throw new Error(`Nền tảng '${job.platform}' chưa được hỗ trợ tính năng quét thành viên.`);
    }

    // Filter out system accounts from results
    scrapedMembers = scrapedMembers.filter(m => {
      const uidNormalized = m.uid.toLowerCase();
      return !systemUserIdentifiers.has(uidNormalized);
    });

    if (scrapedMembers.length === 0) {
      throw new Error('Quá trình quét hoàn tất nhưng không thu thập được thành viên nào mới.');
    }

    console.log(`[Scraper Worker] Quét thành công Job #${job.id}. Tổng số thành viên thu thập được: ${scrapedMembers.length}`);

    // Update job state to completed
    await db`
      UPDATE scrape_jobs 
      SET status = 'completed', total_count = ${scrapedMembers.length}, updated_at = NOW() 
      WHERE id = ${job.id}
    `;

    console.log(`[Scraper Worker] ✅ Hoàn thành xử lý Job #${job.id}. Quét thành công: ${scrapedMembers.length} thành viên.`);

  } catch (err: any) {
    console.error(`[Scraper Worker] ❌ Lỗi khi xử lý tác vụ quét:`, err.message);
    try {
      if (currentJobId) {
        await db`
          UPDATE scrape_jobs 
          SET status = 'failed', error_msg = ${err.message || 'Lỗi không xác định trong quá trình cào dữ liệu'}, updated_at = NOW() 
          WHERE id = ${currentJobId}
        `;
      } else {
        await db`
          UPDATE scrape_jobs 
          SET status = 'failed', error_msg = ${err.message || 'Lỗi không xác định trong quá trình cào dữ liệu'}, updated_at = NOW() 
          WHERE status = 'processing'
        `;
      }
    } catch (e: any) {
      console.error(`[Scraper Worker] Failed to update job fail status:`, e.message);
    }
  } finally {
    isProcessing = false;
  }
}
