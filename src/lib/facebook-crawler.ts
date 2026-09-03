import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import db from './db';
import { browserLimiter } from './concurrency';
import { sendDesktopNotification } from './notify';

export interface ScrapeJobOptions {
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

export interface ExtractedLead {
  uid: string;
  displayName: string;
  avatarUrl?: string;
  profileUrl?: string;
  interactionType: string;
  postUrl?: string;
  phone?: string;
}

// Active jobs map to support cancelling/stopping jobs
const activeJobSignals = new Map<number, { cancelled: boolean }>();

export function stopScrapeJob(jobId: number) {
  const sig = activeJobSignals.get(jobId);
  if (sig) {
    sig.cancelled = true;
  }
}

/**
 * Clean lockfiles on Windows to prevent Playwright persistent profile launch failure (EBUSY / EPERM)
 */
export function unlockProfileDir(userDataDir: string) {
  try {
    if (!userDataDir || !fs.existsSync(userDataDir)) return;
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'];
    for (const lf of lockFiles) {
      const lockPath = path.join(userDataDir, lf);
      if (fs.existsSync(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch {}
      }
    }
  } catch {}
}

/**
 * Clean and extract Facebook vanity or ID from URL / input
 */
export function parseFacebookTarget(input: string): { type: 'page' | 'group' | 'post'; identifier: string; cleanUrl: string } {
  let target = input.trim().replace(/^@/, '');

  if (!target.startsWith('http://') && !target.startsWith('https://')) {
    if (target.includes('groups/')) {
      target = `https://www.facebook.com/${target}`;
    } else {
      target = `https://www.facebook.com/${target}`;
    }
  }

  try {
    const url = new URL(target);
    const pathname = url.pathname.replace(/^\/|\/$/g, '');
    const parts = pathname.split('/').filter(Boolean);

    if (parts.includes('groups')) {
      const gIndex = parts.indexOf('groups');
      const gId = parts[gIndex + 1] || 'unknown';
      return { type: 'group', identifier: gId, cleanUrl: `https://www.facebook.com/groups/${gId}` };
    }

    if (parts.includes('posts') || parts.includes('videos') || parts.includes('photos') || url.searchParams.has('story_fbid')) {
      return { type: 'post', identifier: pathname, cleanUrl: target };
    }

    const pageId = parts[0] || 'profile';
    return { type: 'page', identifier: pageId, cleanUrl: `https://www.facebook.com/${pageId}` };
  } catch {
    const clean = target.replace(/[^a-zA-Z0-9._-]/g, '');
    return { type: 'page', identifier: clean, cleanUrl: `https://www.facebook.com/${clean}` };
  }
}

/**
 * Parse UID / User ID from Facebook link or attribute
 */
export function extractUidFromFacebookLink(link: string): string {
  if (!link) return '';
  try {
    let cleanLink = link;
    if (!cleanLink.startsWith('http')) {
      cleanLink = `https://www.facebook.com${cleanLink.startsWith('/') ? '' : '/'}${cleanLink}`;
    }
    const url = new URL(cleanLink);
    
    // Check id query param (e.g. profile.php?id=100012345678)
    if (url.searchParams.has('id')) {
      return url.searchParams.get('id')!;
    }

    const pathname = url.pathname.replace(/^\/|\/$/g, '');
    const parts = pathname.split('/').filter(Boolean);
    
    // Handle /groups/<groupId>/user/<userId>
    if (parts.includes('user')) {
      const uIndex = parts.indexOf('user');
      if (uIndex < parts.length - 1) {
        return parts[uIndex + 1];
      }
    }
    
    if (parts.length > 0) {
      const first = parts[0];
      const skipSlugs = ['groups', 'pages', 'people', 'watch', 'events', 'photo.php', 'video.php', 'reel', 'story.php', 'marketplace'];
      if (!skipSlugs.includes(first)) {
        return first;
      }
      if (parts.length > 1 && (first === 'pages' || first === 'people')) {
        return parts[1];
      }
    }
  } catch {}
  
  const matchDigits = link.match(/\/user\/(\d+)/);
  if (matchDigits) return matchDigits[1];

  return link.replace(/https?:\/\/(www\.)?facebook\.com\//g, '').split('?')[0].replace(/\/$/, '');
}

/**
 * Extract Vietnamese Phone numbers from raw text (comments, descriptions, bios)
 */
export function extractVietnamesePhones(text: string): string[] {
  if (!text) return [];
  const phoneRegex = /(?:(?:\+84|84|0)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9]))\d{7}\b/g;
  const matches = text.match(phoneRegex) || [];
  const uniquePhones = new Set<string>();

  for (let p of matches) {
    p = p.replace(/\D/g, '');
    if (p.startsWith('84')) {
      p = '0' + p.substring(2);
    }
    if (p.length === 10) {
      uniquePhones.add(p);
    }
  }

  return Array.from(uniquePhones);
}

/**
 * Check if the current page has hit Facebook Checkpoint, Lock or Temporary Block
 */
export function detectFacebookCheckpoint(url: string, pageContent: string): boolean {
  if (url.includes('/checkpoint/') || url.includes('login') || url.includes('disabled') || url.includes('temporarily_blocked')) {
    return true;
  }
  const text = (pageContent || '').toLowerCase();
  if (
    text.includes('tài khoản của bạn tạm thời bị khóa') ||
    text.includes('bạn tạm thời bị chặn') ||
    text.includes('you’re temporarily blocked') ||
    text.includes('vui lòng xác nhận danh tính') ||
    text.includes('confirm your identity') ||
    text.includes('hành động bị chặn')
  ) {
    return true;
  }
  return false;
}

/**
 * Setup Playwright Context with Stealth and Anti-Detection Measures
 */
async function setupStealthBrowserContext(accountId?: number): Promise<{ context: BrowserContext; isPersistent: boolean; accountUsername: string }> {
  let profileDir = '';
  let cookiesToInject: any[] = [];
  let proxyConfig: any = undefined;
  let username = 'Guest';

  if (accountId) {
    const acc = db.prepare(`
      SELECT social_accounts.*, 
             proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
      FROM social_accounts 
      LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
      WHERE social_accounts.id = ?
    `).get(accountId) as any;

    if (acc) {
      username = acc.username || `Account_${acc.id}`;
      if (acc.user_data_dir && fs.existsSync(acc.user_data_dir)) {
        profileDir = acc.user_data_dir;
        unlockProfileDir(profileDir);
      }

      if (acc.host && acc.port) {
        proxyConfig = {
          server: `${acc.proxy_proto || 'http'}://${acc.host}:${acc.port}`,
          username: acc.proxy_user || undefined,
          password: acc.proxy_pass || undefined,
        };
      }

      if (acc.auth_token) {
        try {
          const parsed = JSON.parse(acc.auth_token);
          if (Array.isArray(parsed)) {
            cookiesToInject = parsed;
          } else if (typeof acc.auth_token === 'string' && acc.auth_token.includes('c_user=')) {
            const rawPairs = acc.auth_token.split(';');
            for (const pair of rawPairs) {
              const [k, v] = pair.split('=').map((s: string) => s.trim());
              if (k && v) {
                cookiesToInject.push({
                  name: k,
                  value: v,
                  domain: '.facebook.com',
                  path: '/',
                });
              }
            }
          }
        } catch {
          if (acc.auth_token.includes('c_user=')) {
            const rawPairs = acc.auth_token.split(';');
            for (const pair of rawPairs) {
              const [k, v] = pair.split('=').map((s: string) => s.trim());
              if (k && v) {
                cookiesToInject.push({
                  name: k,
                  value: v,
                  domain: '.facebook.com',
                  path: '/',
                });
              }
            }
          }
        }
      }
    }
  }

  const defaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--disable-dev-shm-usage',
    '--window-position=0,0',
    '--lang=vi-VN,vi,en-US,en'
  ];

