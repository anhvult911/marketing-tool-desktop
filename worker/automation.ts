import { chromium as baseChromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { NetworkScraperEngine } from './network-scraper';
import { PROFILES_DIR } from '../src/lib/paths';
import { launchRobustPersistentContext } from '../src/lib/browser-launcher';
import { killProfileProcesses } from '../src/lib/profile-lock';
import { getRealUserAgentSync } from '../src/lib/user-agent';

export { killProfileProcesses };

// Tự động phát hiện và fallback trình duyệt Playwright sang Edge hoặc Chrome hệ thống nếu thiếu Chromium
const chromium = {
  ...baseChromium,
  launchPersistentContext: (userDataDir: string, options?: any) => {
    return launchRobustPersistentContext(userDataDir, options);
  },
};


export async function dismissFacebookOverlays(page: any) {
  try {
    const dialogSelectors = [
      // Cookie consent buttons (VI & EN)
      'button:has-text("Cho phép tất cả cookie")',
      'button:has-text("Allow all cookies")',
      'button:has-text("Chấp nhận tất cả")',
      'button:has-text("Accept all")',
      'button:has-text("Chỉ cho phép các cookie cần thiết")',
      'button:has-text("Decline optional cookies")',
      'button:has-text("Only allow essential cookies")',
      'button:has-text("Đồng ý với tất cả")',
      'button:has-text("Agree to all")',
      // Login prompt dismissals & Not now
      'div[role="dialog"] div[aria-label="Đóng"]',
      'div[role="dialog"] div[aria-label="Close"]',
      'div[role="dialog"] [aria-label="Đóng"]',
      'div[role="dialog"] [aria-label="Close"]',
      'div[aria-label="Đóng"]',
      'div[aria-label="Close"]',
      'button:has-text("Không phải bây giờ")',
      'button:has-text("Not now")',
      'div[role="button"]:has-text("Không phải bây giờ")',
      'div[role="button"]:has-text("Not now")',
      'div[role="banner"] [aria-label="Đóng"]',
      'div[role="banner"] [aria-label="Close"]'
    ];
    for (const sel of dialogSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        const isVisible = await btn.isVisible().catch(() => false);
        if (isVisible) {
          await btn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(300);
        }
      }
    }
  } catch (e) {}
}

export async function handleFacebookCheckpoints(page: any) {
  try {
    const url = page.url();
    if (!url.includes('facebook.com')) return;

    await dismissFacebookOverlays(page);

    const selectors = [
      'button:has-text("Bỏ qua")',
      '[role="button"]:has-text("Bỏ qua")',
      'span:has-text("Bỏ qua")',
      'button:has-text("Dismiss")',
      '[role="button"]:has-text("Dismiss")',
      'span:has-text("Dismiss")',
      'button:has-text("Tin cậy thiết bị này")',
      '[role="button"]:has-text("Tin cậy thiết bị này")',
      'button:has-text("Trust this device")',
      '[role="button"]:has-text("Trust this device")',
      'button:has-text("Tiếp tục")',
      '[role="button"]:has-text("Tiếp tục")',
      'button:has-text("Continue")',
      '[role="button"]:has-text("Continue")',
      'button:has-text("Lưu trình duyệt")',
      '[role="button"]:has-text("Lưu trình duyệt")',
      'button:has-text("Save Browser")',
      '[role="button"]:has-text("Save Browser")',
      'button:has-text("Tôi đã hiểu")',
      '[role="button"]:has-text("Tôi đã hiểu")',
      'button:has-text("Okay")',
      '[role="button"]:has-text("Okay")'
    ];

    for (const selector of selectors) {
      const btn = await page.$(selector);
      if (btn) {
        const isVisible = await btn.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`[Facebook] Found checkpoint/trust button: "${selector}". Clicking to dismiss.`);
          await btn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(3000);
          return;
        }
      }
    }

    // Fallback evaluate click
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a[role="button"], span'));
      for (const b of buttons) {
        const t = (b.textContent || '').trim().toLowerCase();
        if (t === 'bỏ qua' || t === 'dismiss' || t === 'tôi đã hiểu' || t === 'tiếp tục' || t === 'continue' || t === 'okay') {
          (b as HTMLElement).click();
          return;
        }
      }
    }).catch(() => {});
  } catch (err: any) {
    console.warn(`[Facebook] Non-fatal error while handling checkpoints:`, err.message);
  }
}

// Setup directories
const SCREENSHOT_DIR = path.join(PROFILES_DIR, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Helper to convert simple markdown to HTML for Telegram Web injection
export function markdownToHtml(text: string): string {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Bold: **text** or __text__ -> <b>text</b>
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__(.*?)__/g, '<b>$1</b>');
  
  // Italic: *text* or _text_ -> <i>text</i>
  html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
  html = html.replace(/_(.*?)_/g, '<i>$1</i>');
  
  // Links: [text](url) -> <a href="$2">$1</a>
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
  
  // Newlines -> <br>
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol?: string;
}

interface AccountConfig {
  username: string;
  password?: string;
  email?: string;
  user_data_dir: string;
  auth_token?: string;
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export function parseCookiesToPlaywright(rawInput: string, defaultDomain: string): PlaywrightCookie[] {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return [];

  let domain = defaultDomain.startsWith('.') ? defaultDomain : '.' + defaultDomain;

  // 1. Try parsing JSON array
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((c: any) => {
          let cDomain = c.domain || domain;
          if (!cDomain.startsWith('.') && !cDomain.includes(':')) cDomain = '.' + cDomain;
          let sameSite: 'Strict' | 'Lax' | 'None' = 'None';
          if (c.sameSite === 'lax' || c.sameSite === 'Lax') sameSite = 'Lax';
          else if (c.sameSite === 'strict' || c.sameSite === 'Strict') sameSite = 'Strict';

          return {
            name: String(c.name || '').trim(),
            value: String(c.value !== undefined ? c.value : '').trim(),
            domain: cDomain,
            path: c.path || '/',
            httpOnly: !!c.httpOnly,
            secure: c.secure !== undefined ? !!c.secure : true,
            sameSite
          };
        }).filter(c => c.name && c.value !== undefined);
      }
    } catch (e) {}
  }

  // 2. Otherwise parse string format: c_user=...; xs=...; or newline separated
  const cookies: PlaywrightCookie[] = [];
  const pairs = trimmed.split(/[\r\n;]+/).map(p => p.trim()).filter(Boolean);
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      const name = pair.substring(0, eqIdx).trim();
      const value = pair.substring(eqIdx + 1).trim();
      if (name) {
        cookies.push({
          name,
          value,
          domain,
          path: '/',
          httpOnly: name === 'xs' || name === 'datr' || name === 'sb' || name === 'auth_token',
          secure: true,
          sameSite: 'None'
        });
      }
    }
  }
  return cookies;
}

// Helper to extract c_user ID from cookie string or auth token
export function extractCUserFromAuthToken(authToken?: string): string | null {
  if (!authToken) return null;
  const m = authToken.match(/c_user=([0-9]{5,25})/);
  if (m) return m[1];
  try {
    const parsed = JSON.parse(authToken);
    if (Array.isArray(parsed)) {
      const cUser = parsed.find((c: any) => c.name === 'c_user');
      if (cUser && cUser.value && /^\d+$/.test(cUser.value.toString())) {
        return cUser.value.toString();
      }
    }
  } catch (e) {}
  return null;
}

// Helper to populate all identifiers of the active live account into selfIdentifiers blacklist
export async function populateLiveAccountSelfIdentifiers(
  context: BrowserContext | null,
  account: AccountConfig,
  selfIdentifiers: Set<string>
) {
  if (account.username) {
    selfIdentifiers.add(account.username.toLowerCase());
    if (account.username.includes('@')) {
      selfIdentifiers.add(account.username.split('@')[0].toLowerCase());
    }
  }
  const tokenCUser = extractCUserFromAuthToken(account.auth_token);
  if (tokenCUser) {
    selfIdentifiers.add(tokenCUser.toLowerCase());
  }
  if (context) {
    try {
      const cookies = await context.cookies();
      const cUser = cookies.find(c => c.name === 'c_user');
      if (cUser && cUser.value && /^\d+$/.test(cUser.value)) {
        selfIdentifiers.add(cUser.value.toLowerCase());
      }
    } catch (e) {}
  }
}

// Helper to extract target entity ID(s) and display name to blacklist the target account itself
export async function extractFacebookTargetMetadata(
  page: Page,
  targetUrl: string
): Promise<{ targetIds: string[]; targetDisplayName: string }> {
  const targetIds: string[] = [];
  let targetDisplayName = '';

  try {
    const parsed = await page.evaluate(() => {
      const ids: string[] = [];
      let displayName = '';

      // 1. Meta tags
      const metaAndroid = document.querySelector('meta[property="al:android:url"]')?.getAttribute('content') || '';
      const metaIos = document.querySelector('meta[property="al:ios:url"]')?.getAttribute('content') || '';
      const mAndroid = metaAndroid.match(/fb:\/\/(?:profile|page|group|user)\/(\d+)/i) || metaAndroid.match(/(\d{5,25})/);
      if (mAndroid) ids.push(mAndroid[1]);
      const mIos = metaIos.match(/fb:\/\/(?:profile|page|group|user)\/(\d+)/i) || metaIos.match(/(\d{5,25})/);
      if (mIos) ids.push(mIos[1]);

      // 2. OpenGraph / Title / Header
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';
      displayName = (h1 || ogTitle || document.title || '').replace(/\s*\|\s*Facebook.*$/i, '').trim();

      // 3. Current URL parsing
      const url = window.location.href;
      if (url.includes('profile.php?id=')) {
        try {
          const u = new URL(url);
          const id = u.searchParams.get('id');
          if (id) ids.push(id);
        } catch (e) {}
      }
      const peopleMatch = url.match(/\/people\/[^\/]+\/(\d+)/);
      if (peopleMatch) ids.push(peopleMatch[1]);

      // 4. Inlined script tags
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '').join('\n');
      const entityMatch = scripts.match(/"entity_id"\s*:\s*"(\d{5,25})"/);
      if (entityMatch) ids.push(entityMatch[1]);
      const pageIdMatch = scripts.match(/"pageID"\s*:\s*"(\d{5,25})"/);
      if (pageIdMatch) ids.push(pageIdMatch[1]);
      const targetUserIdMatch = scripts.match(/"userID"\s*:\s*"(\d{5,25})"/);
      if (targetUserIdMatch) ids.push(targetUserIdMatch[1]);

      return {
        ids: Array.from(new Set(ids)),
        displayName
      };
    }).catch(() => ({ ids: [], displayName: '' }));

    if (parsed.ids) targetIds.push(...parsed.ids);
    if (parsed.displayName) targetDisplayName = parsed.displayName;
  } catch (e) {}

  // Also parse from targetUrl string
  if (targetUrl) {
    const clean = targetUrl.trim();
    if (clean.includes('profile.php?id=')) {
      try {
        const u = new URL(clean);
        const id = u.searchParams.get('id');
        if (id) targetIds.push(id);
      } catch (e) {}
    }
    const peopleMatch = clean.match(/\/people\/[^\/]+\/(\d+)/);
    if (peopleMatch) targetIds.push(peopleMatch[1]);
    const numMatch = clean.match(/facebook\.com\/(\d{5,25})/);
    if (numMatch) targetIds.push(numMatch[1]);

    const parts = clean.split('?')[0].split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart !== 'followers' && lastPart !== 'members') {
      targetIds.push(lastPart);
    }
    if (parts.length >= 2) {
      targetIds.push(parts[parts.length - 2]);
    }
  }

  return {
    targetIds: Array.from(new Set(targetIds.filter(Boolean))),
    targetDisplayName
  };
}

// Helper to determine if target is a specific single Post/Photo/Reel link
export function isDirectFacebookPostUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('/photo') ||
    lower.includes('/posts/') ||
    lower.includes('/permalink') ||
    lower.includes('/story.php') ||
    lower.includes('story_fbid=') ||
    lower.includes('fbid=') ||
    lower.includes('pfbid') ||
    lower.includes('/reel/') ||
    lower.includes('/reels/') ||
    lower.includes('/watch')
  );
}

// Helper to normalize Facebook target string to full standard URL
export function normalizeFacebookTargetUrl(target: string): string {
  if (!target) return '';
  let clean = target.trim().replace(/^@/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    if (/^\d+$/.test(clean)) {
      clean = `https://www.facebook.com/profile.php?id=${clean}`;
    } else {
      clean = `https://www.facebook.com/${clean}`;
    }
  }
  return clean.replace(/\/$/, '');
}

// Helper to inject advanced stealth evasions (hardware emulation, WebGL, Chrome runtime) into Playwright BrowserContext
export async function applyStealthToContext(context: BrowserContext) {
  try {
    await context.addInitScript(() => {
      // 1. Hide navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 2. Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['vi-VN', 'vi', 'en-US', 'en'],
      });

      // 3. KHÔNG mock navigator.plugins — mock thiếu PluginArray interface thật
      // (item/namedItem) là detection vector. Trên Windows Chrome thật có PDF plugin
      // sẵn; tín hiệu thật mạnh hơn giả.


      // 4. Mock window.chrome runtime
      if (!(window as any).chrome) {
        (window as any).chrome = {
          app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
          runtime: {
            OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
            OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
            PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
            RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
          },
          loadTimes: function() {},
          csi: function() {}
        };
      }

      // 5. Spoof WebGL Vendor and Renderer (NVIDIA Direct3D11)
      try {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
          if (parameter === 37445) return 'Google Inc. (NVIDIA)';
          if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
          return getParameter.apply(this, [parameter]);
        };

        if (typeof WebGL2RenderingContext !== 'undefined') {
          const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function(parameter: number) {
            if (parameter === 37445) return 'Google Inc. (NVIDIA)';
            if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return getParameter2.apply(this, [parameter]);
          };
        }
      } catch (e) {}

      // 6. Mock hardware concurrency & device memory
      try {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      } catch (e) {}

      // 7. Mock Permissions
      try {
        if (window.navigator?.permissions?.query) {
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (parameters: any) => (
            parameters?.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission } as any) :
              originalQuery(parameters)
          );
        }
      } catch (e) {}
    });
  } catch (e) {}
}

// Helper to inject cookies if available into Playwright BrowserContext
export async function injectCookiesIfAvailable(context: BrowserContext, account: AccountConfig, defaultDomain: string = '.facebook.com') {
  // Apply stealth evasions on every context
  await applyStealthToContext(context);

  if (account.auth_token) {
    const cookies = parseCookiesToPlaywright(account.auth_token, defaultDomain);
    if (cookies.length > 0) {
      try {
        await context.addCookies(cookies);
        console.log(`[Automation] Injected ${cookies.length} session cookies for @${account.username}`);
      } catch (e: any) {
        console.warn(`[Automation] Failed to inject cookies for @${account.username}:`, e.message);
      }
    }
  }
}

// Helper to isolate Facebook DOM by completely hiding personal contacts, chat docks and navigation sidebars
export async function injectFacebookIsolationStyles(page: Page) {
  try {
    await page.addStyleTag({
      content: `
        div[role="complementary"],
        div[aria-label*="Người liên hệ"],
        div[aria-label*="Contacts"],
        div[aria-label*="Cuộc trò chuyện"],
        div[aria-label*="Chat"],
        div[data-pagelet*="RightRail"],
        div[data-pagelet*="Chat"],
        #BuddylistPagelet,
        div[role="navigation"] {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
          opacity: 0 !important;
          height: 0 !important;
          width: 0 !important;
        }
      `
    }).catch(() => {});
  } catch (e) {}
}

// Helper to attach real-time Facebook GraphQL network interceptor
export function attachFacebookGraphQLInterceptor(
  page: Page,
  selfIdentifiers: Set<string>,
  members: Map<string, { uid: string; displayName: string; avatarUrl: string }>,
  onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
) {
  let lastStreamSize = members.size;
  const handler = async (response: any) => {
    try {
      const url = response.url();
      if (!url.includes('/graphql') && !url.includes('/api/graphql/')) return;

      // Filter out non-target viewer background queries (Left rail, Chat, Notifications, Bookmarks, HomeFeed, FriendSuggestions, Presence, Contacts, Stories, Mercury)
      const postData = response.request()?.postData() || '';
      if (
        postData.includes('CometLeftRail') ||
        postData.includes('CometNotifications') ||
        postData.includes('CometChat') ||
        postData.includes('CometHome') ||
        postData.includes('Bookmarks') ||
        postData.includes('Stories') ||
        postData.includes('FriendSuggestions') ||
        postData.includes('Gemini') ||
        postData.includes('Friending') ||
        postData.includes('CometTopContacts') ||
        postData.includes('Presence') ||
        postData.includes('PresenceStatus') ||
        postData.includes('Mercury') ||
        postData.includes('Buddylist') ||
        postData.includes('ChatRoster') ||
        postData.includes('Messenger') ||
        postData.includes('Notification') ||
        postData.includes('NotificationTray') ||
        postData.includes('RightRail') ||
        postData.includes('ChatTab') ||
        postData.includes('MWChat') ||
        postData.includes('MWPresence') ||
        postData.includes('CometMediaViewer') ||
        postData.includes('CometNewsFeed') ||
        postData.includes('NewsFeed') ||
        postData.includes('SearchTypeahead') ||
        postData.includes('Jewel')
      ) {
        return;
      }

      const text = await response.text().catch(() => '');
      if (!text || (!text.includes('"id"') && !text.includes('profile_picture') && !text.includes('actor') && !text.includes('node') && !text.includes('user'))) return;

      const tryParse = (chunk: string) => {
        try {
          const json = JSON.parse(chunk);
          // Group Members
          const grpLeads = NetworkScraperEngine.parseFacebookGroupMembersResponse(json);
          for (const l of grpLeads.leads) {
            const uid = (l.metadata?.id || l.lead_value.split('/').pop() || '').toString();
            if (uid && !selfIdentifiers.has(uid.toLowerCase()) && !members.has(uid)) {
              members.set(uid, { uid, displayName: l.display_name || 'Facebook User', avatarUrl: l.avatar_url || '' });
            }
          }
          // Followers / Subscribers
          const subLeads = NetworkScraperEngine.parseFacebookSubscribersResponse(json);
          for (const l of subLeads.leads) {
            const uid = (l.metadata?.id || l.lead_value.split('/').pop() || '').toString();
            if (uid && !selfIdentifiers.has(uid.toLowerCase()) && !members.has(uid)) {
              members.set(uid, { uid, displayName: l.display_name || 'Facebook User', avatarUrl: l.avatar_url || '' });
            }
          }
          // Reactors
          const rxLeads = NetworkScraperEngine.parseFacebookPostReactionsResponse(json);
          for (const l of rxLeads.leads) {
            const uid = (l.metadata?.id || l.lead_value.split('/').pop() || '').toString();
            if (uid && !selfIdentifiers.has(uid.toLowerCase()) && !members.has(uid)) {
              members.set(uid, { uid, displayName: l.display_name || 'Facebook User', avatarUrl: l.avatar_url || '' });
            }
          }
          // Comments
          const cmtLeads = NetworkScraperEngine.parseFacebookPostCommentsResponse(json);
          for (const l of cmtLeads.leads) {
            const uid = (l.lead_value.split('/').pop() || '').toString();
            if (uid && !selfIdentifiers.has(uid.toLowerCase()) && !members.has(uid)) {
              members.set(uid, { uid, displayName: l.display_name || 'Facebook User', avatarUrl: l.avatar_url || '' });
            }
          }
        } catch (e) {}
      };

      if (text.includes('\n{"')) {
        text.split('\n').forEach((line: string) => {
          if (line.trim().startsWith('{')) tryParse(line.trim());
        });
      } else {
        tryParse(text);
      }

      // Stream incremental leads to database
      if (members.size - lastStreamSize >= 20 && onMembersScraped) {
        const unsaved = Array.from(members.values()).slice(lastStreamSize);
        await onMembersScraped(unsaved).catch(() => {});
        lastStreamSize = members.size;
      }
    } catch (e) {}
  };

  page.on('response', handler);
  return () => page.off('response', handler);
}

