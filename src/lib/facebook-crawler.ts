import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
import db from './db';
import { browserLimiter } from './concurrency';

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
 * Clean and extract Facebook vanity or ID from URL / input
 */
export function parseFacebookTarget(input: string): { type: 'page' | 'group' | 'post'; identifier: string; cleanUrl: string } {
  let target = input.trim();
  target = target.replace(/^@/, '');

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

    // Check pathname
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
      if (first !== 'groups' && first !== 'pages' && first !== 'people' && first !== 'watch' && first !== 'events' && first !== 'photo.php' && first !== 'video.php') {
        return first;
      }
      if (parts.length > 1 && (first === 'pages' || first === 'people')) {
        return parts[1];
      }
    }
  } catch {}
  
  // Extract trailing digits from /user/12345 if any
  const matchDigits = link.match(/\/user\/(\d+)/);
  if (matchDigits) return matchDigits[1];

  return link.replace(/https?:\/\/(www\.)?facebook\.com\//g, '').split('?')[0].replace(/\/$/, '');
}

/**
 * Setup Playwright Context with cookies / persistent profile
 */
async function setupBrowserContext(accountId?: number): Promise<{ context: BrowserContext; isPersistent: boolean }> {
  let profileDir = '';
  let cookiesToInject: any[] = [];
  let proxyConfig: any = undefined;

  if (accountId) {
    const acc = db.prepare(`
      SELECT social_accounts.*, 
             proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
      FROM social_accounts 
      LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
      WHERE social_accounts.id = ?
    `).get(accountId) as any;

    if (acc) {
      if (acc.user_data_dir && fs.existsSync(acc.user_data_dir)) {
        profileDir = acc.user_data_dir;
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

  if (profileDir && fs.existsSync(profileDir)) {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      userAgent: defaultUserAgent,
      proxy: proxyConfig,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    if (cookiesToInject.length > 0) {
      await context.addCookies(cookiesToInject);
    }
    return { context, isPersistent: true };
  } else {
    const browser = await chromium.launch({
      headless: true,
      proxy: proxyConfig,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: defaultUserAgent,
    });
    if (cookiesToInject.length > 0) {
      await context.addCookies(cookiesToInject);
    }
    return { context, isPersistent: false };
  }
}

/**
 * Main Scrape Job Execution Function
 */
export async function runFacebookScrapeJob(options: ScrapeJobOptions): Promise<void> {
  return browserLimiter.run(async () => {
    const { jobId, workspaceId, targetGroup, accountId, maxLimit, autoImport, customTag, targetCampaignId, scrapeType } = options;

    const cancelSignal = { cancelled: false };
    activeJobSignals.set(jobId, cancelSignal);

  // Update job status to processing
  db.prepare(`UPDATE scrape_jobs SET status = 'processing', error_msg = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);

  let browserContext: BrowserContext | null = null;
  let isPersistentCtx = false;
  let scrapedCount = 0;
  const collectedUids = new Set<string>();

  const insertLeadStmt = db.prepare(`
    INSERT OR IGNORE INTO scraped_job_leads (job_id, workspace_id, platform, uid, display_name, avatar_url, profile_url, interaction_type, post_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSpamLeadStmt = db.prepare(`
    INSERT OR IGNORE INTO spam_leads (workspace_id, platform, lead_type, value, display_name, avatar_url, status, source)
    VALUES (?, 'facebook', 'uid', ?, ?, ?, 'pending', ?)
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
      }
    });

    tx();

    db.prepare(`UPDATE scrape_jobs SET total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      scrapedCount,
      scrapedCount,
      jobId
    );
  };

  try {
    const { context, isPersistent } = await setupBrowserContext(accountId);
    browserContext = context;
    isPersistentCtx = isPersistent;

    const page = await browserContext.newPage();

    // Set standard timeouts
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(45000);

    console.log(`[FB Scraper] Starting scrape for job #${jobId}: ${parsedTarget.cleanUrl} (Type: ${parsedTarget.type})`);

    // MODE 1: Group Members Scraping
    if (parsedTarget.type === 'group' || scrapeType === 'members') {
      const groupMembersUrl = `${parsedTarget.cleanUrl}/members`;
      await page.goto(groupMembersUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(3000);

      let scrollAttempts = 0;
      let lastCount = 0;

      while (!cancelSignal.cancelled && scrapedCount < maxLimit && scrollAttempts < 100) {
        const batchLeads = await page.evaluate(() => {
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
              const avatar = img?.getAttribute('src') || '';
              leads.push({
                href,
                name: text.split('\n')[0] || '',
                avatar,
              });
            }
          });
          return leads;
        });

        const formatted = batchLeads.map(l => {
          const uid = extractUidFromFacebookLink(l.href);
          return {
            uid,
            displayName: l.name || uid,
            avatarUrl: l.avatar,
            profileUrl: l.href.startsWith('http') ? l.href : `https://www.facebook.com${l.href}`,
            interactionType: 'group_member',
          };
        }).filter(l => l.uid && l.uid.length > 2 && !l.uid.includes('help') && !l.uid.includes('privacy'));

        saveLeadBatch(formatted);

        if (scrapedCount === lastCount) {
          scrollAttempts++;
        } else {
          scrollAttempts = 0;
          lastCount = scrapedCount;
        }

        // Scroll down
        await page.evaluate(() => window.scrollBy(0, 1200));
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));
      }

    } else {
      // MODE 2: Multi-Vector Fanpage 360° All-in-One Harvester (Followers + Reactions + Comments + Bio Group)
      
      // Step 2.0: Try scanning page followers list
      const followersPageUrl = `${parsedTarget.cleanUrl}/followers`;
      try {
        await page.goto(followersPageUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(2500);

        let followerScrolls = 0;
        while (!cancelSignal.cancelled && followerScrolls < 10 && scrapedCount < maxLimit) {
          const followerLeads = await page.evaluate(() => {
            const list: { href: string; name: string; avatar: string }[] = [];
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
                list.push({ href, name: text.split('\n')[0], avatar: img?.getAttribute('src') || '' });
              }
            });
            return list;
          });

          const formattedFollowers = followerLeads.map(l => {
            const uid = extractUidFromFacebookLink(l.href);
            return {
              uid,
              displayName: l.name || uid,
              avatarUrl: l.avatar,
              profileUrl: l.href.startsWith('http') ? l.href : `https://www.facebook.com${l.href}`,
              interactionType: 'follower',
            };
          }).filter(l => l.uid && l.uid.length > 2);

          saveLeadBatch(formattedFollowers);
          await page.evaluate(() => window.scrollBy(0, 1000));
          await page.waitForTimeout(1200);
          followerScrolls++;
        }
      } catch (err: any) {
        console.log(`[FB Scraper] Followers tab direct scan passed:`, err.message);
      }

      // Navigate to Fanpage Main Feed
      await page.goto(parsedTarget.cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);

      // Step 2.1: Extract Bio for linked Facebook groups using DOM, Regex & Bio Aggregators (beacons.ai, linktree...)
      const bioInfo = await page.evaluate(() => {
        const groups: string[] = [];
        const aggregators: string[] = [];
        const pageHtml = document.body.innerHTML || '';
        
        // Match facebook.com/groups/xxx or /groups/xxx
        const groupRegex = /(?:facebook\.com\/groups\/|groups\/)([a-zA-Z0-9._-]+)/g;
        let match;
        while ((match = groupRegex.exec(pageHtml)) !== null) {
          const gId = match[1];
          if (gId && !['feed', 'discover', 'joins', 'create'].includes(gId) && !groups.includes(gId)) {
            groups.push(gId);
          }
        }

        // Check all <a> tags for groups or aggregator links (beacons.ai, linktr.ee, etc.)
        const anchors = document.querySelectorAll('a[href]');
        anchors.forEach((a: any) => {
          const href = a.getAttribute('href') || '';
          if (href.includes('groups/')) {
            const parts = href.split('groups/')[1]?.split('/')[0]?.split('?')[0];
            if (parts && !groups.includes(parts)) groups.push(parts);
          }
          if (href.includes('beacons.ai/') || href.includes('linktr.ee/') || href.includes('bio.link/') || href.includes('taplink.cc/')) {
            if (!aggregators.includes(href)) aggregators.push(href);
          }
        });

        return { groups, aggregators };
      });

      const detectedGroupIds: string[] = [...bioInfo.groups];

      // If Bio has an aggregator link (like beacons.ai/phk10x), inspect it in a tab to discover hidden groups!
      if (bioInfo.aggregators.length > 0) {
        for (const aggUrl of bioInfo.aggregators.slice(0, 2)) {
          try {
            console.log(`[FB Scraper] Inspecting bio aggregator link: ${aggUrl}`);
            const aggPage = await browserContext.newPage();
            await aggPage.goto(aggUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await aggPage.waitForTimeout(2000);

            const aggGroups = await aggPage.evaluate(() => {
              const found: string[] = [];
              const html = document.body.innerHTML || '';
              const gRegex = /(?:facebook\.com\/groups\/|groups\/)([a-zA-Z0-9._-]+)/g;
              let m;
              while ((m = gRegex.exec(html)) !== null) {
                const id = m[1];
                if (id && !['feed', 'discover', 'joins', 'create'].includes(id) && !found.includes(id)) {
                  found.push(id);
                }
              }
              return found;
            });

            for (const g of aggGroups) {
              if (!detectedGroupIds.includes(g)) detectedGroupIds.push(g);
            }
            await aggPage.close();
          } catch (e: any) {
            console.log(`[FB Scraper] Aggregator inspection skipped:`, e.message);
          }
        }
      }

      console.log(`[FB Scraper] Total detected groups:`, detectedGroupIds);

      // Step 2.2: Deep Feed Crawler (Feed Scroll up to 100+ scrolls, with deep reaction dialogs)
      let feedScrolls = 0;
      let lastFeedCount = scrapedCount;

      while (!cancelSignal.cancelled && feedScrolls < 100 && scrapedCount < maxLimit) {
        // 2.2.1: Scrape visible commenters on current view
        const currentFeedLeads = await page.evaluate(() => {
          const leads: { href: string; name: string; avatar: string; type: string }[] = [];
          const commentElements = document.querySelectorAll('div[role="article"] a[role="link"], div[aria-label*="Comment"] a[role="link"], div[aria-label*="Bình luận"] a[role="link"]');
          commentElements.forEach((a: any) => {
            const href = a.getAttribute('href') || '';
            const name = (a.innerText || '').trim();
            if (name && name.length > 2 && name.length < 50 && !href.includes('/posts/') && !href.includes('/photos/') && !href.includes('/groups/')) {
              const img = a.querySelector('img') || a.parentElement?.querySelector('img');
              leads.push({ href, name: name.split('\n')[0], avatar: img?.getAttribute('src') || '', type: 'comment' });
            }
          });
          return leads;
        });

        const formattedFeed = currentFeedLeads.map(l => {
          const uid = extractUidFromFacebookLink(l.href);
          return {
            uid,
            displayName: l.name || uid,
            avatarUrl: l.avatar,
            profileUrl: l.href.startsWith('http') ? l.href : `https://www.facebook.com${l.href}`,
            interactionType: l.type,
          };
        }).filter(l => l.uid && l.uid.length > 2);

        saveLeadBatch(formattedFeed);

        // 2.2.2: Click all unclicked reaction badges visible on feed
        const openedDialog = await page.evaluate(() => {
          const reactionBadges = document.querySelectorAll(`
            span[aria-label*="bày tỏ"], div[aria-label*="bày tỏ"], 
            span[aria-label*="reaction"], div[aria-label*="reaction"], 
            div[role="button"][aria-label*="See who reacted"], div[role="button"][aria-label*="Xem ai"], 
            span[aria-label*="người khác"], span[aria-label*="others"], 
            span[aria-label*="Thích, yêu thích"], div[aria-label*="Thích, yêu thích"], 
            span[aria-label*="Like, love"], div[aria-label*="Like, love"]
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

        if (openedDialog) {
          await page.waitForTimeout(2000);

          let dialogScrolls = 0;
          let lastDialogCount = scrapedCount;
          let dialogStallCount = 0;

          while (!cancelSignal.cancelled && dialogScrolls < 50 && scrapedCount < maxLimit && dialogStallCount < 4) {
            const dialogUsers = await page.evaluate(() => {
              const users: { href: string; name: string; avatar: string }[] = [];
              const dialog = document.querySelector('div[role="dialog"]');
              if (dialog) {
                const userAnchors = dialog.querySelectorAll('a[role="link"], a[tabindex="0"]');
                userAnchors.forEach((a: any) => {
                  const href = a.getAttribute('href') || '';
                  const name = (a.innerText || '').trim();
                  if (name && name.length > 2 && name.length < 50 && !href.includes('/posts/') && !href.includes('/photos/')) {
                    const img = a.querySelector('img') || a.parentElement?.querySelector('img');
                    users.push({
                      href,
                      name: name.split('\n')[0],
                      avatar: img?.getAttribute('src') || '',
                    });
                  }
                });
              }
              return users;
            });

            const formattedReactors = dialogUsers.map(u => {
              const uid = extractUidFromFacebookLink(u.href);
              return {
                uid,
                displayName: u.name || uid,
                avatarUrl: u.avatar,
                profileUrl: u.href.startsWith('http') ? u.href : `https://www.facebook.com${u.href}`,
                interactionType: 'reaction_like',
              };
            }).filter(u => u.uid && u.uid.length > 2);

            saveLeadBatch(formattedReactors);

            if (scrapedCount === lastDialogCount) {
              dialogStallCount++;
            } else {
              dialogStallCount = 0;
              lastDialogCount = scrapedCount;
            }

            // Scroll the reaction dialog container
            await page.evaluate(() => {
              const dialogBody = document.querySelector('div[role="dialog"] div[style*="overflow"], div[role="dialog"] div[tabindex="-1"]');
              if (dialogBody) {
                dialogBody.scrollBy(0, 900);
              } else {
                window.scrollBy(0, 900);
              }
            });

            await page.waitForTimeout(900 + Math.floor(Math.random() * 500));
            dialogScrolls++;
          }

          // Close the dialog
          await page.keyboard.press('Escape');
          await page.waitForTimeout(800);
        }

        // Scroll main feed
        await page.evaluate(() => window.scrollBy(0, 1400));
        await page.waitForTimeout(1600);
        feedScrolls++;
      }

      // Step 2.3: Sweep Videos / Reels Tab if still under maxLimit
      if (!cancelSignal.cancelled && scrapedCount < maxLimit) {
        const videosUrl = `${parsedTarget.cleanUrl}/videos`;
        try {
          console.log(`[FB Scraper] Sweeping Videos tab: ${videosUrl}`);
          await page.goto(videosUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
          await page.waitForTimeout(2500);

          let videoScrolls = 0;
          while (!cancelSignal.cancelled && videoScrolls < 30 && scrapedCount < maxLimit) {
            const videoLeads = await page.evaluate(() => {
              const leads: { href: string; name: string; avatar: string }[] = [];
              const links = document.querySelectorAll('a[role="link"]');
              links.forEach((a: any) => {
                const href = a.getAttribute('href') || '';
                const name = (a.innerText || '').trim();
                if (name && name.length > 2 && name.length < 50 && !href.includes('/videos/') && !href.includes('/watch/')) {
                  const img = a.querySelector('img');
                  leads.push({ href, name: name.split('\n')[0], avatar: img?.getAttribute('src') || '' });
                }
              });
              return leads;
            });

            const formattedVideoLeads = videoLeads.map(l => {
              const uid = extractUidFromFacebookLink(l.href);
              return {
                uid,
                displayName: l.name || uid,
                avatarUrl: l.avatar,
                profileUrl: l.href.startsWith('http') ? l.href : `https://www.facebook.com${l.href}`,
                interactionType: 'video_viewer',
              };
            }).filter(l => l.uid && l.uid.length > 2);

            saveLeadBatch(formattedVideoLeads);
            await page.evaluate(() => window.scrollBy(0, 1200));
            await page.waitForTimeout(1400);
            videoScrolls++;
          }
        } catch (vErr: any) {
          console.log(`[FB Scraper] Videos tab scan passed:`, vErr.message);
        }
      }

      // Step 2.4: Infiltrate & Scrape Linked Bio Community Group
      if (!cancelSignal.cancelled && scrapedCount < maxLimit && detectedGroupIds.length > 0) {
        for (const gId of detectedGroupIds) {
          if (cancelSignal.cancelled || scrapedCount >= maxLimit) break;

          const groupMembersUrl = `https://www.facebook.com/groups/${gId}/members`;
          console.log(`[FB Scraper] Scraping community group members: ${groupMembersUrl}`);

          try {
            await page.goto(groupMembersUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
            await page.waitForTimeout(3000);

            let groupScrolls = 0;
            let lastGroupCount = scrapedCount;
            let groupStallCount = 0;

            while (!cancelSignal.cancelled && scrapedCount < maxLimit && groupScrolls < 120 && groupStallCount < 8) {
              const groupLeads = await page.evaluate(() => {
                const list: { href: string; name: string; avatar: string }[] = [];
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
                    list.push({ href, name: text.split('\n')[0], avatar: img?.getAttribute('src') || '' });
                  }
                });
                return list;
              });

              const formattedGroup = groupLeads.map(l => {
                const uid = extractUidFromFacebookLink(l.href);
                return {
                  uid,
                  displayName: l.name || uid,
                  avatarUrl: l.avatar,
                  profileUrl: l.href.startsWith('http') ? l.href : `https://www.facebook.com${l.href}`,
                  interactionType: 'linked_group_member',
                };
              }).filter(l => l.uid && l.uid.length > 2 && !l.uid.includes('help') && !l.uid.includes('privacy'));

              saveLeadBatch(formattedGroup);

              if (scrapedCount === lastGroupCount) {
                groupStallCount++;
              } else {
                groupStallCount = 0;
                lastGroupCount = scrapedCount;
              }

              await page.evaluate(() => window.scrollBy(0, 1200));
              await page.waitForTimeout(1300 + Math.floor(Math.random() * 600));
              groupScrolls++;
            }
          } catch (gErr: any) {
            console.error(`[FB Scraper] Error scraping linked group ${gId}:`, gErr.message);
          }
        }
      }
    }

    const finalStatus = cancelSignal.cancelled ? 'stopped' : 'completed';
    db.prepare(`UPDATE scrape_jobs SET status = ?, total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      finalStatus,
      scrapedCount,
      scrapedCount,
      jobId
    );

    console.log(`[FB Scraper] Job #${jobId} finished with status: ${finalStatus}. Total leads collected: ${scrapedCount}`);

  } catch (error: any) {
    console.error(`[FB Scraper] Fatal error executing job #${jobId}:`, error);
    db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      error.message || 'Lỗi không xác định trong quá trình cào dữ liệu.',
      jobId
    );
    } finally {
      activeJobSignals.delete(jobId);
      if (browserContext) {
        try {
          await browserContext.close();
        } catch {}
      }
    }
  });
}