  let context: BrowserContext;
  let isPersistent = false;

  if (profileDir && fs.existsSync(profileDir)) {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1366, height: 768 },
      userAgent: defaultUserAgent,
      proxy: proxyConfig,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      args: launchArgs,
    });
    isPersistent = true;
  } else {
    const browser = await chromium.launch({
      headless: true,
      proxy: proxyConfig,
      args: launchArgs,
    });
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: defaultUserAgent,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    });
    isPersistent = false;
  }

  // Inject Stealth Anti-Detection Script
  await context.addInitScript(() => {
    try {
      // 1. Mask navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 2. Mock chrome runtime
      (window as any).chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };

      // 3. Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // 4. Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['vi-VN', 'vi', 'en-US', 'en'],
      });
    } catch {}
  });

  if (cookiesToInject.length > 0) {
    try {
      await context.addCookies(cookiesToInject);
    } catch {}
  }

  return { context, isPersistent, accountUsername: username };
}

/**
 * Facebook GraphQL Response Interceptor: Parses Group Members, Followers, Reactors, Comments
 */
function parseFacebookGraphQLText(rawText: string): ExtractedLead[] {
  const leads: ExtractedLead[] = [];
  if (!rawText) return leads;

  let cleaned = rawText.trim();
  if (cleaned.startsWith('for (;;);')) {
    cleaned = cleaned.substring('for (;;);'.length).trim();
  }

  const extractFromConnection = (conn: any, type: string) => {
    if (!conn) return;
    const items = conn.edges || conn.nodes || [];
    for (const item of items) {
      const node = item.node || item.user || item;
      if (node && (node.id || node.url || node.profile_url)) {
        const id = (node.id || '').toString();
        if (id.startsWith('Y29tbWVud') || id.startsWith('feedback:') || id.startsWith('comment:')) continue;
        
        let name = (node.name || node.title?.text || node.text || '').trim();
        if (!name && typeof node.title === 'string') name = node.title.trim();
        if (!name || name.startsWith('#') || name.includes('\n')) continue;

        const profileUrl = node.url || node.profile_url || (id ? `https://facebook.com/${id}` : '');
        const avatar = node.profile_picture?.uri || node.profile_picture_depth_0?.uri || node.profile_picture_50?.uri || node.avatar_url || undefined;
        
        if (id || profileUrl) {
          leads.push({
            uid: id || extractUidFromFacebookLink(profileUrl),
            displayName: name,
            avatarUrl: avatar,
            profileUrl: profileUrl || `https://facebook.com/${id}`,
            interactionType: type,
          });
        }
      }
    }
  };

  const tryParseChunk = (chunk: string) => {
    try {
      const json = JSON.parse(chunk);
      // Group Members
      extractFromConnection(json?.data?.node?.all_members, 'group_member');
      extractFromConnection(json?.data?.node?.group_member_list, 'group_member');
      extractFromConnection(json?.data?.node?.admin_and_moderator_members, 'admin_moderator');
      extractFromConnection(json?.data?.node?.members_with_things_in_common, 'common_member');
      extractFromConnection(json?.data?.node?.new_members, 'new_member');
      extractFromConnection(json?.data?.node?.search_results, 'search_member');
      extractFromConnection(json?.data?.node?.group_search_results, 'search_member');

      // Sections
      const sections = json?.data?.node?.sections || json?.data?.sections || [];
      if (Array.isArray(sections)) {
        for (const sec of sections) {
          extractFromConnection(sec?.items, 'group_member');
          extractFromConnection(sec?.member_list, 'group_member');
        }
      }

      // Followers / Subscribers
      extractFromConnection(json?.data?.node?.subscribers, 'follower');
      extractFromConnection(json?.data?.node?.followers, 'follower');
      extractFromConnection(json?.data?.node?.page_followers, 'follower');
      extractFromConnection(json?.data?.node?.page_items, 'follower');
      extractFromConnection(json?.data?.user?.subscribers, 'follower');
      extractFromConnection(json?.data?.user?.followers, 'follower');

      // Post Reactors
      const reactors = json?.data?.node?.reactors || json?.data?.feedback?.reactors || json?.data?.node?.top_reactors;
      extractFromConnection(reactors, 'reaction_like');

      // Comments
      const comments = json?.data?.node?.commentators || json?.data?.feedback?.comments;
      if (comments) {
        const edges = comments.edges || comments.nodes || [];
        for (const edge of edges) {
          const node = edge.node || edge;
          const author = node.author || node.comment_author;
          if (author) {
            const uid = (author.id || '').toString();
            const name = (author.name || '').trim();
            if (uid && name) {
              leads.push({
                uid,
                displayName: name,
                avatarUrl: author.profile_picture?.uri || undefined,
                profileUrl: author.url || `https://facebook.com/${uid}`,
                interactionType: 'comment',
              });
            }
          }
        }
      }
    } catch {}
  };

  if (cleaned.includes('\n{"') || cleaned.includes('\n{ "')) {
    cleaned.split('\n').forEach(line => {
      const lineTrim = line.trim();
      if (lineTrim.startsWith('{') && lineTrim.endsWith('}')) {
        tryParseChunk(lineTrim);
      }
    });
  } else {
    tryParseChunk(cleaned);
  }

  // Fallback regex pattern matching for UID and name
  if (leads.length === 0) {
    const userMatches = Array.from(cleaned.matchAll(/"id"\s*:\s*"(\d{8,20})"[^}]*?"name"\s*:\s*"((?:\\.|[^"\\])+)"/g));
    for (const match of userMatches) {
      const uid = match[1];
      let name = match[2] || '';
      try { name = JSON.parse(`"${name}"`).trim(); } catch {}
      if (uid && /^\d{8,20}$/.test(uid) && name && name.length >= 2 && !name.startsWith('#') && !name.includes('\n')) {
        leads.push({
          uid,
          displayName: name,
          profileUrl: `https://facebook.com/${uid}`,
          interactionType: 'graphql_lead',
        });
      }
    }
  }

  return leads;
}