// Helper to configure browser launch options
export function getLaunchOptions(account: AccountConfig, proxy?: ProxyConfig) {
  const options: any = {
    headless: true,
    viewport: { width: 1366, height: 768 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    extraHTTPHeaders: {
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    // UA thật của binary (gỡ token HeadlessChrome, khớp version). Cache được
    // populate bởi getRealUserAgent() nơi async được phép; fallback nếu chưa.
    userAgent: getRealUserAgentSync(),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--lang=vi-VN,vi,en-US,en',
      '--js-flags=--max-old-space-size=2048'
    ]
  };

  if (proxy) {
    const proto = proxy.protocol || 'http';
    options.proxy = {
      server: `${proto}://${proxy.host}:${proxy.port}`
    };
    if (proxy.username && proxy.password) {
      options.proxy.username = proxy.username;
      options.proxy.password = proxy.password;
    }
  }

  return options;
}

// Helper to check if logged in
export async function checkLoginState(page: Page): Promise<boolean> {
  try {
    // Wait up to 5s to check if we are on X homepage logged in
    await page.waitForSelector('[data-testid="SideNav_NewTweet_Button"]', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Helper to dismiss common X overlays (e.g. phone/email review prompts)
export async function dismissOverlays(page: Page) {
  try {
    const yesSelectors = [
      'button:has-text("Yes, that is my number")',
      'button:has-text("Yes, that\'s my number")',
      'button:has-text("Yes, that is my email")',
      'button:has-text("Yes, that\'s my email")',
      'button:has-text("Đúng, đó là số của tôi")',
      'button:has-text("Đúng, đó là email của tôi")',
      'span:has-text("Yes, that is my number")',
      'span:has-text("Yes, that\'s my number")',
      'span:has-text("Yes, that is my email")',
      'span:has-text("Yes, that\'s my email")',
      'span:has-text("Đúng, đó là số của tôi")',
      'span:has-text("Đúng, đó là email của tôi")'
    ];

    for (const selector of yesSelectors) {
      const btn = await page.$(selector);
      if (btn) {
        const isVisible = await btn.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`[X] Found overlay verification button: "${selector}". Clicking to dismiss.`);
          await btn.click({ force: true });
          await page.waitForTimeout(2000);
          return;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[X] Non-fatal error while dismissing overlays:`, err.message);
  }
}

// Save screenshot on error
async function saveErrorScreenshot(page: Page, username: string, name: string) {
  try {
    if (!page || page.isClosed()) return;
    const filePath = path.join(SCREENSHOT_DIR, `${username}_${name}_error.png`);
    await page.screenshot({ path: filePath, timeout: 5000 }).catch(() => {});
    console.log(`Saved error screenshot: ${filePath}`);
  } catch (err) {
    console.error('Failed to save screenshot:', err);
  }
}

// X automation script class
export class XAutomation {
  static async checkLive(account: AccountConfig, proxy?: ProxyConfig): Promise<'live' | 'checkpoint' | 'die'> {
    console.log(`[X] Checking account status for @${account.username}...`);
    let context: BrowserContext | null = null;
    
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      
      if (account.auth_token) {
        console.log(`[X] Injecting auth_token cookie for @${account.username}...`);
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
      
      const page = await context.newPage();
      
      // Navigate to X Home
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissOverlays(page);
      
      // Check login state
      const isLoggedIn = await checkLoginState(page);
      if (isLoggedIn) {
        console.log(`[X] @${account.username} is LIVE`);
        await context.close();
        return 'live';
      }

      // If not logged in, attempt login if credentials exist
      if (account.password) {
        console.log(`[X] @${account.username} not logged in. Attempting auto login...`);
        const loginSuccess = await this.performLogin(page, account);
        if (loginSuccess) {
          await context.close();
          return 'live';
        }
        
        // Login failed, check where we are now
        const pageUrl = page.url();
        if (pageUrl.includes('checkpoint') || pageUrl.includes('verify')) {
          console.log(`[X] @${account.username} is at CHECKPOINT`);
          await saveErrorScreenshot(page, account.username, 'checkpoint');
          await context.close();
          return 'checkpoint';
        }
        
        console.log(`[X] @${account.username} login failed, assuming DIE`);
        await saveErrorScreenshot(page, account.username, 'login_failed');
        await context.close();
        return 'die';
      }

      // If no credentials, check if we are currently at checkpoint or landing page
      const pageUrl = page.url();
      if (pageUrl.includes('checkpoint') || pageUrl.includes('verify')) {
        console.log(`[X] @${account.username} is at CHECKPOINT (No credentials)`);
        await saveErrorScreenshot(page, account.username, 'checkpoint');
        await context.close();
        return 'checkpoint';
      }

      console.log(`[X] @${account.username} requires login but no credentials provided (DIE)`);
      await saveErrorScreenshot(page, account.username, 'unauthorized');
      await context.close();
      return 'die';

    } catch (error: any) {
      console.error(`[X] Error checking account @${account.username}:`, error.message);
      if (context) await context.close();
      return 'die';
    }
  }

  static async performLogin(page: Page, account: AccountConfig): Promise<boolean> {
    try {
      await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // 1. Enter Username/Phone/Email
      const usernameInput = await page.waitForSelector('input[autocomplete*="username"], input[name="username_or_email"], input[name="text"]', { timeout: 15000 });
      await usernameInput.click({ force: true });
      await page.keyboard.type(account.username, { delay: 100 });
      await page.click('button:has-text("Next"), span:has-text("Next"), button:has-text("Continue"), span:has-text("Continue"), button:has-text("Tiếp tục"), span:has-text("Tiếp tục")', { force: true });
      
      // Wait a bit
      await page.waitForTimeout(2000);

      // Check if X asks for email verification (for security) before password
      const securityCheck = await page.$('input[data-testid="ocfEnterTextTextInput"]');
      if (securityCheck) {
        const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
        if (pageText.includes('code') || pageText.includes('mã') || pageText.includes('verification') || pageText.includes('otp')) {
          console.log(`[X] OTP/Verification code requested for @${account.username}. Pausing automation for manual entry...`);
          // Wait up to 60s for the user to input the code and submit manually, or until the input field disappears
          await page.waitForFunction(() => !document.querySelector('input[data-testid="ocfEnterTextTextInput"]'), { timeout: 60000 }).catch(() => {});
        } else if (account.email) {
          console.log(`[X] Security verification triggered for @${account.username}. Entering email...`);
          await securityCheck.click({ force: true });
          await page.keyboard.type(account.email, { delay: 100 });
          await page.click('button:has-text("Next"), span:has-text("Next"), button:has-text("Continue"), span:has-text("Continue"), button:has-text("Tiếp tục"), span:has-text("Tiếp tục")', { force: true });
          await page.waitForTimeout(2000);
        }
      }

      // 2. Enter Password
      const passwordInput = await page.waitForSelector('input[name="password"]', { timeout: 10000 });
      await passwordInput.click({ force: true });
      if (account.password) {
        await page.keyboard.type(account.password, { delay: 100 });
      }
      await page.click('button:has-text("Log in"), span:has-text("Log in"), button[data-testid="LoginForm_Login_Button"], button:has-text("Đăng nhập"), span:has-text("Đăng nhập")', { force: true });
      
      // 3. Wait for login completion
      await page.waitForTimeout(5000);
      const loggedIn = await checkLoginState(page);
      if (loggedIn) {
        console.log(`[X] Successfully logged in to @${account.username}`);
        return true;
      }
      
      await saveErrorScreenshot(page, account.username, 'login_failed');
      return false;
    } catch (err: any) {
      console.error(`[X] Auto login failed for @${account.username}:`, err.message);
      await saveErrorScreenshot(page, account.username, 'login_error');
      return false;
    }
  }

  static async post(account: AccountConfig, proxy: ProxyConfig | undefined, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    console.log(`[X] Posting as @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      
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
      
      page = await context.newPage();
      
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await dismissOverlays(page);
      
      const isLoggedIn = await checkLoginState(page);
      if (!isLoggedIn) {
        throw new Error('Tài khoản chưa được đăng nhập.');
      }

      // Go directly to compose post page
      await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 20000 });
      
      // Wait for compose modal dialog to be visible in DOM
      await page.waitForSelector('div[role="dialog"]:visible', { timeout: 15000 });
      await page.waitForTimeout(2000); // Wait for React to finish rendering overlays
      await dismissOverlays(page);

      // Upload media if present
      if (mediaPaths && mediaPaths.length > 0) {
        console.log(`[X] Attaching ${mediaPaths.length} media file(s) to post...`);
        const absolutePaths = mediaPaths.map(p => {
          if (fs.existsSync(p)) return p;
          const cleanRelative = p.startsWith('/') ? p.substring(1) : p;
          return path.join(process.cwd(), 'public', cleanRelative);
        });

        // Verify all media files exist
        for (const absPath of absolutePaths) {
          if (!fs.existsSync(absPath)) {
            console.error(`[X] Media file not found: ${absPath}`);
            throw new Error(`Tệp tin đính kèm không tồn tại trên máy chủ: ${path.basename(absPath)}`);
          }
        }

        const fileInput = await page.waitForSelector('div[role="dialog"]:visible input[data-testid="fileInput"]', { timeout: 15000 });
        await fileInput.setInputFiles(absolutePaths);
        console.log('[X] Uploading media file(s) to X...');
        await page.waitForTimeout(4000); // Wait for upload to start
      }

      // Locate textbox inside dialog modal
      const textBox = await page.waitForSelector('div[role="dialog"]:visible div[data-testid="tweetTextarea_0"], div[role="dialog"]:visible div[role="textbox"]', { timeout: 15000 });
      await textBox.focus();
      await textBox.click({ force: true });
      await page.keyboard.type(content, { delay: 50 }); // Type with human-like delay
      await page.waitForTimeout(2000);

      // Wait for post button to load in DOM
      const postBtn = await page.waitForSelector('div[role="dialog"]:visible button[data-testid="tweetButton"]', { timeout: 15000 });
      
      // Wait up to 30s if media is present, or 5s if text only, for validation to clear and button to become enabled
      let postEnabled = false;
      const maxIterations = (mediaPaths && mediaPaths.length > 0) ? 60 : 10;
      for (let i = 0; i < maxIterations; i++) {
        const isAriaDisabled = await postBtn.getAttribute('aria-disabled');
        const isDisabled = await postBtn.isDisabled();
        if (isAriaDisabled !== 'true' && !isDisabled) {
          postEnabled = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      
      if (!postEnabled) {
        throw new Error('Nút đăng bài bị vô hiệu hóa (Disabled). Có thể nội dung vượt quá giới hạn 280 ký tự của X hoặc tài khoản bị hạn chế.');
      }
      
      await postBtn.click({ force: true });
      
      // Wait for success: the compose modal should close, meaning the post button inside dialog should disappear.
      console.log('[X] Clicked post button. Waiting for modal to close...');
      await page.waitForSelector('div[role="dialog"]:visible button[data-testid="tweetButton"]', { state: 'detached', timeout: 10000 });
      console.log('[X] Compose modal closed successfully.');
      await page.waitForTimeout(2000);
      
      // Save screenshot for post verification
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_post_success.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      console.log(`Saved post success screenshot: ${successScreenshotPath}`);

      // Try to get the post URL from profile timeline
      let postUrl = '';
      try {
        await page.goto(`https://x.com/${account.username}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        const tweetLink = await page.waitForSelector('article[data-testid="tweet"] a[href*="/status/"]', { timeout: 10000 });
        if (tweetLink) {
          const href = await tweetLink.getAttribute('href');
          if (href) {
            postUrl = href.startsWith('http') ? href : `https://x.com${href}`;
            console.log(`[X] Found posted tweet URL: ${postUrl}`);
          }
        }
      } catch (err: any) {
        console.warn(`[X] Could not retrieve tweet URL from profile timeline:`, err.message);
      }

      console.log(`[X] Successfully posted as @${account.username}`);
      await context.close();
      return postUrl || true;

    } catch (error: any) {
      console.error(`[X] Failed to post as @${account.username}:`, error.message);
      if (context) {
        const errorPage = page || (await context.pages()).find(p => p.url() !== 'about:blank') || (await context.pages())[0];
        if (errorPage) await saveErrorScreenshot(errorPage, account.username, 'post_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async comment(account: AccountConfig, proxy: ProxyConfig | undefined, targetUrl: string, content: string): Promise<boolean | string> {
    console.log(`[X] Commenting as @${account.username} on ${targetUrl}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      
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
      
      page = await context.newPage();
      
      // Go directly to target post
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Wait for the main tweet detail timeline/article to render
      await page.waitForSelector('article', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000); // Wait for React to finish rendering overlays
      await dismissOverlays(page);
      
      const isLoggedIn = await checkLoginState(page);
      if (!isLoggedIn) {
        throw new Error('Tài khoản chưa được đăng nhập.');
      }

      // Mimic human reading: Scroll down a bit
      await page.evaluate(() => window.scrollBy(0, 300));
      await page.waitForTimeout(1500);

      // Locate reply textbox
      const replyBox = await page.waitForSelector('div[data-testid="tweetTextarea_0"], div[role="textbox"]', { timeout: 15000 });
      await replyBox.focus();
      await replyBox.click({ force: true });
      await page.keyboard.type(content, { delay: 60 });
      await page.waitForTimeout(2000);

      // Wait for reply button to load in DOM
      const replyBtn = await page.waitForSelector('button[data-testid="tweetButtonInline"]', { timeout: 15000 });
      
      // Wait up to 5s for validation to clear and button to become enabled
      let replyEnabled = false;
      for (let i = 0; i < 10; i++) {
        const isAriaDisabled = await replyBtn.getAttribute('aria-disabled');
        const isDisabled = await replyBtn.isDisabled();
        if (isAriaDisabled !== 'true' && !isDisabled) {
          replyEnabled = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      
      if (!replyEnabled) {
        throw new Error('Nút trả lời bị vô hiệu hóa (Disabled). Có thể bình luận vượt quá giới hạn 280 ký tự của X hoặc tài khoản bị hạn chế.');
      }
      
      await replyBtn.click({ force: true });
      
      // Wait for comment to submit
      await page.waitForTimeout(5000);
      
      // Save screenshot for comment verification
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_comment_success.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      console.log(`Saved comment success screenshot: ${successScreenshotPath}`);

      console.log(`[X] Successfully commented as @${account.username}`);
      await context.close();
      return targetUrl;

    } catch (error: any) {
      console.error(`[X] Failed to comment as @${account.username}:`, error.message);
      if (context) {
        const errorPage = page || (await context.pages()).find(p => p.url() !== 'about:blank') || (await context.pages())[0];
        if (errorPage) await saveErrorScreenshot(errorPage, account.username, 'comment_failed');
        await context.close();
      }
      throw error;
    }
  }
}

// Zalo Web automation class
export class ZaloAutomation {
  static async checkLive(account: AccountConfig, proxy?: ProxyConfig): Promise<'live' | 'checkpoint' | 'die'> {
    console.log(`[Zalo] Checking account status for @${account.username}...`);
    let context: BrowserContext | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      const page = await context.newPage();
      await page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      const currentUrl = page.url();
      if (currentUrl.includes('chat.zalo.me') && !currentUrl.includes('login')) {
        console.log(`[Zalo] @${account.username} is LIVE`);
        await context.close();
        return 'live';
      }
      
      console.log(`[Zalo] @${account.username} requires login (DIE)`);
      await context.close();
      return 'die';
    } catch (error: any) {
      console.error(`[Zalo] Error checking @${account.username}:`, error.message);
      if (context) await context.close();
      return 'die';
    }
  }

  static async sendMessage(account: AccountConfig, proxy: ProxyConfig | undefined, targetPhone: string, content: string): Promise<boolean | string> {
    console.log(`[Zalo] Sending message to ${targetPhone} from @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();
      
      await page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
      
      const currentUrl = page.url();
      if (currentUrl.includes('login')) {
        throw new Error('Tài khoản Zalo chưa được đăng nhập. Hãy đăng nhập thủ công trước.');
      }
      
      // 1. Search for phone number
      console.log(`[Zalo] Searching for phone number: ${targetPhone}...`);
      const searchBox = await page.waitForSelector('input[placeholder*="Tìm"], input[placeholder*="search"], #contact-search-input', { timeout: 15000 });
      await searchBox.focus();
      await searchBox.click({ force: true });
      await page.keyboard.type(targetPhone, { delay: 100 });
      await page.waitForTimeout(3000);
      
      // 2. Click on the first search result
      console.log('[Zalo] Selecting search result...');
      const firstResult = await page.waitForSelector('.search-list-item, .contact-item, div[class*="item"]', { timeout: 10000 });
      if (!firstResult) {
        throw new Error(`Không tìm thấy kết quả tìm kiếm cho SĐT ${targetPhone} trên Zalo.`);
      }
      await firstResult.click({ force: true });
      await page.waitForTimeout(2000);
      
      // 3. Click inside chat textbox
      console.log('[Zalo] Typing message...');
      const chatInput = await page.waitForSelector('#chat-input, div[rich-editor-content], div[role="textbox"]', { timeout: 10000 });
      await chatInput.focus();
      await chatInput.click({ force: true });
      await page.keyboard.type(content, { delay: 60 });
      await page.waitForTimeout(1000);
      
      // 4. Press enter to send
      await page.keyboard.press('Enter');
      console.log('[Zalo] Message sent.');
      await page.waitForTimeout(3000);
      
      // Screenshot confirmation
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_zalo_sent.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      
      await context.close();
      return 'https://chat.zalo.me/';
    } catch (error: any) {
      console.error(`[Zalo] Send message failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'zalo_message_failed');
        await context.close();
      }
      throw error;
    }
  }
}

// Telegram Web automation class
export class TelegramAutomation {
  static async checkLive(account: AccountConfig, proxy?: ProxyConfig): Promise<'live' | 'checkpoint' | 'die'> {
    console.log(`[Telegram] Checking account status for @${account.username}...`);
    let context: BrowserContext | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      const page = await context.newPage();
      await page.goto('https://web.telegram.org/a/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(5000);
      
      try {
        // Wait up to 10s to see if search input or chat items appear (logged in)
        await page.waitForSelector('input[placeholder*="Search"], input.search-input, #telegram-search-input, .chat-list', { timeout: 10000 });
        console.log(`[Telegram] @${account.username} is LIVE`);
        await context.close();
        return 'live';
      } catch {
        console.log(`[Telegram] @${account.username} requires login (DIE)`);
        await context.close();
        return 'die';
      }
    } catch (error: any) {
      console.error(`[Telegram] Error checking @${account.username}:`, error.message);
      if (context) await context.close();
      return 'die';
    }
  }

  static parseTarget(target: string): { type: 'username' | 'invite' | 'phone' | 'id'; value: string; topicId?: string } {
    target = target.trim();
    
    // Check if it's a numeric Telegram ID (can be negative for groups/channels, e.g. -100123456, or positive for users)
    if (/^-?[0-9]{5,15}$/.test(target)) {
      return { type: 'id', value: target };
    }

    // Check if it's a phone number (digits only, optional + prefix, length 9 to 15)
    if (/^\+?[0-9]{9,15}$/.test(target)) {
      return { type: 'phone', value: target };
    }

    // Check for private group invite links
    // e.g. https://t.me/+abcde, t.me/joinchat/abcde, joinchat/abcde, or just +abcde
    const inviteRegex = /(?:t\.me\/joinchat\/|t\.me\/\+|joinchat\/|^[+])([a-zA-Z0-9_-]+)/;
    const inviteMatch = target.match(inviteRegex);
    if (inviteMatch) {
      return { type: 'invite', value: inviteMatch[1] };
    }

    // Match username but also capture any trailing subpath (like topic ID) separately
    const tMeMatch = target.match(/(?:t\.me\/|@)([a-zA-Z0-9_]{5,32})(?:\/([0-9]+))?/);
    if (tMeMatch) {
      return { type: 'username', value: tMeMatch[1], topicId: tMeMatch[2] };
    }

    // If it's a username with topic
    const withTopicMatch = target.match(/^([a-zA-Z0-9_]{5,32})\/([0-9]+)$/);
    if (withTopicMatch) {
      return { type: 'username', value: withTopicMatch[1], topicId: withTopicMatch[2] };
    }

    // If it's a pure username
    if (/^[a-zA-Z0-9_]{5,32}$/.test(target)) {
      return { type: 'username', value: target };
    }

    // Fallback: clean target of special characters and return as username
    const cleaned = target.replace(/^@/, '').replace(/https?:\/\/t\.me\//, '');
    const parts = cleaned.split('/');
    if (parts.length > 1 && /^\d+$/.test(parts[1])) {
      return { type: 'username', value: parts[0], topicId: parts[1] };
    }
    return { type: 'username', value: cleaned };
  }

  static async fetchGroupTitleFromInvite(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': getRealUserAgentSync()
        }
      });
      const html = await response.text();
      const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
      if (ogTitleMatch && ogTitleMatch[1]) {
        // Decode HTML entities if any
        return ogTitleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
      }
      // Fallback to <title>
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        let title = titleMatch[1].trim();
        title = title.replace(/\s*–\s*Telegram/i, '').replace(/:\s*Join\s*Group\s*Chat/i, '');
        return title.trim();
      }
    } catch (e: any) {
      console.warn(`[Telegram Scraper] Không thể fetch tiêu đề nhóm từ invite link: ${e.message}`);
    }
    return '';
  }

  static async sendMessage(account: AccountConfig, proxy: ProxyConfig | undefined, target: string, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    console.log(`[Telegram] Sending message to ${target} from @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();
      
      const parsed = TelegramAutomation.parseTarget(target);
      console.log(`[Telegram] Parsed target type: ${parsed.type}, value: ${parsed.value}`);
      
      console.log(`[Telegram] Navigating to main client: https://web.telegram.org/a/`);
      await page.goto('https://web.telegram.org/a/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);
      
      try {
        // Verify if we see logged-in elements
        await page.waitForSelector('input[placeholder*="Search"], input.search-input, #telegram-search-input, .chat-list', { timeout: 15000 });
      } catch {
        throw new Error('Tài khoản Telegram chưa được đăng nhập. Hãy đăng nhập thủ công trước.');
      }
      
      // Mở chat bằng cách thay đổi hash trực tiếp trong SPA Router
      const targetHash = parsed.type === 'invite' ? `+${parsed.value}` : parsed.value;
      console.log(`[Telegram] Activating SPA Router with hash: #${targetHash}`);
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, targetHash);
      await page.waitForTimeout(4000);
      
      // Kiểm tra xem chat đã mở thành công chưa
      let isChatOpened = false;
      const inputSelector = 'div[contenteditable="true"], div.input-message-input, #message-input';
      const hasInput = await page.$(inputSelector);
      if (hasInput && await hasInput.isVisible()) {
        isChatOpened = true;
      }
      
      // Thử hash fallback nếu là invite và chưa mở được
      if (!isChatOpened && parsed.type === 'invite') {
        const fallbackHash = `joinchat/${parsed.value}`;
        console.log(`[Telegram] Trying fallback hash: #${fallbackHash}`);
        await page.evaluate((hash) => {
          window.location.hash = hash;
        }, fallbackHash);
        await page.waitForTimeout(4000);
        
        const hasInput2 = await page.$(inputSelector);
        if (hasInput2 && await hasInput2.isVisible()) {
          isChatOpened = true;
        }
      }
      
      // Nếu vẫn chưa mở được và không phải là invite (ví dụ username/phone), thử Fallback Search
      if (!isChatOpened && parsed.type !== 'invite') {
        console.log(`[Telegram] Using fallback search for target: ${target}...`);
        const searchBox = await page.waitForSelector('input[placeholder*="Search"], input.search-input, #telegram-search-input', { timeout: 15000 });
        await searchBox.focus();
        await searchBox.click({ force: true });
        await searchBox.fill('');
        await page.keyboard.type(target, { delay: 100 });
        await page.waitForTimeout(3000);
        
        console.log('[Telegram] Clicking search result...');
        const firstResultLocator = page.locator('.search-results .ListItem-button, .SearchResults .ListItem-button, .search-result-item, .ListItem-button, .ListItem')
          .filter({ visible: true })
          .first();
        await firstResultLocator.waitFor({ timeout: 15000 });
        await firstResultLocator.click({ force: true });
        await page.waitForTimeout(2000);
      }

      // Resolve chat view, click join if group, handle error modal
      let isResolved = false;
      let hasError = false;
      let errorMsg = '';
      
      const startTime = Date.now();
      const timeout = 20000; // 20 seconds
      
      while (Date.now() - startTime < timeout) {
        // Check for message input (means we are inside the chat and can write)
        const hasInput = await page.$('div[contenteditable="true"], div.input-message-input, #message-input');
        if (hasInput && await hasInput.isVisible()) {
          isResolved = true;
          break;
        }
        
        // Check for Join button (e.g. for group or channel)
        const joinBtn = await page.$('button.join-btn, button.JoinButton, button:has-text("Join"), button:has-text("JOIN"), button:has-text("join"), button:has-text("Tham gia"), .join-channel-wrapper button, button:has-text("Join Group"), button:has-text("Join Channel")');
        if (joinBtn && await joinBtn.isVisible()) {
          console.log('[Telegram] Join button found, clicking it...');
          await joinBtn.click({ force: true });
          await page.waitForTimeout(3000);
          continue; // Recheck if input becomes visible
        }
        
        // Check for error modals (e.g., User not found, invalid invite link)
        const errorModal = await page.$('.modal-dialog, .Popup, .confirm-dialog');
        if (errorModal && await errorModal.isVisible()) {
          const text = await errorModal.textContent() || '';
          if (text.toLowerCase().includes('not found') || text.toLowerCase().includes('invalid') || text.toLowerCase().includes('expired') || text.toLowerCase().includes('không tìm thấy') || text.toLowerCase().includes('hợp lệ') || text.toLowerCase().includes('hết hạn')) {
            hasError = true;
            errorMsg = `Lỗi Telegram: ${text.trim()}`;
            break;
          }
        }
        
        await page.waitForTimeout(500);
      }

      if (hasError) {
        throw new Error(errorMsg);
      }
      
      if (!isResolved) {
        throw new Error('Không thể mở giao diện chat với mục tiêu (có thể link hết hạn, username không tồn tại, hoặc nhóm chỉ đọc/channel).');
      }
      
      const formattedHtml = markdownToHtml(content);

      if (mediaPaths && mediaPaths.length > 0) {
        console.log(`[Telegram] Attaching ${mediaPaths.length} media file(s)...`);
        const absolutePaths = mediaPaths.map(p => {
          if (fs.existsSync(p)) return p;
          const cleanRelative = p.startsWith('/') ? p.substring(1) : p;
          return path.join(process.cwd(), 'public', cleanRelative);
        });

        for (const absPath of absolutePaths) {
          if (!fs.existsSync(absPath)) {
            console.error(`[Telegram] Media file not found: ${absPath}`);
            throw new Error(`Tệp tin đính kèm không tồn tại trên máy chủ: ${path.basename(absPath)}`);
          }
        }

        // 1. Open the attachment menu
        console.log('[Telegram] Opening attachment menu...');
        const attachBtn = await page.waitForSelector('#attach-menu-button', { timeout: 10000 });
        await attachBtn.click({ force: true });
        await page.waitForTimeout(1000);

        // 2. Intercept the file chooser
        console.log('[Telegram] Setting up filechooser intercept...');
        const fileChooserPromise = page.waitForEvent('filechooser');
        
        // 3. Click "Photo or Video" option
        console.log('[Telegram] Clicking "Photo or Video" option...');
        await page.locator('div[role="menuitem"]', { hasText: 'Photo or Video' }).first().click({ force: true });
        
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(absolutePaths);
        console.log('[Telegram] Uploading media to Telegram Web...');
        await page.waitForTimeout(5000);

        console.log('[Telegram] Filling caption...');
        const captionInput = await page.waitForSelector(
          '.modal-dialog div[contenteditable="true"], ' +
          '.modal-dialog div[placeholder*="caption"], ' +
          '.modal-dialog div[placeholder*="thích"], ' +
          '.modal-dialog div[placeholder*="Caption"]', 
          { timeout: 15000 }
        );
        await captionInput.focus();
        await captionInput.click({ force: true });
        
        await captionInput.evaluate((el: any, html: string) => {
          el.innerHTML = html;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, formattedHtml);
        await page.waitForTimeout(1000);

        // Force React/Vue state sync by sending keyboard events
        await page.keyboard.press('End');
        await page.keyboard.type(' ');
        await page.waitForTimeout(500);
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(2000);

        console.log('[Telegram] Clicking send button in media popup...');
        const sendBtn = await page.waitForSelector(
          '.modal-dialog button.btn-primary, ' +
          '.modal-dialog button:has-text("Send"), ' +
          '.modal-dialog button:has-text("Gửi"), ' +
          '.modal-dialog button:has-text("GỬI"), ' +
          '.modal-dialog button.confirm-button, ' +
          '.modal-dialog button:has(.icon-new-send), ' +
          '.modal-dialog .icon-new-send', 
          { timeout: 15000 }
        );
        await sendBtn.click({ force: true });
        console.log('[Telegram] Media post sent. Waiting for upload completion...');
        await page.waitForTimeout(8000);
      } else {
        console.log('[Telegram] Sending rich text...');
        const messageInput = await page.waitForSelector('div[contenteditable="true"], div.input-message-input, #message-input', { timeout: 10000 });
        await messageInput.focus();
        await messageInput.click({ force: true });
        
        await messageInput.evaluate((el: any, html: string) => {
          el.innerHTML = html;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, formattedHtml);
        await page.waitForTimeout(1500);
        
        await page.keyboard.press('Enter');
        console.log('[Telegram] Message sent. Checking for spam restriction...');
        await page.waitForTimeout(2500);
      }
      
      // 4. Check for spam restriction modal
      const errorPopup = await page.$('.modal-dialog, .Popup, .confirm-dialog');
      if (errorPopup && await errorPopup.isVisible()) {
        const text = await errorPopup.textContent() || '';
        if (
          text.toLowerCase().includes('mutual contacts') || 
          text.toLowerCase().includes('restricted') || 
          text.toLowerCase().includes('spam') || 
          text.toLowerCase().includes('danh bạ') || 
          text.toLowerCase().includes('hạn chế')
        ) {
          const okBtn = await errorPopup.$('button');
          if (okBtn) await okBtn.click({ force: true }).catch(() => {});
          throw new Error(`ACCOUNT_RESTRICTED: Tài khoản bị giới hạn gửi tin nhắn cho người lạ. Chi tiết: ${text.trim()}`);
        }
      }
      
      // Screenshot confirmation
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_telegram_sent.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      
      const chatUrl = page.url();
      await context.close();
      return chatUrl || 'https://web.telegram.org/';
    } catch (error: any) {
      console.error(`[Telegram] Send message failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'telegram_message_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async dumpAllUsersFromIndexedDB(page: Page): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    try {
      const users = await page.evaluate(async () => {
        return new Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>>((resolve) => {
          const request = indexedDB.open('tt-data');
          request.onerror = () => resolve([]);
          request.onsuccess = (event: any) => {
            const db = event.target.result;
            try {
              const transaction = db.transaction(['store'], 'readonly');
              const store = transaction.objectStore('store');
              const getReq = store.get('tt-global-state');
              getReq.onsuccess = (e2: any) => {
                const state = e2.target.result;
                const usersById = state?.users?.byId || {};
                const list: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];
                
                for (const id in usersById) {
                  const u = usersById[id];
                  if (!u || u.isSelf || u.isBot) continue;
                  
                  let username = u.username || '';
                  if (!username && Array.isArray(u.usernames)) {
                    const active = u.usernames.find((item: any) => item && item.isActive);
                    if (active && active.username) username = active.username;
                  }
                  
                  const first = u.firstName || '';
                  const last = u.lastName || '';
                  const displayName = `${first} ${last}`.trim() || username || id;
                  const uid = username || id;
                  
                  if (uid && uid.length >= 3 && !/^\d{1,3}$/.test(uid)) {
                    list.push({
                      uid,
                      displayName,
                      avatarUrl: ''
                    });
                  }
                }
                resolve(list);
              };
              getReq.onerror = () => resolve([]);
            } catch (err) {
              resolve([]);
            }
          };
        });
      });
      return users || [];
    } catch (e: any) {
      console.error('[Telegram Scraper] Lỗi khi dump IndexedDB:', e.message);
      return [];
    }
  }

  static async runPrefixSearchQueries(page: Page, searchBoxSelector: string, maxQueries: number = 26): Promise<void> {
    console.log('[Telegram Scraper] Kích hoạt tìm kiếm ký tự đại diện (Alphabet & Numbers) để Telegram client nạp cache thành viên...');
    const searchPrefixes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const queryList = searchPrefixes.slice(0, maxQueries);
    
    try {
      const searchBox = await page.waitForSelector(searchBoxSelector, { timeout: 4000 }).catch(() => null);
      if (!searchBox) return;
      
      for (const prefix of queryList) {
        await searchBox.focus().catch(() => {});
        await searchBox.click({ force: true }).catch(() => {});
        await searchBox.fill(prefix).catch(() => {});
        await page.waitForTimeout(700); // Đợi Telegram Web client gửi RPC lấy user về cache
        
        try {
          const clearButton = await page.$('.search-input-container button.clear-button, .search-input button.clear');
          if (clearButton) await clearButton.click().catch(() => {});
          else await searchBox.fill('').catch(() => {});
        } catch (e) {
          await searchBox.fill('').catch(() => {});
        }
        await page.waitForTimeout(300);
      }
    } catch (e: any) {
      console.log(`[Telegram Scraper] Bỏ qua prefix search: ${e.message}`);
    }
  }

  static async internalHybridScrapeFromPage(
    page: Page,
    account: AccountConfig,
    maxLimit: number = 2000,
    onChunkScraped?: (chunk: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log('[Telegram Scraper] Tiến hành bóc tách Đa chiều (Multi-Vector Chat, Replies, Mentions, Reactions & IndexedDB Dump)...');
    
    const messageListSelectors = ['.MessageList', '.messages-layout .custom-scroll', '.messages-container', '.MiddleColumn .custom-scroll'];
    let messageScrollContainer: any = null;

    for (const selector of messageListSelectors) {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        messageScrollContainer = el;
        break;
      }
    }

    if (!messageScrollContainer) {
      const messageEl = await page.$('#MiddleColumn .Message, .MiddleColumn .Message, #MiddleColumn .message-list-item, .MiddleColumn .message-list-item');
      if (messageEl) {
        messageScrollContainer = await page.evaluateHandle((el: any) => el.closest('.custom-scroll, [class*="scroll"]') || el.parentElement, messageEl);
      }
    }

    const uniqueMap = new Map<string, { peerId: string; displayName: string; avatarUrl: string }>();
    const savedUids = new Set<string>();

    const streamChunk = async (items: Array<{ uid: string; displayName: string; avatarUrl: string }>) => {
      const newItems = items.filter(m => !savedUids.has(m.uid));
      if (newItems.length > 0) {
        newItems.forEach(m => savedUids.add(m.uid));
        if (onChunkScraped) {
          await onChunkScraped(newItems).catch(err => console.error('[Telegram Scraper] Error in onChunkScraped:', err.message));
        }
      }
    };

    if (messageScrollContainer) {
      console.log('[Telegram Scraper] Bắt đầu cuộn ngược lịch sử chat để trích xuất đa chiều...');
      let scrollAttempts = 0;
      let lastScrollTop = -1;
      let scrollStuckCount = 0;
      let lastUniqueCount = 0;
      let noNewUsersCount = 0;
      const maxScrolls = Math.max(1000, Math.ceil(maxLimit * 1.5));
      const messageItemSelector = '#MiddleColumn .Message, .MiddleColumn .Message, #MiddleColumn .message-list-item, .MiddleColumn .message-list-item';

      while (scrollAttempts < maxScrolls) {
        scrollAttempts++;

        const result = await page.evaluate(({ selector, scrollStep }: { selector: string; scrollStep: number }) => {
          const messageListSelectors = ['.MessageList', '.messages-layout .custom-scroll', '.messages-container', '.MiddleColumn .custom-scroll'];
          let el: any = null;
          for (const s of messageListSelectors) {
            const candidate = document.querySelector(s);
            if (candidate && (candidate as HTMLElement).offsetHeight > 0) { el = candidate; break; }
          }
          if (!el) {
            const msg = document.querySelector(selector);
            if (msg) el = msg.closest('.custom-scroll, [class*="scroll"]') || msg.parentElement;
          }
          if (!el) return { error: 'Scroll container not found', scrollInfo: null, visibleUsers: [] };
          
          const scrollInfo = {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight
          };

          const elements = document.querySelectorAll(selector);
          const visibleUsers: Array<{ peerId: string; displayName: string; avatarUrl: string }> = [];

          elements.forEach((msgEl: any) => {
            // 1. Message Sender
            const nameEl = msgEl.querySelector('.fullName, .sender-name, .name, .title, .message-title');
            const displayName = nameEl ? nameEl.textContent?.trim() || '' : '';

            let avatarUrl = '';
            const imgEl = msgEl.querySelector('img');
            if (imgEl) avatarUrl = imgEl.getAttribute('src') || '';

            let peerId = '';
            const avatarEl = msgEl.querySelector('.Avatar');
            if (avatarEl) {
              peerId = avatarEl.getAttribute('data-peer-id') || '';
              if (!peerId) {
                const dataPeer = avatarEl.getAttribute('data-peer') || avatarEl.getAttribute('data-id');
                if (dataPeer) peerId = dataPeer.replace(/[^\d]/g, '');
              }
            }

            if (peerId && peerId.length >= 4 && displayName) {
              visibleUsers.push({ peerId, displayName, avatarUrl });
            }

            // 2. Reply Target
            const replyTitle = msgEl.querySelector('.reply-title, .message-action-reply .fullName, .reply-content .fullName, .reply-name');
            if (replyTitle) {
              const replyName = replyTitle.textContent?.trim() || '';
              const replyPeer = replyTitle.getAttribute('data-peer-id') || replyTitle.closest('[data-peer-id]')?.getAttribute('data-peer-id') || '';
              if (replyPeer && replyPeer.length >= 4 && replyName) {
                visibleUsers.push({ peerId: replyPeer.replace(/[^\d]/g, ''), displayName: replyName, avatarUrl: '' });
              }
            }

            // 3. Mentions (@username)
            const textContent = msgEl.textContent || '';
            const mentionMatches = textContent.match(/@([a-zA-Z0-9_]{5,32})/g);
            if (mentionMatches) {
              mentionMatches.forEach((m: string) => {
                const cleanUser = m.replace('@', '').trim();
                if (cleanUser && cleanUser.length >= 5) {
                  visibleUsers.push({ peerId: cleanUser, displayName: `@${cleanUser}`, avatarUrl: '' });
                }
              });
            }

            // 4. Reactions & Service Messages
            const reactionEls = msgEl.querySelectorAll('.Reaction, .reaction-button, .Reactions .emoji, .service-message, .message-action');
            reactionEls.forEach((r: any) => {
              const rPeer = r.getAttribute('data-peer-id') || r.getAttribute('data-user-id');
              const rName = r.textContent?.trim();
              if (rPeer && rPeer.length >= 4) {
                visibleUsers.push({ peerId: rPeer.replace(/[^\d]/g, ''), displayName: rName || rPeer, avatarUrl: '' });
              }
            });
          });

          el.scrollBy(0, -scrollStep);

          return { scrollInfo, visibleUsers, error: null };
        }, { selector: messageItemSelector, scrollStep: 1500 });

        if (!result || result.error || !result.scrollInfo) break;

        const { scrollInfo, visibleUsers } = result;
        visibleUsers.forEach((u: any) => uniqueMap.set(u.peerId, u));

        const currentCount = uniqueMap.size;
        console.log(`[Telegram Scraper] Thu thập Multi-Vector: ${currentCount} thành viên (Vòng cuộn ${scrollAttempts}/${maxScrolls})...`);

        if (currentCount >= maxLimit) break;

        if (currentCount === lastUniqueCount) {
          noNewUsersCount++;
          if (noNewUsersCount >= 40) break;
        } else {
          noNewUsersCount = 0;
          lastUniqueCount = currentCount;
        }

        if (scrollInfo.scrollTop === 0) {
          scrollStuckCount++;
          if (scrollStuckCount >= 10) break;
        } else {
          scrollStuckCount = 0;
        }

        if (scrollInfo.scrollTop === lastScrollTop) {
          scrollStuckCount++;
          if (scrollStuckCount >= 12) break;
        } else {
          lastScrollTop = scrollInfo.scrollTop;
        }

        await page.waitForTimeout(800);
      }
    } else {
      console.log('[Telegram Scraper] Không thấy container tin nhắn. Bỏ qua cuộn tin nhắn, tiến hành trích xuất Cache.');
    }

    // Prefix search query simulation
    const searchBoxSelector = 'input[placeholder*="Search"], input.search-input, #telegram-search-input, input[type="search"]';
    await TelegramAutomation.runPrefixSearchQueries(page, searchBoxSelector);

    // Deep dump IndexedDB
    console.log('[Telegram Scraper] Đang thực hiện Vét cạn (Deep Dump) toàn bộ thành viên từ IndexedDB...');
    const indexedDbUsers = await TelegramAutomation.dumpAllUsersFromIndexedDB(page);
    console.log(`[Telegram Scraper] Đã bóc tách được ${indexedDbUsers.length} user từ IndexedDB.`);

    // Map & Resolve usernames
    const peerIdsToResolve = Array.from(uniqueMap.keys());
    const usersCache = await page.evaluate(async (ids: string[]) => {
      return new Promise<Record<string, any>>((resolve) => {
        const request = indexedDB.open('tt-data');
        request.onerror = () => resolve({});
        request.onsuccess = (event: any) => {
          const db = event.target.result;
          try {
            const transaction = db.transaction(['store'], 'readonly');
            const store = transaction.objectStore('store');
            const getReq = store.get('tt-global-state');
            getReq.onsuccess = (e2: any) => {
              const state = e2.target.result;
              const usersById = state?.users?.byId || {};
              const filtered: Record<string, any> = {};
              for (const id of ids) {
                if (usersById[id]) {
                  filtered[id] = {
                    username: usersById[id].username,
                    usernames: usersById[id].usernames,
                    firstName: usersById[id].firstName,
                    lastName: usersById[id].lastName
                  };
                }
              }
              resolve(filtered);
            };
            getReq.onerror = () => resolve({});
          } catch (err) {
            resolve({});
          }
        };
      });
    }, peerIdsToResolve).catch(() => ({} as Record<string, any>));

    const resolvedMap = new Map<string, { uid: string; displayName: string; avatarUrl: string }>();

    for (const rawMember of uniqueMap.values()) {
      const userObj = usersCache[rawMember.peerId];
      let username = '';
      let displayName = rawMember.displayName;

      if (userObj) {
        if (userObj.username) username = userObj.username;
        else if (Array.isArray(userObj.usernames)) {
          const active = userObj.usernames.find((u: any) => u && u.isActive);
          if (active && active.username) username = active.username;
        }
        const first = userObj.firstName || '';
        const last = userObj.lastName || '';
        const fullName = `${first} ${last}`.trim();
        if (fullName) displayName = fullName;
      }

      const uid = username || rawMember.peerId;
      resolvedMap.set(uid, { uid, displayName, avatarUrl: rawMember.avatarUrl });
    }

    // Merge IndexedDB dumped users
    for (const dbUser of indexedDbUsers) {
      if (!resolvedMap.has(dbUser.uid)) {
        resolvedMap.set(dbUser.uid, dbUser);
      }
    }

    const finalMembers = Array.from(resolvedMap.values());
    console.log(`[Telegram Scraper] Tổng số thành viên bóc tách thành công: ${finalMembers.length}`);

    // Stream final chunk to DB
    await streamChunk(finalMembers);

    return finalMembers.slice(0, maxLimit);
  }

  static async scrapeGroupMembers(
    account: AccountConfig,
    proxy: ProxyConfig | undefined,
    groupLink: string,
    maxLimit: number = 2000,
    onChunkScraped?: (chunk: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log(`[Telegram Scraper] Bắt đầu quét nhóm: ${groupLink} dùng tài khoản @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      launchOpts.headless = true;
      if (!launchOpts.args) launchOpts.args = [];
      launchOpts.args.push('--blink-settings=imagesEnabled=false');
      
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();
      
      // Log console and error events for debugging (filtering internal socket reconnect warnings)
      page.on('console', msg => {
        const text = msg.text();
        if (text.includes('Connection closed') || text.includes('Not connected') || text.includes('TIMEOUT') || text.includes('worker-')) return;
        console.log(`[Browser Console] ${msg.type()}: ${text}`);
      });
      page.on('pageerror', err => console.error(`[Browser PageError] ${err.message}`));
      
      const parsed = TelegramAutomation.parseTarget(groupLink);
      let directUrl = '';
      if (parsed.type === 'invite') {
        directUrl = `https://web.telegram.org/a/#+${parsed.value}`;
      } else if (parsed.type === 'username') {
        directUrl = `https://web.telegram.org/a/#${parsed.value}`;
      } else if (parsed.type === 'id') {
        directUrl = `https://web.telegram.org/a/#${parsed.value}`;
      } else {
        throw new Error('Link nhóm không hợp lệ hoặc không hỗ trợ định dạng này.');
      }
      
      console.log('[Telegram Scraper] Điều hướng tới trang chủ Telegram Web A...');
      await page.goto('https://web.telegram.org/a/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);
      
      // 1. Kiểm tra trạng thái đăng nhập
      try {
        await page.waitForSelector('.chat-list, .ListItem-button, #telegram-search-input', { timeout: 20000 });
      } catch {
        throw new Error('Tài khoản Telegram chưa được đăng nhập. Hãy đăng nhập qua Dashboard trước.');
      }

      // 1.5. Mở cuộc trò chuyện bằng cách thay đổi hash trực tiếp trong SPA Router
      let isChatOpened = false;
      const headerSelector = '.middle-header-chat-info, .ChatInfo, .chat-info, .middle-header-inner .chat-info';
      const joinLocator = page.locator('button, div[role="button"], .Button, .btn, .join-btn, .JoinButton')
        .filter({ hasText: /^(join group|join channel|join|tham gia)/i })
        .filter({ visible: true })
        .first();

      let groupTitle = '';
      if (parsed.type === 'invite') {
        console.log(`[Telegram Scraper] Đang phân giải tiêu đề nhóm riêng tư từ link: ${groupLink}...`);
        groupTitle = await TelegramAutomation.fetchGroupTitleFromInvite(groupLink);
        if (groupTitle) {
          console.log(`[Telegram Scraper] Đã tìm thấy tiêu đề nhóm riêng tư: "${groupTitle}"`);
        }
      }

      let isResolved = false;

      // Nếu là invite link và đã lấy được groupTitle, thử tìm kiếm tên nhóm trước
      if (parsed.type === 'invite' && groupTitle) {
        console.log(`[Telegram Scraper] Thử tìm kiếm tên nhóm "${groupTitle}" trong danh sách chat đã tham gia...`);
        try {
          const searchBox = await page.waitForSelector('input[placeholder*="Search"], input.search-input, #telegram-search-input, input[type="search"]', { timeout: 10000 });
          await searchBox.focus();
          await searchBox.click({ force: true });
          await searchBox.fill(groupTitle);
          await page.waitForTimeout(4000);
          
          const searchResultLocator = page.locator('.search-results .ListItem-button, .SearchResults .ListItem-button, .search-result-item, .ListItem-button, .ListItem')
            .filter({ visible: true })
            .first();
          
          if (await searchResultLocator.isVisible().catch(() => false)) {
            console.log('[Telegram Scraper] Tìm thấy nhóm trong danh sách chat. Click mở...');
            await searchResultLocator.click({ force: true });
            await page.waitForTimeout(3000);
            
            const header = page.locator(headerSelector).filter({ visible: true }).first();
            if (await header.isVisible().catch(() => false)) {
              isChatOpened = true;
              isResolved = true;
              console.log('[Telegram Scraper] Đã mở chat thành công bằng cách tìm tên nhóm.');
            }
          }
        } catch (err: any) {
          console.log(`[Telegram Scraper] Tìm kiếm tên nhóm thất bại: ${err.message}. Chuyển sang cơ chế Join.`);
        }
        
        try {
          const clearButton = await page.$('.search-input-container button.clear-button, .search-input button.clear');
          if (clearButton) await clearButton.click().catch(() => {});
        } catch (e) {}
      }

      if (!isResolved) {
        const targetHash = parsed.type === 'invite' ? `+${parsed.value}` : parsed.value;
        console.log(`[Telegram Scraper] Kích hoạt SPA Router với hash: #${targetHash}`);
        await page.evaluate((hash) => {
          window.location.hash = hash;
        }, targetHash);
        
        let startTime = Date.now();
        const timeout = 12000;
        
        while (Date.now() - startTime < timeout) {
          const header = page.locator(headerSelector).filter({ visible: true }).first();
          if (await header.isVisible().catch(() => false)) {
            isChatOpened = true;
            isResolved = true;
            console.log('[Telegram Scraper] Đã mở cuộc trò chuyện nhóm thành công qua SPA Router.');
            break;
          }
          
          if (await joinLocator.isVisible().catch(() => false)) {
            isResolved = true;
            console.log('[Telegram Scraper] Phát hiện nút Join Group từ SPA Router.');
            break;
          }
          await page.waitForTimeout(500);
        }

        if (!isResolved && parsed.type === 'invite') {
          const fallbackHash = `joinchat/${parsed.value}`;
          console.log(`[Telegram Scraper] SPA Router chính thức thất bại. Thử hash fallback: #${fallbackHash}`);
          await page.evaluate((hash) => {
            window.location.hash = hash;
          }, fallbackHash);
          
          startTime = Date.now();
          while (Date.now() - startTime < timeout) {
            const header = page.locator(headerSelector).filter({ visible: true }).first();
            if (await header.isVisible().catch(() => false)) {
              isChatOpened = true;
              isResolved = true;
              console.log('[Telegram Scraper] Đã mở cuộc trò chuyện nhóm thành công qua hash fallback.');
              break;
            }
            
            if (await joinLocator.isVisible().catch(() => false)) {
              isResolved = true;
              console.log('[Telegram Scraper] Phát hiện nút Join Group từ hash fallback.');
              break;
            }
            await page.waitForTimeout(500);
          }
        }
      }

      if (!isResolved) {
        if (parsed.type === 'invite') {
          const joinFailedPath = path.join(SCREENSHOT_DIR, `${account.username}_telegram_join_failed.png`);
          await page.screenshot({ path: joinFailedPath }).catch(() => {});
          throw new Error(`Không thể mở liên kết mời nhóm riêng tư này. Màn hình lỗi tại profiles/screenshots/${path.basename(joinFailedPath)}`);
        }
        
        // Strategy A: Navigate directly via t.me deep link (works for public groups/channels even if not joined)
        if (parsed.type === 'username') {
          try {
            const tMeDirectUrl = `https://t.me/${parsed.value}`;
            console.log(`[Telegram Scraper] Thử mở trực tiếp qua deep link: ${tMeDirectUrl}`);
            
            // Open t.me link in new tab to trigger Telegram Web redirect
            const tMePage = await page.context().newPage();
            await tMePage.goto(tMeDirectUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await tMePage.waitForTimeout(2000);
            
            // Look for "Open in Web" or auto-redirect button
            const openWebBtn = await tMePage.$('a[href*="web.telegram.org"], a:has-text("Open in Web"), a:has-text("View in Telegram")');
            let webUrl = '';
            if (openWebBtn) {
              webUrl = await openWebBtn.getAttribute('href') || '';
            }
            await tMePage.close().catch(() => {});
            
            if (webUrl && webUrl.includes('web.telegram.org')) {
              console.log(`[Telegram Scraper] Điều hướng tới: ${webUrl}`);
              await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
              await page.waitForTimeout(3000);
              
              const header = page.locator(headerSelector).filter({ visible: true }).first();
              if (await header.isVisible().catch(() => false)) {
                isChatOpened = true;
                isResolved = true;
                console.log('[Telegram Scraper] Đã mở nhóm thành công qua t.me deep link.');
              }
              
              if (!isResolved && await joinLocator.isVisible().catch(() => false)) {
                isResolved = true;
                console.log('[Telegram Scraper] Phát hiện nút Join Group từ t.me deep link.');
              }
            }
          } catch (deepLinkErr: any) {
            console.warn(`[Telegram Scraper] Deep link thất bại: ${deepLinkErr.message}. Chuyển sang tìm kiếm.`);
          }
        }
        
        // Strategy B: Search in Telegram Web - switch to "Channels" tab for public groups
        if (!isResolved) {
          try {
            console.log(`[Telegram Scraper] Đang tìm kiếm nhóm: ${groupLink} qua thanh tìm kiếm (tab Channels)...`);
            
            // Navigate back to main page if needed
            if (!page.url().includes('web.telegram.org/a/')) {
              await page.goto('https://web.telegram.org/a/', { waitUntil: 'domcontentloaded', timeout: 20000 });
              await page.waitForTimeout(3000);
            }
            
            const searchBox = await page.waitForSelector('input[placeholder*="Search"], input.search-input, #telegram-search-input, input[type="search"]', { timeout: 10000 });
            await searchBox.focus();
            await searchBox.click({ force: true });
            await page.waitForTimeout(500);
            
            // Use triple-click to select all existing text, then type to replace (more reliable than fill)
            const cleanGroupTarget = parsed.type === 'username' ? `@${parsed.value}` : groupLink;
            await searchBox.click({ clickCount: 3 }).catch(() => {});
            await page.keyboard.type(cleanGroupTarget, { delay: 50 });
            await page.waitForTimeout(2000);
            
            // Switch to "Channels" tab (for public groups/channels that are not in chat list)
            const channelsTab = page.locator('.SearchTabs .Tab, .search-tabs .Tab, div[role="tab"]')
              .filter({ hasText: /^Channels$/i })
              .first();
            if (await channelsTab.isVisible().catch(() => false)) {
              console.log('[Telegram Scraper] Chuyển sang tab Channels...');
              await channelsTab.click({ force: true });
              await page.waitForTimeout(2500);
            }
            
            const searchResultLocator = page.locator('.search-results .ListItem-button, .SearchResults .ListItem-button, .search-result-item, .ListItem-button, .ListItem')
              .filter({ visible: true })
              .first();
            
            // Check if results appeared
            let found = await searchResultLocator.isVisible().catch(() => false);
            
            // If not found in Channels tab, also try Chats tab
            if (!found) {
              const chatsTab = page.locator('.SearchTabs .Tab, .search-tabs .Tab, div[role="tab"]')
                .filter({ hasText: /^Chats$/i })
                .first();
              if (await chatsTab.isVisible().catch(() => false)) {
                console.log('[Telegram Scraper] Không tìm thấy trong Channels, chuyển lại tab Chats...');
                await chatsTab.click({ force: true });
                await page.waitForTimeout(2500);
                found = await searchResultLocator.isVisible().catch(() => false);
              }
            }
            
            if (!found) {
              // Wait a bit more for search results to load
              await searchResultLocator.waitFor({ timeout: 8000 });
            }
            
            await searchResultLocator.click({ force: true });
            await page.waitForTimeout(3000);
            
            const headerAfterSearch = page.locator(headerSelector).filter({ visible: true }).first();
            await headerAfterSearch.waitFor({ timeout: 10000 });
            isChatOpened = true;
            isResolved = true;
          } catch (searchErr: any) {
            const searchErrorPath = path.join(SCREENSHOT_DIR, `${account.username}_telegram_search_failed.png`);
            await page.screenshot({ path: searchErrorPath }).catch(() => {});
            throw new Error(`Không thể mở cuộc trò chuyện nhóm. Chi tiết lỗi: ${searchErr.message}.`);
          }
        }
      }
      
      // 2. Click Join nếu chưa tham gia
      if (await joinLocator.isVisible().catch(() => false)) {
        console.log('[Telegram Scraper] Phát hiện nút Join Group. Đang click gia nhập nhóm...');
        await joinLocator.click({ force: true });
        await page.waitForTimeout(4000);
        
        const confirmBtn = await page.$('.popup button:has-text("OK"), .popup button:has-text("Join"), .modal-dialog button:has-text("Join")');
        if (confirmBtn && await confirmBtn.isVisible()) {
          await confirmBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(3000);
        }
      }
      
      // 3. Mở Sidebar thông tin nhóm
      console.log('[Telegram Scraper] Đang mở sidebar thông tin nhóm...');
      const isSidebarOpen = await page.locator('#RightColumn, .RightColumn, .profile-info, .sidebar-content')
        .filter({ visible: true })
        .first()
        .isVisible()
        .catch(() => false);
      
      if (!isSidebarOpen) {
        try {
          const chatHeaderLocator = page.locator(headerSelector).filter({ visible: true }).first();
          await chatHeaderLocator.waitFor({ timeout: 15000 });
          await chatHeaderLocator.click({ force: true });
          await page.waitForTimeout(3000);
        } catch (e) {}
      }
      
      // 4. Click tab Members
      const membersButton = await page.locator('#RightColumn div, #RightColumn span, #RightColumn button, .RightColumn div')
        .filter({ hasText: /^\d+ (members|thành viên)/i })
        .first();
      if (await membersButton.isVisible().catch(() => false)) {
        await membersButton.click({ force: true }).catch(() => {});
        await page.waitForTimeout(2000);
      } else {
        const membersTab = await page.$('.Tab:has-text("Members"), .Tab:has-text("Thành viên"), div[role="tab"]:has-text("Members"), div[role="tab"]:has-text("Thành viên")');
        if (membersTab) {
          await membersTab.click().catch(() => {});
          await page.waitForTimeout(1500);
        }
      }
      
      // 5. Xác định container cuộn
      const memberSelector = '#RightColumn .ListItem, #RightColumn .ListItem-button, #RightColumn .chat-item, #RightColumn div[class*="ListItem"], .profile-info .ListItem-button, .sidebar-content .ListItem-button';
      let scrollContainer = null;

      const sampleItem = await page.$(memberSelector);
      if (sampleItem) {
        const parentHandle = await page.evaluateHandle((item) => {
          let parent = item.parentElement;
          while (parent) {
            const style = window.getComputedStyle(parent);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
              return parent;
            }
            parent = parent.parentElement;
          }
          return null;
        }, sampleItem);
        const el = parentHandle.asElement();
        if (el) scrollContainer = el;
      }

      if (!scrollContainer) {
        const scrollSelector = '#RightColumn .custom-scroll, #RightColumn .sidebar-content, #RightColumn .member-list, #RightColumn .Scrollable, .RightColumn .custom-scroll, .profile-info .custom-scroll';
        for (const selector of scrollSelector.split(',')) {
          const el = await page.$(selector.trim());
          if (el && await el.isVisible()) {
            scrollContainer = el;
            break;
          }
        }
      }

      if (!scrollContainer) {
        const rightCol = await page.$('#RightColumn, .RightColumn, .profile-info, .sidebar-content');
        if (rightCol) scrollContainer = rightCol;
      }
      
      const uniqueMap = new Map<string, { peerId: string; displayName: string; avatarUrl: string }>();

      if (scrollContainer) {
        await scrollContainer.click({ position: { x: 10, y: 10 } }).catch(() => {});
        console.log('[Telegram Scraper] Bắt đầu cuộn Sidebar để tải thành viên...');

        await page.evaluate((el: any) => { el.scrollTop = 0; }, scrollContainer);
        await page.waitForTimeout(1000);

        let scrollAttempts = 0;
        let lastScrollTop = 0;
        let scrollStuckCount = 0;
        const maxSidebarScrolls = Math.max(1000, Math.ceil(maxLimit / 3));
        while (uniqueMap.size < maxLimit && scrollAttempts < maxSidebarScrolls) {
          const scrollInfo = await page.evaluate((el: any) => {
            el.scrollTop += 400;
            return {
              scrollTop: el.scrollTop,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight
            };
          }, scrollContainer);

          await page.keyboard.press('PageDown').catch(() => {});
          await page.waitForTimeout(600);
          scrollAttempts++;

          const pageMembers = await page.evaluate(({ selector }) => {
            const elements = document.querySelectorAll(selector);
            const list: Array<{ peerId: string; displayName: string; avatarUrl: string }> = [];
            
            elements.forEach((el: any) => {
              const nameEl = el.querySelector('.fullName, .title, .name');
              const displayName = nameEl ? nameEl.textContent?.trim() || '' : '';
              const imgEl = el.querySelector('img');
              const avatarUrl = imgEl ? imgEl.getAttribute('src') || '' : '';
              
              let peerId = '';
              const avatarEl = el.querySelector('.Avatar') || el.closest('.Avatar');
              if (avatarEl) peerId = avatarEl.getAttribute('data-peer-id') || '';
              if (!peerId) {
                const dataPeer = el.getAttribute('data-peer-id') || el.getAttribute('data-peer') || el.getAttribute('data-id') || el.querySelector('[data-peer-id]')?.getAttribute('data-peer-id');
                if (dataPeer) peerId = dataPeer.replace(/[^\d]/g, '');
              }
              
              if (peerId && peerId.length >= 4 && displayName) {
                list.push({ peerId, displayName, avatarUrl });
              }
            });
            return list;
          }, { selector: memberSelector });

          pageMembers.forEach(m => uniqueMap.set(m.peerId, m));

          if (scrollInfo.scrollTop === lastScrollTop) {
            scrollStuckCount++;
            if (scrollStuckCount >= 8) break;
          } else {
            scrollStuckCount = 0;
            lastScrollTop = scrollInfo.scrollTop;
          }
        }
      }

      console.log(`[Telegram Scraper] Số lượng thành viên thu thập thô từ Sidebar: ${uniqueMap.size}`);
      
      // AUTO-FALLBACK: Nếu Sidebar trả về ít hơn 10 thành viên (Nhóm bật Hide Members)
      if (uniqueMap.size < 10) {
        console.log(`[Telegram Scraper] Nhóm bật Ẩn thành viên (Hide Members) hoặc chỉ hiển thị Admins (${uniqueMap.size} thành viên). Tự động chuyển hướng sang Thuật toán Lai Đa chiều (Smart Hybrid Scraper)...`);
        const hybridMembers = await TelegramAutomation.internalHybridScrapeFromPage(page, account, maxLimit, onChunkScraped);
        await context.close();
        return hybridMembers;
      }

      // Đọc IndexedDB để map username
      const peerIdsToResolve = Array.from(uniqueMap.keys());
      const usersCache = await page.evaluate(async (ids: string[]) => {
        return new Promise<Record<string, any>>((resolve) => {
          const request = indexedDB.open('tt-data');
          request.onerror = () => resolve({});
          request.onsuccess = (event: any) => {
            const db = event.target.result;
            try {
              const transaction = db.transaction(['store'], 'readonly');
              const store = transaction.objectStore('store');
              const getReq = store.get('tt-global-state');
              getReq.onsuccess = (e2: any) => {
                const state = e2.target.result;
                const usersById = state?.users?.byId || {};
                const filtered: Record<string, any> = {};
                for (const id of ids) {
                  if (usersById[id]) {
                    filtered[id] = {
                      username: usersById[id].username,
                      usernames: usersById[id].usernames,
                      firstName: usersById[id].firstName,
                      lastName: usersById[id].lastName
                    };
                  }
                }
                resolve(filtered);
              };
              getReq.onerror = () => resolve({});
            } catch (err) {
              resolve({});
            }
          };
        });
      }, peerIdsToResolve).catch(() => ({} as Record<string, any>));

      const resolvedMembersMap = new Map<string, { uid: string; displayName: string; avatarUrl: string }>();
      
      for (const rawMember of uniqueMap.values()) {
        const userObj = usersCache[rawMember.peerId];
        let username = '';
        let displayName = rawMember.displayName;

        if (userObj) {
          if (userObj.username) username = userObj.username;
          else if (Array.isArray(userObj.usernames)) {
            const active = userObj.usernames.find((u: any) => u && u.isActive);
            if (active && active.username) username = active.username;
          }
          const first = userObj.firstName || '';
          const last = userObj.lastName || '';
          const fullName = `${first} ${last}`.trim();
          if (fullName) displayName = fullName;
        }
        
        const uid = username || rawMember.peerId;
        resolvedMembersMap.set(uid, { uid, displayName, avatarUrl: rawMember.avatarUrl });
      }
      
      const finalMembers = Array.from(resolvedMembersMap.values());
      console.log(`[Telegram Scraper] Đã quét thành công ${finalMembers.length} thành viên từ Sidebar.`);

      if (onChunkScraped && finalMembers.length > 0) {
        await onChunkScraped(finalMembers).catch(() => {});
      }

      await context.close();
      return finalMembers.slice(0, maxLimit);
    } catch (error: any) {
      console.error('[Telegram Scraper] Quá trình quét thất bại:', error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'telegram_scrape_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async scrapeGroupMembersFromChatHistory(
    account: AccountConfig,
    proxy: ProxyConfig | undefined,
    groupLink: string,
    maxMessages: number = 2000,
    onChunkScraped?: (chunk: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log(`[Telegram Scraper] Bắt đầu quét tin nhắn từ lịch sử chat của nhóm: ${groupLink} dùng tài khoản @${account.username}...`);
    
    let context: any = null;
    let page: any = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      launchOpts.headless = true;
      if (!launchOpts.args) launchOpts.args = [];
      launchOpts.args.push('--blink-settings=imagesEnabled=false');
      
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();
      
      page.on('console', (msg: any) => {
        const text = msg.text();
        if (text.includes('Connection closed') || text.includes('Not connected') || text.includes('TIMEOUT') || text.includes('worker-')) return;
        console.log(`[Browser Console] ${msg.type()}: ${text}`);
      });
      page.on('pageerror', (err: any) => console.error(`[Browser PageError] ${err.message}`));

      console.log('[Telegram Scraper] Điều hướng tới trang chủ Telegram Web A...');
      await page.goto('https://web.telegram.org/a/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      
      let isLogged = false;
      const startTime = Date.now();
      const searchBoxSelector = 'input[placeholder*="Search"], input.search-input, #telegram-search-input, input[type="search"]';
      
      while (Date.now() - startTime < 20000) {
        if (await page.locator(searchBoxSelector).first().isVisible().catch(() => false)) {
          isLogged = true;
          break;
        }
        if (await page.locator('#qr-container, .qr-container, button:has-text("Log in by phone number")').first().isVisible().catch(() => false)) {
          break;
        }
        await page.waitForTimeout(500);
      }
      
      if (!isLogged) {
        throw new Error('Tài khoản quét chưa được đăng nhập. Vui lòng liên kết tài khoản và đăng nhập thành công trên dashboard trước khi quét.');
      }

      const parsed = TelegramAutomation.parseTarget(groupLink);
      let isChatOpened = false;
      const headerSelector = '.chat-info, .ChatInfo, .chat-header, .ChatHeader';
      const joinSelector = 'button.join-btn, button.JoinButton, button:has-text("Join"), button:has-text("JOIN"), button:has-text("join"), button:has-text("Tham gia"), .join-channel-wrapper button, button:has-text("Join Group")';
      const joinLocator = page.locator(joinSelector).filter({ visible: true }).first();
      
      let groupTitle = '';
      if (parsed.type === 'invite') {
        groupTitle = await TelegramAutomation.fetchGroupTitleFromInvite(groupLink);
      }

      let isResolved = false;

      if (parsed.type === 'invite' && groupTitle) {
        try {
          const searchBox = await page.waitForSelector(searchBoxSelector, { timeout: 10000 });
          await searchBox.focus();
          await searchBox.click({ force: true });
          await searchBox.fill(groupTitle);
          await page.waitForTimeout(4000);
          
          const searchResultLocator = page.locator('.search-results .ListItem-button, .SearchResults .ListItem-button, .search-result-item, .ListItem-button, .ListItem')
            .filter({ visible: true })
            .first();
            
          if (await searchResultLocator.isVisible().catch(() => false)) {
            await searchResultLocator.click({ force: true });
            await page.waitForTimeout(3000);
            const header = page.locator(headerSelector).filter({ visible: true }).first();
            if (await header.isVisible().catch(() => false)) {
              isChatOpened = true;
              isResolved = true;
            }
          }
        } catch (err: any) {}
      }

      if (!isResolved) {
        const targetHash = parsed.type === 'invite' ? `+${parsed.value}` : parsed.value;
        await page.evaluate((hash: string) => {
          const a = document.createElement('a');
          a.href = `#${hash}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, targetHash);
        
        let startRouteTime = Date.now();
        while (Date.now() - startRouteTime < 12000) {
          const header = page.locator(headerSelector).filter({ visible: true }).first();
          if (await header.isVisible().catch(() => false)) {
            isChatOpened = true;
            isResolved = true;
            break;
          }
          if (await joinLocator.isVisible().catch(() => false)) {
            isResolved = true;
            break;
          }
          await page.waitForTimeout(500);
        }
      }

      if (!isResolved) {
        try {
          const searchBox = await page.waitForSelector(searchBoxSelector, { timeout: 10000 });
          await searchBox.focus();
          await searchBox.click({ force: true });
          await searchBox.fill(parsed.type === 'username' ? `@${parsed.value}` : groupLink);
          await page.waitForTimeout(4000);
          
          const searchResultLocator = page.locator('.ListItem-button, .ListItem').filter({ hasText: parsed.value }).first();
          await searchResultLocator.waitFor({ timeout: 10000 });
          await searchResultLocator.click({ force: true });
          await page.waitForTimeout(3000);
          isChatOpened = true;
        } catch (err: any) {
          throw new Error(`Không tìm thấy kết quả tìm kiếm hiển thị nào cho: ${groupLink}.`);
        }
      }

      if (!isChatOpened) {
        const joinButton = page.locator(joinSelector).filter({ visible: true }).first();
        if (await joinButton.isVisible().catch(() => false)) {
          await joinButton.click({ force: true });
          await page.waitForTimeout(5000);
        }
      }

      // Trích xuất Đa chiều + Stream Chunk + Deep Dump IndexedDB
      const finalMembers = await TelegramAutomation.internalHybridScrapeFromPage(page, account, maxMessages, onChunkScraped);

      await context.close();
      return finalMembers;
    } catch (error: any) {
      console.error('[Telegram Scraper] Quá trình quét lịch sử chat thất bại:', error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'telegram_scrape_history_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async scrapeGroupMembersHybrid(
    account: AccountConfig,
    proxy: ProxyConfig | undefined,
    groupLink: string,
    maxLimit: number = 2000,
    onChunkScraped?: (chunk: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log(`[Telegram Scraper] Bắt đầu Thuật toán Lai Đa chiều (Smart Hybrid) cho nhóm: ${groupLink}...`);
    return await TelegramAutomation.scrapeGroupMembersFromChatHistory(account, proxy, groupLink, maxLimit, onChunkScraped);
  }
}

// Threads automation class
export class ThreadsAutomation {
  static async checkLive(account: AccountConfig, proxy?: ProxyConfig): Promise<'live' | 'checkpoint' | 'die'> {
    console.log(`[Threads] Checking account status for @${account.username}...`);
    let context: BrowserContext | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      const page = await context.newPage();
      await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(5000);
      
      const currentUrl = page.url();
      if (currentUrl.includes('threads.net') && !currentUrl.includes('login')) {
        console.log(`[Threads] @${account.username} is LIVE`);
        await context.close();
        return 'live';
      }
      
      console.log(`[Threads] @${account.username} requires login (DIE)`);
      await context.close();
      return 'die';
    } catch (error: any) {
      console.error(`[Threads] Error checking @${account.username}:`, error.message);
      if (context) await context.close();
      return 'die';
    }
  }

  static async post(account: AccountConfig, proxy: ProxyConfig | undefined, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    console.log(`[Threads] Creating post as @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();
      
      await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(4000);
      
      if (page.url().includes('login')) {
        throw new Error('Tài khoản Threads chưa được đăng nhập. Hãy đăng nhập thủ công trước.');
      }
      
      // 1. Click post creation button/area
      console.log('[Threads] Opening compose box...');
      const composeBtn = await page.waitForSelector('svg[aria-label="Create"], svg[aria-label="Tạo"], text="Start a thread...", text="Bắt đầu một dòng trạng thái..."', { timeout: 15000 });
      await composeBtn.click({ force: true });
      await page.waitForTimeout(2000);
      
      // 2. Type content
      console.log('[Threads] Typing content...');
      const textBox = await page.waitForSelector('div[role="textbox"], div[contenteditable="true"]', { timeout: 15000 });
      await textBox.focus();
      await textBox.click({ force: true });
      await page.keyboard.type(content, { delay: 60 });
      await page.waitForTimeout(2000);
      
      // 3. Upload media files if any
      if (mediaPaths && mediaPaths.length > 0) {
        console.log(`[Threads] Attaching ${mediaPaths.length} media file(s)...`);
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          const absolutePaths = mediaPaths.map(p => fs.existsSync(p) ? p : path.join(process.cwd(), 'public', p.startsWith('/') ? p.substring(1) : p));
          await fileInput.setInputFiles(absolutePaths);
          await page.waitForTimeout(4000);
        }
      }
      
      // 4. Click Post button
      console.log('[Threads] Clicking Post button...');
      const postBtn = await page.waitForSelector('button:has-text("Post"), button:has-text("Đăng")', { timeout: 15000 });
      await postBtn.click({ force: true });
      console.log('[Threads] Post submitted. Waiting for confirmation...');
      await page.waitForTimeout(5000);
      
      // Screenshot confirmation
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_threads_posted.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      
      // Try to get the post URL from profile timeline
      let postUrl = '';
      try {
        await page.goto(`https://www.threads.net/@${account.username}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);
        const postLink = await page.waitForSelector('a[href*="/post/"]', { timeout: 10000 });
        if (postLink) {
          const href = await postLink.getAttribute('href');
          if (href) {
            postUrl = href.startsWith('http') ? href : `https://www.threads.net${href}`;
            console.log(`[Threads] Found posted thread URL: ${postUrl}`);
          }
        }
      } catch (err: any) {
        console.warn(`[Threads] Could not retrieve post URL from profile timeline:`, err.message);
      }

      await context.close();
      return postUrl || true;
    } catch (error: any) {
      console.error(`[Threads] Post failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'threads_post_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async comment(account: AccountConfig, proxy: ProxyConfig | undefined, targetUrl: string, content: string): Promise<boolean | string> {
    console.log(`[Threads] Commenting as @${account.username} on ${targetUrl}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();
      
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(4000);
      
      if (page.url().includes('login')) {
        throw new Error('Tài khoản Threads chưa được đăng nhập. Hãy đăng nhập thủ công trước.');
      }
      
      // 1. Click Reply/Comment icon
      console.log('[Threads] Clicking comment button...');
      const replyBtn = await page.waitForSelector('svg[aria-label="Reply"], svg[aria-label="Trả lời"]', { timeout: 15000 });
      await replyBtn.click({ force: true });
      await page.waitForTimeout(2000);
      
      // 2. Type content
      console.log('[Threads] Typing comment...');
      const textBox = await page.waitForSelector('div[role="textbox"], div[contenteditable="true"]', { timeout: 15000 });
      await textBox.focus();
      await textBox.click({ force: true });
      await page.keyboard.type(content, { delay: 60 });
      await page.waitForTimeout(2000);
      
      // 3. Click Post/Submit button inside reply modal
      console.log('[Threads] Submitting reply...');
      const submitBtn = await page.waitForSelector('button:has-text("Post"), button:has-text("Đăng"), button:has-text("Reply"), button:has-text("Trả lời")', { timeout: 15000 });
      await submitBtn.click({ force: true });
      await page.waitForTimeout(4000);
      
      // Screenshot confirmation
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_threads_replied.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      
      await context.close();
      return targetUrl;
    } catch (error: any) {
      console.error(`[Threads] Comment failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'threads_comment_failed');
        await context.close();
      }
      throw error;
    }
  }
}

// Facebook Web automation class
export class FacebookAutomation {
  static async checkLive(account: AccountConfig, proxy?: ProxyConfig): Promise<'live' | 'checkpoint' | 'die'> {
    console.log(`[Facebook] Checking account status for @${account.username}...`);
    let context: BrowserContext | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      const page = await context.newPage();
      
      // Inject cookies if available in auth_token
      if (account.auth_token) {
        const cookies = parseCookiesToPlaywright(account.auth_token, '.facebook.com');
        if (cookies.length > 0) {
          try {
            await context.addCookies(cookies);
          } catch (e: any) {
            console.warn(`[Facebook] Failed to inject cookies for @${account.username}:`, e.message);
          }
        }
      }
      
      /**
       * BẰNG CHỨNG ĐĂNG NHẬP (đọc cục bộ, không tốn request):
       * Cookie `c_user` là dấu hiệu DUY NHẤT đáng tin. Trước đây hàm này kết luận
       * 'live' chỉ vì "không thấy ô email/password" — sai nghiêm trọng: account đã
       * mất phiên (chỉ còn cookie 'fr') vẫn bị đánh dấu live, khiến scraper chọn nó
       * rồi thất bại âm thầm và đổ lỗi sai cho nhóm/mục tiêu (đúng ca job #50).
       */
      const authCookies = await context.cookies('https://www.facebook.com').catch(() => []);
      const hasAuthCookie = authCookies.some(c => c.name === 'c_user' && Boolean(c.value));
      if (!hasAuthCookie) {
        console.warn(`[Facebook] @${account.username} KHÔNG có cookie đăng nhập (c_user) — phiên đã hết hạn.`);
      }

      // Navigate to Facebook
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      await handleFacebookCheckpoints(page);
      
      const url = page.url();
      if (url.includes('checkpoint') || url.includes('confirmemail') || url.includes('identity') || url.includes('two_step_verification') || url.includes('two_factor')) {
        console.log(`[Facebook] @${account.username} is at CHECKPOINT/2FA`);
        await saveErrorScreenshot(page, account.username, 'facebook_checkpoint');
        await context.close();
        return 'checkpoint';
      }
      
      const hasEmailInput = await page.$('input[name="email"]');
      const hasPassInput = await page.$('input[name="pass"]');
      
      // CHỈ kết luận 'live' khi CÓ cookie xác thực VÀ không bị chặn bởi form đăng nhập.
      if (hasAuthCookie && !hasEmailInput && !hasPassInput) {
        console.log(`[Facebook] @${account.username} is LIVE (có cookie c_user)`);
        await context.close();
        return 'live';
      }
      if (!hasAuthCookie && !hasEmailInput && !hasPassInput) {
        // Không cookie, không form: trang trung gian/chặn — KHÔNG được coi là live.
        console.warn(`[Facebook] @${account.username}: không có cookie xác thực và không thấy form — coi là cần đăng nhập lại.`);
        await context.close();
        return 'die';
      }
      
      if (account.password) {
        console.log(`[Facebook] @${account.username} not logged in. Attempting auto login...`);
        const loginSuccess = await this.performLogin(page, account);
        if (loginSuccess) {
          await context.close();
          return 'live';
        }
      }
      
      await handleFacebookCheckpoints(page);
      const finalUrl = page.url();
      if (finalUrl.includes('checkpoint') || finalUrl.includes('confirmemail') || finalUrl.includes('identity') || finalUrl.includes('two_step_verification') || finalUrl.includes('two_factor')) {
        console.log(`[Facebook] @${account.username} is at CHECKPOINT/2FA`);
        await saveErrorScreenshot(page, account.username, 'facebook_checkpoint');
        await context.close();
        return 'checkpoint';
      }
      
      console.log(`[Facebook] @${account.username} login failed or requires login (DIE)`);
      await saveErrorScreenshot(page, account.username, 'facebook_die');
      await context.close();
      return 'die';
    } catch (error: any) {
      console.error(`[Facebook] Error checking account @${account.username}:`, error.message);
      if (context) await context.close();
      return 'die';
    }
  }

  static async performLogin(page: Page, account: AccountConfig): Promise<boolean> {
    try {
      const currentUrl = page.url();
      if (!currentUrl.includes('facebook.com')) {
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      
      const emailInput = await page.waitForSelector('input[name="email"]', { timeout: 10000 });
      await emailInput.click({ force: true });
      await page.keyboard.type(account.username, { delay: 100 });
      
      const passInput = await page.waitForSelector('input[name="pass"]', { timeout: 10000 });
      await passInput.click({ force: true });
      if (account.password) {
        await page.keyboard.type(account.password, { delay: 100 });
      }
      
      // 1. Press Enter while password input is focused to submit the form
      await page.keyboard.press('Enter');
      
      // 2. Also try clicking the login button as a backup
      try {
        await page.click('button[name="login"], button[type="submit"], [data-testid="royal_login_button"]', { force: true, timeout: 2000 });
      } catch (e) {}
      
      // Wait for email input to disappear (indicating page navigation started/completed)
      await page.waitForSelector('input[name="email"]', { state: 'detached', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000); // Allow redirect to settle
      
      const url = page.url();
      if (url.includes('checkpoint') || url.includes('confirmemail') || url.includes('identity') || url.includes('two_step_verification') || url.includes('two_factor')) {
        console.log(`[Facebook] @${account.username} requires 2FA or Checkpoint verification.`);
        return false;
      }
      
      const hasEmailInput = await page.$('input[name="email"]');
      if (!hasEmailInput) {
        console.log(`[Facebook] Successfully logged in to @${account.username}`);
        return true;
      }
      
      return false;
    } catch (err: any) {
      console.error(`[Facebook] Auto login failed for @${account.username}:`, err.message);
      return false;
    }
  }

  static async post(account: AccountConfig, proxy: ProxyConfig | undefined, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    console.log(`[Facebook] Posting as @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      await injectCookiesIfAvailable(context, account);
      page = await context.newPage();
      
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      const isLoggedIn = !(await page.$('input[name="email"]'));
      if (!isLoggedIn) {
        throw new Error('Tài khoản chưa được đăng nhập.');
      }
      
      const composeBox = await page.waitForSelector('span:has-text("Bạn đang nghĩ gì"), span:has-text("What\'s on your mind"), div[role="button"]:has-text("Bạn đang nghĩ gì"), div[role="button"]:has-text("What\'s on your mind")', { timeout: 15000 });
      await composeBox.click({ force: true });
      
      const dialog = await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
      await page.waitForTimeout(1000);
      
      const textBox = await dialog.waitForSelector('div[role="textbox"], div[contenteditable="true"]', { timeout: 10000 });
      await textBox.focus();
      await textBox.click({ force: true });
      await page.keyboard.type(content, { delay: 50 });
      await page.waitForTimeout(1000);
      
      if (mediaPaths && mediaPaths.length > 0) {
        const absolutePaths = mediaPaths.map(p => {
          if (fs.existsSync(p)) return p;
          const cleanRelative = p.startsWith('/') ? p.substring(1) : p;
          return path.join(process.cwd(), 'public', cleanRelative);
        });
        
        const mediaBtn = await dialog.$('div[aria-label="Ảnh/video"], div[aria-label="Photo/video"]');
        if (mediaBtn) {
          await mediaBtn.click({ force: true });
          await page.waitForTimeout(1500);
        }
        
        const fileInput = await dialog.waitForSelector('input[type="file"]', { timeout: 10000 });
        await fileInput.setInputFiles(absolutePaths);
        await page.waitForTimeout(3000);
      }
      
      const postBtn = await dialog.waitForSelector('div[aria-label="Đăng"], div[aria-label="Post"], button:has-text("Đăng"), button:has-text("Post")', { timeout: 10000 });
      await postBtn.click({ force: true });
      
      await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 20000 });
      console.log(`[Facebook] Successfully posted as @${account.username}`);
      
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_facebook_post_success.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      
      await context.close();
      return true;
    } catch (error: any) {
      console.error(`[Facebook] Failed to post as @${account.username}:`, error.message);
      if (context) {
        const errorPage = page || (await context.pages())[0];
        if (errorPage) await saveErrorScreenshot(errorPage, account.username, 'facebook_post_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async comment(account: AccountConfig, proxy: ProxyConfig | undefined, targetUrl: string, content: string): Promise<boolean | string> {
    console.log(`[Facebook] Commenting as @${account.username} on ${targetUrl}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      await injectCookiesIfAvailable(context, account);
      page = await context.newPage();
      
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      const isLoggedIn = !(await page.$('input[name="email"]'));
      if (!isLoggedIn) {
        throw new Error('Tài khoản chưa được đăng nhập.');
      }
      
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(1500);
      
      const commentInput = await page.waitForSelector('div[aria-label="Viết bình luận..."], div[aria-label="Write a comment..."], div[aria-label="Viết bình luận"], div[aria-label="Write a comment"], div[role="textbox"]', { timeout: 15000 });
      await commentInput.focus();
      await commentInput.click({ force: true });
      await page.keyboard.type(content, { delay: 60 });
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      
      // Check for Action Blocked popup
      const blockedKeywords = [
        'bị chặn', 'tạm thời', 'hành động này', 'hạn chế',
        'blocked', 'temporary', 'restricted', 'action is blocked'
      ];
      const pageText = await page.evaluate(() => document.body.innerText || '');
      const isBlocked = blockedKeywords.some(keyword => pageText.toLowerCase().includes(keyword));
      if (isBlocked) {
        throw new Error('Tài khoản bị Facebook chặn tương tác (Action Blocked).');
      }
      
      console.log(`[Facebook] Successfully commented as @${account.username}`);
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_facebook_comment_success.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      
      await context.close();
      return targetUrl;
    } catch (error: any) {
      console.error(`[Facebook] Failed to comment as @${account.username}:`, error.message);
      if (context) {
        const errorPage = page || (await context.pages())[0];
        if (errorPage) await saveErrorScreenshot(errorPage, account.username, 'facebook_comment_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async sendMessage(account: AccountConfig, proxy: ProxyConfig | undefined, target: string, content: string): Promise<boolean | string> {
    console.log(`[Facebook] Sending Messenger message to ${target} as @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      await injectCookiesIfAvailable(context, account);
      // Close any other open pages to prevent Comet Messenger tab sync conflicts
      const existingPages = context.pages();
      page = existingPages[0] || (await context.newPage());
      for (let i = 1; i < existingPages.length; i++) {
        await existingPages[i].close().catch(() => {});
      }
      
      let targetUrl = target.trim();
      let isDirectChat = false;
      let threadId = '';
      
      const chatMatch = targetUrl.match(/(?:messages\/t\/|messages\/e2ee\/t\/|messenger\.com\/t\/|messenger\.com\/e2ee\/t\/)([^\/?#]+)/);
      if (chatMatch) {
        threadId = chatMatch[1];
        targetUrl = `https://www.facebook.com/messages/t/${threadId}`;
        isDirectChat = true;
      } else if (!targetUrl.startsWith('http')) {
        targetUrl = `https://www.facebook.com/${targetUrl}`;
      }
      
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      await handleFacebookCheckpoints(page);
      
      const isLoggedIn = !(await page.$('input[name="email"]'));
      if (!isLoggedIn) {
        throw new Error('Tài khoản chưa được đăng nhập.');
      }
      
      if (isDirectChat) {
        // Dismiss E2EE PIN dialog if it appears
        const hasPinDialog = await page.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return false;
          const text = dialog.textContent || '';
          return text.includes('mã PIN') || text.includes('PIN') || text.includes('khôi phục') || text.includes('restore') || text.includes('mật mã') || text.includes('thiếu');
        });

        if (hasPinDialog) {
          console.log('[Facebook/Messenger] Detected encryption PIN dialog. Dismissing...');
          const closeBtn = page.locator('div[role="dialog"] [aria-label="Đóng"], div[role="dialog"] [aria-label="Close"], [aria-label="Đóng"], [aria-label="Close"]').filter({ visible: true }).first();
          const hasClose = await closeBtn.count();
          if (hasClose > 0) {
            await closeBtn.click({ force: true });
            console.log('[Facebook/Messenger] Clicked Close button of PIN dialog. Waiting for confirmation dialog...');
            await page.waitForTimeout(3000);

            let confirmBtn = page.locator('text="Không khôi phục tin nhắn"').filter({ visible: true }).first();
            let count = await confirmBtn.count();
            if (count === 0) {
              confirmBtn = page.locator('text="Không khôi phục"').filter({ visible: true }).first();
              count = await confirmBtn.count();
            }
            if (count === 0) {
              confirmBtn = page.locator('text="Don\'t restore"').filter({ visible: true }).first();
              count = await confirmBtn.count();
            }
            if (count === 0) {
              confirmBtn = page.locator('text="Do not restore"').filter({ visible: true }).first();
              count = await confirmBtn.count();
            }
            if (count > 0) {
              await confirmBtn.click({ force: true });
              console.log('[Facebook/Messenger] Dismissed second confirmation dialog successfully.');
              await page.waitForTimeout(2000);
            } else {
              console.warn('[Facebook/Messenger] Warning: Could not find second confirmation button text to dismiss PIN popup.');
            }
          } else {
            console.warn('[Facebook/Messenger] Warning: Could not find close button of PIN dialog.');
          }
        }

        // Wait up to 8 seconds for client-side routing to stabilize
        let isThreadOpen = false;
        for (let i = 0; i < 8; i++) {
          const currentUrl = page.url();
          if (currentUrl.includes(threadId)) {
            isThreadOpen = true;
            break;
          }
          console.log(`[Facebook/Messenger] Waiting for conversation thread URL redirect... (i=${i}, Current URL: ${currentUrl})`);
          await page.waitForTimeout(1000);
        }

        if (!isThreadOpen) {
          console.warn(`[Facebook/Messenger] Page URL does not match target thread ID. Current URL: ${page.url()}. Forcing reload...`);
          await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(4000);
        }
      } else {
        const msgBtn = await page.waitForSelector('div[aria-label="Nhắn tin"], div[aria-label="Message"], div[role="button"]:has-text("Nhắn tin"), div[role="button"]:has-text("Message")', { timeout: 15000 });
        await msgBtn.click({ force: true });
        await page.waitForTimeout(3000);
      }
      
      const chatBox = await page.waitForSelector('div[role="textbox"][aria-label="Tin nhắn"], div[role="textbox"][aria-label="Message"], div[role="textbox"]', { timeout: 15000 });
      await chatBox.focus();
      await chatBox.click({ force: true });
      await page.keyboard.type(content, { delay: 60 });
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      
      // Check for blocked message popup
      const msgBlockedKeywords = [
        'không thể gửi', 'bị chặn', 'tạm thời', 'hạn chế',
        'couldn\'t send', 'blocked', 'temporary', 'restricted'
      ];
      const msgPageText = await page.evaluate(() => document.body.innerText || '');
      const isMsgBlocked = msgBlockedKeywords.some(keyword => msgPageText.toLowerCase().includes(keyword));
      if (isMsgBlocked) {
        // Check if the sender account itself is globally restricted
        const senderRestrictedKeywords = [
          'tạm thời bị chặn', 'hạn chế tính năng', 'chặn tính năng',
          'bị chặn chia sẻ', 'bị hạn chế', 'temporary blocked',
          'action blocked', 'restricted feature', 'temporary restricted'
        ];
        const isSenderRestricted = senderRestrictedKeywords.some(keyword => msgPageText.toLowerCase().includes(keyword));
        if (isSenderRestricted) {
          throw new Error('Không thể gửi tin nhắn. Tài khoản bị Facebook chặn/hạn chế tính năng (ACCOUNT_RESTRICTED).');
        }
        
        throw new Error('Không thể gửi tin nhắn (giao diện báo "Không thể gửi"). Hãy kiểm tra lại kết nối, khóa bảo mật E2EE của tài khoản, hoặc kiểm tra xem người nhận có chặn bạn không.');
      }
      
      console.log(`[Facebook] Messenger message sent successfully to ${target}`);
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_facebook_message_success.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      
      await context.close();
      return true;
    } catch (error: any) {
      console.error(`[Facebook] Failed to send Messenger message:`, error.message);
      if (context) {
        const errorPage = page || (await context.pages())[0];
        if (errorPage) await saveErrorScreenshot(errorPage, account.username, 'facebook_message_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async scrapeGroupMembers(
    account: AccountConfig, 
    proxy: ProxyConfig | undefined, 
    targetGroup: string, 
    limit: number,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log(`[Facebook] Scraping members from group ${targetGroup} using @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      await injectCookiesIfAvailable(context, account);
      page = await context.newPage();
      
      let groupUrl = targetGroup.trim();
      let targetId = '';
      if (groupUrl.includes('profile.php?id=')) {
        try {
          const u = new URL(groupUrl);
          targetId = u.searchParams.get('id') || '';
        } catch (e) {}
      } else {
        const parts = groupUrl.split('?')[0].split('/').filter(Boolean);
        targetId = parts[parts.length - 1] || '';
        if (targetId === 'members' && parts.length >= 2) {
          targetId = parts[parts.length - 2];
        }
      }

      if (groupUrl.includes('/groups/') && !groupUrl.includes('/members')) {
        groupUrl = groupUrl.replace(/\/$/, '') + '/members';
      }
      
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      await handleFacebookCheckpoints(page);
      await injectFacebookIsolationStyles(page);
      
      const isLoggedIn = !(await page.$('input[name="email"]'));
      if (!isLoggedIn) {
        throw new Error('Tài khoản chưa được đăng nhập.');
      }
      
      // Extract active scraper user ID/username to exclude from results
      const selfIdentifiers = new Set<string>();
      if (targetId) selfIdentifiers.add(targetId.toLowerCase());
      await populateLiveAccountSelfIdentifiers(context, account, selfIdentifiers);

      try {
        const targetMeta = await extractFacebookTargetMetadata(page, groupUrl);
        for (const tid of targetMeta.targetIds) {
          selfIdentifiers.add(tid.toLowerCase());
        }
        if (targetMeta.targetDisplayName) {
          selfIdentifiers.add(targetMeta.targetDisplayName.toLowerCase());
        }
      } catch (e) {}

      const selfUsername = await page.evaluate(() => {
        const profileAnchor = document.querySelector('a[href*="/me/"], a[href*="/profile.php"], a[href^="/"][href*="ref=bookmarks"]');
        if (profileAnchor) {
          const href = profileAnchor.getAttribute('href') || '';
          if (href.includes('profile.php?id=')) {
            const urlObj = new URL(href, window.location.href);
            return urlObj.searchParams.get('id') || '';
          } else {
            const path = href.replace(/^(https?:\/\/)?(www\.)?facebook\.com/, '').split('?')[0].replace(/^\/|\/$/g, '');
            if (path && path !== 'me') return path;
          }
        }
        return (window as any).currentUserInitialData?.USER_ID || '';
      }).catch(() => '');
      if (selfUsername) selfIdentifiers.add(selfUsername.toLowerCase());

      console.log(`[Facebook] Active scraper self identifiers:`, Array.from(selfIdentifiers));

      const members = new Map<string, { uid: string; displayName: string; avatarUrl: string }>();
      const detachInterceptor = attachFacebookGraphQLInterceptor(page, selfIdentifiers, members, onMembersScraped);
      let scrollCount = 0;
      let lastSize = 0;
      let noChangeIterations = 0;
      let lastCallbackSize = 0;
      const maxNoChange = 35;
      
      while (members.size < limit && noChangeIterations < maxNoChange) {
        if (page.isClosed()) {
          throw new Error('Trình duyệt hoặc trang web đã bị đóng đột ngột.');
        }

        // 1. Adaptive Scrolling: Back-off & Jitter when stuck
        let scrollStep = Math.floor(Math.random() * 400) + 600; // 600 - 1000px
        if (noChangeIterations >= 4 && noChangeIterations % 3 === 0) {
          console.log(`[Facebook] Adaptive scroll back-off: Scrolling up 400px to trigger observer listener (Retry ${noChangeIterations}/${maxNoChange})...`);
          await page.evaluate(() => window.scrollBy(0, -400)).catch(() => {});
          await page.waitForTimeout(1000).catch(() => {});
          scrollStep = 1100; // Large step down
        }

        await page.evaluate((step) => {
          window.scrollBy(0, step);
          window.dispatchEvent(new Event('scroll'));
        }, scrollStep).catch((e) => {
          throw new Error(`Mất kết nối với trang (Page crashed / closed): ${e.message}`);
        });
        
        // 2. Click "Xem thêm" / "See more" buttons if rendered in DOM
        if (noChangeIterations >= 2) {
          await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], a[role="button"], button'));
            for (const btn of buttons) {
              const txt = (btn.textContent || '').toLowerCase().trim();
              if (txt === 'xem thêm' || txt === 'tải thêm' || txt === 'see more' || txt === 'show more' || txt === 'thử lại') {
                (btn as HTMLElement).click();
              }
            }
          }).catch(() => {});
        }

        // 3. Dynamic delay: give VPS network more breathing room when GraphQL is waiting
        const baseDelay = noChangeIterations > 5 ? 3000 : 1800;
        const delay = Math.floor(Math.random() * 1200) + baseDelay;
        await page.waitForTimeout(delay).catch(() => {});

        // 4. Scroll Jitter (micro scroll up to mimic human read review)
        if (scrollCount > 0 && scrollCount % 5 === 0) {
          if (page.isClosed()) {
            throw new Error('Trình duyệt hoặc trang web đã bị đóng đột ngột.');
          }
          const jitterStep = -Math.floor(Math.random() * 150) - 150; // -150 to -300px
          await page.evaluate((step) => window.scrollBy(0, step), jitterStep).catch(() => {});
          await page.waitForTimeout(1000).catch(() => {});
        }
        
        // 5. DOM Recycling: clean up off-screen image elements to save memory and prevent OOM Page crashes on VPS
        if (scrollCount > 0 && scrollCount % 6 === 0) {
          if (page.isClosed()) {
            throw new Error('Trình duyệt hoặc trang web đã bị đóng đột ngột.');
          }
          await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img'));
            images.forEach(img => {
              const rect = img.getBoundingClientRect();
              if (rect.bottom < -2000) {
                img.src = '';
                img.remove();
              }
            });
          }).catch(() => {});
        }
        
        const currentMembers = await page.evaluate(() => {
          const list: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];
          const mainContainer = document.querySelector('div[role="main"]') || document.querySelector('div[role="dialog"]') || document.body;
          const anchors = Array.from(mainContainer.querySelectorAll('a[role="link"], a[href*="/user/"], a[href*="/profile.php"]'));
          
          anchors.forEach(a => {
            if (
              a.closest('div[role="complementary"]') || 
              a.closest('div[role="navigation"]') || 
              a.closest('[aria-label*="Người liên hệ"]') || 
              a.closest('[aria-label*="Contacts"]') ||
              a.closest('[aria-label*="Cuộc trò chuyện"]') ||
              a.closest('[aria-label*="Chat"]')
            ) {
              return;
            }

            const href = a.getAttribute('href');
            if (!href) return;
            
            let uid = '';
            let displayName = a.textContent?.trim() || '';
            
            if (href.includes('/user/')) {
              const match = href.match(/\/user\/([^\/]+)/);
              if (match) uid = match[1];
            } else if (href.includes('profile.php?id=')) {
              const urlObj = new URL(href, window.location.href);
              uid = urlObj.searchParams.get('id') || '';
            } else {
              const path = href.replace(/^(https?:\/\/)?(www\.)?facebook\.com/, '').split('?')[0].replace(/^\/|\/$/g, '');
              const skipKeywords = ['groups', 'messages', 'notifications', 'friends', 'marketplace', 'watch', 'gaming', 'events', 'saved', 'memories', 'pages', 'ads', 'policies', 'help', 'login', 'recover', 'me', 'bookmarks', 'feed', 'stories'];
              if (path && !path.includes('/') && !skipKeywords.includes(path.toLowerCase())) {
                uid = path;
              }
            }
            
            if (uid && displayName && displayName.length > 1 && displayName.length < 50 && !displayName.includes('\n')) {
              const parent = a.closest('div');
              let avatarUrl = '';
              if (parent) {
                const img = parent.querySelector('img');
                if (img) avatarUrl = img.getAttribute('src') || '';
              }
              list.push({ uid, displayName, avatarUrl });
            }
          });
          return list;
        });
        
        for (const item of currentMembers) {
          const uidLower = item.uid.toLowerCase();
          if (selfIdentifiers.has(uidLower)) {
            continue;
          }
          if (!members.has(item.uid)) {
            members.set(item.uid, item);
          }
        }
        
        console.log(`[Facebook] Scraped ${members.size}/${limit} members...`);
        
        // Trigger incremental callback every 50 new members
        const unsavedCount = members.size - lastCallbackSize;
        if (unsavedCount >= 50 && onMembersScraped) {
          const unsavedChunk = Array.from(members.values()).slice(lastCallbackSize, members.size);
          await onMembersScraped(unsavedChunk).catch((e) => {
            console.error('[Facebook] Error saving incremental chunk:', e.message);
          });
          lastCallbackSize = members.size;
        }
        
        if (members.size === lastSize) {
          noChangeIterations++;
          if (noChangeIterations % 5 === 0) {
            console.log(`[Facebook] No new members found after ${noChangeIterations}/${maxNoChange} cycles. Current leads: ${members.size}/${limit}...`);
          }
        } else {
          noChangeIterations = 0;
          lastSize = members.size;
        }
        
        scrollCount++;
      }
      
      // Save any remaining unsaved members at the end
      if (members.size > lastCallbackSize && onMembersScraped) {
        const remaining = Array.from(members.values()).slice(lastCallbackSize);
        await onMembersScraped(remaining).catch((e) => {
          console.error('[Facebook] Error saving final remaining chunk:', e.message);
        });
      }

      // Seamless mbasic Fallback: If desktop Comet interface stopped before reaching target limit,
      // activate mbasic.facebook.com to bypass client-side virtualization & GraphQL throttles
      if (members.size < limit && !page.isClosed()) {
        console.log(`[Facebook] 🔄 Desktop scrape yielded ${members.size}/${limit} leads. Activating mbasic.facebook.com fallback engine to fetch remaining members...`);
        try {
          await NetworkScraperEngine.scrapeGroupMembersViaMbasic(
            page,
            targetGroup,
            limit,
            selfIdentifiers,
            members,
            onMembersScraped
          );
        } catch (mbasicErr: any) {
          console.warn(`[Facebook] Non-fatal mbasic fallback warning:`, mbasicErr.message);
        }
      }

      if (members.size >= limit) {
        console.log(`[Facebook] ✅ Scrape completed: Reached limit (${members.size}/${limit} members).`);
      } else if (noChangeIterations >= maxNoChange) {
        console.log(`[Facebook] ℹ️ Scrape ended. Total collected: ${members.size} leads.`);
      }
      
      await context.close();
      return Array.from(members.values()).slice(0, limit);
    } catch (error: any) {
      console.error(`[Facebook] Failed to scrape group members:`, error.message);
      if (context) {
        const errorPage = page || (await context.pages())[0];
        if (errorPage) await saveErrorScreenshot(errorPage, account.username, 'facebook_scrape_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async getViewerAccountId(context: BrowserContext): Promise<string | null> {
    try {
      const cookies = await context.cookies();
      const cUser = cookies.find(c => c.name === 'c_user');
      if (cUser && cUser.value && /^\d+$/.test(cUser.value)) {
        return cUser.value;
      }
    } catch (e) {}
    return null;
  }

  static async resolvePostIdIfNeeded(page: Page, postUrl: string): Promise<string | null> {
    const fromUrl = NetworkScraperEngine.extractPostIdFromUrl(postUrl);
    if (fromUrl) return fromUrl;

    try {
      // Try mbasic redirect first for fast numeric ID resolution
      const mbasicUrl = postUrl.replace(/^(https?:\/\/)?(www\.|m\.)?facebook\.com\//, 'https://mbasic.facebook.com/');
      await page.goto(mbasicUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);

      const redirectedUrl = page.url();
      const fromRedirect = NetworkScraperEngine.extractPostIdFromUrl(redirectedUrl);
      if (fromRedirect) return fromRedirect;

      const content = await page.content().catch(() => '');
      
      const fbidMatch = content.match(/story_fbid=(\d{8,25})/) || content.match(/"story_fbid"\s*:\s*"(\d{8,25})"/);
      if (fbidMatch) return fbidMatch[1];

      const ftEntMatch = content.match(/ft_ent_identifier=(\d{8,25})/);
      if (ftEntMatch) return ftEntMatch[1];

      const postMatch = content.match(/"post_id"\s*:\s*"(\d{8,25})"/);
      if (postMatch) return postMatch[1];

      const alIosMatch = content.match(/content="fb:\/\/(?:post|photo)\/(\d{8,25})/);
      if (alIosMatch) return alIosMatch[1];

      const feedbackMatch = content.match(/feedback_id=(\d{8,25})/) || content.match(/"feedback_id"\s*:\s*"(\d{8,25})"/);
      if (feedbackMatch) return feedbackMatch[1];

    } catch (e: any) {
      console.warn(`[Facebook Post ID Resolver] Warning resolving post ID for ${postUrl}:`, e.message);
    }
    return null;
  }

  static async collectPostPermalinks(page: Page, targetUrl: string, maxPosts: number = 100): Promise<string[]> {
    const cleanUrl = normalizeFacebookTargetUrl(targetUrl);
    if (isDirectFacebookPostUrl(cleanUrl)) {
      console.log(`[Facebook Post Harvester] Target is already a direct post permalink: ${cleanUrl}`);
      return [cleanUrl];
    }

    const postUrls = new Set<string>();
    let cleanBase = cleanUrl;
    if (cleanBase.endsWith('/followers')) cleanBase = cleanBase.replace(/\/followers$/, '');
    if (cleanBase.endsWith('/posts')) cleanBase = cleanBase.replace(/\/posts$/, '');

    const feedTabs = [
      cleanBase,
      `${cleanBase}/posts`,
      `${cleanBase}/photos`,
      `${cleanBase}/videos`,
      `${cleanBase}/reels`,
      `${cleanBase}/community`,
      `${cleanBase}/mentions`
    ];

    for (const tabUrl of feedTabs) {
      if (postUrls.size >= maxPosts || page.isClosed()) break;
      try {
        console.log(`[Facebook Post Harvester] Scanning feed tab for post links: ${tabUrl}`);
        await page.goto(tabUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await dismissFacebookOverlays(page);

        let scrollAttempts = 0;
        let stagnantCount = 0;

        while (postUrls.size < maxPosts && scrollAttempts < 20 && stagnantCount < 4) {
          if (page.isClosed()) break;
          const sizeBefore = postUrls.size;

          const links = await page.evaluate(() => {
            const results: string[] = [];
            const anchors = Array.from(document.querySelectorAll('a[href]'));

            anchors.forEach(a => {
              const href = a.getAttribute('href') || '';
              if (!href) return;

              const isPostLink = 
                href.includes('/posts/') || 
                href.includes('/permalink.php') || 
                href.includes('/permalink/') || 
                href.includes('/photo.php') || 
                href.includes('/photo?') || 
                href.includes('/photo/') ||
                href.includes('/photos/') ||
                href.includes('/reel/') || 
                href.includes('/reels/') ||
                href.includes('/watch/') || 
                href.includes('/story.php') ||
                href.includes('story_fbid=') ||
                href.includes('pfbid') ||
                href.includes('set=a.') ||
                href.includes('fbid=');

              const isIrrelevant = 
                href.includes('/friends') || 
                href.includes('/followers') || 
                href.includes('/following') || 
                href.includes('/about') || 
                href.includes('/reviews') || 
                href.includes('/login') || 
                href.includes('/recover') || 
                href.includes('/settings');

              if (isPostLink && !isIrrelevant) {
                const fullUrl = href.startsWith('http') ? href : `https://www.facebook.com${href.startsWith('/') ? '' : '/'}${href}`;
                results.push(fullUrl);
              }
            });

            return results;
          });

          links.forEach(l => {
            let normalized = l;
            if (normalized.includes('&__cft__')) normalized = normalized.split('&__cft__')[0];
            if (normalized.includes('?__cft__')) normalized = normalized.split('?__cft__')[0];
            if (normalized.includes('&__tn__')) normalized = normalized.split('&__tn__')[0];
            if (normalized.includes('?__tn__')) normalized = normalized.split('?__tn__')[0];
            postUrls.add(normalized);
          });

          console.log(`[Facebook Post Harvester] Discovered ${postUrls.size}/${maxPosts} unique post permalinks...`);

          if (postUrls.size === sizeBefore) {
            stagnantCount++;
          } else {
            stagnantCount = 0;
          }

          await page.evaluate(() => window.scrollBy(0, 1000)).catch(() => {});
          await page.waitForTimeout(1200 + Math.floor(Math.random() * 500));
          scrollAttempts++;
        }
      } catch (e: any) {
        console.warn(`[Facebook Post Harvester] Warning scanning tab ${tabUrl}:`, e.message);
      }
    }

    return Array.from(postUrls);
  }

  static async scrapeSinglePostDeep(
    page: Page,
    postUrl: string,
    selfIdentifiers: Set<string>,
    limitRemaining: number,
    existingMembers: Map<string, { uid: string; displayName: string; avatarUrl: string }>,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<number> {
    console.log(`[Facebook Deep Harvester] 🚀 Navigating directly to post: ${postUrl}`);
    let newLeadsCount = 0;
    let lastSavedSize = existingMembers.size;

    // Attach response listener for GraphQL (strictly parse valid user entities with displayName)
    const responseHandler = async (response: any) => {
      try {
        const url = response.url();
        if (url.includes('/graphql') || url.includes('/api/graphql/')) {
          const text = await response.text().catch(() => '');
          if (text && (text.includes('"id"') || text.includes('profile_picture') || text.includes('actor') || text.includes('node'))) {
            const userMatches: RegExpMatchArray[] = Array.from(text.matchAll(/"id"\s*:\s*"(\d{8,20})"[^}]*?"name"\s*:\s*"((?:\\.|[^"\\])+)"/g));
            for (const match of userMatches) {
              const uid = match[1];
              let displayName = match[2] || '';
              if (displayName) {
                try {
                  displayName = JSON.parse(`"${displayName}"`).trim();
                } catch (e) {}
              }
              if (uid && /^\d{8,20}$/.test(uid) && displayName && displayName.length >= 2 && !displayName.startsWith('#') && !displayName.includes('\n')) {
                const uidLower = uid.toLowerCase();
                if (!selfIdentifiers.has(uidLower) && !existingMembers.has(uid)) {
                  existingMembers.set(uid, { uid, displayName, avatarUrl: '' });
                  newLeadsCount++;
                }
              }
            }
          }
        }
      } catch (e) {}
    };

    page.on('response', responseHandler);

    try {
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      await dismissFacebookOverlays(page);

      // 1. Trigger Reactions Dialog
      await page.evaluate(() => {
        const rxBtns = Array.from(document.querySelectorAll('div[role="button"], span, a[href*="reaction"], a[href*="ufi"], span[role="toolbar"]')).filter(el => {
          const text = el.textContent?.trim() || '';
          const aria = el.getAttribute('aria-label') || '';
          return /\d+/.test(text) || aria.includes('cảm xúc') || aria.includes('reaction') || aria.includes('reactions') || text.includes('người khác') || text.includes('others') || text.includes('thích') || text.includes('like');
        });
        rxBtns.slice(0, 3).forEach(b => {
          b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          (b as HTMLElement).click();
        });
      }).catch(() => {});

      await page.waitForTimeout(1800);

      // Check if dialog opened
      let hasDialog = await page.$('div[role="dialog"]');
      if (hasDialog) {
        console.log(`[Facebook Deep Harvester] Reaction Dialog opened on post! Paginating reactors across all categories...`);
        
        for (let tabIdx = 0; tabIdx < 7; tabIdx++) {
          if (page.isClosed() || existingMembers.size >= limitRemaining + lastSavedSize) break;

          await page.evaluate((idx) => {
            const dialog = document.querySelector('div[role="dialog"]');
            if (dialog) {
              const tabs = Array.from(dialog.querySelectorAll('div[role="tab"], div[role="button"]')).filter(t => {
                const aria = t.getAttribute('aria-label') || '';
                const text = t.textContent?.trim() || '';
                return aria.includes('Tất cả') || aria.includes('Thích') || aria.includes('Yêu thích') || aria.includes('All') || aria.includes('Like') || aria.includes('Haha') || aria.includes('Wow') || aria.includes('Love') || aria.includes('Care') || text.includes('Tất cả') || text.includes('Thích') || text.includes('All');
              });
              if (tabs[idx]) {
                tabs[idx].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                (tabs[idx] as HTMLElement).click();
              }
            }
          }, tabIdx).catch(() => {});

          await page.waitForTimeout(600);

          for (let dScroll = 0; dScroll < 30; dScroll++) {
            if (page.isClosed()) break;
            await page.evaluate(() => {
              const dialog = document.querySelector('div[role="dialog"]');
              if (dialog) {
                const scrollables = Array.from(dialog.querySelectorAll('div')).filter(el => {
                  return el.scrollHeight > el.clientHeight && el.clientHeight > 100;
                });
                if (scrollables.length > 0) {
                  scrollables.forEach(c => c.scrollBy(0, 800));
                } else {
                  dialog.scrollBy(0, 800);
                }
              }
            }).catch(() => {});
            await page.waitForTimeout(300);

            if (existingMembers.size - lastSavedSize >= 20 && onMembersScraped) {
              const unsavedChunk = Array.from(existingMembers.values()).slice(lastSavedSize);
              await onMembersScraped(unsavedChunk).catch(() => {});
              lastSavedSize = existingMembers.size;
            }
          }
        }

        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(600);
      }

      // 2. Expand Comments
      await page.evaluate(() => {
        const filterBtns = Array.from(document.querySelectorAll('div[role="button"], span')).filter(el => {
          const text = el.textContent?.trim() || '';
          return text.includes('Phù hợp nhất') || text.includes('Most relevant') || text.includes('Bình luận phù hợp nhất');
        });
        filterBtns.forEach(b => (b as HTMLElement).click());
      }).catch(() => {});

      await page.waitForTimeout(800);

      await page.evaluate(() => {
        const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="option"], span')).filter(el => {
          const text = el.textContent?.trim() || '';
          return text.includes('Tất cả bình luận') || text.includes('All comments');
        });
        if (menuItems.length > 0) (menuItems[0] as HTMLElement).click();
      }).catch(() => {});

      for (let cIter = 0; cIter < 12; cIter++) {
        if (page.isClosed()) break;
        await page.evaluate(() => {
          const commentButtons = Array.from(document.querySelectorAll('div[role="button"], span, a')).filter(el => {
            const text = el.textContent?.toLowerCase() || '';
            return text.includes('bình luận') || text.includes('comment') || text.includes('xem thêm bình luận') || text.includes('view more comments') || text.includes('câu trả lời') || text.includes('replies') || text.includes('xem các bình luận trước');
          });
          commentButtons.slice(0, 8).forEach(b => (b as HTMLElement).click());
        }).catch(() => {});
        await page.waitForTimeout(500);
      }

      // Extract DOM anchors
      const domLeads = await page.evaluate(() => {
        const list: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];
        const skipKeywords = ['groups', 'messages', 'notifications', 'friends', 'marketplace', 'watch', 'gaming', 'events', 'saved', 'memories', 'pages', 'ads', 'policies', 'help', 'login', 'recover', 'followers', 'following', 'about', 'photos', 'videos', 'reels', 'posts', 'privacy', 'terms', 'shared', 'hashtag', 'places', 'location', 'me', 'bookmarks', 'feed', 'stories'];

        const targetContainer = document.querySelector('div[role="dialog"]') || document.querySelector('div[role="main"]') || document.querySelector('div[role="article"]') || document.body;

        const selectors = [
          'div[role="dialog"] a[role="link"]',
          'div[aria-label*="Bình luận"] a[role="link"]',
          'div[aria-label*="Comment"] a[role="link"]',
          'div[role="article"] a[role="link"]',
          'a[role="link"][href*="profile.php"]',
          'a[role="link"][href*="/people/"]',
          'a[role="link"][href*="/user/"]'
        ];

        const anchors = Array.from(targetContainer.querySelectorAll(selectors.join(', ')));
        anchors.forEach(a => {
          if (
            a.closest('div[role="complementary"]') || 
            a.closest('div[role="navigation"]') || 
            a.closest('[aria-label*="Người liên hệ"]') || 
            a.closest('[aria-label*="Contacts"]') ||
            a.closest('[aria-label*="Cuộc trò chuyện"]') ||
            a.closest('[aria-label*="Chat"]')
          ) {
            return;
          }

          const href = a.getAttribute('href');
          if (!href) return;
          if (href.includes('/hashtag/') || href.includes('/pages/') || href.includes('/places/') || href.includes('/events/')) return;

          let uid = '';
          let displayName = a.textContent?.trim() || '';
          if (displayName.startsWith('#') || displayName.length < 2 || displayName.length > 50 || displayName.includes('\n')) return;

          if (href.includes('/people/')) {
            const match = href.match(/\/people\/[^\/]+\/([^\/\?]+)/);
            if (match) uid = match[1];
          } else if (href.includes('/user/')) {
            const match = href.match(/\/user\/([^\/]+)/);
            if (match) uid = match[1];
          } else if (href.includes('profile.php?id=')) {
            try {
              const urlObj = new URL(href, window.location.href);
              uid = urlObj.searchParams.get('id') || '';
            } catch (e) {}
          } else {
            const cleanHref = href.split('?')[0].split('#')[0];
            const path = cleanHref.replace(/^(https?:\/\/)?(www\.)?facebook\.com/, '').replace(/^\/|\/$/g, '');
            if (
              path && 
              !path.includes('/') && 
              !path.startsWith('#') &&
              !path.startsWith('hashtag') &&
              /^[a-zA-Z0-9._]{3,50}$/.test(path) &&
              !skipKeywords.includes(path.toLowerCase())
            ) {
              uid = path;
            }
          }

          const isValidUid = uid && /^[a-zA-Z0-9._]{3,60}$/.test(uid) && !uid.startsWith('#') && !/^\d{1,4}$/.test(uid);

          if (isValidUid && displayName) {
            const parent = a.closest('div');
            let avatarUrl = '';
            if (parent) {
              const img = parent.querySelector('img');
              if (img) avatarUrl = img.getAttribute('src') || '';
            }
            list.push({ uid, displayName, avatarUrl });
          }
        });
        return list;
      });

      for (const item of domLeads) {
        const uidLower = item.uid.toLowerCase();
        if (selfIdentifiers.has(uidLower)) continue;
        if (!existingMembers.has(item.uid)) {
          existingMembers.set(item.uid, item);
          newLeadsCount++;
        }
      }

      if (existingMembers.size - lastSavedSize > 0 && onMembersScraped) {
        const unsavedChunk = Array.from(existingMembers.values()).slice(lastSavedSize);
        await onMembersScraped(unsavedChunk).catch(() => {});
        lastSavedSize = existingMembers.size;
      }

      // 3. MBASIC FALLBACK: If desktop dialog didn't yield enough leads, scrape via mbasic
      const leadsFromDesktop = existingMembers.size - lastSavedSize;
      if (!hasDialog || leadsFromDesktop < 30) {
        const viewerAccountId = await FacebookAutomation.getViewerAccountId(page.context());
        const postId = await FacebookAutomation.resolvePostIdIfNeeded(page, postUrl);
        if (postId && viewerAccountId) {
          console.log(`[Facebook Deep Harvester] Desktop dialog yielded few leads (${leadsFromDesktop}). Activating Mbasic Harvester for Post ${postId}...`);
          await NetworkScraperEngine.scrapeMbasicReactionsForPost(
            page,
            postId,
            viewerAccountId,
            existingMembers.size + limitRemaining,
            selfIdentifiers,
            existingMembers,
            onMembersScraped
          );
        }
      }

    } catch (err: any) {
      console.warn(`[Facebook Deep Harvester] Warning scraping post ${postUrl}:`, err.message);
    } finally {
      page.off('response', responseHandler);
    }

    console.log(`[Facebook Deep Harvester] Post completed: +${newLeadsCount} new leads (Total running: ${existingMembers.size})`);
    return newLeadsCount;
  }

  static async scrapeDirectTimelineFeed(
    page: Page,
    targetUrl: string,
    selfIdentifiers: Set<string>,
    limit: number,
    existingMembers: Map<string, { uid: string; displayName: string; avatarUrl: string }>,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<number> {
    let cleanBase = targetUrl.trim().replace(/\/$/, '');
    if (cleanBase.endsWith('/followers')) cleanBase = cleanBase.replace(/\/followers$/, '');
    console.log(`[Facebook Timeline Harvester] 🚀 Starting Direct Feed Scraper on ${cleanBase} (Target: ${limit} leads, current: ${existingMembers.size})...`);

    let lastSavedSize = existingMembers.size;
    let initialCount = existingMembers.size;

    // Attach strict structured GraphQL listener
    const detachInterceptor = attachFacebookGraphQLInterceptor(page, selfIdentifiers, existingMembers, onMembersScraped);

    try {
      await page.goto(cleanBase, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(3000);
      await dismissFacebookOverlays(page);
      await injectFacebookIsolationStyles(page);

      let scrollCount = 0;
      let noChangeIterations = 0;
      let lastTotalSize = existingMembers.size;

      const maxNoChange = 35;

      while (existingMembers.size < limit && scrollCount < 250 && noChangeIterations < maxNoChange) {
        if (page.isClosed()) break;

        // Adaptive Back-off Scroll
        if (noChangeIterations >= 4 && noChangeIterations % 3 === 0) {
          await page.evaluate(() => window.scrollBy(0, -400)).catch(() => {});
          await page.waitForTimeout(1000).catch(() => {});
        }

        // 1. Click reaction counters visible on the feed
        await page.evaluate(() => {
          const mainFeed = document.querySelector('div[role="main"]') || document.querySelector('div[role="feed"]') || document.body;
          const rxBtns = Array.from(mainFeed.querySelectorAll('div[role="button"], span, a[href*="reaction"], a[href*="ufi"], span[role="toolbar"]')).filter(el => {
            if (
              el.closest('div[role="complementary"]') || 
              el.closest('div[role="navigation"]') || 
              el.closest('[aria-label*="Người liên hệ"]') || 
              el.closest('[aria-label*="Contacts"]')
            ) return false;
            const text = el.textContent?.trim() || '';
            const aria = el.getAttribute('aria-label') || '';
            return /\d+/.test(text) || aria.includes('cảm xúc') || aria.includes('reaction') || text.includes('người khác') || text.includes('others') || text.includes('thích');
          });
          rxBtns.slice(0, 4).forEach(b => {
            b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            (b as HTMLElement).click();
          });
        }).catch(() => {});

        await page.waitForTimeout(1500);

        // Check if reaction dialog opened
        let hasDialog = await page.$('div[role="dialog"]');
        if (hasDialog) {
          for (let dScroll = 0; dScroll < 15; dScroll++) {
            if (page.isClosed() || existingMembers.size >= limit) break;
            await page.evaluate(() => {
              const dialog = document.querySelector('div[role="dialog"]');
              if (dialog) {
                const scrollables = Array.from(dialog.querySelectorAll('div')).filter(el => el.scrollHeight > el.clientHeight && el.clientHeight > 100);
                if (scrollables.length > 0) scrollables.forEach(c => c.scrollBy(0, 800));
                else dialog.scrollBy(0, 800);
              }
            }).catch(() => {});
            await page.waitForTimeout(400);

            if (existingMembers.size - lastSavedSize >= 25 && onMembersScraped) {
              const unsaved = Array.from(existingMembers.values()).slice(lastSavedSize);
              await onMembersScraped(unsaved).catch(() => {});
              lastSavedSize = existingMembers.size;
            }
          }

          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(500);
        }

        // 2. Expand comment buttons on feed
        await page.evaluate(() => {
          const mainFeed = document.querySelector('div[role="main"]') || document.querySelector('div[role="feed"]') || document.body;
          const commentButtons = Array.from(mainFeed.querySelectorAll('div[role="button"], span, a')).filter(el => {
            if (
              el.closest('div[role="complementary"]') || 
              el.closest('div[role="navigation"]') || 
              el.closest('[aria-label*="Người liên hệ"]') || 
              el.closest('[aria-label*="Contacts"]')
            ) return false;
            const text = el.textContent?.toLowerCase() || '';
            return text.includes('bình luận') || text.includes('comment') || text.includes('xem thêm bình luận') || text.includes('view more comments') || text.includes('câu trả lời');
          });
          commentButtons.slice(0, 4).forEach(b => (b as HTMLElement).click());
        }).catch(() => {});

        await page.waitForTimeout(800);

        // 3. Extract DOM anchors from feed
        const currentDOM = await page.evaluate(() => {
          const list: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];
          const skipKeywords = ['groups', 'messages', 'notifications', 'friends', 'marketplace', 'watch', 'gaming', 'events', 'saved', 'memories', 'pages', 'ads', 'policies', 'help', 'login', 'recover', 'followers', 'following', 'about', 'photos', 'videos', 'reels', 'posts', 'privacy', 'terms', 'me', 'bookmarks', 'feed', 'stories'];
          const mainContainer = document.querySelector('div[role="main"]') || document.querySelector('div[role="dialog"]') || document.querySelector('div[role="feed"]') || document.body;
          const anchors = Array.from(mainContainer.querySelectorAll('a[role="link"], a[href*="/user/"], a[href*="/profile.php"], a[href*="/people/"]'));

          anchors.forEach(a => {
            if (
              a.closest('div[role="complementary"]') || 
              a.closest('div[role="navigation"]') || 
              a.closest('[aria-label*="Người liên hệ"]') || 
              a.closest('[aria-label*="Contacts"]') ||
              a.closest('[aria-label*="Cuộc trò chuyện"]') ||
              a.closest('[aria-label*="Chat"]')
            ) {
              return;
            }

            const href = a.getAttribute('href');
            if (!href) return;
            let uid = '';
            let displayName = a.textContent?.trim() || '';

            if (href.includes('/people/')) {
              const match = href.match(/\/people\/[^\/]+\/([^\/\?]+)/);
              if (match) uid = match[1];
            } else if (href.includes('/user/')) {
              const match = href.match(/\/user\/([^\/]+)/);
              if (match) uid = match[1];
            } else if (href.includes('profile.php?id=')) {
              try {
                const urlObj = new URL(href, window.location.href);
                uid = urlObj.searchParams.get('id') || '';
              } catch (e) {}
            } else {
              const cleanHref = href.split('?')[0].split('#')[0];
              const path = cleanHref.replace(/^(https?:\/\/)?(www\.)?facebook\.com/, '').replace(/^\/|\/$/g, '');
              if (
                path && 
                !path.includes('/') && 
                !path.startsWith('#') &&
                !path.startsWith('hashtag') &&
                /^[a-zA-Z0-9._]+$/.test(path) &&
                !skipKeywords.includes(path.toLowerCase())
              ) {
                uid = path;
              }
            }

            const isValidUid = uid && /^[a-zA-Z0-9._]{3,60}$/.test(uid) && !uid.startsWith('#');
            if (isValidUid && displayName && displayName.length > 1 && displayName.length < 50 && !displayName.includes('\n')) {
              list.push({ uid, displayName, avatarUrl: '' });
            }
          });
          return list;
        });

        for (const item of currentDOM) {
          const uidLower = item.uid.toLowerCase();
          if (selfIdentifiers.has(uidLower)) continue;
          if (!existingMembers.has(item.uid)) {
            existingMembers.set(item.uid, item);
          }
        }

        console.log(`[Facebook Timeline Harvester] Running count: ${existingMembers.size}/${limit} leads...`);

        // Stream incremental chunk
        if (existingMembers.size - lastSavedSize >= 25 && onMembersScraped) {
          const unsaved = Array.from(existingMembers.values()).slice(lastSavedSize);
          await onMembersScraped(unsaved).catch(() => {});
          lastSavedSize = existingMembers.size;
        }

        if (existingMembers.size === lastTotalSize) {
          noChangeIterations++;
        } else {
          noChangeIterations = 0;
          lastTotalSize = existingMembers.size;
        }

        // Scroll down timeline
        await page.evaluate(() => window.scrollBy(0, 1200)).catch(() => {});
        const baseDelay = noChangeIterations > 5 ? 2500 : 1500;
        await page.waitForTimeout(baseDelay + Math.floor(Math.random() * 800));
        scrollCount++;
      }

      if (existingMembers.size > lastSavedSize && onMembersScraped) {
        const unsaved = Array.from(existingMembers.values()).slice(lastSavedSize);
        await onMembersScraped(unsaved).catch(() => {});
      }

    } catch (err: any) {
      console.warn(`[Facebook Timeline Harvester] Warning during feed scan:`, err.message);
    } finally {
      detachInterceptor();
    }

    const harvestedCount = existingMembers.size - initialCount;
    console.log(`[Facebook Timeline Harvester] Completed! Added +${harvestedCount} leads (Total: ${existingMembers.size})`);
    return harvestedCount;
  }

  /**
   * Deep Direct Followers Tab Harvester (Scrapes the complete Grid of Followers from the Followers/People Tab)
   */
  static async scrapeFacebookFollowersTabDeep(
    page: Page,
    followersUrl: string,
    targetMeta: { targetIds: string[]; targetDisplayName: string },
    selfIdentifiers: Set<string>,
    limit: number,
    members: Map<string, { uid: string; displayName: string; avatarUrl: string }>,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<number> {
    const initialSize = members.size;
    console.log(`[Facebook Followers Tab] 🚀 Navigating to Followers Tab: ${followersUrl}...`);

    const detachInterceptor = attachFacebookGraphQLInterceptor(page, selfIdentifiers, members, onMembersScraped);

    try {
      await page.goto(followersUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await dismissFacebookOverlays(page);

      // Attempt to click the "Người theo dõi" / "Followers" tab explicitly if not already active
      await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('a[role="tab"], div[role="tab"], a[href*="followers"], a[href*="sk=followers"]'));
        for (const tab of tabs) {
          const text = (tab.textContent || '').trim().toLowerCase();
          if (text.includes('người theo dõi') || text.includes('followers')) {
            (tab as HTMLElement).click();
            break;
          }
        }
      }).catch(() => {});

      await page.waitForTimeout(1500);

      let stagnantCount = 0;
      let scrollAttempts = 0;
      let lastSavedSize = members.size;
      const maxStagnant = 35;

      while (members.size < limit && stagnantCount < maxStagnant && scrollAttempts < 250) {
        if (page.isClosed()) break;
        scrollAttempts++;
        const sizeBefore = members.size;

        // Adaptive Back-off Scroll
        if (stagnantCount >= 4 && stagnantCount % 3 === 0) {
          await page.evaluate(() => {
            window.scrollBy(0, -400);
            const main = document.querySelector('div[role="main"]');
            if (main) main.scrollBy(0, -400);
          }).catch(() => {});
          await page.waitForTimeout(1000).catch(() => {});
        }

        const currentCards = await page.evaluate((targetDisplayName) => {
          const list: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];
          const mainContainer = document.querySelector('div[role="main"]') || document.querySelector('div[role="dialog"]') || document.body;
          const anchors = Array.from(mainContainer.querySelectorAll('a[role="link"], a[href]'));

          const skipKeywords = [
            'groups', 'messages', 'notifications', 'friends', 'marketplace', 'watch',
            'events', 'saved', 'pages', 'ads', 'policies', 'help', 'login', 'recover', 'settings',
            'privacy', 'terms', 'photo.php', 'video.php', 'story.php', 'home.php', 'menu', 'bug', 'r.php',
            'hashtag', 'hashtags', 'places', 'location', 'allactivity', 'browse', 'search', 'sharer.php',
            'about', 'photos', 'videos', 'reels', 'posts', 'permalink', 'feed', 'followers', 'following', 'sk=followers'
          ];

          anchors.forEach(a => {
            if (
              a.closest('div[role="complementary"]') || 
              a.closest('div[role="navigation"]') || 
              a.closest('[aria-label*="Người liên hệ"]') || 
              a.closest('[aria-label*="Contacts"]') ||
              a.closest('[aria-label*="Chat"]')
            ) {
              return;
            }

            const href = a.getAttribute('href') || '';
            if (!href || href.startsWith('#')) return;

            let uid = '';
            const displayName = (a.textContent || '').trim();

            if (href.includes('/people/')) {
              const m = href.match(/\/people\/[^\/]+\/(\d+)/);
              if (m) uid = m[1];
            } else if (href.includes('/user/')) {
              const match = href.match(/\/user\/([^\/]+)/);
              if (match) uid = match[1];
            } else if (href.includes('profile.php?id=')) {
              try {
                const urlObj = new URL(href, window.location.href);
                uid = urlObj.searchParams.get('id') || '';
              } catch (e) {}
            } else {
              const cleanHref = href.split('?')[0].split('#')[0];
              const path = cleanHref.replace(/^(https?:\/\/)?(www\.)?facebook\.com/, '').replace(/^\/|\/$/g, '');
              if (
                path && 
                !path.includes('/') && 
                !path.startsWith('#') &&
                !path.startsWith('hashtag') &&
                /^[a-zA-Z0-9._]+$/.test(path) &&
                !skipKeywords.includes(path.toLowerCase())
              ) {
                uid = path;
              }
            }

            const isValidUid = uid && /^[a-zA-Z0-9._]{3,60}$/.test(uid) && !uid.startsWith('#') && !skipKeywords.includes(uid.toLowerCase());
            if (
              isValidUid && 
              displayName && 
              displayName.length >= 2 && 
              displayName.length < 60 && 
              !displayName.includes('\n') &&
              !displayName.startsWith('#') &&
              !['theo dõi', 'follow', 'nhắn tin', 'message', 'thích', 'like', 'bạn bè', 'xem thêm'].includes(displayName.toLowerCase())
            ) {
              const parent = a.closest('div');
              let avatarUrl = '';
              if (parent) {
                const img = parent.querySelector('img');
                if (img) avatarUrl = img.getAttribute('src') || '';
              }
              list.push({ uid, displayName, avatarUrl });
            }
          });
          return list;
        }, targetMeta.targetDisplayName || '');

        const newBatch: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];
        for (const card of currentCards) {
          const uidLower = card.uid.toLowerCase();
          const dNameLower = card.displayName.toLowerCase();
          if (
            selfIdentifiers.has(uidLower) || 
            selfIdentifiers.has(dNameLower) ||
            (targetMeta.targetDisplayName && dNameLower === targetMeta.targetDisplayName.toLowerCase()) ||
            members.has(card.uid)
          ) {
            continue;
          }
          members.set(card.uid, card);
          newBatch.push(card);
        }

        if (newBatch.length > 0 && onMembersScraped) {
          await onMembersScraped(newBatch).catch(() => {});
          lastSavedSize = members.size;
        }

        console.log(`[Facebook Followers Tab] Cycle ${scrollAttempts}: +${newBatch.length} leads (Total: ${members.size}/${limit})`);

        if (members.size === sizeBefore) {
          stagnantCount++;
        } else {
          stagnantCount = 0;
        }

        // Scroll down smoothly
        await page.evaluate(() => {
          window.scrollBy(0, 1400);
          const main = document.querySelector('div[role="main"]');
          if (main) main.scrollBy(0, 1400);
        }).catch(() => {});

        const baseDelay = stagnantCount > 5 ? 2200 : 1200;
        await page.waitForTimeout(baseDelay + Math.floor(Math.random() * 800));
      }

    } catch (e: any) {
      console.warn(`[Facebook Followers Tab] Warning:`, e.message);
    } finally {
      detachInterceptor();
    }

    const added = members.size - initialSize;
    console.log(`[Facebook Followers Tab] Finished deep follower tab scan! Added +${added} leads (Total: ${members.size})`);
    return added;
  }

  static async scrapeKOLFollowers(
    account: AccountConfig,
    proxy: ProxyConfig | undefined,
    targetGroup: string,
    limit: number,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log(`[Facebook] 🚀 Starting High-Capacity Follower Harvester (Target: ${limit} leads) for ${targetGroup} using @${account.username}...`);
    let context: BrowserContext | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      await injectCookiesIfAvailable(context, account);

      let cleanTarget = normalizeFacebookTargetUrl(targetGroup);
      const isSinglePost = isDirectFacebookPostUrl(cleanTarget);
      let followersUrl = '';
      let targetKOLId = '';

      if (cleanTarget.includes('profile.php?id=')) {
        try {
          const u = new URL(cleanTarget);
          targetKOLId = u.searchParams.get('id') || '';
        } catch (e) {}
        followersUrl = `${cleanTarget}&sk=followers`;
      } else if (!isSinglePost) {
        const parts = cleanTarget.split('?')[0].split('/').filter(Boolean);
        targetKOLId = parts[parts.length - 1] || '';
        if (targetKOLId === 'followers' && parts.length >= 2) {
          followersUrl = cleanTarget;
          targetKOLId = parts[parts.length - 2];
        } else {
          followersUrl = `${cleanTarget}/followers`;
        }
      }

      const selfIdentifiers = new Set<string>();
      if (targetKOLId) selfIdentifiers.add(targetKOLId.toLowerCase());
      await populateLiveAccountSelfIdentifiers(context, account, selfIdentifiers);

      // Extract full target entity IDs & display name to strictly blacklist target account
      let targetMeta: { targetIds: string[]; targetDisplayName: string } = { targetIds: [], targetDisplayName: '' };
      const discPage = await context.newPage();
      try {
        await discPage.goto(cleanTarget, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await discPage.waitForTimeout(2000);
        await dismissFacebookOverlays(discPage);
        targetMeta = await extractFacebookTargetMetadata(discPage, cleanTarget);
        for (const tid of targetMeta.targetIds) {
          selfIdentifiers.add(tid.toLowerCase());
        }
        if (targetMeta.targetDisplayName) {
          selfIdentifiers.add(targetMeta.targetDisplayName.toLowerCase());
        }
        console.log(`[Facebook] Target entity metadata blacklist:`, targetMeta);
      } catch (e: any) {
        console.warn(`[Facebook] Target metadata discovery warning:`, e.message);
      } finally {
        await discPage.close().catch(() => {});
      }

      console.log(`[Facebook] Active scraper self identifiers blacklist:`, Array.from(selfIdentifiers));

      const members = new Map<string, { uid: string; displayName: string; avatarUrl: string }>();
      let lastCallbackSize = 0;

      // STEP 1: DEEP FOLLOWERS TAB HARVESTER (DOM Grid + GraphQL Interception)
      if (!isSinglePost && followersUrl) {
        console.log(`[Facebook] 🚀 Step 1: Initiating Deep Followers Tab Harvester on ${followersUrl}...`);
        const tabFollowersPage = await context.newPage();
        try {
          await FacebookAutomation.scrapeFacebookFollowersTabDeep(
            tabFollowersPage,
            followersUrl,
            targetMeta,
            selfIdentifiers,
            limit,
            members,
            onMembersScraped
          );
          lastCallbackSize = members.size;
        } finally {
          await tabFollowersPage.close().catch(() => {});
        }
      }

      // STEP 1.5: DIRECT MBASIC FANPAGE TIMELINE HARVESTER (If Followers is below limit)
      if (members.size < limit && !isSinglePost) {
        console.log(`[Facebook] 🚀 Step 1.5: Activating Direct Mbasic Fanpage Timeline Harvester for ${cleanTarget} (Current Leads: ${members.size}/${limit})...`);
        const viewerAccountId = await FacebookAutomation.getViewerAccountId(context);
        if (viewerAccountId) {
          const mbasicPage = await context.newPage();
          try {
            await NetworkScraperEngine.scrapeFanpageTimelineMbasic(
              mbasicPage,
              cleanTarget,
              viewerAccountId,
              40, // scan up to 40 posts on timeline
              limit,
              selfIdentifiers,
              members,
              onMembersScraped
            );
            lastCallbackSize = members.size;
          } catch (err: any) {
            console.warn(`[Facebook] Direct Mbasic Fanpage timeline warning:`, err.message);
          } finally {
            await mbasicPage.close().catch(() => {});
          }
        }
      }

      // STEP 2: MULTI-POST & REEL PERMALINK HARVESTER (If more leads needed or for active commenters/reactors)
      let postUrls: string[] = isSinglePost ? [cleanTarget] : [];
      if (members.size < limit && !isSinglePost) {
        console.log(`[Facebook] 🚀 Step 2: Collecting Post & Media Permalinks for deep multi-post reaction/comment harvesting...`);
        const postPage = await context.newPage();
        try {
          postUrls = await FacebookAutomation.collectPostPermalinks(postPage, cleanTarget, 120);
          console.log(`[Facebook] Found ${postUrls.length} active post permalinks to process.`);
        } finally {
          await postPage.close().catch(() => {});
        }
      }

      if (members.size < limit && postUrls.length > 0) {
        const postPage = await context.newPage();
        try {
          for (let i = 0; i < postUrls.length; i++) {
            if (members.size >= limit || postPage.isClosed()) break;
            const postUrl = postUrls[i];
            console.log(`[Facebook] Processing Post [${i + 1}/${postUrls.length}]: ${postUrl} (Current Leads: ${members.size}/${limit})...`);

            await FacebookAutomation.scrapeSinglePostDeep(
              postPage,
              postUrl,
              selfIdentifiers,
              limit - members.size,
              members,
              onMembersScraped
            );

            lastCallbackSize = members.size;
            await postPage.waitForTimeout(1000 + Math.floor(Math.random() * 1000));
          }
        } finally {
          await postPage.close().catch(() => {});
        }
      }

      // STEP 2.5: MBASIC HIGH-THROUGHPUT REACTION HARVESTER (If more leads needed)
      if (members.size < limit && postUrls.length > 0) {
        console.log(`[Facebook] 🚀 Step 2.5: Activating Mbasic Reaction Harvester on ${postUrls.length} posts (Current Leads: ${members.size}/${limit})...`);
        const viewerAccountId = await FacebookAutomation.getViewerAccountId(context);
        if (viewerAccountId) {
          const mbasicPage = await context.newPage();
          try {
            for (let i = 0; i < postUrls.length; i++) {
              if (members.size >= limit || mbasicPage.isClosed()) break;
              const postUrl = postUrls[i];
              const postId = await FacebookAutomation.resolvePostIdIfNeeded(mbasicPage, postUrl);
              if (!postId) continue;

              console.log(`[Facebook Mbasic] Processing Post [${i + 1}/${postUrls.length}] ID: ${postId} (Current Leads: ${members.size}/${limit})...`);
              await NetworkScraperEngine.scrapeMbasicReactionsForPost(
                mbasicPage,
                postId,
                viewerAccountId,
                limit,
                selfIdentifiers,
                members,
                onMembersScraped
              );
              lastCallbackSize = members.size;
            }
          } finally {
            await mbasicPage.close().catch(() => {});
          }
        }
      }

      // STEP 3: FALLBACK TO DIRECT TIMELINE FEED HARVESTING IF LEADS STILL BELOW LIMIT
      if (members.size < limit && !isSinglePost) {
        console.log(`[Facebook] 🚀 Step 3: Activating Direct Timeline Feed Harvester (Current Leads: ${members.size}/${limit})...`);
        const timelinePage = await context.newPage();
        try {
          await FacebookAutomation.scrapeDirectTimelineFeed(
            timelinePage,
            cleanTarget,
            selfIdentifiers,
            limit,
            members,
            onMembersScraped
          );
        } finally {
          await timelinePage.close().catch(() => {});
        }
      }

      if (members.size > lastCallbackSize && onMembersScraped) {
        const remaining = Array.from(members.values()).slice(lastCallbackSize);
        await onMembersScraped(remaining).catch(() => {});
      }

      await context.close();
      console.log(`[Facebook] ✅ Finished High-Capacity Harvester! Total unique leads collected: ${members.size}`);
      return Array.from(members.values()).slice(0, limit);
    } catch (error: any) {
      console.error(`[Facebook] Failed to scrape KOL followers:`, error.message);
      if (context) await context.close();
      throw error;
    }
  }

  static async scrapeSwarmKOLFollowers(
    accountConfigs: Array<{ accountConfig: AccountConfig; proxyConfig?: ProxyConfig }>,
    targetGroup: string,
    limit: number,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    if (accountConfigs.length === 0) throw new Error('Không có tài khoản nào để cào dữ liệu.');
    if (accountConfigs.length === 1) {
      return this.scrapeKOLFollowers(accountConfigs[0].accountConfig, accountConfigs[0].proxyConfig, targetGroup, limit, onMembersScraped);
    }

    const cleanTarget = normalizeFacebookTargetUrl(targetGroup);
    const isSinglePost = isDirectFacebookPostUrl(cleanTarget);

    console.log(`[Facebook Swarm Engine] 🚀 Initializing Parallel Multi-Account Swarm (${accountConfigs.length} accounts, Target: ${limit} leads, IsPost: ${isSinglePost}) for ${cleanTarget}...`);

    const sharedMembers = new Map<string, { uid: string; displayName: string; avatarUrl: string }>();
    let lastCallbackSize = 0;

    let targetKOLId = '';
    if (cleanTarget.includes('profile.php?id=')) {
      try {
        const u = new URL(cleanTarget);
        targetKOLId = u.searchParams.get('id') || '';
      } catch (e) {}
    } else if (!isSinglePost) {
      const parts = cleanTarget.split('?')[0].split('/').filter(Boolean);
      targetKOLId = parts[parts.length - 1] || '';
    }

    const selfIdentifiers = new Set<string>();
    if (targetKOLId) selfIdentifiers.add(targetKOLId.toLowerCase());
    for (const acc of accountConfigs) {
      if (acc.accountConfig.username) {
        selfIdentifiers.add(acc.accountConfig.username.toLowerCase());
        if (acc.accountConfig.username.includes('@')) {
          selfIdentifiers.add(acc.accountConfig.username.split('@')[0].toLowerCase());
        }
      }
      const tokenCUser = extractCUserFromAuthToken(acc.accountConfig.auth_token);
      if (tokenCUser) {
        selfIdentifiers.add(tokenCUser.toLowerCase());
      }
    }

    // Step 0: Extract full target entity IDs & display name to strictly blacklist target account across swarm
    let targetMeta: { targetIds: string[]; targetDisplayName: string } = { targetIds: [], targetDisplayName: '' };
    let postUrls: string[] = isSinglePost ? [cleanTarget] : [];
    const primary = accountConfigs[0];
    let discContext: BrowserContext | null = null;
    try {
      killProfileProcesses(primary.accountConfig.user_data_dir);
      const launchOpts = getLaunchOptions(primary.accountConfig, primary.proxyConfig);
      discContext = await chromium.launchPersistentContext(primary.accountConfig.user_data_dir, launchOpts);
      await injectCookiesIfAvailable(discContext, primary.accountConfig);
      const discPage = await discContext.newPage();
      await discPage.goto(cleanTarget, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await discPage.waitForTimeout(2000);
      await dismissFacebookOverlays(discPage);
      targetMeta = await extractFacebookTargetMetadata(discPage, cleanTarget);
      for (const tid of targetMeta.targetIds) {
        selfIdentifiers.add(tid.toLowerCase());
      }
      if (targetMeta.targetDisplayName) {
        selfIdentifiers.add(targetMeta.targetDisplayName.toLowerCase());
      }
      console.log(`[Facebook Swarm Engine] Target entity metadata discovered:`, targetMeta);

      if (!isSinglePost) {
        postUrls = await FacebookAutomation.collectPostPermalinks(discPage, cleanTarget, 120);
      }
    } catch (e: any) {
      console.warn(`[Facebook Swarm Engine] Discovery warning:`, e.message);
    } finally {
      if (discContext) await discContext.close().catch(() => {});
    }

    console.log(`[Facebook Swarm Engine] Initialized blacklist for ${accountConfigs.length} Live accounts:`, Array.from(selfIdentifiers));

    let followersUrl = cleanTarget.includes('profile.php?id=') ? `${cleanTarget}&sk=followers` : `${cleanTarget.replace(/\/followers\/?$/, '')}/followers`;

    // STEP 1: PARALLEL SWARM DEEP FOLLOWERS TAB HARVESTER (DOM Grid + GraphQL Interception)
    if (!isSinglePost && followersUrl) {
      console.log(`[Facebook Swarm Engine] 🚀 Step 1: Initiating Deep Followers Tab Harvester for ${cleanTarget}...`);
      const primaryAcc = accountConfigs[0];
      let tabContext: BrowserContext | null = null;
      try {
        killProfileProcesses(primaryAcc.accountConfig.user_data_dir);
        const launchOpts = getLaunchOptions(primaryAcc.accountConfig, primaryAcc.proxyConfig);
        tabContext = await chromium.launchPersistentContext(primaryAcc.accountConfig.user_data_dir, launchOpts);
        await injectCookiesIfAvailable(tabContext, primaryAcc.accountConfig);
        await populateLiveAccountSelfIdentifiers(tabContext, primaryAcc.accountConfig, selfIdentifiers);
        const tabPage = await tabContext.newPage();

        await FacebookAutomation.scrapeFacebookFollowersTabDeep(
          tabPage,
          followersUrl,
          targetMeta,
          selfIdentifiers,
          limit,
          sharedMembers,
          onMembersScraped
        );
        lastCallbackSize = sharedMembers.size;
      } catch (e: any) {
        console.warn(`[Facebook Swarm Engine] Followers Tab scan warning:`, e.message);
      } finally {
        if (tabContext) await tabContext.close().catch(() => {});
      }
    }

    // STEP 1.5: DIRECT MBASIC FANPAGE TIMELINE HARVESTER (High-Speed reaction harvesting if target is Fanpage or GraphQL leads below limit)
    if (sharedMembers.size < limit && !isSinglePost) {
      console.log(`[Facebook Swarm Engine] 🚀 Step 1.5: Activating Direct Fanpage Mbasic Timeline Harvester for ${cleanTarget} (Current Leads: ${sharedMembers.size}/${limit})...`);
      const primaryAcc = accountConfigs[0];
      let mbasicContext: BrowserContext | null = null;
      try {
        killProfileProcesses(primaryAcc.accountConfig.user_data_dir);
        const launchOpts = getLaunchOptions(primaryAcc.accountConfig, primaryAcc.proxyConfig);
        mbasicContext = await chromium.launchPersistentContext(primaryAcc.accountConfig.user_data_dir, launchOpts);
        await injectCookiesIfAvailable(mbasicContext, primaryAcc.accountConfig);
        await populateLiveAccountSelfIdentifiers(mbasicContext, primaryAcc.accountConfig, selfIdentifiers);

        const viewerAccountId = await FacebookAutomation.getViewerAccountId(mbasicContext);
        if (viewerAccountId) {
          const mbasicPage = await mbasicContext.newPage();
          await NetworkScraperEngine.scrapeFanpageTimelineMbasic(
            mbasicPage,
            cleanTarget,
            viewerAccountId,
            50, // scan up to 50 posts
            limit,
            selfIdentifiers,
            sharedMembers,
            onMembersScraped
          );
          lastCallbackSize = sharedMembers.size;
        }
      } catch (err: any) {
        console.warn(`[Facebook Swarm Engine] Direct Fanpage timeline warning:`, err.message);
      } finally {
        if (mbasicContext) await mbasicContext.close().catch(() => {});
      }
    }

    if (postUrls.length > 0 && sharedMembers.size < limit) {
      const numWorkers = accountConfigs.length;
      const shards: string[][] = Array.from({ length: numWorkers }, () => []);
      postUrls.forEach((url, i) => {
        shards[i % numWorkers].push(url);
      });

      console.log(`[Facebook Swarm Engine] Sharded ${postUrls.length} posts across ${numWorkers} accounts.`);

      // Run workers with concurrency batching of 2
      const batchSize = 2;
      for (let i = 0; i < accountConfigs.length; i += batchSize) {
        if (sharedMembers.size >= limit) break;
        const currentBatch = accountConfigs.slice(i, i + batchSize);

        await Promise.allSettled(currentBatch.map(async (acc, bIdx) => {
          const workerIdx = i + bIdx;
          const workerPosts = shards[workerIdx];
          if (!workerPosts || workerPosts.length === 0) return;

          console.log(`[Swarm Worker #${workerIdx + 1} (@${acc.accountConfig.username})] Scraping ${workerPosts.length} assigned posts...`);
          let workerContext: BrowserContext | null = null;

          try {
            killProfileProcesses(acc.accountConfig.user_data_dir);
            const launchOpts = getLaunchOptions(acc.accountConfig, acc.proxyConfig);
            workerContext = await chromium.launchPersistentContext(acc.accountConfig.user_data_dir, launchOpts);
            await injectCookiesIfAvailable(workerContext, acc.accountConfig);
            await populateLiveAccountSelfIdentifiers(workerContext, acc.accountConfig, selfIdentifiers);
            const workerPage = await workerContext.newPage();

            const detachWorkerInterceptor = attachFacebookGraphQLInterceptor(workerPage, selfIdentifiers, sharedMembers, onMembersScraped);

            for (const postUrl of workerPosts) {
              if (sharedMembers.size >= limit || workerPage.isClosed()) break;

              console.log(`[Swarm Worker #${workerIdx + 1} (@${acc.accountConfig.username})] Scraping Post: ${postUrl} (Total leads: ${sharedMembers.size}/${limit})...`);

              await FacebookAutomation.scrapeSinglePostDeep(
                workerPage,
                postUrl,
                selfIdentifiers,
                limit - sharedMembers.size,
                sharedMembers,
                onMembersScraped
              );

              lastCallbackSize = sharedMembers.size;
              await workerPage.waitForTimeout(1000 + Math.floor(Math.random() * 800));
            }
          } catch (err: any) {
            console.warn(`[Swarm Worker #${workerIdx + 1} (@${acc.accountConfig.username})] Worker error:`, err.message);
          } finally {
            if (workerContext) await workerContext.close().catch(() => {});
          }
        }));
      }
    }

    // STEP 2.5: PARALLEL SWARM MBASIC REACTION HARVESTER (Sharded across accounts)
    if (sharedMembers.size < limit && postUrls.length > 0) {
      console.log(`[Facebook Swarm Engine] 🚀 Step 2.5: Parallel Mbasic Reaction Harvester across ${accountConfigs.length} accounts (Current Leads: ${sharedMembers.size}/${limit})...`);
      const numWorkers = accountConfigs.length;
      const mbasicShards: string[][] = Array.from({ length: numWorkers }, () => []);
      postUrls.forEach((url, i) => {
        mbasicShards[i % numWorkers].push(url);
      });

      const batchSize = 3;
      for (let i = 0; i < accountConfigs.length; i += batchSize) {
        if (sharedMembers.size >= limit) break;
        const currentBatch = accountConfigs.slice(i, i + batchSize);

        await Promise.allSettled(currentBatch.map(async (acc, bIdx) => {
          const workerIdx = i + bIdx;
          const workerPosts = mbasicShards[workerIdx];
          if (!workerPosts || workerPosts.length === 0) return;

          console.log(`[Swarm Mbasic Worker #${workerIdx + 1} (@${acc.accountConfig.username})] Scraping ${workerPosts.length} assigned posts via Mbasic...`);
          let workerContext: BrowserContext | null = null;
          try {
            killProfileProcesses(acc.accountConfig.user_data_dir);
            const launchOpts = getLaunchOptions(acc.accountConfig, acc.proxyConfig);
            workerContext = await chromium.launchPersistentContext(acc.accountConfig.user_data_dir, launchOpts);
            await injectCookiesIfAvailable(workerContext, acc.accountConfig);
            await populateLiveAccountSelfIdentifiers(workerContext, acc.accountConfig, selfIdentifiers);

            const viewerAccountId = await FacebookAutomation.getViewerAccountId(workerContext);
            if (!viewerAccountId) {
              console.warn(`[Swarm Mbasic Worker #${workerIdx + 1}] Could not find c_user cookie.`);
              return;
            }

            const workerPage = await workerContext.newPage();
            for (const postUrl of workerPosts) {
              if (sharedMembers.size >= limit || workerPage.isClosed()) break;
              const postId = await FacebookAutomation.resolvePostIdIfNeeded(workerPage, postUrl);
              if (!postId) continue;

              await NetworkScraperEngine.scrapeMbasicReactionsForPost(
                workerPage,
                postId,
                viewerAccountId,
                limit,
                selfIdentifiers,
                sharedMembers,
                onMembersScraped
              );
              lastCallbackSize = sharedMembers.size;
            }
          } catch (err: any) {
            console.warn(`[Swarm Mbasic Worker #${workerIdx + 1}] Warning:`, err.message);
          } finally {
            if (workerContext) await workerContext.close().catch(() => {});
          }
        }));
      }
    }

    // STEP 3: RESILIENT FALLBACK - TIMELINE HARVESTER (Profiles/Pages only)
    if (sharedMembers.size < limit && !isSinglePost) {
      console.log(`[Facebook Swarm Engine] 🚀 Total leads (${sharedMembers.size}/${limit}) below target. Activating Direct Timeline Feed Harvester on ${cleanTarget}...`);
      
      const fallbackAccount = accountConfigs[0];
      let fallbackContext: BrowserContext | null = null;
      try {
        killProfileProcesses(fallbackAccount.accountConfig.user_data_dir);
        const launchOpts = getLaunchOptions(fallbackAccount.accountConfig, fallbackAccount.proxyConfig);
        fallbackContext = await chromium.launchPersistentContext(fallbackAccount.accountConfig.user_data_dir, launchOpts);
        await injectCookiesIfAvailable(fallbackContext, fallbackAccount.accountConfig);
        const fallbackPage = await fallbackContext.newPage();

        const detachFallbackInterceptor = attachFacebookGraphQLInterceptor(fallbackPage, selfIdentifiers, sharedMembers, onMembersScraped);

        await FacebookAutomation.scrapeDirectTimelineFeed(
          fallbackPage,
          cleanTarget,
          selfIdentifiers,
          limit,
          sharedMembers,
          onMembersScraped
        );
      } catch (err: any) {
        console.warn(`[Facebook Swarm Engine] Fallback timeline harvester warning:`, err.message);
      } finally {
        if (fallbackContext) await fallbackContext.close().catch(() => {});
      }
    }

    if (sharedMembers.size > lastCallbackSize && onMembersScraped) {
      const remaining = Array.from(sharedMembers.values()).slice(lastCallbackSize);
      await onMembersScraped(remaining).catch(() => {});
    }

    console.log(`[Facebook Swarm Engine] ✅ Parallel Swarm completed! Total unique leads: ${sharedMembers.size}`);
    return Array.from(sharedMembers.values()).slice(0, limit);
  }

  static async scrapePostCommenters(
    account: AccountConfig,
    proxy: ProxyConfig | undefined,
    targetGroup: string,
    postLimit: number,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log(`[Facebook] Scraping Post Commenters & Reactors from ${targetGroup} (Limit: ${postLimit}) using @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      await injectCookiesIfAvailable(context, account);
      page = await context.newPage();

      let cleanTarget = targetGroup.trim().replace(/\/$/, '');
      let targetKOLId = '';
      if (cleanTarget.includes('profile.php?id=')) {
        try {
          const u = new URL(cleanTarget);
          targetKOLId = u.searchParams.get('id') || '';
        } catch (e) {}
      } else {
        const parts = cleanTarget.split('?')[0].split('/').filter(Boolean);
        targetKOLId = parts[parts.length - 1] || '';
      }

      const cookies = await context.cookies();
      const cUserCookie = cookies.find(c => c.name === 'c_user');
      const selfUserId = cUserCookie ? cUserCookie.value : '';

      const selfIdentifiers = new Set<string>();
      if (selfUserId) selfIdentifiers.add(selfUserId.toLowerCase());
      if (targetKOLId) selfIdentifiers.add(targetKOLId.toLowerCase());
      if (account.username) {
        selfIdentifiers.add(account.username.toLowerCase());
        if (account.username.includes('@')) {
          selfIdentifiers.add(account.username.split('@')[0].toLowerCase());
        }
      }

      const members = new Map<string, { uid: string; displayName: string; avatarUrl: string }>();
      const detachInterceptor = attachFacebookGraphQLInterceptor(page, selfIdentifiers, members, onMembersScraped);
      const postUrls = await FacebookAutomation.collectPostPermalinks(page, cleanTarget, Math.min(postLimit, 80));

      for (let i = 0; i < postUrls.length; i++) {
        if (page.isClosed()) break;
        const postUrl = postUrls[i];
        console.log(`[Facebook] Processing Post [${i + 1}/${postUrls.length}]: ${postUrl}...`);

        await FacebookAutomation.scrapeSinglePostDeep(
          page,
          postUrl,
          selfIdentifiers,
          postLimit,
          members,
          onMembersScraped
        );

        await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));
      }

      if (members.size < postLimit && !page.isClosed()) {
        await FacebookAutomation.scrapeDirectTimelineFeed(
          page,
          cleanTarget,
          selfIdentifiers,
          postLimit,
          members,
          onMembersScraped
        );
      }

      await context.close();
      return Array.from(members.values());
    } catch (error: any) {
      console.error(`[Facebook] Failed to scrape post commenters:`, error.message);
      if (context) await context.close();
      throw error;
    }
  }

  static async scrapeMessengerGroupMembers(
    account: AccountConfig,
    proxy: ProxyConfig | undefined,
    targetGroup: string,
    limit: number,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log(`[Facebook/Messenger] Scraping members from Messenger group ${targetGroup} using @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      await injectCookiesIfAvailable(context, account);
      
      // Close any other open pages to prevent Comet Messenger tab sync conflicts
      const existingPages = context.pages();
      page = existingPages[0] || (await context.newPage());
      for (let i = 1; i < existingPages.length; i++) {
        await existingPages[i].close().catch(() => {});
      }

      // 1. Parse Thread ID or Link (strip trailing slashes, hashes and query parameters first)
      let threadId = targetGroup.trim().split('?')[0].split('#')[0].replace(/\/$/, '');
      if (threadId.startsWith('http')) {
        try {
          const urlObj = new URL(threadId);
          const pathParts = urlObj.pathname.split('/');
          const tIndex = pathParts.indexOf('t');
          if (tIndex !== -1 && pathParts[tIndex + 1]) {
            threadId = pathParts[tIndex + 1];
          }
        } catch (e) {
          const match = threadId.match(/(?:messages\/t\/|messenger\.com\/t\/)([^\/?#]+)/);
          if (match) {
            threadId = match[1];
          }
        }
      }
      
      const messengerUrl = `https://www.facebook.com/messages/t/${threadId}`;
      console.log(`[Facebook/Messenger] Navigating to ${messengerUrl}...`);
      await page.goto(messengerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000); // Wait for messages interface to load

      await handleFacebookCheckpoints(page);

      const isLoggedIn = !(await page.$('input[name="email"]'));
      if (!isLoggedIn) {
        throw new Error('Tài khoản chưa được đăng nhập.');
      }

      // Check and dismiss Facebook end-to-end encryption PIN popup if it appears (2 steps with Playwright native clicks)
      const hasPinDialog = await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return false;
        const text = dialog.textContent || '';
        return text.includes('mã PIN') || text.includes('PIN') || text.includes('khôi phục') || text.includes('restore') || text.includes('mật mã') || text.includes('thiếu');
      });

      if (hasPinDialog) {
        console.log('[Facebook/Messenger] Detected encryption PIN dialog. Dismissing...');
        const closeBtn = page.locator('div[role="dialog"] [aria-label="Đóng"], div[role="dialog"] [aria-label="Close"], [aria-label="Đóng"], [aria-label="Close"]').filter({ visible: true }).first();
        const hasClose = await closeBtn.count();
        if (hasClose > 0) {
          await closeBtn.click({ force: true });
          console.log('[Facebook/Messenger] Clicked Close button of PIN dialog. Waiting for confirmation dialog...');
          await page.waitForTimeout(3000);

          let confirmBtn = page.locator('text="Không khôi phục tin nhắn"').filter({ visible: true }).first();
          let count = await confirmBtn.count();
          if (count === 0) {
            confirmBtn = page.locator('text="Không khôi phục"').filter({ visible: true }).first();
            count = await confirmBtn.count();
          }
          if (count === 0) {
            confirmBtn = page.locator('text="Don\'t restore"').filter({ visible: true }).first();
            count = await confirmBtn.count();
          }
          if (count === 0) {
            confirmBtn = page.locator('text="Do not restore"').filter({ visible: true }).first();
            count = await confirmBtn.count();
          }

          if (count > 0) {
            await confirmBtn.click({ force: true });
            console.log('[Facebook/Messenger] Dismissed second confirmation dialog successfully.');
            await page.waitForTimeout(3000);
          } else {
            console.warn('[Facebook/Messenger] Warning: Could not find second confirmation button text to dismiss PIN popup.');
          }
        } else {
          console.warn('[Facebook/Messenger] Warning: Could not find close button of PIN dialog.');
        }
      }

      // Check if we are actually in the conversation thread (wait up to 8 seconds for client-side routing to stabilize)
      let isThreadOpen = false;
      for (let i = 0; i < 8; i++) {
        const currentUrl = page.url();
        if (currentUrl.includes(threadId)) {
          isThreadOpen = true;
          break;
        }
        console.log(`[Facebook/Messenger] Waiting for conversation thread URL redirect... (i=${i}, Current URL: ${currentUrl})`);
        await page.waitForTimeout(1000);
      }

      if (!isThreadOpen) {
        console.warn(`[Facebook/Messenger] Page URL does not match target thread ID. Current URL: ${page.url()}. Forcing reload...`);
        await page.goto(messengerUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(4000);
      }

      // Extract active scraper user ID/username to exclude from results
      const cookies = await context.cookies();
      const cUserCookie = cookies.find(c => c.name === 'c_user');
      const selfUserId = cUserCookie ? cUserCookie.value : '';
      
      const selfUsername = await page.evaluate(() => {
        const profileAnchor = document.querySelector('a[href*="/me/"], a[href*="/profile.php"], a[href^="/"][href*="ref=bookmarks"]');
        if (profileAnchor) {
          const href = profileAnchor.getAttribute('href') || '';
          if (href.includes('profile.php?id=')) {
            const urlObj = new URL(href, window.location.href);
            return urlObj.searchParams.get('id') || '';
          } else {
            const path = href.replace(/^(https?:\/\/)?(www\.)?facebook\.com/, '').split('?')[0].replace(/^\/|\/$/g, '');
            if (path && path !== 'me') return path;
          }
        }
        return (window as any).currentUserInitialData?.USER_ID || '';
      }).catch(() => '');

      const selfIdentifiers = new Set<string>();
      if (selfUserId) selfIdentifiers.add(selfUserId.toLowerCase());
      if (selfUsername) selfIdentifiers.add(selfUsername.toLowerCase());
      if (account.username) {
        selfIdentifiers.add(account.username.toLowerCase());
        if (account.username.includes('@')) {
          selfIdentifiers.add(account.username.split('@')[0].toLowerCase());
        }
      }

      console.log(`[Facebook/Messenger] Active scraper self identifiers:`, Array.from(selfIdentifiers));

      // 2. Open/Ensure Details Sidebar is open
      let isSidebarOpen = await page.evaluate(() => {
        const sidebar = document.querySelector('div[role="complementary"]');
        if (!sidebar) return false;
        const rect = sidebar.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (!isSidebarOpen) {
        console.log(`[Facebook/Messenger] Sidebar is closed. Attempting to open Details sidebar...`);
        const clicked = await page.evaluate(() => {
          const labels = [
            'thông tin', 'conversation details', 'thread info', 'conversation info', 
            'chi tiết cuộc trò chuyện', 'cài đặt cuộc trò chuyện', 'info', 'detail'
          ];
          
          const mainArea = document.querySelector('div[role="main"]');
          if (mainArea) {
            // Only search within mainArea to avoid clicking list items in the left sidebar (e.g. "Kombat Detailing" matching 'detail')
            const buttons = Array.from(mainArea.querySelectorAll('[role="button"], button, a, div[aria-label]'));
            for (const btn of buttons) {
              const label = (btn.getAttribute('aria-label') || '').toLowerCase();
              if (labels.some(l => label === l || label.includes(l))) {
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  (btn as HTMLElement).click();
                  return `aria-label: ${label}`;
                }
              }
            }

            const header = mainArea.querySelector('span[weight="bold"], span[style*="font-weight: 600"], h2');
            if (header) {
              const clickable = header.closest('div[role="button"]') || header.closest('a') || header;
              const rect = (clickable as HTMLElement).getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                (clickable as HTMLElement).click();
                return `header title: ${header.textContent}`;
              }
            }
          }
          
          return null;
        });

        if (clicked) {
          console.log(`[Facebook/Messenger] Opened sidebar via: ${clicked}`);
          await page.waitForTimeout(3000);
        }
      }

      // 3. Click "See all" / "Xem tất cả" if it is already visible
      console.log(`[Facebook/Messenger] Checking if See All button is already visible...`);
      let clickedSeeAll = await page.evaluate(() => {
        const seeAllKeywords = [
          'Xem tất cả',
          'See all',
          'Xem tất cả thành viên',
          'See all members',
          'Xem thành viên trong đoạn chat',
          'See group members',
          'View members'
        ];
        
        const elements = Array.from(document.querySelectorAll('div[role="button"], span, a, div'));
        for (const el of elements) {
          const text = el.textContent?.trim() || '';
          if (seeAllKeywords.some(kw => text.toLowerCase() === kw.toLowerCase() || text.toLowerCase().includes(kw.toLowerCase()))) {
            const sidebar = el.closest('div[role="complementary"]') || el.closest('[role="dialog"]');
            if (sidebar) {
              const clickable = el.closest('div[role="button"]') || el;
              const rect = clickable.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                (clickable as HTMLElement).click();
                return text;
              }
            }
          }
        }
        return null;
      });

      if (clickedSeeAll) {
        console.log(`[Facebook/Messenger] Clicked See All button directly: "${clickedSeeAll}". Waiting for modal...`);
        await page.waitForTimeout(3000);
      } else {
        // If "See all" is not directly visible, click the section header to expand it first
        console.log(`[Facebook/Messenger] "See all" button not visible. Attempting to click Member section header in sidebar...`);
        const clickedSection = await page.evaluate(() => {
          const keywords = [
            'Thành viên trong đoạn chat', 
            'Xem thành viên trong đoạn chat', 
            'Chat members', 
            'See chat members', 
            'Thành viên nhóm', 
            'Group members', 
            'Thành viên', 
            'Members'
          ];
          
          const elements = Array.from(document.querySelectorAll('div[role="button"], span, div, h2, h3'));
          for (const el of elements) {
            const text = el.textContent?.trim() || '';
            if (keywords.some(kw => text.toLowerCase() === kw.toLowerCase() || text.toLowerCase().includes(kw.toLowerCase()))) {
              const sidebar = el.closest('div[role="complementary"]') || el.closest('[role="dialog"]');
              if (sidebar) {
                const clickable = el.closest('div[role="button"]') || el;
                const rect = clickable.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  (clickable as HTMLElement).click();
                  return text;
                }
              }
            }
          }
          return null;
        });

        if (clickedSection) {
          console.log(`[Facebook/Messenger] Clicked member section header: "${clickedSection}". Waiting for expansion...`);
          await page.waitForTimeout(3000);

          const clickedSeeAllAfterExpand = await page.evaluate(() => {
            const seeAllKeywords = [
              'Xem tất cả',
              'See all',
              'Xem tất cả thành viên',
              'See all members',
              'Xem thành viên trong đoạn chat',
              'See group members',
              'View members'
            ];
            
            const elements = Array.from(document.querySelectorAll('div[role="button"], span, a, div'));
            for (const el of elements) {
              const text = el.textContent?.trim() || '';
              if (seeAllKeywords.some(kw => text.toLowerCase() === kw.toLowerCase() || text.toLowerCase().includes(kw.toLowerCase()))) {
                const sidebar = el.closest('div[role="complementary"]') || el.closest('[role="dialog"]');
                if (sidebar) {
                  const clickable = el.closest('div[role="button"]') || el;
                  const rect = clickable.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    (clickable as HTMLElement).click();
                    return text;
                  }
                }
              }
            }
            return null;
          });

          if (clickedSeeAllAfterExpand) {
            console.log(`[Facebook/Messenger] Clicked See All button after expansion: "${clickedSeeAllAfterExpand}". Waiting for modal...`);
            await page.waitForTimeout(3000);
          }
        }
      }

      // 4. Scrape and Scroll Loop
      const members = new Map<string, { uid: string; displayName: string; avatarUrl: string }>();
      let scrollCount = 0;
      let lastSize = 0;
      let noChangeIterations = 0;
      let lastCallbackSize = 0;
      const maxNoChange = 30;

      while (members.size < limit && noChangeIterations < maxNoChange) {
        if (page.isClosed()) {
          throw new Error('Trình duyệt hoặc trang web đã bị đóng đột ngột.');
        }

        // Dynamically detect scroll container on each iteration
        const scrollContainerSelector = await page.evaluate(() => {
          if (document.querySelector('div[role="dialog"]')) {
            return 'div[role="dialog"]';
          }
          if (document.querySelector('div[role="complementary"]')) {
            return 'div[role="complementary"]';
          }
          return '';
        });

        // Extract members
        const currentMembers = await page.evaluate((selector) => {
          const container = selector ? document.querySelector(selector) : document;
          if (!container) return [];

          const list: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];
          const anchors = Array.from(container.querySelectorAll('a'));
          
          anchors.forEach(a => {
            const href = a.getAttribute('href');
            if (!href) return;
            
            let uid = '';
            let displayName = a.textContent?.trim() || '';
            
            if (href.includes('/user/')) {
              const match = href.match(/\/user\/([^\/]+)/);
              if (match) uid = match[1];
            } else if (href.includes('profile.php?id=')) {
              const urlObj = new URL(href, window.location.href);
              uid = urlObj.searchParams.get('id') || '';
            } else {
              const path = href.replace(/^(https?:\/\/)?(www\.)?facebook\.com/, '').split('?')[0].replace(/^\/|\/$/g, '');
              const skipKeywords = ['messages', 't', 'direct', 'threads', 'friends', 'groups', 'help', 'settings'];
              if (path && !path.includes('/') && !skipKeywords.includes(path.toLowerCase())) {
                uid = path;
              }
            }
            
            if (uid && displayName && displayName.length > 1 && displayName.length < 50 && !displayName.includes('\n')) {
              let avatarUrl = '';
              let currentParent = a.parentElement;
              for (let i = 0; i < 4 && currentParent; i++) {
                const img = currentParent.querySelector('img');
                if (img) {
                  avatarUrl = img.getAttribute('src') || '';
                  if (avatarUrl) break;
                }
                currentParent = currentParent.parentElement;
              }
              list.push({ uid, displayName, avatarUrl });
            }
          });
          return list;
        }, scrollContainerSelector);

        // Save scraped members
        for (const item of currentMembers) {
          const uidLower = item.uid.toLowerCase();
          if (selfIdentifiers.has(uidLower)) {
            continue;
          }
          if (!members.has(item.uid)) {
            members.set(item.uid, item);
          }
        }

        console.log(`[Facebook/Messenger] Scraped ${members.size}/${limit} members...`);

        // Trigger incremental callback every 50 new members
        const unsavedCount = members.size - lastCallbackSize;
        if (unsavedCount >= 50 && onMembersScraped) {
          const unsavedChunk = Array.from(members.values()).slice(lastCallbackSize, members.size);
          await onMembersScraped(unsavedChunk).catch((e) => {
            console.error('[Facebook/Messenger] Error saving incremental chunk:', e.message);
          });
          lastCallbackSize = members.size;
        }

        // Scroll
        const scrollStep = 400;
        await page.evaluate(({ selector, step }) => {
          const container = selector ? document.querySelector(selector) : null;
          if (container) {
            const scrollable = container.querySelector('div[style*="overflow-y: auto"], div[style*="overflow: auto"]') || container;
            scrollable.scrollBy(0, step);
          } else {
            window.scrollBy(0, step);
          }
        }, { selector: scrollContainerSelector, step: scrollStep }).catch(() => {});

        // Random delay
        const delay = Math.floor(Math.random() * 1500) + 1500; // 1.5 - 3.0s
        await page.waitForTimeout(delay).catch(() => {});

        if (members.size === lastSize) {
          noChangeIterations++;
        } else {
          noChangeIterations = 0;
          lastSize = members.size;
        }

        scrollCount++;
      }

      // Save remaining
      if (members.size > lastCallbackSize && onMembersScraped) {
        const remaining = Array.from(members.values()).slice(lastCallbackSize);
        await onMembersScraped(remaining).catch((e) => {
          console.error('[Facebook/Messenger] Error saving final remaining chunk:', e.message);
        });
      }

      await context.close();
      return Array.from(members.values()).slice(0, limit);
    } catch (error: any) {
      console.error(`[Facebook/Messenger] Failed to scrape Messenger members:`, error.message);
      if (context) {
        const errorPage = page || (await context.pages())[0];
        if (errorPage) await saveErrorScreenshot(errorPage, account.username, 'messenger_scrape_failed');
        await context.close();
      }
      throw error;
    }
  }
}

// Mock automation class for other platforms (Facebook, YouTube, TikTok, Instagram...)
export class MockAutomation {
  static async checkLive(platform: string, account: AccountConfig, proxy?: ProxyConfig): Promise<'live'> {
    console.log(`[Mock:${platform}] Checking account status for @${account.username}...`);
    console.log(`[Mock:${platform}] Account @${account.username} is marked as LIVE (Mock Mode)`);
    return 'live';
  }

  static async post(platform: string, account: AccountConfig, proxy: ProxyConfig | undefined, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    console.log(`[Mock:${platform}] Posting as @${account.username} (Mock Mode):`);
    console.log(`[Mock:${platform}] Content: "${content}"`);
    if (mediaPaths && mediaPaths.length > 0) {
      console.log(`[Mock:${platform}] Media: ${JSON.stringify(mediaPaths)}`);
    }
    return `https://mock-${platform}.com/post/mock_id_12345`;
  }

  static async comment(platform: string, account: AccountConfig, proxy: ProxyConfig | undefined, targetUrl: string, content: string): Promise<boolean | string> {
    console.log(`[Mock:${platform}] Commenting as @${account.username} on ${targetUrl} (Mock Mode):`);
    console.log(`[Mock:${platform}] Content: "${content}"`);
    return `https://mock-${platform}.com/comment/mock_id_12345`;
  }
}

// newf319 automation class
export class NewF319Automation {
  static async checkLive(account: AccountConfig, proxy?: ProxyConfig): Promise<'live' | 'checkpoint' | 'die'> {
    console.log(`[newf319] Checking account status for @${account.username}...`);
    let context: BrowserContext | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      const page = await context.newPage();
      
      // Navigate to forum index
      await page.goto('https://newf319.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      const isLoggedIn = await page.evaluate(() => {
        return document.documentElement.classList.contains('LoggedIn') || 
               document.querySelector('.visitorTabs a.username') !== null;
      });
      
      if (isLoggedIn) {
        console.log(`[newf319] @${account.username} is LIVE`);
        await context.close();
        return 'live';
      }
      
      // If not logged in, attempt login if credentials exist
      if (account.password) {
        console.log(`[newf319] @${account.username} not logged in. Attempting auto login...`);
        const loginSuccess = await this.performLogin(page, account);
        if (loginSuccess) {
          await context.close();
          return 'live';
        }
        await saveErrorScreenshot(page, account.username, 'login_failed');
        await context.close();
        return 'die';
      }
      
      console.log(`[newf319] @${account.username} requires login (DIE)`);
      await context.close();
      return 'die';
    } catch (error: any) {
      console.error(`[newf319] Error checking @${account.username}:`, error.message);
      if (context) await context.close();
      return 'die';
    }
  }

  static async performLogin(page: Page, account: AccountConfig): Promise<boolean> {
    try {
      await page.goto('https://newf319.com/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      
      // Fill login and password
      const usernameInput = await page.waitForSelector('form#pageLogin input[name="login"], input#ctrl_pageLogin_login, input[name="login"]', { timeout: 10000 });
      await usernameInput.click({ force: true });
      await page.keyboard.type(account.username, { delay: 60 });
      
      const passwordInput = await page.waitForSelector('form#pageLogin input[name="password"], input#ctrl_pageLogin_password, input[name="password"]', { timeout: 10000 });
      await passwordInput.click({ force: true });
      if (account.password) {
        await page.keyboard.type(account.password, { delay: 60 });
      }
      
      // Ensure 'Duy trì đăng nhập' is checked
      const rememberCheckbox = await page.$('input[name="remember"], input#ctrl_pageLogin_remember');
      if (rememberCheckbox) {
        const isChecked = await rememberCheckbox.isChecked();
        if (!isChecked) {
          await rememberCheckbox.click({ force: true });
        }
      }
      
      // Submit
      const submitBtn = await page.waitForSelector('form#pageLogin input[type="submit"], input[type="submit"].button.primary, input[value="Đăng nhập"]', { timeout: 10000 });
      await submitBtn.click({ force: true });
      await page.waitForTimeout(5000);
      
      const isLoggedIn = await page.evaluate(() => {
        return document.documentElement.classList.contains('LoggedIn') || 
               document.querySelector('.visitorTabs a.username') !== null;
      });
      
      if (isLoggedIn) {
        console.log(`[newf319] Successfully logged in to @${account.username}`);
        return true;
      }
      return false;
    } catch (err: any) {
      console.error(`[newf319] Auto login failed for @${account.username}:`, err.message);
      return false;
    }
  }


  static async post(account: AccountConfig, proxy: ProxyConfig | undefined, targetUrl: string | undefined, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    const target = targetUrl || 'https://newf319.com/forums/thi-truong-chung-khoan.3/';
    console.log(`[newf319] Posting to ${target} as @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();
      
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      let isLoggedIn = await page.evaluate(() => {
        return document.documentElement.classList.contains('LoggedIn') || 
               document.querySelector('.visitorTabs a.username') !== null;
      });
      
      if (!isLoggedIn) {
        if (account.password) {
          console.log(`[newf319] Not logged in. Attempting auto login...`);
          const loginSuccess = await this.performLogin(page, account);
          if (!loginSuccess) throw new Error('Đăng nhập thất bại.');
          await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2000);
        } else {
          throw new Error('Tài khoản chưa được đăng nhập và không có mật khẩu để auto login.');
        }
      }
      
      // Navigate to create-thread
      const createThreadUrl = target.endsWith('/') ? `${target}create-thread` : `${target}/create-thread`;
      await page.goto(createThreadUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      
      // Extract title and body from spintax parsed content
      let title = 'Chứng khoán hôm nay';
      let bodyText = content;
      
      const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        title = lines[0];
        bodyText = content.substring(content.indexOf('\n') + 1).trim();
      } else if (lines.length === 1) {
        title = lines[0];
        bodyText = lines[0];
      }
      
      // Fill title
      console.log(`[newf319] Title: "${title}"`);
      const titleInput = await page.waitForSelector('form.xenForm input[name="title"]', { timeout: 15000 });
      await titleInput.click({ force: true });
      await titleInput.fill('');
      await page.keyboard.type(title, { delay: 60 });
      
      // Tắt bộ gõ Mudim
      await page.evaluate(() => {
        if ((window as any).Mudim) {
          (window as any).Mudim.method = 0;
        }
      });
      
      // Fill editor body
      console.log('[newf319] Entering content into Redactor editor...');
      
      // Try using the official XenForo Redactor jQuery API first (most reliable)
      const apiSuccess = await page.evaluate((text) => {
        try {
          const $ = (window as any).jQuery;
          if ($) {
            const $ta = $('textarea[name="message_html"], textarea[name="message"]');
            if ($ta.length) {
              const htmlContent = text.replace(/\n/g, '<br>');
              
              // 1. Try XenForo.HtmlEditor first
              const htmlEditor = $ta.data('XenForo.HtmlEditor');
              if (htmlEditor && htmlEditor.api) {
                console.log('XenForo.HtmlEditor API found. Setting HTML...');
                if (htmlEditor.api.code && htmlEditor.api.code.set) {
                  htmlEditor.api.code.set(htmlContent);
                  if (htmlEditor.api.placeholder && htmlEditor.api.placeholder.remove) {
                    htmlEditor.api.placeholder.remove();
                  }
                  if (htmlEditor.sync) htmlEditor.sync();
                  return true;
                }
              }
              
              // 2. Try raw redactor instance
              const redactor = $ta.data('redactor');
              if (redactor) {
                console.log('Raw redactor instance found. Setting HTML...');
                if (redactor.code && redactor.code.set) {
                  redactor.code.set(htmlContent);
                  if (redactor.placeholder && redactor.placeholder.remove) {
                    redactor.placeholder.remove();
                  }
                  if (redactor.syncCode) redactor.syncCode();
                  return true;
                }
                
                // Fallback for XenForo custom redactor where .code is not exposed but .$editor is available
                if (redactor.$editor && typeof redactor.$editor.html === 'function') {
                  console.log('XenForo custom redactor .$editor found. Setting HTML...');
                  redactor.$editor.html(htmlContent);
                  if (redactor.placeholder && redactor.placeholder.remove) {
                    redactor.placeholder.remove();
                  }
                  
                  // Trigger events
                  redactor.$editor.trigger('focus');
                  redactor.$editor.trigger('keydown');
                  redactor.$editor.trigger('input');
                  redactor.$editor.trigger('keyup');
                  redactor.$editor.trigger('change');
                  redactor.$editor.trigger('blur');
                  
                  // Sync
                  if (htmlEditor && typeof htmlEditor.sync === 'function') {
                    htmlEditor.sync();
                  } else if (redactor.syncCode) {
                    redactor.syncCode();
                  }
                  return true;
                }
              }
              
              // 3. Try jQuery plugin method
              if (typeof ($ta as any).redactor === 'function') {
                console.log('Calling redactor jQuery plugin...');
                ($ta as any).redactor('code.set', htmlContent);
                ($ta as any).redactor('syncCode');
                return true;
              }
            }
          }
        } catch (e) {
          console.error('Error in Redactor API evaluation:', e);
        }
        return false;
      }, bodyText);

      if (apiSuccess) {
        console.log('[newf319] Successfully set content via Redactor API.');
      } else {
        console.log('[newf319] Redactor API set failed, falling back to frame/textarea manipulation...');
        let iframe = null;
        try {
          iframe = await page.waitForSelector('.redactor_box iframe, iframe.redactor_iframe, iframe[class*="redactor"]', { timeout: 5000 });
        } catch (e) {
          console.log('[newf319] Redactor iframe not found within 5s, using fallback textarea...');
        }

        if (iframe) {
          const frame = await iframe.contentFrame();
          if (frame) {
            await frame.waitForSelector('body[contenteditable="true"]', { timeout: 5000 });
            await frame.evaluate((text) => {
              const body = document.querySelector('body[contenteditable="true"]');
              if (body) {
                const htmlContent = text.replace(/\n/g, '<br>');
                body.innerHTML = htmlContent;
                body.dispatchEvent(new Event('focus', { bubbles: true }));
                body.dispatchEvent(new Event('keydown', { bubbles: true }));
                body.dispatchEvent(new Event('keypress', { bubbles: true }));
                body.dispatchEvent(new Event('input', { bubbles: true }));
                body.dispatchEvent(new Event('keyup', { bubbles: true }));
                body.dispatchEvent(new Event('change', { bubbles: true }));
                body.dispatchEvent(new Event('blur', { bubbles: true }));
              }
            }, bodyText);
          } else {
            throw new Error('Không thể truy cập frame soạn thảo Redactor.');
          }
        } else {
          // Fallback to textarea (may be hidden, so we fill using page.evaluate)
          await page.waitForSelector('textarea[name="message"], textarea[name="message_html"]', { state: 'attached', timeout: 5000 });
          await page.evaluate((text) => {
            const ta = (document.querySelector('textarea[name="message"]') || document.querySelector('textarea[name="message_html"]')) as HTMLTextAreaElement;
            if (ta) {
              ta.value = text;
              ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, bodyText);
        }
      }

      // Sync content directly to the textarea and message_html as backup just in case
      await page.evaluate((text) => {
        try {
          const htmlContent = text.replace(/\n/g, '<br>');
          const tas = document.querySelectorAll('textarea[name="message"], textarea[name="message_html"]');
          tas.forEach((el) => {
            const ta = el as HTMLTextAreaElement;
            // Write HTML content to message_html, plain text to message
            ta.value = ta.name === 'message_html' ? htmlContent : text;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          });
        } catch (e) {}
      }, bodyText);

      await page.waitForTimeout(2000);
      
      // Submit
      const submitBtn = await page.waitForSelector('form.xenForm input[type="submit"]', { timeout: 15000 });
      await submitBtn.click({ force: true });
      
      // Wait for navigation and verification
      await page.waitForTimeout(6000);
      
      const currentUrl = page.url();
      if (currentUrl.includes('/threads/')) {
        console.log(`[newf319] Successfully created thread at ${currentUrl}`);
        const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_newf319_posted.png`);
        await page.screenshot({ path: successScreenshotPath }).catch(() => {});
        await context.close();
        return currentUrl;
      } else {
        // Try to extract XenForo error messages if page did not navigate
        let errorMsg = '';
        try {
          errorMsg = await page.evaluate(() => {
            const overlay = document.querySelector('.errorOverlay, .xenOverlay.errorOverlay');
            if (overlay) {
              const baseHtml = overlay.querySelector('.baseHtml');
              if (baseHtml && baseHtml.textContent) return baseHtml.textContent.trim();
              return overlay.textContent ? overlay.textContent.trim() : '';
            }
            const panel = document.querySelector('.errorPanel, .errorKeys');
            if (panel) return panel.textContent ? panel.textContent.trim() : '';
            const inlineError = document.querySelector('.error, .errorText');
            if (inlineError) return inlineError.textContent ? inlineError.textContent.trim() : '';
            return '';
          });
        } catch (e) {}
        
        const detailedError = errorMsg ? `Diễn đàn báo lỗi: "${errorMsg}"` : `URL hiện tại: ${currentUrl}`;
        throw new Error(`Đăng bài thất bại. ${detailedError}`);
      }
    } catch (error: any) {
      console.error(`[newf319] Post failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'newf319_post_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async comment(account: AccountConfig, proxy: ProxyConfig | undefined, targetUrl: string, content: string): Promise<boolean | string> {
    console.log(`[newf319] Commenting on ${targetUrl} as @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();
      
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(4000);
      
      let isLoggedIn = await page.evaluate(() => {
        return document.documentElement.classList.contains('LoggedIn') || 
               document.querySelector('.visitorTabs a.username') !== null;
      });
      
      if (!isLoggedIn) {
        if (account.password) {
          console.log(`[newf319] Not logged in. Attempting auto login...`);
          const loginSuccess = await this.performLogin(page, account);
          if (!loginSuccess) throw new Error('Đăng nhập thất bại.');
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await page.waitForTimeout(3000);
        } else {
          throw new Error('Tài khoản chưa được đăng nhập và không có mật khẩu để auto login.');
        }
      }
      
      // Scroll to QuickReply form
      await page.evaluate(() => {
        const form = document.querySelector('form#QuickReply');
        if (form) form.scrollIntoView({ behavior: 'smooth' });
      });
      await page.waitForTimeout(1500);
      
      // Tắt bộ gõ Mudim
      await page.evaluate(() => {
        if ((window as any).Mudim) {
          (window as any).Mudim.method = 0;
        }
      });
      
      // Fill editor body
      console.log('[newf319] Entering content into Quick Reply Redactor editor...');
      
      // Try using the official XenForo Redactor jQuery API first (most reliable)
      const apiSuccess = await page.evaluate((text) => {
        try {
          const $ = (window as any).jQuery;
          if ($) {
            const $ta = $('form#QuickReply textarea[name="message_html"], form#QuickReply textarea[name="message"]');
            if ($ta.length) {
              const htmlContent = text.replace(/\n/g, '<br>');
              
              // 1. Try XenForo.HtmlEditor first
              const htmlEditor = $ta.data('XenForo.HtmlEditor');
              if (htmlEditor && htmlEditor.api) {
                console.log('XenForo.HtmlEditor API found for QuickReply. Setting HTML...');
                if (htmlEditor.api.code && htmlEditor.api.code.set) {
                  htmlEditor.api.code.set(htmlContent);
                  if (htmlEditor.api.placeholder && htmlEditor.api.placeholder.remove) {
                    htmlEditor.api.placeholder.remove();
                  }
                  if (htmlEditor.sync) htmlEditor.sync();
                  return true;
                }
              }
              
              // 2. Try raw redactor instance
              const redactor = $ta.data('redactor');
              if (redactor) {
                console.log('Raw redactor instance found for QuickReply. Setting HTML...');
                if (redactor.code && redactor.code.set) {
                  redactor.code.set(htmlContent);
                  if (redactor.placeholder && redactor.placeholder.remove) {
                    redactor.placeholder.remove();
                  }
                  if (redactor.syncCode) redactor.syncCode();
                  return true;
                }
                
                // Fallback for XenForo custom redactor where .code is not exposed but .$editor is available
                if (redactor.$editor && typeof redactor.$editor.html === 'function') {
                  console.log('XenForo custom redactor .$editor found for QuickReply. Setting HTML...');
                  redactor.$editor.html(htmlContent);
                  if (redactor.placeholder && redactor.placeholder.remove) {
                    redactor.placeholder.remove();
                  }
                  
                  // Trigger events
                  redactor.$editor.trigger('focus');
                  redactor.$editor.trigger('keydown');
                  redactor.$editor.trigger('input');
                  redactor.$editor.trigger('keyup');
                  redactor.$editor.trigger('change');
                  redactor.$editor.trigger('blur');
                  
                  // Sync
                  if (htmlEditor && typeof htmlEditor.sync === 'function') {
                    htmlEditor.sync();
                  } else if (redactor.syncCode) {
                    redactor.syncCode();
                  }
                  return true;
                }
              }
              
              // 3. Try jQuery plugin method
              if (typeof ($ta as any).redactor === 'function') {
                console.log('Calling redactor jQuery plugin for QuickReply...');
                ($ta as any).redactor('code.set', htmlContent);
                ($ta as any).redactor('syncCode');
                return true;
              }
            }
          }
        } catch (e) {
          console.error('Error in Redactor API evaluation:', e);
        }
        return false;
      }, content);

      if (apiSuccess) {
        console.log('[newf319] Successfully set comment content via Redactor API.');
      } else {
        console.log('[newf319] Redactor API set failed for comment, falling back to frame/textarea manipulation...');
        let iframe = null;
        try {
          iframe = await page.waitForSelector('form#QuickReply .redactor_box iframe, form#QuickReply iframe, form#QuickReply iframe[class*="redactor"]', { timeout: 5000 });
        } catch (e) {
          console.log('[newf319] QuickReply Redactor iframe not found within 5s, using fallback textarea...');
        }

        if (iframe) {
          const frame = await iframe.contentFrame();
          if (frame) {
            await frame.waitForSelector('body[contenteditable="true"]', { timeout: 5000 });
            await frame.evaluate((text) => {
              const body = document.querySelector('body[contenteditable="true"]');
              if (body) {
                const htmlContent = text.replace(/\n/g, '<br>');
                body.innerHTML = htmlContent;
                body.dispatchEvent(new Event('focus', { bubbles: true }));
                body.dispatchEvent(new Event('keydown', { bubbles: true }));
                body.dispatchEvent(new Event('keypress', { bubbles: true }));
                body.dispatchEvent(new Event('input', { bubbles: true }));
                body.dispatchEvent(new Event('keyup', { bubbles: true }));
                body.dispatchEvent(new Event('change', { bubbles: true }));
                body.dispatchEvent(new Event('blur', { bubbles: true }));
              }
            }, content);
          } else {
            throw new Error('Không thể truy cập frame trả lời Redactor.');
          }
        } else {
          // Fallback to textarea (may be hidden, so we fill using page.evaluate)
          await page.waitForSelector('form#QuickReply textarea[name="message"], form#QuickReply textarea[name="message_html"]', { state: 'attached', timeout: 5000 });
          await page.evaluate((text) => {
            const ta = (document.querySelector('form#QuickReply textarea[name="message"]') || document.querySelector('form#QuickReply textarea[name="message_html"]')) as HTMLTextAreaElement;
            if (ta) {
              ta.value = text;
              ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, content);
        }
      }

      // Sync content directly to the textarea and message_html as backup just in case
      await page.evaluate((text) => {
        try {
          const htmlContent = text.replace(/\n/g, '<br>');
          const tas = document.querySelectorAll('form#QuickReply textarea[name="message"], form#QuickReply textarea[name="message_html"]');
          tas.forEach((el) => {
            const ta = el as HTMLTextAreaElement;
            // Write HTML content to message_html, plain text to message
            ta.value = ta.name === 'message_html' ? htmlContent : text;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
          });
        } catch (e) {}
      }, content);

      await page.waitForTimeout(2000);
      
      // Submit Reply
      const submitBtn = await page.waitForSelector('form#QuickReply input[type="submit"], form#QuickReply input#submitReply', { timeout: 15000 });
      await submitBtn.click({ force: true });
      
      // Wait for submit
      await page.waitForTimeout(6000);

      // Try to extract XenForo error messages if page is still showing QuickReply form and has errors
      let errorMsg = '';
      try {
        errorMsg = await page.evaluate(() => {
          const overlay = document.querySelector('.errorOverlay, .xenOverlay.errorOverlay');
          if (overlay) {
            const baseHtml = overlay.querySelector('.baseHtml');
            if (baseHtml && baseHtml.textContent) return baseHtml.textContent.trim();
            return overlay.textContent ? overlay.textContent.trim() : '';
          }
          const panel = document.querySelector('.errorPanel, .errorKeys');
          if (panel) return panel.textContent ? panel.textContent.trim() : '';
          const inlineError = document.querySelector('.error, .errorText');
          if (inlineError) return inlineError.textContent ? inlineError.textContent.trim() : '';
          return '';
        });
      } catch (e) {}

      if (errorMsg) {
        throw new Error(`Bình luận thất bại. Diễn đàn báo lỗi: "${errorMsg}"`);
      }
      
      console.log('[newf319] Comment submitted successfully.');
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_newf319_replied.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});
      
      const commentUrl = page.url();
      await context.close();
      return commentUrl || targetUrl;
    } catch (error: any) {
      console.error(`[newf319] Comment failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'newf319_comment_failed');
        await context.close();
      }
      throw error;
    }
  }
}

// WhatsApp Web automation class
export class WhatsAppAutomation {
  static cleanPhoneNumber(phone: string): string {
    if (!phone) return '';
    let cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');
    if (cleaned.startsWith('+')) {
      cleaned = cleaned.substring(1);
    }
    // Convert Vietnamese leading 0 (e.g. 0912345678 -> 84912345678)
    if (cleaned.startsWith('0') && cleaned.length >= 10 && cleaned.length <= 11) {
      cleaned = '84' + cleaned.substring(1);
    }
    // Only keep numeric digits
    cleaned = cleaned.replace(/\D/g, '');
    return cleaned;
  }

  static async checkLive(account: AccountConfig, proxy?: ProxyConfig): Promise<'live' | 'checkpoint' | 'die'> {
    console.log(`[WhatsApp] Checking account status for @${account.username}...`);
    let context: BrowserContext | null = null;
    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      const page = await context.newPage();
      await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);

      // Check for ban or flagged status
      const isBanned = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : '';
        return text.includes('This account is not allowed to use WhatsApp') ||
               text.includes('bị cấm sử dụng WhatsApp') ||
               text.includes('Account flagged') ||
               text.includes('Tài khoản bị gắn cờ');
      }).catch(() => false);

      if (isBanned) {
        console.log(`[WhatsApp] @${account.username} is BANNED (DIE)`);
        await context.close();
        return 'die';
      }

      // Check if logged in (chat pane or search bar exists)
      const isLoggedIn = await page.waitForSelector('#pane-side, [data-testid="chat-list"], div[contenteditable="true"][data-tab="3"], span[data-icon="chat"], header [data-testid="default-user"]', { timeout: 10000 })
        .then(() => true)
        .catch(() => false);

      if (isLoggedIn) {
        console.log(`[WhatsApp] @${account.username} is LIVE`);
        await context.close();
        return 'live';
      }

      // Check if QR code / Login prompt is present
      const isNeedsLogin = await page.$('canvas[aria-label*="Scan"], div[data-ref], button:has-text("Link with phone number"), div[data-testid="qrcode"]');
      if (isNeedsLogin) {
        console.log(`[WhatsApp] @${account.username} requires QR login (CHECKPOINT/DIE)`);
        await context.close();
        return 'die';
      }

      console.log(`[WhatsApp] @${account.username} status unknown, marking as DIE`);
      await context.close();
      return 'die';
    } catch (error: any) {
      console.error(`[WhatsApp] Error checking @${account.username}:`, error.message);
      if (context) await context.close();
      return 'die';
    }
  }

  static async sendMessage(account: AccountConfig, proxy: ProxyConfig | undefined, targetPhone: string, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    const cleanPhone = WhatsAppAutomation.cleanPhoneNumber(targetPhone);
    if (!cleanPhone) {
      throw new Error(`Số điện thoại "${targetPhone}" không hợp lệ.`);
    }

    console.log(`[WhatsApp] Sending message to +${cleanPhone} from @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();

      // Navigate to chat direct send URL
      const sendUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
      await page.goto(sendUrl, { waitUntil: 'domcontentloaded', timeout: 50000 });
      await page.waitForTimeout(4000);

      // Check if account is not logged in
      const needsLogin = await page.$('canvas[aria-label*="Scan"], div[data-ref], button:has-text("Link with phone number")');
      if (needsLogin) {
        throw new Error('Tài khoản WhatsApp chưa được đăng nhập. Hãy mở Live Screen và quét mã QR trước.');
      }

      // Check for invalid phone number popup
      const checkInvalidPopup = async (): Promise<boolean> => {
        try {
          const popup = await page?.$('div[data-animate-modal-popup="true"], div[role="dialog"]');
          if (popup) {
            const popupText = await popup.innerText();
            if (popupText.includes('invalid') || popupText.includes('không hợp lệ') || popupText.includes('Phone number') || popupText.includes('URL')) {
              const okBtn = await popup.$('button');
              if (okBtn) await okBtn.click().catch(() => {});
              return true;
            }
          }
        } catch (e) {}
        return false;
      };

      // Wait up to 20 seconds for chat input to be ready or detect invalid phone
      let chatInput: any = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await checkInvalidPopup()) {
          throw new Error(`Số điện thoại +${cleanPhone} chưa đăng ký hoặc không tồn tại trên WhatsApp.`);
        }

        chatInput = await page.$('#main footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"], footer div[role="textbox"]');
        if (chatInput && (await chatInput.isVisible())) {
          break;
        }
        await page.waitForTimeout(1000);
      }

      if (!chatInput) {
        if (await checkInvalidPopup()) {
          throw new Error(`Số điện thoại +${cleanPhone} chưa đăng ký hoặc không tồn tại trên WhatsApp.`);
        }
        throw new Error(`Không thể tải khung chat cho số điện thoại +${cleanPhone}. Có thể do mạng chậm hoặc số không hợp lệ.`);
      }

      // Handle Media Upload if present
      if (mediaPaths && mediaPaths.length > 0) {
        console.log(`[WhatsApp] Attaching media: ${mediaPaths.join(', ')}...`);
        const validFiles = mediaPaths.map(p => path.resolve(p)).filter(p => fs.existsSync(p));

        if (validFiles.length > 0) {
          // Open attach menu or locate file input
          const attachBtn = await page.$('span[data-icon="plus"], button[aria-label="Attach"], div[title="Attach"], button[title="Attach"]');
          if (attachBtn) {
            await attachBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(1000);
          }

          let fileInput = await page.$('input[type="file"][accept*="image"], input[type="file"]');
          if (!fileInput) {
            // Re-query file input
            fileInput = await page.$('input[type="file"]');
          }

          if (fileInput) {
            await fileInput.setInputFiles(validFiles);
            await page.waitForTimeout(3000);

            // Type caption in media preview caption input if provided
            if (content && content.trim()) {
              const captionBox = await page.$('div[aria-label*="caption" i], div[data-tab="10"][contenteditable="true"], div[contenteditable="true"][role="textbox"]');
              if (captionBox) {
                await captionBox.focus();
                await captionBox.click({ force: true });
                await page.keyboard.type(content, { delay: 40 });
                await page.waitForTimeout(800);
              }
            }

            // Click send media button
            const sendMediaBtn = await page.waitForSelector('span[data-icon="send"], div[aria-label="Send"], button[aria-label="Send"]', { timeout: 15000 });
            await sendMediaBtn.click({ force: true });
            console.log(`[WhatsApp] Media sent to +${cleanPhone}.`);
            await page.waitForTimeout(4000);

            await context.close();
            return `https://web.whatsapp.com/send?phone=${cleanPhone}`;
          }
        }
      }

      // Plain Text Message Flow
      console.log(`[WhatsApp] Typing text message to +${cleanPhone}...`);
      await chatInput.focus();
      await chatInput.click({ force: true });
      await page.keyboard.type(content, { delay: 45 });
      await page.waitForTimeout(600);

      // Press Enter to send
      await page.keyboard.press('Enter');
      console.log(`[WhatsApp] Message sent to +${cleanPhone}.`);
      await page.waitForTimeout(3500);

      // Screenshot confirmation
      const successScreenshotPath = path.join(SCREENSHOT_DIR, `${account.username}_whatsapp_sent.png`);
      await page.screenshot({ path: successScreenshotPath }).catch(() => {});

      await context.close();
      return `https://web.whatsapp.com/send?phone=${cleanPhone}`;
    } catch (error: any) {
      console.error(`[WhatsApp] Send message failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'whatsapp_message_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async postGroupMessage(account: AccountConfig, proxy: ProxyConfig | undefined, targetGroup: string, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    console.log(`[WhatsApp] Posting to group "${targetGroup}" from @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();

      const isInviteLink = targetGroup.includes('chat.whatsapp.com/');
      if (isInviteLink) {
        let cleanInvite = targetGroup.trim();
        if (!cleanInvite.startsWith('http')) cleanInvite = `https://${cleanInvite}`;
        await page.goto(cleanInvite, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(3000);

        // Click "Join Chat" / "Use WhatsApp Web"
        const joinBtn = await page.$('a#action-button, a[href*="web.whatsapp.com"], button:has-text("Join Chat"), a:has-text("Join Chat"), a:has-text("Use WhatsApp Web")');
        if (joinBtn) {
          await joinBtn.click({ force: true });
          await page.waitForTimeout(4000);
        }

        // Handle Web modal "Join group"
        const confirmJoinBtn = await page.$('div[role="button"]:has-text("Join group"), div[role="button"]:has-text("Tham gia nhóm"), button:has-text("Join group")');
        if (confirmJoinBtn) {
          await confirmJoinBtn.click({ force: true });
          await page.waitForTimeout(3000);
        }
      } else {
        // Search group by name in search bar
        await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(3000);

        const searchBox = await page.waitForSelector('div[contenteditable="true"][data-tab="3"], input[placeholder*="Search"]', { timeout: 15000 });
        await searchBox.focus();
        await searchBox.click({ force: true });
        await page.keyboard.type(targetGroup, { delay: 60 });
        await page.waitForTimeout(2500);

        const groupItem = await page.waitForSelector('#pane-side div[role="listitem"], .chat-list-item', { timeout: 10000 });
        await groupItem.click({ force: true });
        await page.waitForTimeout(2000);
      }

      const chatInput = await page.waitForSelector('#main footer div[contenteditable="true"], footer div[role="textbox"]', { timeout: 20000 });
      
      // Handle Media Upload if present
      if (mediaPaths && mediaPaths.length > 0) {
        const validFiles = mediaPaths.map(p => path.resolve(p)).filter(p => fs.existsSync(p));
        if (validFiles.length > 0) {
          const attachBtn = await page.$('span[data-icon="plus"], button[aria-label="Attach"], div[title="Attach"]');
          if (attachBtn) {
            await attachBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(1000);
          }

          const fileInput = await page.$('input[type="file"][accept*="image"], input[type="file"]');
          if (fileInput) {
            await fileInput.setInputFiles(validFiles);
            await page.waitForTimeout(3000);

            if (content && content.trim()) {
              const captionBox = await page.$('div[aria-label*="caption" i], div[data-tab="10"][contenteditable="true"], div[contenteditable="true"][role="textbox"]');
              if (captionBox) {
                await captionBox.focus();
                await captionBox.click({ force: true });
                await page.keyboard.type(content, { delay: 40 });
                await page.waitForTimeout(800);
              }
            }

            const sendMediaBtn = await page.waitForSelector('span[data-icon="send"], div[aria-label="Send"], button[aria-label="Send"]', { timeout: 15000 });
            await sendMediaBtn.click({ force: true });
            await page.waitForTimeout(4000);

            await context.close();
            return page.url();
          }
        }
      }

      // Text only
      await chatInput.focus();
      await chatInput.click({ force: true });
      await page.keyboard.type(content, { delay: 50 });
      await page.waitForTimeout(600);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      const successUrl = page.url();
      await context.close();
      return successUrl;
    } catch (error: any) {
      console.error(`[WhatsApp] Post group message failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'whatsapp_group_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async postStatus(account: AccountConfig, proxy: ProxyConfig | undefined, content: string, mediaPaths?: string[]): Promise<boolean | string> {
    console.log(`[WhatsApp] Posting Status from @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();

      await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);

      // Open Status Tab
      const statusTabBtn = await page.waitForSelector('button[aria-label="Status"], span[data-icon="status-outline"], span[data-icon="status-refreshed"]', { timeout: 15000 });
      await statusTabBtn.click({ force: true });
      await page.waitForTimeout(2000);

      // Handle media status or text status
      if (mediaPaths && mediaPaths.length > 0) {
        const validFiles = mediaPaths.map(p => path.resolve(p)).filter(p => fs.existsSync(p));
        const fileInput = await page.$('input[type="file"][accept*="image"], input[type="file"]');
        if (fileInput && validFiles.length > 0) {
          await fileInput.setInputFiles(validFiles[0]);
          await page.waitForTimeout(3000);

          if (content && content.trim()) {
            const captionBox = await page.$('div[aria-label*="caption" i], div[contenteditable="true"][role="textbox"]');
            if (captionBox) {
              await captionBox.focus();
              await captionBox.click({ force: true });
              await page.keyboard.type(content, { delay: 40 });
            }
          }

          const sendBtn = await page.waitForSelector('span[data-icon="send"], div[aria-label="Send"], button[aria-label="Send"]', { timeout: 10000 });
          await sendBtn.click({ force: true });
          await page.waitForTimeout(4000);

          await context.close();
          return 'https://web.whatsapp.com/status';
        }
      }

      await context.close();
      return 'https://web.whatsapp.com/status';
    } catch (error: any) {
      console.error(`[WhatsApp] Post status failed:`, error.message);
      if (context) {
        const errPage = page || (await context.pages())[0];
        if (errPage) await saveErrorScreenshot(errPage, account.username, 'whatsapp_status_failed');
        await context.close();
      }
      throw error;
    }
  }

  static async scrapeGroupMembers(
    account: AccountConfig,
    proxy: ProxyConfig | undefined,
    targetGroup: string,
    limit: number = 2000,
    saveChunkCallback?: (chunk: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<Array<{ uid: string; displayName: string; avatarUrl: string }>> {
    console.log(`[WhatsApp] Scraping members from group "${targetGroup}" as @${account.username}...`);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    const scrapedMembers = new Map<string, { uid: string; displayName: string; avatarUrl: string }>();

    try {
      killProfileProcesses(account.user_data_dir);
      const launchOpts = getLaunchOptions(account, proxy);
      context = await chromium.launchPersistentContext(account.user_data_dir, launchOpts);
      page = await context.newPage();

      const isInviteLink = targetGroup.includes('chat.whatsapp.com/');
      if (isInviteLink) {
        let cleanInvite = targetGroup.trim();
        if (!cleanInvite.startsWith('http')) cleanInvite = `https://${cleanInvite}`;
        await page.goto(cleanInvite, { waitUntil: 'domcontentloaded', timeout: 50000 });
        await page.waitForTimeout(3000);

        const joinBtn = await page.$('a#action-button, a[href*="web.whatsapp.com"], button:has-text("Join Chat"), a:has-text("Join Chat"), a:has-text("Use WhatsApp Web")');
        if (joinBtn) {
          await joinBtn.click({ force: true });
          await page.waitForTimeout(4000);
        }

        const confirmJoinBtn = await page.$('div[role="button"]:has-text("Join group"), div[role="button"]:has-text("Tham gia nhóm"), button:has-text("Join group")');
        if (confirmJoinBtn) {
          await confirmJoinBtn.click({ force: true });
          await page.waitForTimeout(3000);
        }
      } else {
        await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 50000 });
        await page.waitForTimeout(3000);

        const searchBox = await page.waitForSelector('div[contenteditable="true"][data-tab="3"], input[placeholder*="Search"]', { timeout: 15000 });
        await searchBox.focus();
        await searchBox.click({ force: true });
        await page.keyboard.type(targetGroup, { delay: 60 });
        await page.waitForTimeout(2500);

        const groupItem = await page.waitForSelector('#pane-side div[role="listitem"], .chat-list-item', { timeout: 10000 });
        await groupItem.click({ force: true });
        await page.waitForTimeout(2000);
      }

      // Click on group header to open Group Info drawer
      const groupHeader = await page.waitForSelector('#main header', { timeout: 15000 });
      await groupHeader.click({ force: true });
      await page.waitForTimeout(2500);

      // Locate Group Info Drawer
      const drawer = await page.waitForSelector('div[data-testid="chat-info-drawer"], div[role="region"], #app div[tabindex="-1"]', { timeout: 15000 });

      // Click "View all" members button if available
      const viewAllBtn = await page.$('div[role="button"]:has-text("View all"), div[role="button"]:has-text("Xem tất cả"), div[role="button"]:has-text("more")');
      if (viewAllBtn) {
        await viewAllBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(2000);
      }

      // Virtual Scroll through member list
      let consecutiveEmptyScrolls = 0;
      let lastTotalCount = 0;

      for (let step = 0; step < 100 && scrapedMembers.size < limit; step++) {
        const currentBatch: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];

        // Extract visible participant elements
        const items = await page.$$('div[role="listitem"], div[data-testid="cell-frame-container"]');
        for (const item of items) {
          try {
            const itemText = await item.innerText();
            if (!itemText) continue;

            const lines = itemText.split('\n').map(s => s.trim()).filter(Boolean);
            let uid = '';
            let displayName = '';

            for (const line of lines) {
              const cleaned = WhatsAppAutomation.cleanPhoneNumber(line);
              if (cleaned && cleaned.length >= 9 && cleaned.length <= 15) {
                uid = cleaned;
              } else if (!displayName && line !== 'Admin' && line !== 'You' && line !== 'Group Admin' && !line.includes('~')) {
                displayName = line;
              }
            }

            if (!uid && lines.length > 0) {
              // Try finding phone or username in title attributes
              const titleEl = await item.$('span[title]');
              if (titleEl) {
                const titleAttr = (await titleEl.getAttribute('title')) || '';
                const cleanedTitle = WhatsAppAutomation.cleanPhoneNumber(titleAttr);
                if (cleanedTitle && cleanedTitle.length >= 9) {
                  uid = cleanedTitle;
                  displayName = lines[0] || titleAttr;
                }
              }
            }

            if (uid && !scrapedMembers.has(uid)) {
              let avatarUrl = '';
              const img = await item.$('img');
              if (img) {
                avatarUrl = (await img.getAttribute('src')) || '';
              }

              const memberObj = { uid, displayName: displayName || `User +${uid}`, avatarUrl };
              scrapedMembers.set(uid, memberObj);
              currentBatch.push(memberObj);
            }
          } catch (e) {}
        }

        if (currentBatch.length > 0 && saveChunkCallback) {
          await saveChunkCallback(currentBatch);
        }

        if (scrapedMembers.size === lastTotalCount) {
          consecutiveEmptyScrolls++;
          if (consecutiveEmptyScrolls >= 5) {
            console.log(`[WhatsApp Scraper] Reached end of participants list (${scrapedMembers.size} members found).`);
            break;
          }
        } else {
          consecutiveEmptyScrolls = 0;
          lastTotalCount = scrapedMembers.size;
        }

        // Scroll down within drawer / participants list
        await page.evaluate(() => {
          const scrollContainers = document.querySelectorAll('div[data-testid="chat-info-drawer"] div[tabindex="0"], div[role="region"] div[tabindex="0"], div[data-testid="drawer-middle"]');
          if (scrollContainers.length > 0) {
            const container = scrollContainers[scrollContainers.length - 1];
            container.scrollBy(0, 450);
          } else {
            window.scrollBy(0, 450);
          }
        });
        await page.waitForTimeout(1000);
      }

      console.log(`[WhatsApp Scraper] Scraped ${scrapedMembers.size} members total.`);
      await context.close();
      return Array.from(scrapedMembers.values()).slice(0, limit);
    } catch (error: any) {
      console.error(`[WhatsApp Scraper] Failed to scrape members:`, error.message);
      if (context) {
        const errorPage = page || (await context.pages())[0];
        if (errorPage) await saveErrorScreenshot(errorPage, account.username, 'whatsapp_scrape_failed');
        await context.close();
      }
      throw error;
    }
  }
}