/**
 * Main Scrape Job Execution Function with Multi-Account Rotation, Stealth & Dual-Engine
 */
export async function runFacebookScrapeJob(options: ScrapeJobOptions): Promise<void> {
  return browserLimiter.run(async () => {
    const { jobId, workspaceId, targetGroup, maxLimit, autoImport, customTag, scrapeType } = options;

    const cancelSignal = { cancelled: false };
    activeJobSignals.set(jobId, cancelSignal);

    // Update job status to processing
    db.prepare(`UPDATE scrape_jobs SET status = 'processing', error_msg = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);

    let scrapedCount = 0;
    let phoneCount = 0;
    const collectedUids = new Set<string>();
    const collectedPhones = new Set<string>();

    const insertLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO scraped_job_leads (job_id, workspace_id, platform, uid, display_name, avatar_url, profile_url, interaction_type, post_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSpamLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (workspace_id, platform, lead_type, value, display_name, avatar_url, status, source)
      VALUES (?, 'facebook', 'uid', ?, ?, ?, 'pending', ?)
    `);

    const insertPhoneLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (workspace_id, platform, lead_type, value, display_name, avatar_url, status, source)
      VALUES (?, 'zalo', 'phone', ?, ?, NULL, 'pending', ?)
    `);

    const parsedTarget = parseFacebookTarget(targetGroup);
    const targetTag = customTag && customTag.trim() ? customTag.trim() : `KOL_${parsedTarget.identifier}`;

    const saveLeadBatch = (leads: ExtractedLead[]) => {
      if (leads.length === 0) return;
      const tx = db.transaction(() => {
        for (const lead of leads) {
          if (!lead.uid || collectedUids.has(lead.uid.toLowerCase())) continue;
          collectedUids.add(lead.uid.toLowerCase());

          const profileLink = lead.profileUrl || `https://www.facebook.com/${lead.uid}`;
          insertLeadStmt.run(
            jobId,
            workspaceId,
            'facebook',
            lead.uid,
            lead.displayName || lead.uid,
            lead.avatarUrl || null,
            profileLink,
            lead.interactionType || 'engaged_fan',
            lead.postUrl || null
          );

          if (autoImport) {
            insertSpamLeadStmt.run(
              workspaceId,
              lead.uid,
              lead.displayName || lead.uid,
              lead.avatarUrl || null,
              targetTag
            );
          }

          scrapedCount++;

          // If lead has a phone number extracted
          if (lead.phone && !collectedPhones.has(lead.phone)) {
            collectedPhones.add(lead.phone);
            phoneCount++;
            if (autoImport) {
              insertPhoneLeadStmt.run(
                workspaceId,
                lead.phone,
                lead.displayName || `Khách hàng ${lead.phone}`,
                `${targetTag}_SĐT`
              );
            }
          }
        }
      });

      tx();

      const actualTotal = (db.prepare(`SELECT count(*) as count FROM scraped_job_leads WHERE job_id = ?`).get(jobId) as any)?.count || scrapedCount;

      db.prepare(`UPDATE scrape_jobs SET total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        actualTotal,
        actualTotal,
        jobId
      );
    };

    // Determine account pool queue for Multi-Account Rotation
    let accountQueue: number[] = [];
    if (options.accountIds && Array.isArray(options.accountIds) && options.accountIds.length > 0) {
      accountQueue = [...options.accountIds];
    } else if (options.accountId) {
      accountQueue = [options.accountId];
    } else {
      // Fallback: pick live Facebook accounts from DB
      const liveAccs = db.prepare(`
        SELECT id FROM social_accounts 
        WHERE workspace_id = ? AND platform = 'facebook' AND status IN ('live', 'ready', 'active')
        ORDER BY id ASC LIMIT 5
      `).all(workspaceId) as any[];
      accountQueue = liveAccs.map(a => a.id);
    }

    if (accountQueue.length === 0) {
      accountQueue = [0]; // Guest mode if no account
    }

    console.log(`[FB Scraper] Job #${jobId} starting with ${accountQueue.length} account(s) in rotation pool.`);

    let currentAccountIdx = 0;
    const maxPerAccountQuota = Math.max(300, Math.min(800, Math.ceil(maxLimit / Math.max(1, accountQueue.length))));

    try {
      while (!cancelSignal.cancelled && scrapedCount < maxLimit && currentAccountIdx < accountQueue.length) {
        const currentAccountId = accountQueue[currentAccountIdx];
        let browserContext: BrowserContext | null = null;
        let accountSessionCount = 0;

        console.log(`[FB Scraper] 🔄 Rotating to Account #${currentAccountId} (Session quota: ~${maxPerAccountQuota} leads)`);

        try {
          const { context, accountUsername } = await setupStealthBrowserContext(currentAccountId > 0 ? currentAccountId : undefined);
          browserContext = context;

          const page = await browserContext.newPage();
          page.setDefaultTimeout(35000);
          page.setDefaultNavigationTimeout(45000);

          // Attach Dual-Engine GraphQL Network Interceptor
          const responseListener = async (response: any) => {
            try {
              const url = response.url();
              if (!url.includes('/graphql') && !url.includes('/api/graphql/')) return;

              const postData = response.request()?.postData() || '';
              // Exclude personal live viewer background chatter
              if (
                postData.includes('CometNotifications') ||
                postData.includes('CometChat') ||
                postData.includes('Presence') ||
                postData.includes('NewsFeed') ||
                postData.includes('Stories')
              ) {
                return;
              }

              const text = await response.text().catch(() => '');
              if (!text || (!text.includes('"id"') && !text.includes('profile_picture'))) return;

              const parsedLeads = parseFacebookGraphQLText(text);
              if (parsedLeads.length > 0) {
                // Auto-detect Vietnamese phones in the payload
                const foundPhones = extractVietnamesePhones(text);
                if (foundPhones.length > 0) {
                  for (let i = 0; i < Math.min(foundPhones.length, parsedLeads.length); i++) {
                    parsedLeads[i].phone = foundPhones[i];
                  }
                }

                saveLeadBatch(parsedLeads);
                accountSessionCount += parsedLeads.length;
              }
            } catch {}
          };

          page.on('response', responseListener);

          // Navigate to target
          console.log(`[FB Scraper] Navigating to ${parsedTarget.cleanUrl} via @${accountUsername}...`);
          await page.goto(parsedTarget.cleanUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
          await page.waitForTimeout(2500);

          // Check for Checkpoint / Account ban
          const pageHtml = await page.content().catch(() => '');
          if (detectFacebookCheckpoint(page.url(), pageHtml)) {
            console.warn(`[FB Scraper] ⚠️ Account #${currentAccountId} hit Checkpoint / Block! Circuit Breaker triggered.`);
            if (currentAccountId > 0) {
              db.prepare(`UPDATE social_accounts SET status = 'checkpoint' WHERE id = ?`).run(currentAccountId);
              sendDesktopNotification(
                'Tài khoản Facebook bị Checkpoint ⚠️',
                `Tài khoản #${currentAccountId} (@${accountUsername}) gặp checkpoint. Hệ thống đang tự động đổi sang tài khoản tiếp theo...`
              );
            }
            await browserContext.close();
            currentAccountIdx++;
            continue; // Rotate to next account
          }

          // MODE 1: Group Members Scraping (with Prefix Search fallback)
          if (parsedTarget.type === 'group' || scrapeType === 'members') {
            const groupMembersUrl = `${parsedTarget.cleanUrl}/members`;
            await page.goto(groupMembersUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForTimeout(2500);

            let scrollAttempts = 0;
            let lastCount = scrapedCount;

            // Phase 1.1: Infinite Scroll
            while (!cancelSignal.cancelled && scrapedCount < maxLimit && accountSessionCount < maxPerAccountQuota && scrollAttempts < 40) {
              const domLeads = await page.evaluate(() => {
                const leads: { href: string; name: string; avatar: string }[] = [];
                const links = document.querySelectorAll('a[role="link"], a[tabindex="0"]');
                links.forEach((a: any) => {
                  const href = a.getAttribute('href') || '';
                  const text = (a.innerText || '').trim();
                  if (
                    href.includes('/user/') ||
                    href.includes('/profile.php?id=') ||
                    (href.startsWith('/') && !href.includes('/groups/') && !href.includes('/hashtag/') && text.length > 2 && text.length < 50)
                  ) {
                    const img = a.querySelector('img') || a.parentElement?.querySelector('img');
                    leads.push({ href, name: text.split('\n')[0] || '', avatar: img?.getAttribute('src') || '' });
                  }
                });
                return leads;
              });

              const formatted = domLeads.map(l => ({
                uid: extractUidFromFacebookLink(l.href),
                displayName: l.name || 'Facebook User',
                avatarUrl: l.avatar,
                profileUrl: l.href.startsWith('http') ? l.href : `https://www.facebook.com${l.href}`,
                interactionType: 'group_member',
              })).filter(l => l.uid && l.uid.length > 2 && !l.uid.includes('help') && !l.uid.includes('privacy'));

              saveLeadBatch(formatted);
              accountSessionCount += formatted.length;

              if (scrapedCount === lastCount) {
                scrollAttempts++;
              } else {
                scrollAttempts = 0;
                lastCount = scrapedCount;
              }

              // Human-like adaptive scroll
              await page.evaluate(() => window.scrollBy(0, 1100 + Math.floor(Math.random() * 400)));
              await page.waitForTimeout(1200 + Math.floor(Math.random() * 800));
            }

            // Phase 1.2: Prefix Search Expansion if scroll slows down (Unlocks 10,000+ members in large groups)
            if (!cancelSignal.cancelled && scrapedCount < maxLimit && accountSessionCount < maxPerAccountQuota) {
              console.log(`[FB Scraper] 🔍 Activating Prefix Search Expansion (A-Z) for Group...`);
              const searchLetters = ['a', 'b', 'c', 'd', 'e', 'h', 'k', 'm', 'n', 't', 'v'];

              for (const letter of searchLetters) {
                if (cancelSignal.cancelled || scrapedCount >= maxLimit || accountSessionCount >= maxPerAccountQuota) break;

                try {
                  const searchInput = await page.$('input[aria-label*="Tìm kiếm"], input[placeholder*="Tìm kiếm"], input[aria-label*="Search"]');
                  if (searchInput) {
                    await searchInput.fill(letter);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(2000);

                    // Scroll search results
                    for (let s = 0; s < 5; s++) {
                      await page.evaluate(() => window.scrollBy(0, 1000));
                      await page.waitForTimeout(1000);
                    }
                  }
                } catch {}
              }
            }

          } else {
            // MODE 2: Multi-Vector Fanpage 360° Harvester (Followers + Reactions + Comments + SĐT Extractor)
            
            // Step 2.1: Followers direct scan
            const followersPageUrl = `${parsedTarget.cleanUrl}/followers`;
            try {
              await page.goto(followersPageUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
              await page.waitForTimeout(2000);

              let fScrolls = 0;
              while (!cancelSignal.cancelled && fScrolls < 12 && scrapedCount < maxLimit && accountSessionCount < maxPerAccountQuota) {
                const domFollowers = await page.evaluate(() => {
                  const list: { href: string; name: string; avatar: string }[] = [];
                  const links = document.querySelectorAll('a[role="link"], a[tabindex="0"]');
                  links.forEach((a: any) => {
                    const href = a.getAttribute('href') || '';
                    const text = (a.innerText || '').trim();
                    if (
                      href.includes('/user/') ||
                      href.includes('/profile.php?id=') ||
                      (href.startsWith('/') && !href.includes('/groups/') && text.length > 2 && text.length < 50)
                    ) {
                      const img = a.querySelector('img');
                      list.push({ href, name: text.split('\n')[0], avatar: img?.getAttribute('src') || '' });
                    }
                  });
                  return list;
                });

                const formatted = domFollowers.map(l => ({
                  uid: extractUidFromFacebookLink(l.href),
                  displayName: l.name,
                  avatarUrl: l.avatar,
                  profileUrl: l.href.startsWith('http') ? l.href : `https://www.facebook.com${l.href}`,
                  interactionType: 'follower',
                })).filter(l => l.uid && l.uid.length > 2);

                saveLeadBatch(formatted);
                accountSessionCount += formatted.length;
                await page.evaluate(() => window.scrollBy(0, 1200));
                await page.waitForTimeout(1200);
                fScrolls++;
              }
            } catch {}

            // Step 2.2: Main Feed Deep Extraction
            await page.goto(parsedTarget.cleanUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
            await page.waitForTimeout(2500);

            // Expand "All Comments" ("Tất cả bình luận") filter to unlock 95% hidden comments
            try {
              await page.evaluate(() => {
                const filterBtns = document.querySelectorAll('span, div[role="button"]');
                for (const b of Array.from(filterBtns)) {
                  const t = (b.textContent || '').trim();
                  if (t.includes('Phù hợp nhất') || t.includes('Most relevant')) {
                    (b as HTMLElement).click();
                    break;
                  }
                }
              });
              await page.waitForTimeout(1000);
              await page.evaluate(() => {
                const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="option"], span');
                for (const item of Array.from(menuItems)) {
                  const t = (item.textContent || '').trim();
                  if (t.includes('Tất cả bình luận') || t.includes('All comments')) {
                    (item as HTMLElement).click();
                    break;
                  }
                }
              });
            } catch {}

            // Feed scrolling loop
            let feedScrolls = 0;
            let feedStallCount = 0;
            let lastFeedCount = scrapedCount;
            while (!cancelSignal.cancelled && feedScrolls < 60 && scrapedCount < maxLimit && accountSessionCount < maxPerAccountQuota) {
              // Extract comment leads & phone numbers from DOM
              const feedLeads = await page.evaluate(() => {
                const leads: { href: string; name: string; avatar: string; commentText: string }[] = [];
                const articles = document.querySelectorAll('div[role="article"], div[aria-label*="Comment"], div[aria-label*="Bình luận"]');
                articles.forEach((art: any) => {
                  const a = art.querySelector('a[role="link"]');
                  if (a) {
                    const href = a.getAttribute('href') || '';
                    const name = (a.innerText || '').trim();
                    const commentText = (art.innerText || '').trim();
                    if (name && name.length > 2 && name.length < 50 && !href.includes('/posts/')) {
                      const img = art.querySelector('img');
                      leads.push({ href, name: name.split('\n')[0], avatar: img?.getAttribute('src') || '', commentText });
                    }
                  }
                });
                return leads;
              });

              const formattedFeed: ExtractedLead[] = [];
              for (const fl of feedLeads) {
                const uid = extractUidFromFacebookLink(fl.href);
                if (uid && uid.length > 2) {
                  const phones = extractVietnamesePhones(fl.commentText);
                  formattedFeed.push({
                    uid,
                    displayName: fl.name || uid,
                    avatarUrl: fl.avatar,
                    profileUrl: fl.href.startsWith('http') ? fl.href : `https://www.facebook.com${fl.href}`,
                    interactionType: 'comment',
                    phone: phones.length > 0 ? phones[0] : undefined
                  });
                }
              }

              saveLeadBatch(formattedFeed);
              accountSessionCount += formattedFeed.length;

              if (scrapedCount === lastFeedCount) {
                feedStallCount++;
              } else {
                feedStallCount = 0;
                lastFeedCount = scrapedCount;
              }

              // Nếu 5 lần cuộn liên tiếp không có thêm dữ liệu -> Đã quét hết trang
              if (feedStallCount >= 5) {
                console.log(`[FB Scraper] 🏁 Đã quét cạn toàn bộ bài viết hiển thị trên trang ${parsedTarget.identifier}. Dừng cuộn sớm.`);
                break;
              }

              // Click reaction badge if visible to open reactor dialog
              const openedReactorDialog = await page.evaluate(() => {
                const reactionBadges = document.querySelectorAll(`
                  span[aria-label*="bày tỏ"], div[aria-label*="bày tỏ"], 
                  span[aria-label*="reaction"], div[aria-label*="reaction"], 
                  div[role="button"][aria-label*="See who reacted"], div[role="button"][aria-label*="Xem ai"]
                `);
                for (const btn of Array.from(reactionBadges)) {
                  const el = btn as HTMLElement;
                  if (el && !el.dataset.scraped) {
                    el.dataset.scraped = 'true';
                    el.click();
                    return true;
                  }
                }
                return false;
              });

              if (openedReactorDialog) {
                await page.waitForTimeout(1800);
                for (let d = 0; d < 15; d++) {
                  if (cancelSignal.cancelled) break;
                  await page.evaluate(() => {
                    const dialogBody = document.querySelector('div[role="dialog"] div[style*="overflow"], div[role="dialog"] div[tabindex="-1"]');
                    if (dialogBody) dialogBody.scrollBy(0, 900);
                  });
                  await page.waitForTimeout(800 + Math.floor(Math.random() * 400));
                }
                await page.keyboard.press('Escape').catch(() => {});
                await page.waitForTimeout(500);
              }

              // Click "View more comments"
              await page.evaluate(() => {
                const moreBtns = document.querySelectorAll('span');
                for (const b of Array.from(moreBtns)) {
                  const t = (b.textContent || '').trim();
                  if (t.includes('Xem thêm bình luận') || t.includes('View more comments') || t.includes('câu trả lời')) {
                    (b as HTMLElement).click();
                    break;
                  }
                }
              });

              await page.evaluate(() => window.scrollBy(0, 1300));
              await page.waitForTimeout(1400 + Math.floor(Math.random() * 600));
              feedScrolls++;
            }
          }

        } catch (sessionErr: any) {
          console.error(`[FB Scraper] Session error on Account #${currentAccountId}:`, sessionErr.message);
        } finally {
          if (browserContext) {
            try { await browserContext.close(); } catch {}
          }
        }

        // Account rotation check
        currentAccountIdx++;
        if (scrapedCount < maxLimit && currentAccountIdx < accountQueue.length) {
          console.log(`[FB Scraper] ⏳ Account #${currentAccountId} completed session. Resting 3s before rotating to next account...`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      const actualTotal = (db.prepare(`SELECT count(*) as count FROM scraped_job_leads WHERE job_id = ?`).get(jobId) as any)?.count || scrapedCount;
      const finalStatus = cancelSignal.cancelled ? 'stopped' : 'completed';
      db.prepare(`UPDATE scrape_jobs SET status = ?, total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        finalStatus,
        actualTotal,
        actualTotal,
        jobId
      );

      console.log(`[FB Scraper] Job #${jobId} completed! Total leads: ${actualTotal} (Phones: ${phoneCount}). Status: ${finalStatus}`);
      sendDesktopNotification(
        'Hoàn tất cào dữ liệu Facebook 🎯',
        `Job #${jobId} đã thu thập thành công ${actualTotal} leads (${phoneCount} số điện thoại).`
      );

    } catch (error: any) {
      console.error(`[FB Scraper] Fatal error executing job #${jobId}:`, error);
      db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        error.message || 'Lỗi không xác định trong quá trình cào dữ liệu.',
        jobId
      );
    } finally {
      activeJobSignals.delete(jobId);
    }
  });
}
