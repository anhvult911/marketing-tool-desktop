import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import db, { getSetting } from './db';
import { extractVietnamesePhones, minePhonesFromHtml } from './lead-utils';
import { normalizeLeadValue } from './lead-normalize';
import { scrapeLimiter, ConcurrencyLimiter } from './concurrency';
import { ScrapeAccountPool } from './scrape-pool';
import { ScrapeTaskBoard } from './scrape-tasks';
import { IpRegistry, chooseIpForSession, maxSafeSessions, proxyIpKey, type ProxyEndpoint } from './ip-registry';
import { summarizeByAccount, recommendPacing, withinWindow, TelemetryRow } from './scrape-telemetry';
import type { ClaimedTask } from './scrape-tasks';
import { sendDesktopNotification } from './notify';
import { launchRobustPersistentContext, launchRobustBrowser } from './browser-launcher';
import { unlockProfileDir, killProfileProcesses } from './profile-lock';
import { getRealUserAgent } from './user-agent';

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
  parallelSessions?: number;
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

declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

function sleep(ms: number): Promise<void> {
  if (typeof Promise.withResolvers === 'function') {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  }
  return new Promise(r => setTimeout(r, ms));
}


/**
 * Danh sách từ khóa giao diện hệ thống Facebook, thẻ tag hệ thống & cảm xúc cần loại bỏ
 */
export const UI_BLACKLIST_TERMS = new Set([
  'bài viết', 'giới thiệu', 'ảnh', 'video', 'người theo dõi', 'đang theo dõi',
  'xem thêm', 'xem tất cả', 'thông báo', 'posts', 'about', 'photos', 'videos', 'followers', 'following',
  'reels', 'community', 'reviews', 'mentions', 'settings', 'privacy', 'policies',
  'chia sẻ', 'thích', 'bình luận', 'share', 'like', 'comment', 'facebook', 'menu',
  'trang chủ', 'home', 'tin nhắn', 'liên hệ với chúng tôi', 'gửi tin nhắn', 'tất cả bình luận',
  'phù hợp nhất', 'xem bình luận trước', 'xem thêm câu trả lời', 'xem ai đã bày tỏ cảm xúc',
  'quản lý', 'chỉnh sửa', 'tạo bài viết', 'trực tiếp', 'sự kiện', 'đáng chú ý', 'gần đây nhất',
  'xem bản dịch', 'xem bản gốc', 'chi tiết', 'xem trang cá nhân', 'theo dõi', 'bỏ theo dõi',
  // Thẻ mention hệ thống
  '@nêu bật', 'nêu bật', '@highlight', 'highlight', '@mọi người', '@everyone', 'mọi người',
  // Cảm xúc Facebook (Feelings / Minutiae)
  'đồng cảm', 'nhớ nhà', 'thất bại', 'vô hình', 'hết tiền', 'lo sợ', 'giàu có', 'hào phóng',
  'khỏe mạnh', 'hối hận', 'bị thờ ơ', 'xấu xa', 'tức tối', 'vui vẻ', 'tuyệt vời', 'bối rối',
  'đau khổ', 'thoải mái', 'lo lắng', 'kiệt sức', 'khủng khiếp', 'khỏe', 'hài lòng', 'giận dữ',
  'cô đơn', 'an toàn', 'hạnh phúc', 'có phúc', 'được yêu', 'buồn', 'đáng yêu', 'biết ơn',
  'hào hứng', 'đang yêu', 'điên', 'cảm kích', 'sung sướng', 'khờ khạo', 'thú vị', 'thư giãn',
  'tích cực', 'đầy hy vọng', 'hân hoan', 'mệt mỏi', 'có động lực', 'tự hào', 'chu đáo', 'ok',
  'hoài niệm', 'ốm yếu', 'xúc động', 'tự tin', 'rất tuyệt', 'tươi mới', 'quyết đoán', 'bực mình',
  'may mắn', 'buồn tẻ', 'buồn ngủ', 'tràn đầy sinh lực', 'đói', 'chuyên nghiệp', 'đau đớn',
  'thanh thản', 'thất vọng', 'lạc quan', 'lạnh', 'dễ thương', 'tuyệt cú mèo', 'thật tuyệt',
  'hối tiếc', 'thật giỏi', 'vui nhộn', 'tồi tệ', 'xuống tinh thần', 'đầy cảm hứng', 'phấn khích',
  'bình tĩnh', 'ngớ ngẩn', 'trống vắng', 'tốt', 'mỉa mai', 'mạnh mẽ', 'đặc biệt', 'chán nản',
  'tò mò', 'ủ dột', 'được chào đón', 'xinh đẹp', 'cáu', 'căng thẳng', 'thiếu vắng', 'quá siêu',
  'tinh quái', 'kinh ngạc', 'tức giận', 'buồn chán', 'phẫn nộ', 'mới mẻ', 'thành công',
  'ngạc nhiên', 'nản lòng', 'tẻ nhạt', 'xinh xắn', 'khá hơn', 'tội lỗi', 'tự do', 'được ưu tiên',
  'được yêu mến', 'được coi trọng', 'đủ điều kiện', 'đầy đủ', 'đầy năng lượng', 'ấm áp',
  // Nhãn đăng nhập & tài khoản
  'quên mật khẩu?', 'quên mật khẩu', 'đăng nhập', 'tạo tài khoản mới', 'không phải bây giờ', 'not now', 'log in'
]);

export const SYSTEM_SLUG_SET = new Set([
  'notifications', 'messages', 'friends', 'bookmarks', 'gaming', 'saved', 'memories',
  'settings', 'allactivity', 'search', 'dialog', 'login', 'hashtag', 'feelings', 'activity',
  'help', 'privacy', 'policies', 'terms', 'support', 'about', 'photos', 'videos', 'reels',
  'recover', 'checkpoint', 'reg', 'recover_account'
]);

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
 * A1 — Target validation: phân loại khả năng thu của target trước khi scrape.
 * Trả về kênh khả dụng + thông điệp kỳ vọng để UI/log báo trước, tránh job chạy
 * 10 phút trả 30 leads mà người dùng không hiểu tại sao.
 */
export type TargetCapability = {
  followerListPublic: boolean;   // tab /followers render list thật (không redirect/rỗng)
  isFanpage: boolean;            // fanpage (slug có gạch nối hoặc __typename Page)
  suggestedPagesOnly: boolean;   // trang chỉ hiển thị "Trang tương tự" (FB chặn follower list)
  recommendation: 'cursor_engine' | 'engager_only' | 'group_members' | 'post_engagement';
  notice: string;
};

export async function probeTargetCapability(
  page: Page,
  cleanUrl: string,
  parsedType: 'page' | 'group' | 'post'
): Promise<TargetCapability> {
  const result: TargetCapability = {
    followerListPublic: false,
    isFanpage: false,
    suggestedPagesOnly: false,
    recommendation: 'engager_only',
    notice: '',
  };
  if (parsedType === 'group') {
    result.recommendation = 'group_members';
    result.notice = 'Nhóm Facebook — thu toàn bộ thành viên qua mbasic (public members list).';
    return result;
  }
  if (parsedType === 'post') {
    result.recommendation = 'post_engagement';
    result.notice = 'Bài viết đơn — thu reactors + commenters qua mbasic reaction browser.';
    return result;
  }

  // page/profile: probe trang /followers
  try {
    const followersUrl = `${cleanUrl.replace(/\/$/, '')}/followers`;
    await page.goto(followersUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const lower = (bodyText || '').toLowerCase();
    const currentUrl = page.url();

    result.suggestedPagesOnly =
      lower.includes('trang tương tự') || lower.includes('trang được đề xuất') ||
      lower.includes('gợi ý cho bạn') || lower.includes('suggested pages') || lower.includes('similar pages');
    result.isFanpage = /[a-z]+-[a-z]+/.test(cleanUrl.split('/').pop() || '') || result.suggestedPagesOnly;
    // Trang followers "thật" có danh sách anchor người dùng + KHÔNG phải trang suggested
    const hasUserAnchors = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[role="link"], a[href*="profile.php"], a[href*="/user/"]'));
      let userCount = 0;
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (href.includes('/user/') || href.includes('profile.php?id=')) userCount++;
        if (userCount >= 5) break;
      }
      return userCount >= 5;
    }).catch(() => false);

    result.followerListPublic = !result.suggestedPagesOnly && hasUserAnchors;
    if (result.followerListPublic) {
      result.recommendation = 'cursor_engine';
      result.notice = 'Follower list công khai — Follower Cursor Engine sẽ thu tối đa qua GraphQL phân trang.';
    } else if (result.suggestedPagesOnly) {
      result.recommendation = 'engager_only';
      result.notice = 'Fanpage chặn follower list (hiển thị Trang tương tự) — chuyển engager harvesting (reactions + comments toàn timeline).';
    } else {
      result.recommendation = 'engager_only';
      result.notice = 'Profile cá nhân ẩn follower list (mặc định FB từ 2023) — chỉ thu được engager (người thả cảm xúc/bình luận). Không thể enumerate follower list.';
    }
  } catch {
    result.recommendation = 'engager_only';
    result.notice = 'Không probe được trang followers — mặc định engager harvesting.';
  }
  return result;
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

    // Ưu tiên: /user/<userId> hoặc /groups/<groupId>/user/<userId> là link người dùng thật
    const matchDigits = cleanLink.match(/\/user\/(\d+)/);
    if (matchDigits && /^\d{6,20}$/.test(matchDigits[1])) return matchDigits[1];

    // Chặn tuyệt đối các đường dẫn hệ thống / bài viết / chia sẻ (ID trong link là của BÀI VIẾT hoặc trang hệ thống, không phải người dùng)
    const lowerPath = url.pathname.toLowerCase();
    if (
      lowerPath.includes('.php') && lowerPath !== '/profile.php' ||
      /^\/(photo|photos|video|videos|watch|story|stories|share|reel|reels|permalink|groups|events|marketplace|help|policies|privacy|terms|login|recover|reg|hashtag|feed|notes|gaming|jobs|ads)(\/|$)/.test(lowerPath)
    ) {
      // Ngoại lệ: profile.php?id=... là link người dùng thật
      if (lowerPath !== '/profile.php') return '';
    }

    // profile.php?id=... là link người dùng thật (đã loại story.php?id=... ở blocklist trên)
    if (lowerPath === '/profile.php') {
      const idVal = url.searchParams.get('id') || '';
      if (/^\d{6,20}$/.test(idVal)) return idVal;
      return '';
    }


    const pathname = url.pathname.replace(/^\/|\/$/g, '');
    const parts = pathname.split('/').filter(Boolean);

    if (parts.includes('user')) {
      const uIndex = parts.indexOf('user');
      if (uIndex < parts.length - 1 && /^\d{6,20}$/.test(parts[uIndex + 1])) {
        return parts[uIndex + 1];
      }
    }

    if (parts.length === 1) {
      let first = parts[0];
      try { first = decodeURIComponent(first); } catch {}

      // Bỏ qua slug hệ thống, danh mục trang
      if (
        SYSTEM_SLUG_SET.has(first.toLowerCase()) ||
        ['groups', 'pages', 'people', 'watch', 'events', 'photo.php', 'video.php', 'reel', 'story.php', 'marketplace', 'p', 'hashtag'].includes(first.toLowerCase()) ||
        first.includes('%')
      ) {
        if (parts.length > 1 && (parts[0] === 'people' || parts[0] === 'user')) {
          for (let idx = parts.length - 1; idx >= 1; idx--) {
            const part = parts[idx];
            if (/^\d{6,20}$/.test(part)) return part;
            if (/^[a-zA-Z0-9.]{5,50}$/.test(part) && !SYSTEM_SLUG_SET.has(part.toLowerCase())) {
              return part;
            }
          }
        }
        return '';
      }

      // Username cá nhân chuẩn Facebook: chỉ gồm chữ cái, số và dấu chấm, độ dài 5-50
      // Loại trừ slug Fanpage có gạch nối (e.g. Shop-hoa-tuoi-..., Chuoi-Winmart-...)
      if (/^[a-zA-Z0-9.]{5,50}$/.test(first) && !first.includes('-')) {
        return first;
      }
    }
  } catch {}

  return '';
}

/**
 * Trích xuất UID người dùng từ thuộc tính data-hovercard
 * Trả về { uid, isPage }
 */
export function extractUidFromHovercard(hovercard: string): { uid: string; isPage: boolean } {
  if (!hovercard) return { uid: '', isPage: false };
  if (hovercard.includes('page.php') || hovercard.includes('/pages/')) {
    return { uid: '', isPage: true };
  }
  const matchUser = hovercard.match(/user\.php\?id=(\d+)/);
  if (matchUser && matchUser[1] && /^\d{6,20}$/.test(matchUser[1])) {
    return { uid: matchUser[1], isPage: false };
  }
  return { uid: '', isPage: false };
}

// P2/P3 — util SĐT dùng chung với telegram-crawler (src/lib/lead-utils.ts).
// Re-export để code/API cũ import từ facebook-crawler vẫn chạy.
export { extractVietnamesePhones } from './lead-utils';

/**
 * P2 — Bóc SĐT trực tiếp từ HTML mbasic (reaction/comment/timeline/member pages).
 * Mỗi SĐT là 1 lead zalo độc lập (uid rỗng, saveLeadBatch xử lý nhánh phone-only).
 * Trang mbasic là HTML thuần nên text bình luận/bài viết nằm ngay trong markup.
 */
function harvestPhonesFromHtml(
  html: string,
  saveBatch: (leads: ExtractedLead[]) => number
): number {
  const phones = minePhonesFromHtml(html);
  if (phones.length === 0) return 0;
  return saveBatch(phones.map(p => ({
    uid: '',
    displayName: `SĐT từ bình luận/bài viết`,
    interactionType: 'phone_comment',
    phone: p,
  })));
}

/**
 * Kết quả phân loại tình trạng trang: phân biệt rõ 3 mức vì hậu quả khác nhau.
 *
 * Đo trên máy thật: account #4 bị log "checkpoint" và bị loại khỏi job, nhưng job vẫn
 * thu 373 leads và account vẫn khoẻ. Nguyên nhân: các phép khớp CHUỖI THÔ:
 *   - html.includes('login_form')  → khớp cả tên biến JS vô hại
 *   - html.includes('checkpoint')  → khớp cả markup/khoá JS bình thường
 *   - url.includes('login')        → khớp cả query param  (?ref=login)
 *   - url.includes('disabled')     → khớp cả query param  (?disabled=1)
 * Báo oan checkpoint khiến account bị cooldown 60' và bị loại khỏi pool — mất nguồn
 * lực đúng lúc đang chạy tốt, đồng thời làm nhiễu mọi thống kê sức khoẻ.
 */
export type BlockKind = 'none' | 'login' | 'checkpoint';

export interface BlockAssessment {
  kind: BlockKind;
  markers: string[];
}

/** True nếu path (không tính query) chứa segment khớp chính xác. */
function pathHasSegment(rawUrl: string, segments: string[]): boolean {
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.toLowerCase().split('/').filter(Boolean);
    return parts.some(p => segments.includes(p));
  } catch {
    return false;
  }
}

/** Đích chuyển hướng đăng nhập thật của Facebook. */
function isLoginRedirect(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname.toLowerCase();
    const host = u.hostname.toLowerCase();
    if (!host.includes('facebook.com')) return false;
    if (path === '/login.php' || path === '/login' || path.startsWith('/login/')) return true;
    // /checkpoint/ là trang xác minh danh tính — mức nặng hơn login
    return false;
  } catch {
    return false;
  }
}

/**
 * Đánh giá tình trạng trang trả về. Chỉ kết luận khi có dấu hiệu ĐỦ CỤ THỂ:
 * mẫu câu tiếng Việt/Anh đầy đủ, hoặc redirect tới đúng /login.php.
 * Cố tình KHÔNG dùng `includes('checkpoint')` / `includes('login')` trần.
 */
export function assessBlock(rawUrl: string, pageContent: string): BlockAssessment {
  const url = String(rawUrl || '');
  const text = String(pageContent || '').toLowerCase();
  const markers: string[] = [];

  // ── Checkpoint (nặng: tài khoản bị khoá/xác minh) ──
  if (pathHasSegment(url, ['checkpoint'])) markers.push('url:/checkpoint/');
  const checkpointPhrases = [
    'tài khoản của bạn tạm thời bị khóa',
    'tài khoản của bạn đã bị khóa',
    'bạn tạm thời bị chặn',
    'vui lòng xác nhận danh tính',
    'xác nhận danh tính của bạn',
    'you’re temporarily blocked',
    "you're temporarily blocked",
    'confirm your identity',
    'hành động bị chặn',
    'action blocked',
    'we suspended your account',
  ];
  for (const p of checkpointPhrases) {
    if (text.includes(p)) { markers.push(`text:${p}`); break; }
  }
  if (markers.length > 0) return { kind: 'checkpoint', markers };

  // ── Login wall (nhẹ: phiên hỏng, KHÔNG phải tài khoản bị khoá) ──
  if (isLoginRedirect(url)) markers.push('url:redirect-login');
  const loginPhrases = [
    'đăng nhập vào facebook',
    'log in to facebook',
    'log into facebook',
    'bạn phải đăng nhập',
    'you must log in',
  ];
  for (const p of loginPhrases) {
    if (text.includes(p)) { markers.push(`text:${p}`); break; }
  }
  if (markers.length > 0) return { kind: 'login', markers };

  return { kind: 'none', markers: [] };
}

/**
 * Giữ API cũ cho tương thích: true khi trang là checkpoint THẬT (không tính login wall).
 * Caller cũ dùng hàm này để quyết định cooldown account — nay chỉ checkpoint mới đủ nặng.
 */
export function detectFacebookCheckpoint(url: string, pageContent: string): boolean {
  return assessBlock(url, pageContent).kind === 'checkpoint';
}

/**
 * Tự động đóng các modal quảng cáo đăng nhập, đồng ý cookie gây cản trở tương tác
 */
export async function dismissFacebookDialogs(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      // Cookie banner accept/decline
      const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').toLowerCase().trim();
        if (
          text.includes('cho phép tất cả cookie') ||
          text.includes('chỉ cho phép các cookie thiết yếu') ||
          text.includes('allow all cookies') ||
          text.includes('decline optional cookies') ||
          text.includes('không phải bây giờ') ||
          text.includes('not now')
        ) {
          (btn as HTMLElement).click();
          break;
        }
      }

      // Close login overlay popup if any
      const closeButtons = document.querySelectorAll('div[aria-label*="Đóng"], div[aria-label*="Close"], div[role="button"][aria-label*="Đóng"], div[role="button"][aria-label*="Close"]');
      for (const cb of Array.from(closeButtons)) {
        (cb as HTMLElement).click();
      }
    });
  } catch {}
}

/**
 * Setup Playwright Context with Stealth and Anti-Detection Measures
 */

/**
 * Mở 1 page cấu hình mobile trong cùng context (giữ cookie + proxy của account).
 * Viewport mobile để mbasic không redirect sang www.
 * KHÔNG override User-Agent (header lẫn navigator): UA thật của binary được mbasic
 * chấp nhận (chỉ UA mobile Chrome<=88 mới bị 400), và UA thật khớp 100% client
 * hints + JS engine — không còn mismatch 122/124/153 để FB soi.
 */
async function newMbasicPage(context: BrowserContext): Promise<Page> {
  const p = await context.newPage();
  await p.setViewportSize({ width: 360, height: 640 });
  return p;
}

/**
 * Setup Playwright Context with Stealth and Anti-Detection Measures.
 * CD6 — proxyOverride: phiên dùng proxy khác proxy mặc định của account (xoay IP
 * giữa các pass — FB reset chuỗi phân trang theo IP, nghỉ chỉ hỗ trợ một phần).
 */
async function setupStealthBrowserContext(accountId?: number, proxyOverride?: { proxyId: number; host: string; port: number; username?: string; password?: string; protocol?: string }): Promise<{ context: BrowserContext; isPersistent: boolean; accountUsername: string; usedProxyId: number | null }> {
  let profileDir = '';
  let cookiesToInject: any[] = [];
  let proxyConfig: any = undefined;
  let username = 'Guest';
  let usedProxyId: number | null = null;
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
      // turbopackIgnore: profile dir của account là dữ liệu RUNTIME (ngoài bundle);
      // không đánh dấu sẽ khiến bộ trace của Next glob cả project.
      if (acc.user_data_dir && fs.existsSync(/*turbopackIgnore: true*/ acc.user_data_dir)) {
        profileDir = acc.user_data_dir;
        unlockProfileDir(profileDir);
      }

      if (proxyOverride) {
        // CD6: phiên dùng proxy khác mặc định — IP mới = chuỗi phân trang mới
        usedProxyId = proxyOverride.proxyId;
        proxyConfig = {
          server: `${proxyOverride.protocol || 'http'}://${proxyOverride.host}:${proxyOverride.port}`,
          username: proxyOverride.username || undefined,
          password: proxyOverride.password || undefined,
        };
      } else if (acc.host && acc.port) {
        proxyConfig = {
          server: `${acc.proxy_proto || 'http'}://${acc.host}:${acc.port}`,
          username: acc.proxy_user || undefined,
          password: acc.proxy_pass || undefined,
        };
        usedProxyId = acc.proxy_id || null;
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

  // KHÔNG set userAgent: Chrome dùng UA thật của binary, Sec-Ch-Ua tự khớp.
  // Hardcode Chrome/124 khi binary là 153 = detection vector của FB.

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--disable-dev-shm-usage',
    '--window-position=0,0',
    '--lang=vi-VN,vi,en-US,en'
  ];
  // Headless Chrome tự gắn token "HeadlessChrome" trong UA — gỡ bằng cách set
  // UA thật (khớp version binary, lấy 1 lần rồi cache) cho context.
  const realUA = await getRealUserAgent();

  let context: BrowserContext;
  let isPersistent = false;

  if (profileDir && fs.existsSync(/*turbopackIgnore: true*/ profileDir)) {
    context = await launchRobustPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1366, height: 768 },
      userAgent: realUA,
      proxy: proxyConfig,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      args: launchArgs,
    });
    isPersistent = true;
  } else {
    const browser = await launchRobustBrowser({
      headless: true,
      proxy: proxyConfig,
      args: launchArgs,
    });
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: realUA,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    });
    isPersistent = false;
  }

  // Inject Stealth Anti-Detection Script
  // KHÔNG mock navigator.plugins — mock [1,2,3,4,5] thiếu PluginArray interface
  // (item/namedItem/length behavior) là detection vector nổi tiếng. Trên Windows
  // Chrome thật có PDF plugin sẵn, plugins thật là tín hiệu mạnh hơn mock.
  await context.addInitScript(() => {
    try {
      // Mask navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock languages khớp locale vi-VN
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

  return { context, isPersistent, accountUsername: username, usedProxyId };
}

/**
 * Quét thành viên Group Facebook trực tiếp từ DOM (/groups/<id>/members)
 */
async function extractGroupMembersFromDOM(
  page: Page,
  groupUrl: string,
  saveBatch: (leads: ExtractedLead[]) => number,
  maxLimit: number,
  cancelSignal: { cancelled: boolean }
): Promise<number> {
  const membersUrl = groupUrl.endsWith('/members') ? groupUrl : `${groupUrl.replace(/\/$/, '')}/members`;
  console.log(`[FB Scraper] 👥 Điều hướng tới danh sách thành viên nhóm: ${membersUrl}`);
  await page.goto(membersUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await dismissFacebookDialogs(page);

  let totalScraped = 0;
  let scrollAttempts = 0;
  const seenUids = new Set<string>();

  while (!cancelSignal.cancelled && totalScraped < maxLimit && scrollAttempts < 35) {
    const rawMembers = (await page.evaluate(() => {
      const items: { href: string; name: string; avatar: string }[] = [];
      const links = Array.from(document.querySelectorAll('a[role="link"]'));

      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const isUserLink = href.includes('/user/') || href.includes('/profile.php?id=') || (
          a.closest('div[role="listitem"]') !== null && !href.includes('/groups/') && !href.includes('/hashtag/')
        );
        if (!isUserLink) continue;

        const nameEl = a.querySelector('span[dir="auto"]') || a;
        const text = (nameEl.textContent || a.textContent || '').trim();
        if (!text || text.length < 2 || text.length > 50 || text.includes('\n')) continue;
        if (text.startsWith('@') || text.startsWith('#')) continue;

        const row = a.closest('div[role="listitem"]') || a.parentElement;
        const img = a.querySelector('img') || row?.querySelector('img');
        const avatar = img?.getAttribute('src') || '';

        items.push({ href, name: text.split('\n')[0].trim(), avatar });
      }
      return items;
    }) ?? []);

    const newLeads: ExtractedLead[] = [];
    for (const m of rawMembers) {
      const uid = extractUidFromFacebookLink(m.href);
      if (uid && uid.length > 2 && !seenUids.has(uid.toLowerCase())) {
        seenUids.add(uid.toLowerCase());
        newLeads.push({
          uid,
          displayName: m.name,
          avatarUrl: m.avatar || undefined,
          profileUrl: m.href.startsWith('http') ? m.href : `https://www.facebook.com${m.href}`,
          interactionType: 'group_member'
        });
      }
    }

    // Đếm theo số lead insert MỚI (dedup ở saveBatch), không theo số anchor parse được
    const inserted = saveBatch(newLeads);
    if (inserted > 0) {
      totalScraped += inserted;
      scrollAttempts = 0;
    } else {
      scrollAttempts++;
    }

    await page.evaluate(() => window.scrollBy(0, 1100 + Math.floor(Math.random() * 300)));
    await page.waitForTimeout(1300 + Math.floor(Math.random() * 500));
  }

  return totalScraped;
}

/**
 * Quét danh sách người công khai từ DOM: /followers (fanpage/profile) hoặc
 * /friends (profile để bạn bè công khai). P2 — dùng chung cho 2 kênh.
 */
async function extractPeopleListFromDOM(
  page: Page,
  listUrl: string,
  interactionType: 'follower' | 'friend',
  saveBatch: (leads: ExtractedLead[]) => number,
  maxLimit: number,
  cancelSignal: { cancelled: boolean }
): Promise<number> {
  console.log(`[FB Scraper] 🌟 Kiểm tra danh sách (${interactionType}) tại: ${listUrl}`);
  await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await dismissFacebookDialogs(page);

  // Kiểm tra xem trang có hiển thị "Trang tương tự" / "Gợi ý cho bạn" hay không
  // (Facebook Fanpage luôn ẩn followers và chỉ hiển thị gợi ý Fanpage kinh doanh)
  const isRecommendedPages = await page.evaluate(() => {
    const text = (document.body.innerText || '').toLowerCase();
    return (
      text.includes('trang tương tự') ||
      text.includes('trang được đề xuất') ||
      text.includes('gợi ý cho bạn') ||
      text.includes('suggested pages') ||
      text.includes('similar pages')
    );
  });

  if (isRecommendedPages) {
    console.log(`[FB Scraper] ⚠️ Tab ${listUrl} hiển thị danh sách trang đề xuất thay vì người thật. Bỏ qua.`);
    return 0;
  }

  let totalScraped = 0;
  let scrollAttempts = 0;
  const seenUids = new Set<string>();

  let stagnantScrolls = 0;

  while (!cancelSignal.cancelled && totalScraped < maxLimit && scrollAttempts < 120 && stagnantScrolls < 40) {
    const rawFollowers = (await page.evaluate(() => {
      const items: { href: string; name: string; avatar: string; hovercard: string }[] = [];
      const mainContainer = document.querySelector('div[role="main"]') || document.body;
      const links = Array.from(mainContainer.querySelectorAll('a[role="link"]'));

      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (
          !href ||
          href.includes('/followers') ||
          href.includes('/friends') ||
          href.includes('/following') ||
          href.includes('/groups/') ||
          href.includes('/posts/') ||
          href.includes('/videos/')
        ) {
          continue;
        }

        const hovercard = a.getAttribute('data-hovercard') || a.parentElement?.getAttribute('data-hovercard') || '';
        if (hovercard.includes('page.php') || hovercard.includes('/pages/')) {
          continue; // Loại trừ 100% Fanpage
        }

        const nameEl = a.querySelector('span[dir="auto"]') || a;
        const text = (nameEl.textContent || a.textContent || '').trim();
        if (!text || text.length < 2 || text.length > 50 || text.includes('\n')) continue;
        if (text.startsWith('@') || text.startsWith('#')) continue;

        const card = a.closest('div[style*="flex"], div[data-visualcompletion]') || a.parentElement;
        const img = a.querySelector('img') || card?.querySelector('img');
        const avatar = img?.getAttribute('src') || '';

        items.push({ href, name: text.split('\n')[0].trim(), avatar, hovercard });
      }
      return items;
    }) ?? []);

    const newLeads: ExtractedLead[] = [];
    for (const f of rawFollowers) {
      let uid = '';
      if (f.hovercard) {
        const parsedH = extractUidFromHovercard(f.hovercard);
        if (parsedH.isPage) continue;
        if (parsedH.uid) uid = parsedH.uid;
      }
      if (!uid) {
        uid = extractUidFromFacebookLink(f.href);
      }

      if (uid && uid.length > 2 && !seenUids.has(uid.toLowerCase())) {
        seenUids.add(uid.toLowerCase());
        newLeads.push({
          uid,
          displayName: f.name,
          avatarUrl: f.avatar || undefined,
          profileUrl: f.href.startsWith('http') ? f.href : `https://www.facebook.com${f.href}`,
          interactionType
        });
      }
    }

    // Đếm theo số lead insert MỚI (dedup ở saveBatch) — followers lặp giữa các batch không đốt quota
    const inserted = saveBatch(newLeads);
    if (inserted > 0) {
      totalScraped += inserted;
      scrollAttempts = 0;
      stagnantScrolls = 0;
    } else {
      scrollAttempts++;
      stagnantScrolls++;
      if (scrollAttempts >= 3 && totalScraped === 0) {
        console.log(`[FB Scraper] Danh sách ${listUrl} không có dữ liệu công khai hoặc bị ẩn.`);
        break;
      }
    }

    // Adaptive back-off: cuộn ngược nhẹ mỗi 4 lần trống để kích hoạt lazy-load bị kẹt
    if (stagnantScrolls >= 4 && stagnantScrolls % 3 === 0) {
      await page.evaluate(() => window.scrollBy(0, -400));
      await page.waitForTimeout(1000);
    }

    await page.evaluate(() => window.scrollBy(0, 1100 + Math.floor(Math.random() * 300)));
    await page.waitForTimeout(1400 + Math.floor(Math.random() * 500));
  }

  return totalScraped;
}

/**
 * Quét tương tác bài viết (Người thả cảm xúc Like/Love/Care + Bình luận + Trích xuất SĐT)
 */
async function extractTimelineEngagement(
  page: Page,
  cleanUrl: string,
  saveBatch: (leads: ExtractedLead[]) => number,
  maxLimit: number,
  cancelSignal: { cancelled: boolean }
): Promise<number> {
  console.log(`[FB Scraper] 💬 Bắt đầu quét tương tác bài viết (Reactions + Comments + SĐT) tại: ${cleanUrl}`);
  await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await dismissFacebookDialogs(page);

  let totalScraped = 0;
  let postScrolls = 0;
  // Track post theo PERMALINK (ổn định khi Comet re-render/virtualize feed),
  // không theo index — index xáo trộn khiến post bị bỏ qua hoặc xử lý lại (bug yield thấp)
  const processedPosts = new Set<string>();

  while (!cancelSignal.cancelled && totalScraped < maxLimit && postScrolls < 90) {
    const postKeys = (await page.evaluate(() => {
      const posts = document.querySelectorAll('div[role="feed"] > div, div[role="article"]');
      return Array.from(posts).map((post, i) => {
        const permalink = post.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story.php"], a[href*="videos/"], a[href*="reel"], a[href*="photos/"]')?.getAttribute('href');
        return permalink ? permalink.split('?')[0] : `pos:${i}`;
      });
    }) ?? []);

    for (let i = 0; i < postKeys.length; i++) {
      if (cancelSignal.cancelled || totalScraped >= maxLimit) break;
      const postKey = postKeys[i];
      if (processedPosts.has(postKey)) continue;
      processedPosts.add(postKey);

      try {
        await page.evaluate((idx) => {
          const posts = document.querySelectorAll('div[role="feed"] > div, div[role="article"]');
          if (posts[idx]) {
            posts[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, i);
        await page.waitForTimeout(800);

        // A. Thử click mở Modal Cảm xúc (Reactions Dialog)
        const clickedReaction = await page.evaluate((idx) => {
          const posts = document.querySelectorAll('div[role="feed"] > div, div[role="article"]');
          const post = posts[idx];
          if (!post) return false;

          const candidates = Array.from(post.querySelectorAll(`
            span[role="toolbar"] [role="button"],
            div[role="button"][aria-label*="bày tỏ"],
            div[role="button"][aria-label*="cảm xúc"],
            div[role="button"][aria-label*="reaction"],
            div[role="button"][aria-label*="reacted"],
            div[role="button"][aria-label*="thích:"],
            div[role="button"][aria-label*="like:"],
            div[role="button"][aria-label*="thích"],
            div[role="button"][aria-label*="xem ai đã"],
            span[data-visualcompletion="ignore-dynamic-hydration"] [role="button"],
            span[data-visualcompletion="ignore-dynamic-hydration"],
            span[role="button"]
          `));

          for (const el of candidates) {
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const text = (el.textContent || '').trim().toLowerCase();
            if (
              aria.includes('bày tỏ') ||
              aria.includes('cảm xúc') ||
              aria.includes('reaction') ||
              aria.includes('reacted') ||
              aria.includes('thích:') ||
              aria.includes('like:') ||
              aria.includes('xem ai đã') ||
              text.includes('người khác') ||
              text.includes('và người') ||
              (/^\d+([\.,]\d+)?[kK]?$/.test(text) && el.querySelector('img, svg, i'))
            ) {
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, i);

        if (clickedReaction) {
          const dialog = await page.waitForSelector('div[role="dialog"]', { timeout: 3000 }).catch(() => null);
          if (dialog) {
            console.log(`[FB Scraper] 👍 Đã mở popup cảm xúc bài ${postKey}`);
            const seenDialogUids = new Set<string>();

            for (let d = 0; d < 40; d++) {
              if (cancelSignal.cancelled || totalScraped >= maxLimit) break;

              const dialogUsers = await page.evaluate(() => {
                const results: { href: string; name: string; avatar: string; hovercard: string }[] = [];
                const dialogEl = document.querySelector('div[role="dialog"]');
                if (!dialogEl) return results;

                const tabTerms = new Set(['tất cả', 'thích', 'yêu thích', 'haha', 'woa', 'buồn', 'phẫn nộ', 'all', 'like', 'love', 'care', 'sad', 'angry', 'xem thêm']);
                const links = Array.from(dialogEl.querySelectorAll('a[role="link"]'));

                for (const a of links) {
                  const href = a.getAttribute('href') || '';
                  if (!href || href.includes('/posts/') || href.includes('/groups/')) continue;

                  const hovercard = a.getAttribute('data-hovercard') || 
                                    a.parentElement?.getAttribute('data-hovercard') || 
                                    a.closest('div[role="listitem"]')?.getAttribute('data-hovercard') || '';
                  if (hovercard.includes('page.php') || hovercard.includes('/pages/')) continue;

                  const nameEl = a.querySelector('span[dir="auto"]') || a;
                  const text = (nameEl.textContent || a.textContent || '').trim();
                  if (!text || text.length < 2 || text.length > 50 || text.includes('\n')) continue;
                  if (tabTerms.has(text.toLowerCase()) || text.startsWith('@') || text.startsWith('#')) continue;

                  const img = a.querySelector('img') || a.parentElement?.querySelector('img') || a.closest('div[role="listitem"]')?.querySelector('img');
                  const avatar = img?.getAttribute('src') || '';

                  results.push({ href, name: text.split('\n')[0].trim(), avatar, hovercard });
                }
                return results;
              });

              const newReactors: ExtractedLead[] = [];
              for (const u of dialogUsers) {
                let uid = '';
                if (u.hovercard) {
                  const parsedH = extractUidFromHovercard(u.hovercard);
                  if (parsedH.isPage) continue;
                  if (parsedH.uid) uid = parsedH.uid;
                }
                if (!uid) {
                  uid = extractUidFromFacebookLink(u.href);
                }

                if (uid && uid.length > 2 && !seenDialogUids.has(uid.toLowerCase())) {
                  seenDialogUids.add(uid.toLowerCase());
                  newReactors.push({
                    uid,
                    displayName: u.name,
                    avatarUrl: u.avatar || undefined,
                    profileUrl: u.href.startsWith('http') ? u.href : `https://www.facebook.com${u.href}`,
                    interactionType: 'reaction_like'
                  });
                }
              }

              if (newReactors.length > 0) {
                totalScraped += saveBatch(newReactors);
              }

              const dialogScrolled = await page.evaluate(() => {
                const dialogEl = document.querySelector('div[role="dialog"]');
                if (!dialogEl) return false;
                const scrollables = dialogEl.querySelectorAll('*');
                for (const el of Array.from(scrollables)) {
                  if (el.scrollHeight > el.clientHeight + 40 && window.getComputedStyle(el).overflowY !== 'hidden') {
                    el.scrollBy(0, 900);
                    return true;
                  }
                }
                return false;
              });

              if (!dialogScrolled) break;
              await page.waitForTimeout(1000 + Math.floor(Math.random() * 400));
            }

            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(600);
          }
        }

        // B. Khai thác Bình luận (Comments) & Số điện thoại
        await page.evaluate((idx) => {
          const posts = document.querySelectorAll('div[role="feed"] > div, div[role="article"]');
          const post = posts[idx];
          if (!post) return;

          const buttons = Array.from(post.querySelectorAll('span, div[role="button"]'));
          for (const b of buttons) {
            const t = (b.textContent || '').trim();
            if (t.includes('Xem thêm bình luận') || t.includes('View more comments') || t.includes('Xem các câu trả lời') || t.includes('câu trả lời')) {
              (b as HTMLElement).click();
            }
          }
        }, i);
        await page.waitForTimeout(800);

        const commentData = await page.evaluate((idx) => {
          const results: { href: string; name: string; avatar: string; commentText: string; hovercard: string }[] = [];
          const posts = document.querySelectorAll('div[role="feed"] > div, div[role="article"]');
          const post = posts[idx];
          if (!post) return results;

          const commentArticles = Array.from(post.querySelectorAll('div[role="article"], div[aria-label*="Bình luận"], div[aria-label*="Comment"]'));
          for (const art of commentArticles) {
            const a = art.querySelector('a[role="link"]');
            if (!a) continue;
            const href = a.getAttribute('href') || '';
            if (!href || href.includes('/posts/')) continue;

            const hovercard = a.getAttribute('data-hovercard') || 
                              a.parentElement?.getAttribute('data-hovercard') || 
                              art.getAttribute('data-hovercard') || '';
            if (hovercard.includes('page.php') || hovercard.includes('/pages/')) continue;

            const nameEl = a.querySelector('span[dir="auto"]') || a;
            const text = (nameEl.textContent || a.textContent || '').trim();
            if (!text || text.length < 2 || text.length > 50 || text.includes('\n')) continue;
            if (text.startsWith('@') || text.startsWith('#')) continue;

            const commentText = (art.textContent || '').trim();
            const img = art.querySelector('img');
            const avatar = img?.getAttribute('src') || '';

            results.push({ href, name: text.split('\n')[0].trim(), avatar, commentText, hovercard });
          }
          return results;
        }, i);

        if (commentData.length > 0) {
          const commentLeads: ExtractedLead[] = [];
          for (const c of commentData) {
            let uid = '';
            if (c.hovercard) {
              const parsedH = extractUidFromHovercard(c.hovercard);
              if (parsedH.isPage) continue;
              if (parsedH.uid) uid = parsedH.uid;
            }
            if (!uid) {
              uid = extractUidFromFacebookLink(c.href);
            }

            if (uid && uid.length > 2) {
              const phones = extractVietnamesePhones(c.commentText);
              commentLeads.push({
                uid,
                displayName: c.name,
                avatarUrl: c.avatar || undefined,
                profileUrl: c.href.startsWith('http') ? c.href : `https://www.facebook.com${c.href}`,
                interactionType: 'comment',
                phone: phones.length > 0 ? phones[0] : undefined
              });
            }
          }

          if (commentLeads.length > 0) {
            totalScraped += saveBatch(commentLeads);
          }
        }

      } catch (postErr: unknown) {
        const msg = postErr instanceof Error ? postErr.message : String(postErr);
        console.warn(`[FB Scraper] Lỗi khi xử lý bài viết ${postKey}:`, msg);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 1200 + Math.floor(Math.random() * 400)));
    await page.waitForTimeout(1500 + Math.floor(Math.random() * 500));
    postScrolls++;
  }

  return totalScraped;
}

/**
 * Lấy Viewer Account ID (c_user) từ cookie phiên đăng nhập của context
 */
export async function getViewerAccountId(context: BrowserContext): Promise<string> {
  try {
    const cookies = await context.cookies('https://www.facebook.com');
    return cookies.find(c => c.name === 'c_user')?.value || '';
  } catch {
    return '';
  }
}
/**
 * Capture template của query followers: endpoint + headers + POST params + variables.
 * Engine cursor pagination sẽ dùng template này để tự phân trang (giống hệt yêu cầu UI tự phát).
 */
export interface GraphQLFollowerCapture {
  endpoint: string | null;
  headers: Record<string, string> | null;
  postParams: Record<string, string> | null;
  variables: Record<string, unknown> | null;
  cursor: string | null;
  queryName: string;
  capturedAt: number;
  // v2: token tự nạp từ trang khi template capture không chứa đủ — đủ để engine
  // tự replay không phụ thuộc trang phải bắn query followers trước.
  fbDtsg: string | null;
  lsd: string | null;
  viewerId: string | null;
}

export function createFollowerCapture(): GraphQLFollowerCapture {
  return { endpoint: null, headers: null, postParams: null, variables: null, cursor: null, queryName: '', capturedAt: 0, fbDtsg: null, lsd: null, viewerId: null };
}
/**
 * Pre-flight: kiểm tra đăng nhập thật bằng 1 request mbasic /me/.
 * Trả { live, decisive }: decisive=false nghĩa là không kết luận được (400/timeout) —
 * caller giữ nguyên trạng thái account, không mark die oan.
 */
export async function probeAccountLogin(context: BrowserContext): Promise<{ live: boolean; decisive: boolean }> {
  let page: Page | null = null;
  try {
    page = await newMbasicPage(context);
    const resp = await page.goto('https://mbasic.facebook.com/me/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(1200);
    const url = page.url();
    const html = await page.content().catch(() => '');
    // DEAD dứt khoát: FB redirect thẳng trang login kèm login_form
    if (url.includes('login') && html.includes('login_form')) return { live: false, decisive: true };
    // LIVE DỨT KHOÁT cần 2 điều kiện, không chỉ "không thấy login form":
    // 1. Response 200 thật (không bị throttle/soft-block trả trang trắng)
    // 2. Trang chứa marker của mbasic đã đăng nhập: own profile link hoặc composer,
    //    loại trừ trang login/checkpoint đã bị redirect qua www.
    const httpOk = !!resp && resp.status() === 200;
    const onMbasic = url.includes('mbasic.facebook.com');
    const hasLoginMarker = html.includes('login_form') || url.includes('login') || url.includes('checkpoint');
    const loggedInMarker =
      html.includes('/composer/?') ||
      html.includes('/feed/?') ||
      html.includes('/notifications.php') ||
      html.includes('/friends/requests') ||
      /href="\/[0-9]{6,}"/.test(html);
    if (httpOk && onMbasic && !hasLoginMarker && loggedInMarker) {
      return { live: true, decisive: true };
    }
    if (httpOk && onMbasic && !hasLoginMarker && !loggedInMarker) {
      // Ở mbasic, không login form nhưng thiếu marker feed — nghi soft-block/màn rỗng.
      // KHÔNG decisive: giữ trạng thái cũ, để phiên thật quyết định.
      console.warn(`[FB Scraper] Probe ambiguous: mbasic 200 nhưng không thấy marker logged-in — giữ status cũ.`);
      return { live: true, decisive: false };
    }
    // Không kết luận được (400, timeout, checkpoint...) — giữ nguyên trạng thái cũ
    return { live: true, decisive: false };
  } catch {
    return { live: true, decisive: false };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}
/**
 * v2 — Tự nạp token GraphQL từ trang đang mở: fb_dtsg (DTSGInitData), lsd, viewer id.
 * Cho phép engine replay query followers ngay cả khi trang KHÔNG tự bắn query nào
 * để capture (màn hình chậm, adblock, query đổi tên) — không còn phụ thuộc may rủi.
 */
export async function harvestGraphQLTokens(page: Page, capture: GraphQLFollowerCapture): Promise<void> {
  try {
    const tokens = await page.evaluate(() => {
      const w = window as unknown as Record<string, any>;
      let dtsg: string | null = null;
      try { dtsg = w.require?.('DTSGInitData')?.token || null; } catch {}
      if (!dtsg) {
        const m = (document.documentElement.innerHTML || '').match(/"DTSGInitData"\s*,\s*\[\]\s*,\s*\{\s*"token":"([^"]+)"/);
        dtsg = m ? m[1] : null;
      }
      if (!dtsg) {
        const input = document.querySelector<HTMLInputElement>('input[name="fb_dtsg"]');
        dtsg = input ? input.value : null;
      }
      let lsd: string | null = null;
      try { lsd = w.require?.('LSD')?.token || null; } catch {}
      if (!lsd) {
        const input = document.querySelector<HTMLInputElement>('input[name="lsd"]');
        lsd = input ? input.value : null;
      }
      let viewer: string | null = null;
      try { viewer = w.require?.('CurrentUserInitialData')?.USER_ID || null; } catch {}
      if (!viewer) {
        const m = (document.cookie || '').match(/c_user=(\d+)/);
        viewer = m ? m[1] : null;
      }
      return { dtsg, lsd, viewer };
    });
    if (tokens.dtsg) capture.fbDtsg = tokens.dtsg;
    if (tokens.lsd) capture.lsd = tokens.lsd;
    if (tokens.viewer) capture.viewerId = tokens.viewer;
    console.log(`[Followers Cursor] Tokens: dtsg=${capture.fbDtsg ? 'OK' : 'MISSING'} lsd=${capture.lsd ? 'OK' : 'MISSING'} viewer=${capture.viewerId || 'MISSING'}`);
  } catch {}
}

export function extractFollowerEndCursor(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const data = root['data'] as Record<string, unknown> | undefined;
  if (!data) return null;

  const readConn = (conn: unknown): string | null => {
    if (!conn || typeof conn !== 'object') return null;
    const pageInfo = (conn as Record<string, unknown>)['page_info'] as Record<string, unknown> | undefined;
    if (pageInfo && pageInfo['has_next_page'] === true && typeof pageInfo['end_cursor'] === 'string') {
      return pageInfo['end_cursor'];
    }
    return null;
  };

  const node = data['node'] as Record<string, unknown> | undefined;
  const user = data['user'] as Record<string, unknown> | undefined;
  const group = data['group'] as Record<string, unknown> | undefined;
  const feedback = node?.['feedback'] as Record<string, unknown> | undefined;
  const commentInstance = node?.['comment_rendering_instance'] as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    node?.['subscribers'], node?.['followers'], node?.['page_followers'], node?.['pageItems'],
    user?.['subscribers'], user?.['followers'],
    group?.['members'],
    // B2: comments connection (phân trang bình luận — nguồn leads mạnh trên profile riêng tư)
    feedback?.['comments'], node?.['commentators'], commentInstance?.['comments'],
    data['comments'], data['feedback'] ? (data['feedback'] as Record<string, unknown>)['comments'] : undefined,
  ];
  const collections = node?.['all_collections'] as { nodes?: Array<Record<string, unknown>> } | undefined;
  if (Array.isArray(collections?.nodes)) {
    for (const col of collections.nodes) candidates.push(col?.['pageItems']);
  }

  for (const c of candidates) {
    const cursor = readConn(c);
    if (cursor) return cursor;
  }
  return null;
}

/**
 * Bộ quét chậm (Passive Interceptor): nghe mọi phản hồi GraphQL trong phiên và bóc tách
 * Followers / Subscribers / Members / Reactions / Comments trực tiếp từ JSON (không phụ thuộc DOM).
 * Khi truyền `capture`, interceptor đồng thời lưu template query followers đầu tiên thấy được
 * (whitelist Subscriber/Follower/PageItems — blacklist truy vấn nền cá nhân) + cursor mới nhất.
 */
export function attachFacebookGraphQLInterceptor(
  page: Page,
  saveBatch: (leads: ExtractedLead[]) => void,
  capture?: GraphQLFollowerCapture
): () => void {
  const handler = async (response: any) => {
    try {
      const url: string = response.url();
      if (!url.includes('/graphql') && !url.includes('/api/graphql/')) return;

      // Loại bỏ các truy vấn nền cá nhân của tài khoản đang đăng nhập (không phải dữ liệu mục tiêu)
      const postData: string = response.request()?.postData() || '';
      if (
        postData.includes('CometNotifications') || postData.includes('CometTopContacts') ||
        postData.includes('CometChat') || postData.includes('Presence') ||
        postData.includes('FriendSuggestions') || postData.includes('Friending') ||
        postData.includes('NewsFeed') || postData.includes('HomeFeed') ||
        postData.includes('Bookmarks') || postData.includes('Stories') ||
        postData.includes('Mercury') || postData.includes('Gemini') ||
        postData.includes('LeftRail') || postData.includes('RightRail') ||
        postData.includes('Jewel') || postData.includes('SearchTypeahead') ||
        postData.includes('MWChat') || postData.includes('MWPresence') ||
        postData.includes('CometModernNewsFeed') || postData.includes('CometFeed')
      ) {
        return;
      }

      // === CAPTURE template followers (lần đầu thấy, chỉ khi caller truyền capture) ===
      // Chiến lược 2 tầng: (a) whitelist tên query, (b) response-driven — bất kỳ query nào
      // trả về connection followers/subscribers/page_followers/pageItems CÓ cursor đều được nhận.
      // FB đổi tên query liên tục → hình dạng response là tín hiệu đáng tin hơn tên.
      if (capture && !capture.endpoint && postData) {
        // CỔNG DUY NHẤT theo hình dạng response: chỉ capture query mà response thực sự
        // chứa connection followers/subscribers/page_followers/pageItems. Tên query không
        // đáng tin (FB đổi liên tục + query nền lồng từ 'followers'/'Comments' trong def).
        try {
          const body = await response.text().catch(() => '');
          if (body) {
            const jsons: unknown[] = body.includes('\n{"')
              ? body.split('\n').filter((l: string) => l.trim().startsWith('{')).map((l: string) => JSON.parse(l))
              : [JSON.parse(body)];
            const hasFollowerConnection = jsons.some((j: unknown) =>
              !!(j && typeof j === 'object' && 'data' in j) &&
              !!(function hasConn(d: unknown): boolean {
                if (!d || typeof d !== 'object') return false;
                const node = (d as Record<string, unknown>)['node'];
                const user = (d as Record<string, unknown>)['user'];
                for (const container of [node, user]) {
                  if (container && typeof container === 'object') {
                    const c = container as Record<string, unknown>;
                    if (c['subscribers'] || c['followers'] || c['page_followers'] || c['pageItems'] || c['page_items']) return true;
                  }
                }
                return false;
              })((j as Record<string, unknown>)['data'])
            );
            if (hasFollowerConnection) {
              const method = (response.request()?.method() || 'POST').toUpperCase();
              const parsedVars = new URLSearchParams(postData).get('variables');
              capture.endpoint = url.split('?')[0];
              capture.headers = response.request()?.headers() || null;
              capture.postParams = method === 'POST' ? Object.fromEntries(new URLSearchParams(postData)) : null;
              capture.variables = parsedVars ? JSON.parse(parsedVars) : null;
              capture.queryName = capture.postParams?.['fb_api_req_friendly_name'] || 'UnknownQuery';
              capture.capturedAt = Date.now();
              console.log(`[FB Scraper] 🎯 Captured follower query template (response-shape): ${capture.queryName} (${method})`);
            }
          }
        } catch {}
      }

      const text: string = await response.text().catch(() => '');
      if (!text || (!text.includes('"id"') && !text.includes('profile_picture'))) return;

      const parseChunk = (chunk: string) => {
        try {
          const json = JSON.parse(chunk);
          const leads = parseFacebookGraphQLResponse(json);
          if (leads.length > 0) saveBatch(leads);
          // Cập nhật cursor mới nhất cho engine cursor pagination
          if (capture) {
            const cursor = extractFollowerEndCursor(json);
            if (cursor) capture.cursor = cursor;
          }
        } catch {}
      };

      // NDJSON streaming hoặc JSON đơn
      if (text.includes('\n{"')) {
        text.split('\n').forEach((line: string) => {
          const t = line.trim();
          if (t.startsWith('{')) parseChunk(t);
        });
      } else {
        parseChunk(text);
      }
    } catch {}
  };

  page.on('response', handler);
  return () => {
    try { page.off('response', handler); } catch {}
  };
}

/**
 * Bóc tách người dùng từ JSON GraphQL Facebook (chuẩn connection edges/nodes)
 * Trả về danh sách ExtractedLead (kèm interactionType suy đoán theo vị trí dữ liệu)
 */
export function parseFacebookGraphQLResponse(json: any): ExtractedLead[] {
  const leads: ExtractedLead[] = [];
  if (!json || typeof json !== 'object') return leads;

  const extractFromConnection = (conn: any, interactionType: string) => {
    if (!conn) return;
    const items = conn.edges || conn.nodes || [];
    for (const item of items) {
      const node = item.node || item.user || item;
      if (!node || typeof node !== 'object') continue;
      const id = (node.id || '').toString();
      // Loại trừ entity ID của comment/feedback (không phải người dùng)
      if (id.startsWith('Y29tbWVud') || id.startsWith('feedback:') || id.startsWith('comment:') || id.startsWith('group:')) continue;

      const author = node.author || node.comment_author;
      const target: any = author || node;
      const tId = ((target && target.id) || id || '').toString();

      const name = (target?.name || node.title?.text || node.text || '').trim();
      if (!name || name.startsWith('#') || name.includes('\n')) continue;

      // Loại trừ Fanpage: __typename Page hoặc slug có gạch nối (đặc trưng fanpage kinh doanh)
      const typename = (node.__typename || target?.__typename || '').toString();
      const slugCandidate = (target?.url || node.url || node.profile_url || '').split('?')[0].split('/').filter(Boolean).pop() || '';
      if (typename === 'Page' || slugCandidate.includes('-')) continue;

      const profileUrl = target?.url || node.url || node.profile_url || (tId ? `https://www.facebook.com/${tId}` : '');
      if (!profileUrl) continue;

      const uid = /^\d{6,20}$/.test(tId) ? tId
        : extractUidFromFacebookLink(profileUrl);
      if (!uid || uid.length < 3) continue;

      leads.push({
        uid,
        displayName: name,
        avatarUrl: target?.profile_picture?.uri || node.profile_picture?.uri || node.profile_picture_depth_0?.uri || node.profile_picture_50?.uri || undefined,
        profileUrl,
        interactionType
      });
    }
  };

  // Các cấu trúc trực tiếp của mục tiêu
  extractFromConnection(json?.data?.node?.subscribers, 'follower');
  extractFromConnection(json?.data?.node?.followers, 'follower');
  extractFromConnection(json?.data?.node?.page_followers, 'follower');
  extractFromConnection(json?.data?.node?.page_items, 'follower');
  extractFromConnection(json?.data?.user?.subscribers, 'follower');
  extractFromConnection(json?.data?.user?.followers, 'follower');
  extractFromConnection(json?.data?.node?.all_members, 'group_member');
  extractFromConnection(json?.data?.node?.group_members, 'group_member');
  extractFromConnection(json?.data?.group?.all_members, 'group_member');
  extractFromConnection(json?.data?.node?.reactors, 'reaction_like');
  extractFromConnection(json?.data?.feedback?.reactors, 'reaction_like');
  extractFromConnection(json?.data?.node?.top_reactors, 'reaction_like');
  extractFromConnection(json?.data?.node?.commentators, 'comment');
  extractFromConnection(json?.data?.feedback?.comments, 'comment');
  extractFromConnection(json?.data?.node?.comment_rendering_instance?.comments, 'comment');

  // Comet nested collections (ProfileCometAppCollectionListRenderer)
  const collections = json?.data?.node?.all_collections?.nodes || [];
  for (const col of collections) {
    extractFromConnection(col?.pageItems, 'follower');
  }
  extractFromConnection(json?.data?.node?.pageItems, 'follower');

  // Fallback quét đệ quy nếu không tìm thấy cấu trúc chuẩn (loại trừ namespace viewer cá nhân)
  if (leads.length === 0) {
    const skipBranches = new Set([
      'viewer', 'current_user', 'me', 'viewer_actor', 'left_rail_collections',
      'bookmarks', 'notifications', 'chat_roster', 'friend_suggestions', 'friending',
      'feed', 'news_feed', 'top_contacts', 'buddylist', 'presence', 'viewer_friends',
      'messenger', 'right_rail', 'chat', 'stories', 'feed_units', 'allactivity'
    ]);

    const findEdgesRecursive = (obj: any, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 5) return;
      if (Array.isArray(obj.edges) && obj.edges.length > 0) {
        extractFromConnection(obj, 'follower');
      }
      if (Array.isArray(obj.nodes) && obj.nodes.length > 0) {
        extractFromConnection(obj, 'follower');
      }
      for (const key of Object.keys(obj)) {
        if (skipBranches.has(key.toLowerCase())) continue;
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          findEdgesRecursive(obj[key], depth + 1);
        }
      }
    };
    findEdgesRecursive(json);
  }

  return leads;
}

/**
 * Parse HTML từ trang reaction browser của mbasic.facebook.com
 */
export function parseMbasicReactionPage(html: string): {
  leads: Array<{ uid: string; displayName: string }>;
  nextPageUrl: string | null;
} {
  const leads: Array<{ uid: string; displayName: string }> = [];
  let nextPageUrl: string | null = null;
  if (!html) return { leads, nextPageUrl };

  const skipKeywords = [
    'ufi', 'reaction', 'reactions', 'groups', 'messages', 'notifications', 'friends', 'marketplace', 'watch',
    'events', 'saved', 'pages', 'ads', 'policies', 'help', 'login', 'recover', 'settings',
    'privacy', 'terms', 'photo.php', 'video.php', 'story.php', 'home.php', 'menu', 'bug', 'r.php',
    'hashtag', 'hashtags', 'places', 'location', 'allactivity', 'browse', 'search', 'sharer.php', 'mbasic',
    'profile_picture', 'comment', 'share', 'permalink', 'about', 'feed'
  ];

  const skipTextKeywords = [
    'xem thêm', 'see more', 'tất cả', 'thích', 'yêu thích', 'haha', 'wow', 'buồn', 'phẫn nộ', 'thương thương',
    'like', 'love', 'care', 'sad', 'angry', 'bình luận', 'chia sẻ', 'báo cáo', 'quay lại', 'trang chủ', 'menu',
    'đăng nhập', 'tin nhắn', 'thông báo', 'bạn bè', 'cài đặt', 'xem trước', 'tìm kiếm'
  ];

  // 1. Tìm link phân trang ("Xem thêm" / "See More")
  const paginationMatches = Array.from(html.matchAll(/<a\s+[^>]*href="([^"]*\/ufi\/reaction\/profile\/browser\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
  for (const match of paginationMatches) {
    const rawHref = match[1];
    const linkText = match[2]?.replace(/<[^>]+>/g, '').trim().toLowerCase() || '';
    if (rawHref && (rawHref.includes('after=') || rawHref.includes('cursor=') || linkText.includes('xem thêm') || linkText.includes('see more') || linkText.includes('tiếp'))) {
      let cleanHref = rawHref.replace(/&amp;/g, '&');
      nextPageUrl = cleanHref.startsWith('http') ? cleanHref : `https://mbasic.facebook.com${cleanHref.startsWith('/') ? '' : '/'}${cleanHref}`;
      break;
    }
  }

  // 2. Bóc tách profile anchor (dùng chung với parser trang comment)
  leads.push(...parseMbasicUserAnchors(html));

  return { leads, nextPageUrl };
}

/**
 * P2 — Bóc tách profile anchor từ HTML mbasic bất kỳ (reaction browser, comment
 * page, story page). Tách riêng để trang comment tái dùng đúng ngữ nghĩa lọc
 * (loại link hệ thống/bài viết, giữ link người thật) đã kiểm chứng ở reaction.
 */
function parseMbasicUserAnchors(html: string): Array<{ uid: string; displayName: string }> {
  const leads: Array<{ uid: string; displayName: string }> = [];
  if (!html) return leads;

  const skipKeywords = [
    'ufi', 'reaction', 'reactions', 'groups', 'messages', 'notifications', 'friends', 'marketplace', 'watch',
    'events', 'saved', 'pages', 'ads', 'policies', 'help', 'login', 'recover', 'settings',
    'privacy', 'terms', 'photo.php', 'video.php', 'story.php', 'home.php', 'menu', 'bug', 'r.php',
    'hashtag', 'hashtags', 'places', 'location', 'allactivity', 'browse', 'search', 'sharer.php', 'mbasic',
    'profile_picture', 'comment', 'share', 'permalink', 'about', 'feed'
  ];

  const skipTextKeywords = [
    'xem thêm', 'see more', 'tất cả', 'thích', 'yêu thích', 'haha', 'wow', 'buồn', 'phẫn nộ', 'thương thương',
    'like', 'love', 'care', 'sad', 'angry', 'bình luận', 'chia sẻ', 'báo cáo', 'quay lại', 'trang chủ', 'menu',
    'đăng nhập', 'tin nhắn', 'thông báo', 'bạn bè', 'cài đặt', 'xem trước', 'tìm kiếm', 'trả lời', 'reply'
  ];

  const anchorMatches = Array.from(html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
  for (const match of anchorMatches) {
    const href = match[1]?.replace(/&amp;/g, '&') || '';
    const text = match[2]?.replace(/<[^>]+>/g, '').trim() || '';

    if (!href || href.startsWith('#') || !text || text.length < 2 || text.length > 50 || text.includes('\n')) continue;
    if (text.startsWith('#')) continue;
    if (skipTextKeywords.some(kw => text.toLowerCase() === kw || text.toLowerCase().startsWith(kw + ' '))) continue;

    if (
      href.includes('/ufi/reaction/') ||
      href.includes('/allactivity/') ||
      href.includes('/hashtag/') ||
      href.includes('/pages/') ||
      href.includes('/places/') ||
      href.includes('/photo.php') ||
      href.includes('/story.php') ||
      href.includes('/share')
    ) continue;

    let uid = '';
    if (href.includes('profile.php?id=')) {
      const idMatch = href.match(/profile\.php\?id=(\d+)/);
      if (idMatch) uid = idMatch[1];
    } else if (href.includes('/people/')) {
      const peopleMatch = href.match(/\/people\/[^\/]+\/(\d+)/);
      if (peopleMatch) uid = peopleMatch[1];
    } else if (href.includes('/user/')) {
      const userMatch = href.match(/\/user\/(\d{6,20})/);
      if (userMatch) uid = userMatch[1];
    } else {
      const cleanPath = href.split('?')[0].split('#')[0].replace(/^(https?:\/\/)?(mbasic\.|www\.|m\.)?facebook\.com/, '').replace(/^\/|\/$/g, '');
      if (cleanPath && !cleanPath.includes('/') && /^[a-zA-Z0-9._]{3,50}$/.test(cleanPath) && !cleanPath.startsWith('hashtag')) {
        const lower = cleanPath.toLowerCase();
        if (!skipKeywords.includes(lower)) {
          uid = cleanPath;
        }
      }
    }

    if (uid && !skipKeywords.includes(uid.toLowerCase()) && !/^\d{1,4}$/.test(uid)) {
      leads.push({ uid, displayName: text });
    }
  }

  return leads;
}

/**
 * P2 — Parse trang comment mbasic (story.php) — bóc người bình luận + link phân
 * trang. Trang comment dùng chung cấu trúc anchor người dùng với reaction browser.
 */
export function parseMbasicCommentPage(html: string): {
  leads: Array<{ uid: string; displayName: string }>;
  nextPageUrl: string | null;
} {
  const leads = parseMbasicUserAnchors(html);
  let nextPageUrl: string | null = null;
  if (!html) return { leads, nextPageUrl };

  // Link phân trang comment: story.php kèm cursor/after hoặc nhãn "xem thêm bình luận"
  const anchorMatches = Array.from(html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
  for (const m of anchorMatches) {
    const rawHref = m[1]?.replace(/&amp;/g, '&') || '';
    const linkText = (m[2] || '').replace(/<[^>]+>/g, '').trim().toLowerCase();
    const isCommentPaging = /story\.php\?[^"]*(cursor|after|comment_id|pagination)=/i.test(rawHref) &&
      !rawHref.includes('/ufi/reaction/');
    const isMoreText = linkText.includes('xem thêm bình luận') || linkText.includes('xem các bình luận trước') ||
      linkText.includes('xem bình luận trước') || linkText.includes('see more comments') || linkText.includes('view more comments');
    if (isCommentPaging || isMoreText) {
      nextPageUrl = rawHref.startsWith('http') ? rawHref : `https://mbasic.facebook.com${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;
      break;
    }
  }

  return { leads, nextPageUrl };
}

/**
 * Thu hoạch reaction của 1 bài viết qua mbasic.facebook.com (8 loại cảm xúc × 30 trang)
 * Nguồn dữ liệu vượt soft-cap DOM: mỗi request trả ~100 profile thuần
 */
async function scrapeMbasicReactionsForPost(
  page: Page,
  postId: string,
  viewerAccountId: string,
  maxLeads: number,
  saveBatch: (leads: ExtractedLead[]) => number,
  requestBudget: { remaining: number; onSpend?: () => void } | null = null
): Promise<number> {
  let addedCount = 0;
  let requestCount = 0;

  // Reaction types: 0 (All), 1 (Like), 2 (Love), 3 (Care), 4 (Haha), 7 (Wow), 8 (Sad), 11 (Angry)
  const reactionTypes = [0, 1, 2, 3, 4, 7, 8, 11];

  for (const rxType of reactionTypes) {
    if (addedCount >= maxLeads || page.isClosed()) break;
    // Với rx_type=0 (All) đã lấy toàn bộ; chỉ quay lại từng loại nếu còn thiếu và loại đó bị ẩn trong All
    if (rxType !== 0 && addedCount >= maxLeads * 0.5) break;

    let currentUrl: string | null = `https://mbasic.facebook.com/ufi/reaction/profile/browser/?ft_ent_identifier=${postId}&av=${viewerAccountId}&reaction_type=${rxType}&limit=100`;
    let pageNum = 1;
    let stagnantPages = 0;

    while (currentUrl && addedCount < maxLeads && pageNum <= 60 && stagnantPages < 3) {
      if (page.isClosed()) break;
      if (requestBudget && requestBudget.remaining <= 0) return addedCount;
      requestCount++;
      spendBudget(requestBudget);

      try {
        const sizeBefore = addedCount;
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        const html = await page.content().catch(() => '');

        if (!html || html.includes('checkpoint') || html.includes('login_form')) {
          console.warn(`[Mbasic Harvester] Checkpoint / yêu cầu đăng nhập ở trang ${pageNum} bài ${postId}`);
          break;
        }

        const parsed = parseMbasicReactionPage(html);
        const batch: ExtractedLead[] = parsed.leads.map(item => ({
          uid: item.uid,
          displayName: item.displayName,
          profileUrl: `https://www.facebook.com/${item.uid}`,
          interactionType: 'reaction_like'
        }));

        // Chỉ đếm lead insert MỚI — dedup thực hiện ở saveBatch (dedup tại trung tâm)
        addedCount += saveBatch(batch);

        // P2 — bóc SĐT trong text trang reaction (bài viết/nội dung kèm) — lead zalo
        addedCount += harvestPhonesFromHtml(html, saveBatch);

        if (addedCount === sizeBefore) {
          stagnantPages++;
        } else {
          stagnantPages = 0;
        }

        currentUrl = parsed.nextPageUrl;
        pageNum++;

        // Nhịp request người-dùng: 1.2-2.2s/trang (nâng từ 350-500ms — 18 goto
        // liên tục <0.5s là signature automation FB quét được). Nghỉ sâu 8-15s
        // mỗi 15 trang như người đọc danh sách reaction thật.
        await page.waitForTimeout(1200 + Math.floor(Math.random() * 1000));
        if (requestCount % 15 === 0) {
          await page.waitForTimeout(8000 + Math.floor(Math.random() * 7000));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Mbasic Harvester] Lỗi bài ${postId} trang ${pageNum}:`, msg);
        break;
      }
    }
  }

  return addedCount;
}

/**
 * P2 — Thu hoạch NGƯỜI BÌNH LUẬN của 1 bài viết qua mbasic story.php.
 * Bổ sung cho reaction harvester: reactors và commenters là 2 tập người khác nhau,
 * hợp lại tăng đáng kể unique leads/bài. Bóc kèm SĐT trong text bình luận.
 */
async function scrapeMbasicCommentersForPost(
  page: Page,
  postId: string,
  maxLeads: number,
  saveBatch: (leads: ExtractedLead[]) => number,
  requestBudget: { remaining: number; onSpend?: () => void } | null = null
): Promise<number> {
  let addedCount = 0;
  let stagnantPages = 0;

  let currentUrl: string | null = `https://mbasic.facebook.com/story.php?story_fbid=${postId}`;
  let pageNum = 1;

  while (currentUrl && addedCount < maxLeads && pageNum <= 40 && stagnantPages < 3) {
    if (page.isClosed()) break;
    if (requestBudget && requestBudget.remaining <= 0) break;
    spendBudget(requestBudget);

    try {
      const sizeBefore = addedCount;
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      const html = await page.content().catch(() => '');

      if (!html || html.includes('checkpoint') || html.includes('login_form')) {
        console.warn(`[Mbasic Comment] Checkpoint / yêu cầu đăng nhập ở trang ${pageNum} bài ${postId}`);
        break;
      }

      const parsed = parseMbasicCommentPage(html);
      const batch: ExtractedLead[] = parsed.leads.map(item => ({
        uid: item.uid,
        displayName: item.displayName,
        profileUrl: `https://www.facebook.com/${item.uid}`,
        interactionType: 'comment'
      }));

      addedCount += saveBatch(batch);
      addedCount += harvestPhonesFromHtml(html, saveBatch);

      if (addedCount === sizeBefore) stagnantPages++;
      else stagnantPages = 0;

      currentUrl = parsed.nextPageUrl;
      pageNum++;

      await page.waitForTimeout(1300 + Math.floor(Math.random() * 1200));
      if (pageNum % 10 === 0) {
        await page.waitForTimeout(6000 + Math.floor(Math.random() * 6000));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Mbasic Comment] Lỗi bài ${postId} trang ${pageNum}:`, msg);
      break;
    }
  }

  return addedCount;
}

/**
 * P1 — Khám phá Post ID từ timeline mbasic (bước 1 của engager sharding).
 * Pool session chia nhau danh sách post này để thu reaction — mỗi account xử lý
 * các bài khác nhau qua atomic pop, không quét lại timeline.
 */
async function discoverMbasicPostIds(
  page: Page,
  targetUrlOrSlug: string,
  maxPosts: number,
  saveBatch: (leads: ExtractedLead[]) => number,
  requestBudget: { remaining: number; onSpend?: () => void } | null = null
): Promise<string[]> {
  console.log(`[Mbasic Engager] 🚀 Khám phá timeline ${targetUrlOrSlug} (tối đa ${maxPosts} bài)...`);

  const cleanSlug = targetUrlOrSlug.replace(/^(https?:\/\/)?(mbasic\.|www\.|m\.)?facebook\.com\//, '').split('?')[0].replace(/^\/|\/$/g, '');
  let timelineUrl: string | null = `https://mbasic.facebook.com/${cleanSlug}`;
  const discoveredPostIds = new Set<string>();
  let timelinePageNum = 1;

  while (timelineUrl && discoveredPostIds.size < maxPosts && timelinePageNum <= 60) {
    if (page.isClosed()) break;
    if (requestBudget && requestBudget.remaining <= 0) break;
    try {
      spendBudget(requestBudget);
      await page.goto(timelineUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      const html = await page.content().catch(() => '');

      if (!html || html.includes('checkpoint') || html.includes('login_form')) {
        console.warn(`[Mbasic Engager] Checkpoint / yêu cầu đăng nhập tại trang timeline ${timelinePageNum}`);
        break;
      }

      for (const m of Array.from(html.matchAll(/ft_ent_identifier=(\d{8,25})/gi))) {
        if (m[1]) discoveredPostIds.add(m[1]);
      }
      for (const m of Array.from(html.matchAll(/story\.php\?[^"]*story_fbid=(\d{8,25})/gi))) {
        if (m[1]) discoveredPostIds.add(m[1]);
      }

      // P2 — bài viết trên timeline thường chứa SĐT trong nội dung → lead zalo
      harvestPhonesFromHtml(html, saveBatch);

      // Link phân trang timeline: sưu tầm MỌI anchor chứa cursor phân trang
      let nextTimelineUrl: string | null = null;
      const pageAnchors = Array.from(html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
      for (const m of pageAnchors) {
        const rawHref = m[1];
        const linkText = (m[2] || '').replace(/<[^>]+>/g, '').trim().toLowerCase();
        const isCursorLink = /[?&](cursor|start|sectionLoadingID|unit_cursor|cursor_b|after|bqst)=/i.test(rawHref);
        const isMoreText = linkText.includes('xem thêm') || linkText.includes('see more') || linkText.includes('bài trước');
        if ((isCursorLink || isMoreText) && !rawHref.includes('/messages/') && !rawHref.includes('/notifications')) {
          const cleanHref = rawHref.replace(/&amp;/g, '&');
          nextTimelineUrl = cleanHref.startsWith('http') ? cleanHref : `https://mbasic.facebook.com${cleanHref.startsWith('/') ? '' : '/'}${cleanHref}`;
          break;
        }
      }
      if (nextTimelineUrl) {
        timelineUrl = nextTimelineUrl;
        timelinePageNum++;
        await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));
      } else {
        timelineUrl = null;
      }
    } catch (e: unknown) {
      console.warn(`[Mbasic Engager] Lỗi quét timeline:`, e instanceof Error ? e.message : String(e));
      break;
    }
  }

  console.log(`[Mbasic Engager] Phát hiện ${discoveredPostIds.size} bài viết để chia pool.`);
  return Array.from(discoveredPostIds);
}

/**
 * Tiêu 1 request trong ngân sách phiên: giảm `remaining` VÀ báo `onSpend` để
 * telemetry + daily_request_count ghi nhận. Các engine mbasic trước đây chỉ
 * giảm `remaining` nên telemetry luôn báo 0 request và quota ngày bị bỏ sót.
 */
function spendBudget(
  budget: { remaining: number; onSpend?: () => void } | null,
  n = 1
): void {
  if (!budget) return;
  budget.remaining -= n;
  if (budget.onSpend) {
    for (let i = 0; i < n; i++) budget.onSpend();
  }
}

/**
 * Cào thành viên nhóm qua mbasic.facebook.com (miễn nhiễm GraphQL throttle & React Virtual DOM).
 * P2 — nhận `startUrl` để RESUME phân trang từ chain trước (account khác tiếp tục
 * đúng trang thay vì quét lại từ đầu — tránh đốt request vào member đã thu).
 */
export type GroupStopReason =
  | 'exhausted'   // đi hết phân trang
  | 'empty'       // nhiều trang liền không thấy thành viên nào
  | 'blocked'     // FB trả login/checkpoint wall
  | 'not_member'  // account không thuộc nhóm → FB chỉ hiện nút tham gia
  | 'quota'       // chạm trần lead phiên (còn trang, chạy tiếp được)
  | 'budget'      // hết ngân sách request (còn trang, chạy tiếp được)
  | 'error'       // lỗi phiên/trang đóng
  | 'cancelled';

export interface GroupHarvestResult {
  added: number;
  /** URL chạy tiếp — CHỈ có khi thực sự còn việc (phân trang thật / hết ngân sách) */
  nextUrl: string | null;
  stopReason: GroupStopReason;
  /** dấu hiệu nhận dạng trang để chẩn đoán từ xa (login_form, join, cp…) */
  markers: string[];
}

/**
 * Nhận dạng "tường" FB trả về thay vì danh sách thành viên. Trước đây harvester
 * coi mọi lần dừng sớm là "còn trang kế" → job #48 lưu cursor vào URL bị chặn,
 * kênh group không bao giờ đóng và account bị checkpoint vì đập lại nhiều lần.
 */
function detectGroupPageWall(html: string): { blocked: boolean; notMember: boolean; markers: string[] } {
  const lower = html.toLowerCase();
  const markers: string[] = [];
  const blocked = lower.includes('login_form') || lower.includes('checkpoint') ||
    lower.includes('temporarily blocked') || lower.includes('disabled');
  if (lower.includes('login_form')) markers.push('login_form');
  if (lower.includes('checkpoint')) markers.push('checkpoint');
  const joinSignals = [
    'tham gia nhóm', 'join group', 'join this group', 'bạn cần là thành viên',
    'you must be a member', 'phải là thành viên', 'request to join', 'yêu cầu tham gia',
  ].filter(k => lower.includes(k));
  if (joinSignals.length > 0) markers.push('join:' + joinSignals[0]);
  return { blocked, notMember: joinSignals.length > 0, markers };
}

export async function scrapeGroupMembersViaMbasic(
  page: Page,
  targetGroup: string,
  maxLeads: number,
  saveBatch: (leads: ExtractedLead[]) => number,
  requestBudget: { remaining: number; onSpend?: () => void } | null = null,
  startUrl?: string | null,
  cancelSignal?: { cancelled: boolean }
): Promise<GroupHarvestResult> {
  console.log(`[Mbasic Group Harvester] 🚀 Khởi động bộ cào mbasic cho ${targetGroup}${startUrl ? ' (resume từ trang đã lưu)' : ''}...`);

  const targetClean = targetGroup.trim().replace(/\/$/, '');
  let targetId = '';
  if (targetClean.includes('profile.php?id=')) {
    try {
      const u = new URL(targetClean);
      targetId = u.searchParams.get('id') || '';
    } catch {}
  } else {
    const parts = targetClean.split('?')[0].split('/').filter(Boolean);
    targetId = parts[parts.length - 1] || '';
    if (targetId === 'members' && parts.length >= 2) {
      targetId = parts[parts.length - 2];
    }
  }

  let currentUrl: string | null = startUrl || (targetId
    ? `https://mbasic.facebook.com/groups/${targetId}/members/`
    : targetClean.replace(/^(https?:\/\/)?(www\.|m\.)?facebook\.com\//, 'https://mbasic.facebook.com/').replace(/\/$/, '') + '/members/');

  let pageNum = 1;
  let addedCount = 0;
  let consecutiveEmptyPages = 0;
  // Lý do dừng tường minh — KHÔNG suy diễn từ currentUrl (bug job #48)
  let stopReason: GroupStopReason | null = null;
  const markers: string[] = [];

  const skipKeywords = [
    'groups', 'messages', 'notifications', 'friends', 'marketplace', 'watch',
    'events', 'saved', 'pages', 'ads', 'policies', 'help', 'login', 'recover', 'settings',
    'privacy', 'terms', 'photo.php', 'video.php', 'story.php', 'home.php', 'menu', 'bug', 'r.php',
    'hashtag', 'hashtags', 'places', 'location', 'allactivity', 'browse', 'search', 'sharer.php', 'mbasic',
    'profile_picture', 'comment', 'share', 'permalink', 'about', 'feed'
  ];

  const skipTextKeywords = [
    'xem thêm', 'see more', 'tất cả', 'thành viên', 'members', 'báo cáo', 'rời khỏi nhóm',
    'thêm thành viên', 'mời', 'quản trị viên', 'người kiểm duyệt', 'bạn bè', 'trang chủ', 'menu',
    'đăng nhập', 'tin nhắn', 'thông báo', 'cài đặt', 'xem trước', 'tìm kiếm'
  ];

  while (currentUrl && addedCount < maxLeads && pageNum <= 500 && consecutiveEmptyPages < 5 && !stopReason) {
    if (page.isClosed()) { stopReason = 'error'; break; }
    if (requestBudget && requestBudget.remaining <= 0) { stopReason = 'budget'; break; }
    if (cancelSignal?.cancelled) { stopReason = 'cancelled'; break; }
    try {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));
      spendBudget(requestBudget);
      // Nghỉ sâu mỗi 10 trang — phân trang mbasic liên tục là tín hiệu automation
      if (pageNum % 10 === 0) {
        await page.waitForTimeout(8000 + Math.floor(Math.random() * 6000));
      }

      const html = await page.content().catch(() => '');
      if (!html) {
        stopReason = 'error';
        break;
      }
      const wall = detectGroupPageWall(html);
      markers.push(...wall.markers);
      if (wall.blocked) {
        console.warn(`[Mbasic Group Harvester] ⛔ FB trả tường chặn (${wall.markers.join(',') || 'cp/login'}) tại trang ${pageNum} — dừng, KHÔNG lưu cursor.`);
        stopReason = 'blocked';
        break;
      }

      const sizeBefore = addedCount;
      const batch: ExtractedLead[] = [];

      // 1. Bóc tách profile thành viên trên trang
      const anchorMatches = Array.from(html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
      for (const match of anchorMatches) {
        const href = match[1]?.replace(/&amp;/g, '&') || '';
        const text = match[2]?.replace(/<[^>]+>/g, '').trim() || '';

        if (!href || href.startsWith('#') || !text || text.length < 2 || text.length > 60 || text.includes('\n')) continue;
        if (text.startsWith('#')) continue;
        if (skipTextKeywords.some(kw => text.toLowerCase() === kw || text.toLowerCase().startsWith(kw + ' '))) continue;

        let uid = '';
        if (href.includes('profile.php?id=')) {
          const idMatch = href.match(/profile\.php\?id=(\d+)/);
          if (idMatch) uid = idMatch[1];
        } else if (href.includes('/people/')) {
          const peopleMatch = href.match(/\/people\/[^\/]+\/(\d+)/);
          if (peopleMatch) uid = peopleMatch[1];
        } else if (href.includes('/user/')) {
          const userMatch = href.match(/\/user\/([^\/?#]+)/);
          if (userMatch) uid = userMatch[1];
        } else {
          const cleanPath = href.split('?')[0].split('#')[0].replace(/^(https?:\/\/)?(mbasic\.|www\.|m\.)?facebook\.com/, '').replace(/^\/|\/$/g, '');
          if (cleanPath && !cleanPath.includes('/') && /^[a-zA-Z0-9._]{3,50}$/.test(cleanPath) && !cleanPath.startsWith('hashtag')) {
            const lower = cleanPath.toLowerCase();
            if (!skipKeywords.includes(lower)) {
              uid = cleanPath;
            }
          }
        }

        if (uid && !skipKeywords.includes(uid.toLowerCase()) && !/^\d{1,4}$/.test(uid)) {
          batch.push({
            uid,
            displayName: text,
            profileUrl: `https://www.facebook.com/${uid}`,
            interactionType: 'group_member'
          });
        }
      }

      // Đếm theo số lead insert MỚI (dedup ở saveBatch) — anchor lặp giữa các trang không đốt quota
      const savedNow = saveBatch(batch);
      addedCount += savedNow;
      // P2 — SĐT trong bài đăng/bio hiển thị trên trang thành viên
      addedCount += harvestPhonesFromHtml(html, saveBatch);

      // Trang đầu không có ai + có tín hiệu "tham gia nhóm" → account chưa vào nhóm.
      // FB hiển thị nút join thay vì danh sách → không phải lỗi tạm thời.
      if (pageNum === 1 && batch.length === 0 && wall.notMember) {
        console.warn(`[Mbasic Group Harvester] ⛔ Account chưa tham gia nhóm (${wall.markers.join(',')}) — dừng.`);
        stopReason = 'not_member';
        break;
      }

      const newFound = addedCount - sizeBefore;
      console.log(`[Mbasic Group Harvester] Trang ${pageNum}: +${newFound} leads (Tổng: ${addedCount}/${maxLeads})...`);

      if (newFound === 0) {
        consecutiveEmptyPages++;
      } else {
        consecutiveEmptyPages = 0;
      }

      // 2. Tìm link phân trang ("Xem thêm thành viên")
      let nextLink: string | null = null;
      const paginationMatches = Array.from(html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
      for (const match of paginationMatches) {
        const rawHref = match[1];
        const linkText = match[2]?.replace(/<[^>]+>/g, '').trim().toLowerCase() || '';
        if (
          (rawHref.includes('start=') || rawHref.includes('cursor=') || rawHref.includes('after=')) ||
          (linkText.includes('xem thêm thành viên') || linkText.includes('see more members') || linkText.includes('xem thêm') || linkText.includes('see more') || linkText.includes('tiếp'))
        ) {
          if (!rawHref.includes('/messages/') && !rawHref.includes('/settings/') && !rawHref.includes('/notifications')) {
            const cleanHref = rawHref.replace(/&amp;/g, '&');
            nextLink = cleanHref.startsWith('http') ? cleanHref : `https://mbasic.facebook.com${cleanHref.startsWith('/') ? '' : '/'}${cleanHref}`;
            break;
          }
        }
      }

      currentUrl = nextLink;
      pageNum++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Mbasic Group Harvester] Lỗi trang ${pageNum}:`, msg);
      break;
    }
  }

  // ── Chốt lý do dừng khi vòng lặp tự thoát (không qua nhánh break) ──
  if (!stopReason) {
    if (addedCount >= maxLeads) stopReason = 'quota';
    else if (consecutiveEmptyPages >= 5) stopReason = 'empty';
    else if (pageNum > 500) stopReason = 'quota';
    // Đi hết phân trang mà KHÔNG thu được ai → 'empty' (nhóm ẩn/rỗng), không phải
    // 'exhausted' (đã cào xong) — khác biệt này quyết định thông báo cho người dùng.
    else if (!currentUrl && addedCount === 0) stopReason = 'empty';
    else if (!currentUrl) stopReason = 'exhausted';
    else stopReason = 'error';
  }

  // Chỉ trả URL chạy tiếp khi THỰC SỰ còn việc: phân trang thật, hoặc dừng vì
  // hạn mức (quota/budget) giữa danh sách. Mọi nhánh chặn/lỗi → null.
  const resumable = stopReason === 'quota' || stopReason === 'budget';
  const nextUrl = resumable ? currentUrl : null;

  console.log(`[Mbasic Group Harvester] Hoàn tất: +${addedCount} leads, dừng vì ${stopReason}${nextUrl ? ' (còn trang kế)' : ''}.`);
  return { added: addedCount, nextUrl, stopReason, markers: Array.from(new Set(markers)) };
}
/**
 * Trích xuất Post ID số trực tiếp từ URL mẫu fbid, story_fbid, /posts/ID, /reel/ID...
 */
function extractPostIdFromUrl(url: string): string | null {
  try {
    if (!url) return null;
    const cleanUrl = url.trim();
    const u = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://www.facebook.com/${cleanUrl}`);

    const fbid = u.searchParams.get('fbid') || u.searchParams.get('story_fbid') || u.searchParams.get('ft_ent_identifier');
    if (fbid && /^\d+$/.test(fbid)) return fbid;

    const postMatch = cleanUrl.match(/\/(?:posts|permalink|photos|videos|reel|stories)\/(\d{8,25})/);
    if (postMatch) return postMatch[1];

    const entMatch = cleanUrl.match(/ft_ent_identifier=(\d{8,25})/);
    if (entMatch) return entMatch[1];

    return null;
  } catch {
    return null;
  }
}
/**
 * Extract "Tất cả người theo dõi" count từ trang profile/fanpage (dùng làm thước đo độ phủ).
 */
export function extractFollowerCountFromText(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  // Số + suffix rút gọn tùy chọn (12.400 / 2,3K / 1,2Tr / 1K) ngay trước "người theo dõi/followers"
  const re = /([\d.,]+)\s*(k|tr|m)?\s*(?:người theo dõi|followers?)/;
  const m = lower.match(re);
  if (!m || !m[1]) return null;
  const short = m[2];
  if (short) {
    const val = parseFloat(m[1].replace(',', '.'));
    if (isNaN(val)) return null;
    if (short === 'k') return Math.round(val * 1000);
    return Math.round(val * 1000000); // 'tr' | 'm'
  }
  const clean = m[1].replace(/\./g, '').replace(/,/g, '').replace(/\s/g, '');
  const num = parseInt(clean, 10);
  return isNaN(num) || num <= 0 ? null : num;
}
/**
 * PHASE 1 — Follower GraphQL Cursor Engine (signature):
 * Phân trang connection subscribers/followers bằng fetch in-page với template đã capture.
 */
export async function harvestFollowersByCursor(
  page: Page,
  capture: GraphQLFollowerCapture,
  initialCursor: string | null,
  saveBatch: (leads: ExtractedLead[]) => number,
  maxLeads: number,
  cancelSignal: { cancelled: boolean },
  requestBudget: { remaining: number; onSpend?: () => void },
  onProgress?: (newLeads: number, cursor: string | null) => void,
  /** P5 — pacing khởi điểm đo từ telemetry account này (mặc định 3200ms) */
  initialPacingMs?: number
): Promise<{ newLeads: number; nextCursor: string | null; ended: string; http500: number; first500AtRequest: number }> {
  // v2: nếu template capture chưa đủ (thiếu postParams — GET capture), tự nạp token
  // từ trang để build body hoàn chỉnh; đủ thì vẫn nạp để refresh dtsg mới nhất.
  await harvestGraphQLTokens(page, capture);
  if (!capture.postParams && capture.variables) {
    // Build postParams tối thiểu từ variables + token: dạng chuẩn /api/graphql/
    capture.postParams = {
      av: capture.viewerId || '0',
      __user: capture.viewerId || '0',
      __a: '1',
      __req: 'k',
      dpr: '1',
      __ccg: 'UNKNOWN',
      __rev: '1010000000',
      __comet_req: '1',
      lsd: capture.lsd || '',
      jazoest: '2957',
      __spin_r: '1008000000',
      __spin_b: 'trunk',
      __spin_t: String(Math.floor(Date.now() / 1000)),
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: capture.queryName || 'FollowerQuery',
      variables: '{}',
      server_timestamps: 'true',
      doc_id: '',
      fb_dtsg: capture.fbDtsg || '',
    };
    // Gỡ các param undefined/rỗng — FB từ chối body lộn xộn
    for (const k of Object.keys(capture.postParams)) {
      if (capture.postParams[k] === undefined) delete capture.postParams[k];
    }
  }

  let currentCursor = initialCursor;
  let newLeads = 0;
  let emptyStreak = 0;           // trang rỗng còn cursor (soft-throttle signal)
  let http500Count = 0;          // CD5: đếm 500/phiên — telemetry cảnh báo pacing vượt ngưỡng
  let first500AtRequest = 0;     // P5: request thứ mấy thì dính 500 đầu tiên (0 = không)
  let consecutiveSlow = 0;       // latency tăng liên tục (throttle sớm)
  let lastLatencyMs = 0;
  // CD2: cơ sở 3.2s — floor 3s (FB 500 với pacing <2.5s).
  // P5 — telemetry account có thể siết lên (500 nhiều) nhưng không bao giờ dưới sàn.
  let pacingMs = Math.max(3000, Math.min(8000, initialPacingMs || 3200));
  let requestCount = 0;
  // TẦNG 2 — Hằng số đo thực: FB trả HTTP 500 ở khoảng request thứ 18 vì chuỗi phân
  // trang cạn (đo bg_1: req 0-17 OK, req 18 = 500). Cố chạm 18 để "lấy thêm 1 trang"
  // chính là lúc kích hoạt tín hiệu chặn — sau đó IP+session bị gắn cờ.
  // Chủ động dừng ở 15 (biên an toàn 3 request), giữ cursor, nhường IP.
  const chainSlotLimit = 15;
  let hitsChainLimit = false;
  // FB dùng key cursor không thống nhất giữa các query: 'cursor' phổ biến,
  // một số query dùng 'after' / 'afterCursor'. Thử tuần tự khi key hiện tại không tiến.
  const cursorKeys: string[] = ['cursor', 'after'];
  let cursorKeyIdx = 0;

  const postBody = (vars: Record<string, unknown>): string => {
    if (capture.postParams) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...capture.postParams, variables: JSON.stringify(vars) })) {
        params.append(k, v);
      }
      return params.toString();
    }
    return '';
  };

  // SELF-HEAL: đếm request không lead — 3 lần liên tiếp mà interceptor bắt được cursor tươi
  // (trang tự bắn) thì hoán đổi sang cursor tươi, không fetch tiếp bằng cursor chết.
  let reqSinceLead = 0;

  while (newLeads < maxLeads && !cancelSignal.cancelled) {
    if (page.isClosed()) return { newLeads, nextCursor: currentCursor, ended: 'error', http500: http500Count, first500AtRequest };
    if (requestBudget.remaining <= 0) return { newLeads, nextCursor: currentCursor, ended: 'budget', http500: http500Count, first500AtRequest };
    // TẦNG 2 — dừng TRƯỚC ngưỡng 500 của FB, giữ cursor để chain kế tiếp (IP khác) resume.
    if (requestCount >= chainSlotLimit) {
      hitsChainLimit = true;
      console.log(`[Followers Cursor] 🛡️ Dừng chủ động ở ${requestCount} request (ngưỡng FB ~18) — giữ cursor, nhường IP.`);
      return { newLeads, nextCursor: currentCursor, ended: 'chain-limit', http500: http500Count, first500AtRequest };
    }
    if (reqSinceLead >= 3 && capture.cursor && capture.cursor !== currentCursor) {
      console.log(`[Followers Cursor] Cursor resume chết — chuyển sang cursor tươi từ trang.`);
      currentCursor = capture.cursor;
      reqSinceLead = 0;
      emptyStreak = 0;
    }

    // Chuẩn hóa variables: giữ nguyên count/first từ template mà page FB thật gửi lên (thường là 8-10)
    // KHÔNG ép cứng count: 200 — FB backend ép node size 8, cố tình gửi 200 là cờ bot kích hoạt 500 sớm.
    const nextVars: Record<string, unknown> = { ...(capture.variables || {}) };
    if (nextVars.count === undefined && nextVars.first === undefined) {
      nextVars.count = 8;
    }
    // v2: đảm bảo token trong variables luôn tươi (một số query nhận dtsg trong variables)
    if (capture.fbDtsg && typeof nextVars.fb_dtsg === 'undefined') nextVars.fb_dtsg = capture.fbDtsg;
    if (capture.viewerId && typeof nextVars.__user === 'undefined') nextVars.__user = capture.viewerId;
    if (currentCursor) {
      // Xóa các key cursor khác trước khi set key hiện tại (tránh cursor cũ lẫn lại)
      for (const k of cursorKeys) delete nextVars[k];
      nextVars[cursorKeys[cursorKeyIdx]] = currentCursor;
    }

    const endpoint = capture.endpoint;
    const headers = capture.headers;
    const body = capture.postParams ? postBody(nextVars) : null;

    let fetchResult: { status: number; text: string };
    try {
      const start = Date.now();
      fetchResult = await page.evaluate(async (args) => {
        const { endpoint, headers, body } = args;
        try {
          if (!endpoint) return { status: 500, text: 'no-endpoint' };
          const res = await fetch(endpoint, {
            headers: headers || undefined,
            body: body || undefined,
            credentials: 'include',
          });
          if (res.status === 429) return { status: 429, text: '' };
          if (!res.ok) return { status: res.status, text: '' };
          const text = await res.text();
          return { status: 200, text };
        } catch (err: unknown) {
          return { status: 500, text: err instanceof Error ? err.message : String(err) };
        }
      }, { endpoint, headers, body });
      lastLatencyMs = Date.now() - start;
      requestCount++;
      requestBudget.remaining--;
      if (requestBudget.onSpend) requestBudget.onSpend();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Followers Cursor] Fetch lỗi: ${msg}`);
      return { newLeads, nextCursor: currentCursor, ended: 'error', http500: http500Count, first500AtRequest };
    }

    // 429 = rate limit cứng → dừng ngay, giữ cursor
    if (fetchResult.status === 429) {
      console.warn('[Followers Cursor] HTTP 429 — dừng phiên, giữ cursor để resume.');
      return { newLeads, nextCursor: currentCursor, ended: 'throttled', http500: http500Count, first500AtRequest };
    }
    if (fetchResult.status !== 200) {
      // 5xx = FB bắt đầu chặn chuỗi phân trang (~18 req kịch trần trên IP này).
      // DỪNG NGAY LẬP TỨC để bảo vệ tài khoản và IP, giữ cursor để chuyển sang Proxy mới
      // hoặc phiên sau tiếp tục — KHÔNG retry 4 lần liên tiếp (8s->16s->32s->64s) gây nóng IP
      // và kích hoạt forced-logout của Facebook.
      http500Count++;
      if (first500AtRequest === 0) first500AtRequest = requestCount;
      console.warn(`[Followers Cursor] HTTP ${fetchResult.status} — chuỗi phân trang chạm trần (~18 req). Dừng phiên ngay, giữ cursor để đổi IP.`);
      return { newLeads, nextCursor: currentCursor, ended: 'throttled', http500: http500Count, first500AtRequest };
    }

    const text = fetchResult.text || '';
    if (text.includes('login_form') || text.includes('checkpoint') || text.includes('/login.php')) {
      console.warn('[Followers Cursor] Response chuyển hướng login/checkpoint — dừng phiên.');
      return { newLeads, nextCursor: currentCursor, ended: 'throttled', http500: http500Count, first500AtRequest };
    }

    // Parse NDJSON / JSON đơn
    let pageLeads: ExtractedLead[] = [];
    let pageCursor: string | null = null;
    const parseChunk = (chunk: string) => {
      try {
        const json = JSON.parse(chunk) as unknown;
        pageLeads.push(...parseFacebookGraphQLResponse(json));
        const cur = extractFollowerEndCursor(json);
        if (cur) pageCursor = cur;
      } catch {}
    };
    if (text.includes('\n{"')) {
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (t.startsWith('{')) parseChunk(t);
      }
    } else {
      parseChunk(text);
    }

    const inserted = saveBatch(pageLeads);
    newLeads += inserted;
    if (onProgress) onProgress(newLeads, pageCursor ?? currentCursor);

    // Cursor không tiến (giống cursor cũ) hoặc 0 lead → soft-throttle signal
    if (!pageCursor || pageCursor === currentCursor) {
      if (!pageCursor) return { newLeads, nextCursor: currentCursor, ended: 'done', http500: http500Count, first500AtRequest };
      // Fallback: key cursor hiện tại không hiệu quả → thử key kế tiếp trước khi kết luận throttle
      if (cursorKeyIdx < cursorKeys.length - 1) {
        cursorKeyIdx++;
        emptyStreak = 0;
        console.log(`[Followers Cursor] Cursor key '${cursorKeys[cursorKeyIdx - 1]}' không tiến — thử key '${cursorKeys[cursorKeyIdx]}'.`);
        await page.waitForTimeout(pacingMs);
        continue;
      }
      emptyStreak++;
    } else {
      currentCursor = pageCursor;
      emptyStreak = 0;
      consecutiveSlow = 0;
    }
    if (inserted === 0 && pageLeads.length === 0) { emptyStreak++; reqSinceLead++; }
    else reqSinceLead = 0;
    if (emptyStreak >= 3) {
      console.warn(`[Followers Cursor] Soft-throttle: ${emptyStreak} trang rỗng/lặp cursor. Dừng phiên, giữ cursor.`);
      return { newLeads, nextCursor: currentCursor, ended: 'throttled', http500: http500Count, first500AtRequest };
    }

    // CD2 — pacing floor 3s: FB 2026-09 siết phân trang replay <2.5s/request → 500 ngay.
    // Latency tăng → nhân 1.6; ổn định → giảm CHẦM về floor 3000 (không còn 1200).
    if (lastLatencyMs > 3000) {
      consecutiveSlow++;
      pacingMs = Math.min(8000, Math.round(pacingMs * 1.6));
    } else {
      consecutiveSlow = 0;
      pacingMs = Math.max(3000, Math.round(pacingMs * 0.95));
    }

    await page.waitForTimeout(pacingMs + Math.floor(Math.random() * 900));
    // CD3 — hơi thở chuỗi: nghỉ 45-75s mỗi 12 request (chủ động, không chờ 500)
    if (requestCount % 12 === 0) {
      await page.waitForTimeout(45000 + Math.floor(Math.random() * 30000));
    }
  }

  return { newLeads, nextCursor: currentCursor, ended: cancelSignal.cancelled ? 'cancelled' : 'done', http500: http500Count, first500AtRequest };
}

/**
 * CD1 — PASSIVE SCROLL ENGINE (nguồn chính thu followers):
 * Không tự fetch GraphQL. Scroll trang /followers, FB tự bắn pagination query,
 * interceptor (đã attach bên ngoài) parse leads + cursor từ response.
 * Đã chứng minh thực tế: 144 leads / 10 scroll, 0 throttle — trong khi active replay
 * fetch liên tục pacing <2.5s bị FB 500 từ request đầu (ngưỡng mới 2026-09).
 */
export async function harvestFollowersPassive(
  page: Page,
  capture: GraphQLFollowerCapture,
  getLeadCount: () => number, // interceptor-side counter (được cập nhật mỗi batch FB tự bắn)
  maxLeads: number,
  cancelSignal: { cancelled: boolean },
  opts: { scrollWaitMs?: number; onProgress?: (totalLeads: number, cursor: string | null) => void; requestBudget?: { remaining: number; onSpend?: () => void } | null } = {}
): Promise<{ newLeads: number; nextCursor: string | null; ended: string }> {
  const scrollWaitMs = opts.scrollWaitMs ?? 3500;
  let stagnantScrolls = 0;
  let newLeads = getLeadCount();

  // Đếm request FB tự bắn vào budget: mỗi scroll đều trigger 1+ pagination request.
  // Không đếm thì telemetry luôn 0 requests (như đã thấy job #45: 152 leads, 0 request)
  // — che khuất footprint thật, adaptive cooldown tính sai.
  const budget = opts.requestBudget ?? null;
  const spendScrollRequest = () => {
    if (budget) {
      budget.remaining--;
      if (budget.onSpend) budget.onSpend();
    }
  };

  // Đợi request pagination đầu tiên (chứa cursor + leads): FB bắn sau khi render list,
  // thường cần 1 scroll nhẹ để kích hoạt lazy-load.
  const deadline = Date.now() + 16000;
  while (!capture.cursor && Date.now() < deadline && !cancelSignal.cancelled) {
    await page.evaluate(() => window.scrollBy(0, 700 + Math.floor(Math.random() * 300))).catch(() => {});
    spendScrollRequest();
    await page.waitForTimeout(2000);
  }
  if (!capture.cursor) {
    return { newLeads: getLeadCount(), nextCursor: null, ended: 'no-cursor' };
  }

  while (getLeadCount() < maxLeads && !cancelSignal.cancelled && stagnantScrolls < 4) {
    if (page.isClosed()) return { newLeads: getLeadCount(), nextCursor: capture.cursor, ended: 'error' };
    if (budget && budget.remaining <= 0) {
      console.log('[Passive Scroll] Hết ngân sách request — dừng sớm, giữ cursor.');
      return { newLeads: getLeadCount(), nextCursor: capture.cursor, ended: 'budget' };
    }

    newLeads = getLeadCount();
    await page.evaluate(() => window.scrollBy(0, 900 + Math.floor(Math.random() * 400))).catch(() => {});
    spendScrollRequest();
    // Chờ FB tự bắn pagination + interceptor parse. Pacing 4.5-6s/scroll (nâng từ
    // 3.5-4.5s): con người đọc danh sách trước khi cuộn tiếp — FB đo inter-scroll
    // interval; <3s liên tục 18 request là signature automation đã bị 500.
    await page.waitForTimeout(Math.round(scrollWaitMs / 2));
    await page.waitForTimeout(Math.round(scrollWaitMs / 2) + Math.floor(Math.random() * 1500));

    if (opts.onProgress) opts.onProgress(getLeadCount(), capture.cursor);

    if (getLeadCount() === newLeads) {
      stagnantScrolls++;
      // Scroll lùi nhẹ rồi tới lại — kích hoạt lazy-load bị kẹt (pattern FB desktop)
      if (stagnantScrolls >= 2) {
        await page.evaluate(() => window.scrollBy(0, -500)).catch(() => {});
        await page.waitForTimeout(1500);
      }
    } else {
      stagnantScrolls = 0;
    }
  }

  return { newLeads: getLeadCount(), nextCursor: capture.cursor, ended: stagnantScrolls >= 4 ? 'stagnant' : (cancelSignal.cancelled ? 'cancelled' : 'done') };
}


/**
 * P1+P2 — PARALLEL SESSION POOL JOB (thay Multi-Account Rotation tuần tự).
 *
 * - ĐÚNG 1 worker/account cho cả job; số browser chạy đồng thời điều tiết bằng
 *   ConcurrencyLimiter (setting `max_scrape_sessions`, 1-6).
 * - ScrapeAccountPool quản cooldown + circuit breaker per-account (2 chain 0 lead
 *   liên tiếp → loại account khỏi job).
 * - ScrapeTaskBoard chia việc theo KÊNH: cursor (followers) / friends / group /
 *   post khoá độc quyền theo target; engager harvest song song qua post queue
 *   (discovery single-flight). Nhờ đó 1 target chạy được nhiều account cùng lúc.
 * - Cursor chia sẻ theo target lưu DB (last_cursor + resume_target_idx): followers
 *   GraphQL và phân trang thành viên nhóm đều resume đúng vị trí ở chain kế.
 * - Spare proxy lease ĐỘC QUYỀN: 2 session song song không bao giờ trùng IP;
 *   cạn spare thì dùng proxy mặc định của chính account.
 * - saveLeadBatch atomic qua db.transaction — N worker ghi song song an toàn WAL.
 */
export async function runFacebookScrapeJob(options: ScrapeJobOptions): Promise<void> {
  return scrapeLimiter.run(async () => {
    const { jobId, workspaceId, targetGroup, maxLimit, autoImport, customTag, scrapeType } = options;

    const cancelSignal = { cancelled: false };
    activeJobSignals.set(jobId, cancelSignal);

    db.prepare(`UPDATE scrape_jobs SET status = 'processing', error_msg = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);

    let scrapedCount = 0;
    let phoneCount = 0;
    /** P4/fix: số ứng viên THÔ đã thấy trước dedup — phân biệt "trùng hết" vs "không thấy ai" */
    let rawCandidates = 0;
    /** Lý do kênh không thu được gì (chặn/không phải thành viên/nhóm rỗng) → error_msg cuối job */
    const jobBlockReasons: string[] = [];
    const collectedUids = new Set<string>();
    const collectedPhones = new Set<string>();

    const insertLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO scraped_job_leads (job_id, workspace_id, platform, uid, display_name, avatar_url, profile_url, interaction_type, post_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // P4 — chèn kèm khoá chuẩn hoá + chặn trùng ngữ nghĩa ngay ở tầng SQL
    // (@User vs t.me/user, 090… vs +8490…). WHERE NOT EXISTS dùng index
    // idx_spam_leads_norm nên vẫn rẻ; INSERT OR IGNORE giữ dedup tuyệt đối theo value.
    const insertSpamLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (workspace_id, platform, lead_type, value, display_name, avatar_url, status, source, normalized_value)
      SELECT ?, 'facebook', 'uid', ?, ?, ?, 'pending', ?, ?
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

    // B3: multi-target — mỗi dòng 1 target, dedup chung qua collectedUids
    const targetList = targetGroup.split(/[\n,]+/).map((t: string) => t.trim()).filter(Boolean);
    const parsedTarget = parseFacebookTarget(targetList[0] || targetGroup);
    const targetTag = customTag && customTag.trim() ? customTag.trim() : `KOL_${parsedTarget.identifier}`;

    /**
     * TẦNG 2 — Lịch sử yield của target: nếu target này đã cào nhiều lần mà thu rất ít,
     * chạy lại chỉ đốt account + IP mà gần như không thêm lead (đo thật: job 36/37 chỉ
     * 16 và 40 lead, tiếp tục chạy thêm nhiều lượt nữa). Cảnh báo rõ để người dùng quyết
     * định, KHÔNG tự chặn (có thể target vừa đổi nội dung).
     */
    const priorRuns = db.prepare(`
      SELECT COUNT(*) runs, COALESCE(SUM(scraped_count), 0) leads
      FROM scrape_jobs
      WHERE workspace_id = ? AND platform = 'facebook'
        AND target_group = ? AND status = 'completed'
    `).get(workspaceId, targetList.join('\n')) as { runs: number; leads: number } | undefined;
    if (priorRuns && priorRuns.runs >= 2) {
      const avg = Math.round(priorRuns.leads / priorRuns.runs);
      if (avg < 50) {
        console.warn(
          `[FB Scraper] ⚠️ Target này đã cào ${priorRuns.runs} lần, trung bình chỉ ${avg} lead/lần ` +
          `(tổng ${priorRuns.leads}). Nhiều khả năng đã cạn lead hoặc bị FB hạn chế xem — ` +
          `cân nhắc đổi target thay vì chạy lại, tránh đốt account.`
        );
        try {
          db.prepare(`INSERT INTO crawler_logs (workspace_id, target_value, action_type, message) VALUES (?, ?, 'low_yield_target', ?)`)
            .run(workspaceId, targetList[0] || targetGroup, `Target đã cào ${priorRuns.runs} lần, trung bình ${avg} lead/lần — nên đổi target.`);
        } catch { /* log lỗi không chặn job */ }
      }
    }
    let targetFollowerCount = (db.prepare(`SELECT target_follower_count FROM scrape_jobs WHERE id = ?`).get(jobId) as { target_follower_count: number | null } | undefined)?.target_follower_count || 0;

    // Atomic qua transaction: an toàn khi nhiều account worker gọi đồng thời
    const saveLeadBatch = (leads: ExtractedLead[]): number => {
      if (leads.length === 0) return 0;
      rawCandidates += leads.length;
      let inserted = 0;
      const tx = db.transaction(() => {
        for (const lead of leads) {
          // P2 — lead phone-only (SĐT bóc từ HTML mbasic, không có uid): ghi thẳng
          // lead zalo, không đi qua nhánh uid FB.
          if (!lead.uid && lead.phone) {
            if (!collectedPhones.has(lead.phone)) {
              collectedPhones.add(lead.phone);
              if (autoImport) {
                const phoneNorm = normalizeLeadValue('zalo', lead.phone);
                insertPhoneLeadStmt.run(
                  workspaceId,
                  lead.phone,
                  lead.displayName || `Khách hàng ${lead.phone}`,
                  `${targetTag}_SĐT`,
                  phoneNorm,
                  workspaceId,
                  phoneNorm
                );
                phoneCount++;
                inserted++;
              }
            }
            continue;
          }
          if (!lead.uid || collectedUids.has(lead.uid.toLowerCase())) continue;
          if (parsedTarget.identifier && lead.uid.toLowerCase() === parsedTarget.identifier.toLowerCase()) continue;
          if (lead.displayName && lead.displayName.trim().startsWith('@')) continue;

          const lowerName = (lead.displayName || '').toLowerCase().trim();
          if (UI_BLACKLIST_TERMS.has(lowerName)) continue;

          const lowerUid = lead.uid.toLowerCase();
          if (
            SYSTEM_SLUG_SET.has(lowerUid) ||
            lowerUid.includes('help') ||
            lowerUid.includes('privacy') ||
            lowerUid.includes('policies') ||
            lowerUid.includes('settings') ||
            lowerUid.includes('terms') ||
            lowerUid.includes('support') ||
            lowerUid.includes('.php')
          ) {
            continue;
          }

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
            const uidNorm = normalizeLeadValue('facebook', lead.uid);
            insertSpamLeadStmt.run(
              workspaceId,
              lead.uid,
              lead.displayName || lead.uid,
              lead.avatarUrl || null,
              targetTag,
              uidNorm,
              workspaceId,
              uidNorm
            );
          }

          inserted++;

          if (lead.phone && !collectedPhones.has(lead.phone)) {
            collectedPhones.add(lead.phone);
            phoneCount++;
            if (autoImport) {
              const phoneNorm = normalizeLeadValue('zalo', lead.phone);
              insertPhoneLeadStmt.run(
                workspaceId,
                lead.phone,
                lead.displayName || `Khách hàng ${lead.phone}`,
                `${targetTag}_SĐT`,
                phoneNorm,
                workspaceId,
                phoneNorm
              );
            }
          }
        }
        if (inserted > 0) {
          scrapedCount += inserted;
          db.prepare(`UPDATE scrape_jobs SET total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
            scrapedCount,
            scrapedCount,
            jobId
          );
        }
      });

      tx();
      return inserted;
    };

    // ── Account queue: filter cooldown / daily quota (Phase 4.1) ──
    const DAILY_REQUEST_LIMIT = 3000;
    // SQLite CURRENT_TIMESTAMP lưu 'YYYY-MM-DD HH:MM:SS' theo UTC (không suffix Z);
    // Date.parse chuỗi này trả giờ LOCAL → sai lệch múi giờ (VN +7h). Chuẩn hóa
    // bằng cách gắn 'Z' trước khi so với nowMs.
    const nowMs = Date.now();
    const parseDbTime = (s: string | null | undefined): number => {
      if (!s) return 0;
      const t = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
      const v = Date.parse(t);
      return isNaN(v) ? 0 : v;
    };
    /**
     * TẦNG 2 — Warm-up: account chưa chạy thành công đủ số phiên thì bị giới hạn
     * (quota nhỏ + nghỉ dài). Đo trên máy thật: account vừa nạp cookie rồi cào mạnh
     * ngay là nhóm bị checkpoint sớm nhất.
     */
    const WARMUP_SESSIONS_REQUIRED = 2;
    const WARMUP_QUOTA_MULTIPLIER = 0.4;
    const CHAIN_SLOT_LIMIT_GLOBAL = 15;

    const accountEligible = (a: { id: number; daily_request_count: number | null; daily_reset_at: string | null; cooldown_until: string | null }): boolean => {
      if (a.cooldown_until) {
        const until = parseDbTime(a.cooldown_until);
        if (until > nowMs) return false;
      }
      if (a.daily_reset_at) {
        const reset = parseDbTime(a.daily_reset_at);
        if (reset > 0 && nowMs - reset >= 24 * 3600 * 1000) {
          db.prepare(`UPDATE social_accounts SET daily_request_count = 0, daily_reset_at = CURRENT_TIMESTAMP WHERE id = ?`).run(a.id);
          return true;
        }
      } else {
        db.prepare(`UPDATE social_accounts SET daily_reset_at = CURRENT_TIMESTAMP WHERE id = ?`).run(a.id);
      }
      return (a.daily_request_count || 0) < DAILY_REQUEST_LIMIT;
    };

    let accountQueue: number[] = [];
    if (options.accountIds && Array.isArray(options.accountIds) && options.accountIds.length > 0) {
      const placeholders = options.accountIds.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT id, status, daily_request_count, daily_reset_at, cooldown_until FROM social_accounts
        WHERE id IN (${placeholders})
        ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, id ASC
      `).all(...options.accountIds) as Array<{ id: number; status: string; daily_request_count: number | null; daily_reset_at: string | null; cooldown_until: string | null }>;
      accountQueue = rows.filter(accountEligible).map(a => a.id);
      const skipped = options.accountIds.length - accountQueue.length;
      if (skipped > 0) console.warn(`[FB Scraper] Bỏ qua ${skipped} account (cooldown / hết quota ngày ${DAILY_REQUEST_LIMIT}).`);
    } else if (options.accountId) {
      const row = db.prepare(`
        SELECT id, status, daily_request_count, daily_reset_at, cooldown_until FROM social_accounts WHERE id = ?
      `).get(options.accountId) as { id: number; status: string; daily_request_count: number | null; daily_reset_at: string | null; cooldown_until: string | null } | undefined;
      if (row && accountEligible(row)) accountQueue = [row.id];
    } else {
      const liveAccs = db.prepare(`
        SELECT id, daily_request_count, daily_reset_at, cooldown_until FROM social_accounts
        WHERE workspace_id = ? AND platform = 'facebook' AND status IN ('live', 'ready', 'active', 'pending', 'die')
        ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, id ASC
        LIMIT 5
      `).all(workspaceId) as Array<{ id: number; daily_request_count: number | null; daily_reset_at: string | null; cooldown_until: string | null }>;
      accountQueue = liveAccs.filter(accountEligible).map(a => a.id);
    }

    if (accountQueue.length === 0) {
      const cooldowns = db.prepare(`
        SELECT username, cooldown_until FROM social_accounts
        WHERE workspace_id = ? AND platform = 'facebook' AND status != 'deleted'
          AND cooldown_until IS NOT NULL AND cooldown_until > CURRENT_TIMESTAMP
        ORDER BY cooldown_until ASC
      `).all(workspaceId) as Array<{ username: string; cooldown_until: string }>;
      const msg = cooldowns.length > 0
        ? `Không có account khả dụng (đăng nhập FB bắt buộc từ 2026-09). Tất cả đang cooldown: ${cooldowns.map(c => `#${c.username} → ${c.cooldown_until}`).join('; ')}. Nạp cookie account khác để chạy ngay.`
        : 'Không có account Facebook nào trong hệ thống. Đăng nhập/ấn cookie để cào.';
      console.error(`[FB Scraper] Job #${jobId} dừng trước khi chạy: ${msg}`);
      db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(msg, jobId);
      sendDesktopNotification('Không có account khả dụng ⚠️', msg.slice(0, 300));
      return;
    }

    // ── P2: pool account + slot semaphore + task board kênh song song ──
    const requestedSlots = Math.max(1, Math.min(6,
      options.parallelSessions && options.parallelSessions > 0
        ? options.parallelSessions
        : parseInt(getSetting('max_scrape_sessions', '3'), 10) || 3
    ));

    /**
     * TẦNG 1 — Số session song song bị chặn bởi SỐ IP THẬT, không phải số account.
     * Chạy nhiều session hơn số IP khả dụng chỉ tạo ra session xếp hàng chờ (không
     * tăng sản lượng) trong khi làm tăng rủi ro nếu luật độc quyền IP bị hở.
     */
    const accountProxyRows = db.prepare(`
      SELECT a.id as account_id, a.proxy_id, p.host, p.port, p.username, p.password, p.protocol,
             p.exit_ip, p.exit_ip_checked_at
      FROM social_accounts a LEFT JOIN proxies p ON a.proxy_id = p.id
      WHERE a.id IN (${accountQueue.map(() => '?').join(',')})
    `).all(...accountQueue) as Array<{ account_id: number; proxy_id: number | null; host: string | null; port: number | null; username: string | null; password: string | null; protocol: string | null; exit_ip: string | null; exit_ip_checked_at: string | null }>;
    const accountProxyById = new Map<number, ProxyEndpoint | null>();
    const distinctIps = new Set<string>();
    for (const row of accountProxyRows) {
      const ep: ProxyEndpoint | null = row.proxy_id && row.host && row.port
        ? { proxyId: row.proxy_id, host: row.host, port: row.port, exitIp: row.exit_ip, username: row.username || undefined, password: row.password || undefined, protocol: row.protocol || 'http' }
        : null;
      accountProxyById.set(row.account_id, ep);
      distinctIps.add(ep ? proxyIpKey(ep) : 'direct');
    }
    const spareProxyRows = db.prepare(`
      SELECT id, host, port, username, password, protocol, exit_ip FROM proxies
      WHERE status = 'working' AND id NOT IN (SELECT COALESCE(proxy_id, -1) FROM social_accounts)
      ORDER BY id ASC
    `).all() as Array<{ id: number; host: string; port: number; username: string | null; password: string | null; protocol: string | null; exit_ip: string | null }>;
    const spareProxies: ProxyEndpoint[] = spareProxyRows.map(r => ({
      proxyId: r.id, host: r.host, port: r.port, exitIp: r.exit_ip,
      username: r.username || undefined, password: r.password || undefined, protocol: r.protocol || 'http',
    }));

    const configuredSlots = maxSafeSessions(distinctIps.size, requestedSlots);
    const pool = new ScrapeAccountPool(accountQueue);
    const slots = new ConcurrencyLimiter(configuredSlots);
    const board = new ScrapeTaskBoard(
      targetList.map(t => ({ kind: parseFacebookTarget(t).type })),
      { scrapeType }
    );

    console.log(
      `[FB Scraper] Job #${jobId} pool: ${accountQueue.length} account, ${configuredSlots} slot song song` +
      `${configuredSlots < requestedSlots ? ` (đã hạ từ ${requestedSlots} theo ${distinctIps.size} IP khả dụng)` : ''}` +
      `, ${targetList.length} target (kênh hybrid).`
    );
    const unmeasured = accountProxyRows.filter(r => r.proxy_id && !r.exit_ip).length;
    if (unmeasured > 0) {
      console.warn(
        `[FB Scraper] ⚠️ ${unmeasured} proxy chưa đo IP đầu ra thật — đang tạm dùng host:port làm danh tính. ` +
        `Chạy "npm run verify:proxy-ip" để đo, tránh 2 account vô tình trùng IP.`
      );
    }
    if (distinctIps.size < accountQueue.length) {
      console.warn(
        `[FB Scraper] ⚠️ ${accountQueue.length} account nhưng chỉ ${distinctIps.size} IP riêng — ` +
        `${accountQueue.length - distinctIps.size} account phải dùng chung IP. ` +
        `Đây là nguyên nhân checkpoint hàng loạt; nạp thêm proxy riêng cho từng account.`
      );
    }

    // CD3: trần chuỗi thật của FB / account / chain — vượt chỉ mời 500
    const maxPerAccountQuota = 150;
    const budgetByType: Record<string, number> = {
      cursor_engine: 2000,
      group_members: 1500,
      post_engagement: 900,
      engager_only: 900,
    };

    /**
     * TẦNG 1 — Sổ đăng ký IP thật: MỘT IP = TỐI ĐA MỘT SESSION.
     *
     * Trước đây lease theo proxy.id nên 3 row cùng host (103.179.188.222) bị coi là
     * 3 IP khác nhau → 3 session/1 IP trong 17 giây → checkpoint hàng loạt.
     * Nay danh tính là `host`, và không có ngoại lệ cho proxy mặc định của account.
     */
    const ipRegistry = new IpRegistry();

    /** Ghi crawler_logs 1 lần cho mỗi (khoá) — tránh spam khi nhiều chain cùng lý do. */
    const loggedBlockKeys = new Set<string>();
    const logBlockReasonOnce = (key: string, targetValue: string, actionType: string, message: string): void => {
      if (loggedBlockKeys.has(key)) return;
      loggedBlockKeys.add(key);
      try {
        db.prepare(`INSERT INTO crawler_logs (workspace_id, target_value, action_type, message) VALUES (?, ?, ?, ?)`)
          .run(workspaceId, targetValue, actionType, message);
      } catch { /* log lỗi không được làm hỏng job */ }
    };

    // ── Cursor chia sẻ theo target (followers GraphQL / trang thành viên nhóm) ──
    const cursorsByTarget: Array<string | null> = targetList.map(() => null);
    const resumeRow = db.prepare(`SELECT last_cursor, resume_target_idx FROM scrape_jobs WHERE id = ?`).get(jobId) as { last_cursor: string | null; resume_target_idx: number | null } | undefined;
    if (resumeRow?.last_cursor) {
      const idx = Math.min(Math.max(0, resumeRow.resume_target_idx || 0), targetList.length - 1);
      cursorsByTarget[idx] = resumeRow.last_cursor;
    }

    const setCursorForTarget = (targetIdx: number, cursor: string) => {
      cursorsByTarget[targetIdx] = cursor;
      db.prepare(`UPDATE scrape_jobs SET last_cursor = ?, resume_target_idx = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(cursor, targetIdx, jobId);
    };

    // P5 — nạp khuyến nghị pacing/cooldown từ telemetry 7 ngày, tính MỘT LẦN khi
    // mở job (mỗi chain chỉ tra Map trong RAM, không query lại).
    const pacingByAccount = new Map<number, { pacingMs: number; cooldownMs: number; note: string }>();
    try {
      const telRows = db.prepare(`
        SELECT t.account_id, t.engine, t.requests, t.leads_new, t.http_500,
               t.duration_ms, t.first_500_at_request, t.created_at
        FROM scrape_telemetry t
        JOIN scrape_jobs j ON j.id = t.job_id
        WHERE j.workspace_id = ?
        ORDER BY t.id DESC LIMIT 3000
      `).all(workspaceId) as TelemetryRow[];
      const windowed = withinWindow(telRows, Date.now(), 7 * 24 * 3600_000);
      for (const stats of summarizeByAccount(windowed)) {
        const rec = recommendPacing(stats);
        pacingByAccount.set(stats.accountId, { pacingMs: rec.pacingMs, cooldownMs: rec.cooldownMs, note: rec.note });
        if (rec.confident) {
          console.log(`[FB Scraper] 📈 Auto-tune Account #${stats.accountId}: pacing ${rec.pacingMs}ms, cooldown ${Math.round(rec.cooldownMs / 60000)}' — ${rec.note}`);
        }
      }
    } catch (telErr: unknown) {
      console.warn('[FB Scraper] Bỏ qua auto-tune telemetry:', telErr instanceof Error ? telErr.message : telErr);
    }

    // Cache capability theo target (probe 1 lần/target cho cả job) + cờ gap-fill 1 lần
    const capabilityCache: Array<TargetCapability | null> = targetList.map(() => null);
    const groupDomDone = targetList.map(() => false);
    const engagerDomDone = targetList.map(() => false);

    interface AccountChainOutcome {
      leads: number;
      requests: number;
      http500: number;
      /** P5 — request index của lần 500 đầu tiên (0 = không dính) */
      first500AtRequest: number;
      /** P5 — thời lượng chain (ms) để tính leads/giờ */
      durationMs: number;
      dead: boolean;
      throttled: boolean;
      finished: boolean;
      /** Tầng 1: không giành được IP rảnh → session không hề chạy */
      ipUnavailable?: boolean;
      /** Tầng 2: dừng chủ động trước ngưỡng 500 — còn việc, cursor đã giữ */
      chainLimited?: boolean;
    }

    /**
     * P2 — Chạy 1 chain: 1 browser session, 1 target, ĐÚNG 1 kênh (cursor/engager/
     * group/post/friends). Nhờ tách kênh, nhiều account phục vụ cùng target song song.
     */
    const runChain = async (accountId: number, task: ClaimedTask, pass: number, warmup = false): Promise<AccountChainOutcome> => {
      const targetIdx = task.targetIdx;
      const currentTarget = parseFacebookTarget(targetList[targetIdx]);
      const chainStartedAt = Date.now();
      const out: AccountChainOutcome = { leads: 0, requests: 0, http500: 0, first500AtRequest: 0, durationMs: 0, dead: false, throttled: false, finished: false };

      // TẦNG 1 — giành IP TRƯỚC khi mở browser. Không có IP rảnh → nhường slot;
      // tuyệt đối không chạy chung IP với session khác.
      const sessionLease = chooseIpForSession({
        registry: ipRegistry,
        accountId,
        accountProxy: accountProxyById.get(accountId) ?? null,
        spareProxies,
        allowSpare: pass >= 2,
      });
      if (!sessionLease) {
        console.log(`[FB Scraper] ⏸️ Account #${accountId}: mọi IP khả dụng đang bận — nhường slot, thử lại sau.`);
        out.ipUnavailable = true;
        return out;
      }
      const spareProxy = sessionLease.proxy;

      let browserContext: BrowserContext | null = null;
      let sessionRequestsUsed = 0;
      let sessionHttp500 = 0;

      try {
        const launched = await setupStealthBrowserContext(accountId, spareProxy);
        browserContext = launched.context;
        const accountUsername = launched.accountUsername;

        /**
         * KIỂM TRA PHIÊN CỤC BỘ (không tốn request, không thể sai):
         * Cookie `c_user` là bằng chứng DUY NHẤT rằng phiên còn đăng nhập. Nếu thiếu,
         * mọi engine đều vô nghĩa:
         *   - engine mbasic (nguồn chính của nhóm) cần viewer id → bị bỏ qua âm thầm
         *   - FB trả trang generic cho khách → DOM gap-fill đọc 0 thành viên
         *   - thông báo lỗi cuối cùng đổ oan cho NHÓM, trong khi lỗi thật là account
         *     đã đăng xuất (đúng ca job #50: cả 5 account mất c_user, chỉ còn cookie 'fr')
         * Vì vậy kiểm tra TRƯỚC khi probe mạng, và coi đây là account cần nạp lại cookie.
         */
        const sessionViewerId = await getViewerAccountId(browserContext);
        if (!sessionViewerId) {
          const msg = `Account #${accountId} (@${accountUsername}) KHÔNG có cookie đăng nhập (c_user) — phiên đã hết hạn. Cần nạp lại cookie cho account này.`;
          console.warn(`[FB Scraper] 🔑 ${msg}`);
          logBlockReasonOnce(`nocookie:${accountId}`, `account:${accountId}`, 'no_session_cookie', msg);
          jobBlockReasons.push(msg);
          db.prepare(`
            UPDATE social_accounts SET status = 'die', last_checked = CURRENT_TIMESTAMP,
                   cooldown_until = datetime('now', '+20 minutes')
            WHERE id = ?
          `).run(accountId);
          pool.markExhausted(accountId);
          out.dead = true;
          await browserContext.close().catch(() => {});
          return out;
        }

        // Pre-flight login probe (cache 30 phút account vừa xác nhận live)
        let loggedIn = true;
        const accCheck = db.prepare(`SELECT status, last_checked FROM social_accounts WHERE id = ?`).get(accountId) as { status: string; last_checked: string | null } | undefined;
        const lastCheckedMs = parseDbTime(accCheck?.last_checked);
        // Cache này chỉ AN TOÀN khi cookie đã được xác nhận ở trên (đã qua cổng c_user).
        const isRecentlyLive = accCheck?.status === 'live' && lastCheckedMs > 0 && (Date.now() - lastCheckedMs < 30 * 60 * 1000);
        if (isRecentlyLive) {
          console.log(`[FB Scraper] ⚡ Account #${accountId} vừa probe 'live' <30p trước (cookie hợp lệ) — bỏ qua probe.`);
        } else {
          const probe = await probeAccountLogin(browserContext);
          if (!probe.live && probe.decisive) {
            console.warn(`[FB Scraper] ⛔ Account #${accountId} cookie DEAD — loại khỏi pool job.`);
            const recentLogouts = (db.prepare(`
              SELECT COUNT(*) as n FROM scrape_telemetry
              WHERE account_id = ? AND engine = 'facebook_session'
                AND requests = 0 AND leads_new = 0
                AND created_at > datetime('now', '-24 hours')
            `).get(accountId) as { n: number } | undefined)?.n || 0;
            const cooldownHours = recentLogouts >= 2 ? 12 : recentLogouts === 1 ? 6 : 1;
            db.prepare(`
              UPDATE social_accounts
              SET status = 'die', last_checked = CURRENT_TIMESTAMP,
                  cooldown_until = datetime('now', '+' || ? || ' hours')
              WHERE id = ?
            `).run(cooldownHours, accountId);
            pool.markExhausted(accountId);
            loggedIn = false;
          } else if (probe.live && probe.decisive) {
            db.prepare(`UPDATE social_accounts SET status = 'live', last_checked = CURRENT_TIMESTAMP WHERE id = ?`).run(accountId);
          }
        }

        if (loggedIn) {
          const page = await browserContext.newPage();
          page.setDefaultTimeout(35000);
          page.setDefaultNavigationTimeout(45000);
          const detachInterceptor = attachFacebookGraphQLInterceptor(page, saveLeadBatch);
          const closePage = async () => { detachInterceptor(); await page.close().catch(() => {}); };

          // Tầng 2 — account đang warm-up chỉ nhận quota nhỏ để hạ "độ nóng" của phiên.
          const effectiveQuota = warmup
            ? Math.max(30, Math.round(maxPerAccountQuota * WARMUP_QUOTA_MULTIPLIER))
            : maxPerAccountQuota;
          const sessionQuota = Math.min(effectiveQuota, Math.max(30, maxLimit - scrapedCount));
          if (warmup) console.log(`[FB Scraper] 🌱 Account #${accountId} đang warm-up — quota phiên hạ còn ${sessionQuota}.`);
          const sessionRequestBudget = {
            remaining: 1500,
            // TẦNG 2 — Đếm quota ngày THẬT (mỗi request +1).
            // Lỗi cũ: chỉ cộng khi `sessionRequestsUsed % 10 === 0`. Đo trên máy thật,
            // chain trung bình chỉ 5-7 request → KHÔNG BAO GIỜ đạt mốc 10 → counter luôn 0
            // dù telemetry có tới 216 request (account #3). Hệ quả: trần quota ngày
            // chưa từng hoạt động, account không được nghỉ theo ngày.
            onSpend: () => {
              sessionRequestsUsed++;
              db.prepare(`UPDATE social_accounts SET daily_request_count = COALESCE(daily_request_count, 0) + 1 WHERE id = ?`).run(accountId);
            },
          };

          await page.goto(currentTarget.cleanUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
          await page.waitForTimeout(2500);
          await dismissFacebookDialogs(page);

          const pageHtml = await page.content().catch(() => '');
          const block = assessBlock(page.url(), pageHtml);

          // ── CHECKPOINT (nặng): tài khoản thực sự bị khoá/xác minh danh tính ──
          // Cooldown dài + cooldown proxy (IP đó đã bị FB gắn cờ cùng tài khoản).
          if (block.kind === 'checkpoint') {
            console.warn(`[FB Scraper] 🛑 Account #${accountId} CHECKPOINT thật (${block.markers.join(',')}) — cooldown dài.`);
            const proxyIdRow = db.prepare(`SELECT proxy_id FROM social_accounts WHERE id = ?`).get(accountId) as { proxy_id: number | null } | undefined;
            if (proxyIdRow?.proxy_id) {
              db.prepare(`UPDATE proxies SET status = 'cooldown' WHERE id = ?`).run(proxyIdRow.proxy_id);
            }
            db.prepare(`UPDATE social_accounts SET status = 'checkpoint', cooldown_until = datetime('now', '+60 minutes') WHERE id = ?`).run(accountId);
            try {
              db.prepare(`INSERT INTO crawler_logs (workspace_id, target_value, action_type, message) VALUES (?, ?, 'checkpoint', ?)`).run(
                workspaceId,
                `account:${accountId}`,
                `Checkpoint thật (${block.markers.join(',')}) — account cooldown 60', proxy ${proxyIdRow?.proxy_id || 'n/a'} cooldown cùng lúc.`
              );
            } catch {}
            sendDesktopNotification(
              'Tài khoản Facebook bị Checkpoint ⚠️',
              `Tài khoản #${accountId} (@${accountUsername}) gặp checkpoint. Cooldown 60 phút rồi tự khôi phục.`
            );
            pool.markExhausted(accountId);
            out.dead = true;
            await closePage();
          }

          // ── LOGIN WALL (nhẹ): phiên/cookie hỏng, KHÔNG phải tài khoản bị khoá ──
          // KHÔNG được cooldown account, KHÔNG được markExhausted: đo trên máy thật,
          // account #4 từng bị đánh oan "checkpoint" và bị loại khỏi job, ngay sau đó
          // job vẫn thu 373 leads và account vẫn khoẻ. Chỉ ngắt phiên này, nhường IP.
          if (block.kind === 'login') {
            // Login wall = cookie ĐÃ CHẾT (không phải tài khoản bị khoá). Không cooldown
            // theo kiểu "phạt checkpoint", NHƯNG phải đánh dấu cần nạp lại cookie — nếu chỉ
            // log rồi để nguyên status='live', account sẽ được chọn lại và lặp vô hạn
            // (đúng ca job #50: account #2 hit login wall, job vẫn để nó 'live').
            console.warn(`[FB Scraper] 🔐 Account #${accountId} gặp login wall (${block.markers.join(',')}) — cookie hết hạn, cần nạp lại.`);
            const msg = `Account @${accountUsername} gặp login wall (${block.markers.join(',')}) — phiên đã hết hạn, cần nạp lại cookie.`;
            logBlockReasonOnce(`login:${accountId}`, `account:${accountId}`, 'login_wall', msg);
            jobBlockReasons.push(msg);
            db.prepare(`
              UPDATE social_accounts SET status = 'die', last_checked = CURRENT_TIMESTAMP,
                     cooldown_until = datetime('now', '+20 minutes')
              WHERE id = ?
            `).run(accountId);
            pool.markExhausted(accountId);
            out.dead = true;
            out.finished = true;
            await closePage();
          } else {

          let capability = capabilityCache[targetIdx];
          if (!capability) {
            capability = await probeTargetCapability(page, currentTarget.cleanUrl, currentTarget.type);
            capabilityCache[targetIdx] = capability;
            console.log(`[FB Scraper] 🔎 Target [${targetIdx + 1}] capability: ${capability.recommendation} — ${capability.notice}`);
          }
          const refinedBudget = budgetByType[capability.recommendation];
          if (refinedBudget) sessionRequestBudget.remaining = refinedBudget;

          const viewerAccountId = await getViewerAccountId(browserContext);
          const remaining = () => Math.min(sessionQuota - out.leads, maxLimit - scrapedCount);

          if (task.channel === 'group') {
            // ── KÊNH GROUP: mbasic members (resume phân trang) + DOM gap-fill 1 lần ──
            if (viewerAccountId) {
              const mbasicPage = await newMbasicPage(browserContext);
              try {
                const res = await scrapeGroupMembersViaMbasic(
                  mbasicPage, currentTarget.cleanUrl, sessionQuota, saveLeadBatch,
                  sessionRequestBudget, cursorsByTarget[targetIdx], cancelSignal
                );
                out.leads += res.added;
                if (res.nextUrl) {
                  setCursorForTarget(targetIdx, res.nextUrl);
                } else {
                  cursorsByTarget[targetIdx] = null;
                }
                console.log(`[FB Scraper] Account #${accountId} mbasic group: +${res.added} leads (dừng: ${res.stopReason}${res.markers.length ? `, dấu hiệu: ${res.markers.join(',')}` : ''}).`);

                // Phân loại theo PHẠM VI nguyên nhân trước khi đóng kênh:
                //  - 'exhausted'/'empty': thuộc về TARGET (ai chạy cũng vậy) → đóng kênh.
                //  - 'blocked'/'not_member': thuộc về ACCOUNT này → KHÔNG đóng kênh,
                //    để account khác (đã vào nhóm / session sạch) thử tiếp. Account
                //    hỏng tự bị loại bởi circuit breaker 2 chain 0 lead.
                // Đóng kênh sai ở đây sẽ khiến nhóm không ai cào được chỉ vì 1 nick lỗi.
                if (res.stopReason === 'exhausted' || res.stopReason === 'empty') {
                  out.finished = true;
                  board.markFinished(targetIdx, 'group');
                }
                if (res.stopReason === 'blocked') {
                  const reason = `Nhóm ${currentTarget.identifier}: account @${accountUsername} nhận tường chặn từ FB (${res.markers.join(',') || 'login/checkpoint'}) — loại account này khỏi job, account khác thử tiếp.`;
                  jobBlockReasons.push(reason);
                  logBlockReasonOnce(`blocked:${targetIdx}:${accountId}`, currentTarget.identifier, 'group_blocked', reason);
                  pool.markExhausted(accountId);
                } else if (res.stopReason === 'not_member') {
                  const reason = `Nhóm ${currentTarget.identifier}: account @${accountUsername} chưa tham gia nhóm nên FB không hiện danh sách thành viên — cần cho account vào nhóm rồi chạy lại.`;
                  jobBlockReasons.push(reason);
                  logBlockReasonOnce(`not_member:${targetIdx}:${accountId}`, currentTarget.identifier, 'group_not_member', reason);
                } else if (res.stopReason === 'empty') {
                  jobBlockReasons.push(`Nhóm ${currentTarget.identifier}: đi hết danh sách nhưng không thấy thành viên nào (nhóm ẩn/rỗng).`);
                }
              } finally {
                await mbasicPage.close().catch(() => {});
              }
            }
            if (!cancelSignal.cancelled && remaining() > 0 && !groupDomDone[targetIdx] && !out.finished) {
              groupDomDone[targetIdx] = true;
              const domLeads = await extractGroupMembersFromDOM(page, currentTarget.cleanUrl, saveLeadBatch, remaining(), cancelSignal);
              out.leads += domLeads;
              if (domLeads === 0) {
                // Tới đây phiên ĐÃ được xác nhận đăng nhập (đã qua cổng cookie c_user),
                // nên thông báo nói rõ điều đó và nêu nguyên nhân còn lại thay vì đoán mò.
                const reason = `Nhóm ${currentTarget.identifier}: account @${accountUsername} đã đăng nhập nhưng không đọc được thành viên nào (engine mbasic + DOM www) — khả năng cao account chưa là thành viên nhóm, hoặc nhóm giới hạn xem danh sách thành viên. Hãy cho account vào nhóm rồi chạy lại.`;
                jobBlockReasons.push(reason);
                logBlockReasonOnce(`dom_empty:${targetIdx}`, currentTarget.identifier, 'group_dom_empty', reason);
              }
            }
          } else if (task.channel === 'post') {
            // ── KÊNH POST: engagement DOM + reaction sâu + commenters ──
            out.leads += await extractTimelineEngagement(page, currentTarget.cleanUrl, saveLeadBatch, sessionQuota, cancelSignal);
            const postId = extractPostIdFromUrl(currentTarget.cleanUrl);
            if (postId && viewerAccountId && remaining() > 0 && !cancelSignal.cancelled) {
              const mbasicPage = await newMbasicPage(browserContext);
              try {
                out.leads += await scrapeMbasicReactionsForPost(mbasicPage, postId, viewerAccountId, Math.min(remaining(), maxLimit - scrapedCount), saveLeadBatch, sessionRequestBudget);
                if (remaining() > 0 && sessionRequestBudget.remaining > 0) {
                  out.leads += await scrapeMbasicCommentersForPost(mbasicPage, postId, Math.min(remaining(), maxLimit - scrapedCount), saveLeadBatch, sessionRequestBudget);
                }
              } finally {
                await mbasicPage.close().catch(() => {});
              }
            }
            out.finished = true;
          } else if (task.channel === 'friends') {
            // ── KÊNH FRIENDS: bạn bè công khai (một lần/target) ──
            const friendsUrl = `${currentTarget.cleanUrl.replace(/\/$/, '')}/friends`;
            out.leads += await extractPeopleListFromDOM(page, friendsUrl, 'friend', saveLeadBatch, remaining(), cancelSignal);
            out.finished = true;
          } else if (task.channel === 'cursor') {
            // ── KÊNH CURSOR: followers GraphQL (passive + active replay) ──
            if (!capability.followerListPublic || !viewerAccountId) {
              out.finished = true;
              console.log(`[FB Scraper] Kênh cursor target [${targetIdx + 1}]: follower list không công khai — đóng kênh, engager lo phần còn lại.`);
            } else {
              const followersUrl = `${currentTarget.cleanUrl.replace(/\/$/, '')}/followers`;
              const capture = createFollowerCapture();
              const detachWithCapture = attachFacebookGraphQLInterceptor(page, saveLeadBatch, capture);
              try {
                console.log(`[FB Scraper] 🎯 Account #${accountId} mở /followers để capture query template...`);
                await page.goto(followersUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
                await page.waitForTimeout(2500);
                await dismissFacebookDialogs(page);

                if (!targetFollowerCount) {
                  const headerText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
                  const fc = extractFollowerCountFromText(headerText || '');
                  if (fc) {
                    targetFollowerCount = fc;
                    db.prepare(`UPDATE scrape_jobs SET target_follower_count = ?, target_follower_name = ? WHERE id = ?`).run(fc, currentTarget.identifier, jobId);
                    console.log(`[FB Scraper] 📊 Target có ~${fc.toLocaleString('vi-VN')} followers — theo dõi độ phủ trên UI.`);
                  }
                }

                for (let i = 0; i < 7 && (!capture.endpoint || !capture.cursor) && !cancelSignal.cancelled; i++) {
                  await page.waitForTimeout(2000);
                  if (!capture.endpoint || !capture.cursor) {
                    await page.evaluate(() => {
                      window.scrollBy(0, 600 + Math.floor(Math.random() * 300));
                      const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], a[role="button"], button'));
                      for (const btn of buttons) {
                        const txt = (btn.textContent || '').toLowerCase().trim();
                        if (txt === 'xem thêm' || txt === 'see more' || txt === 'tải thêm' || txt.includes('hiển thị thêm')) {
                          (btn as HTMLElement).click();
                          break;
                        }
                      }
                    }).catch(() => {});
                  }
                }

                if (!capture.endpoint) {
                  console.log(`[FB Scraper] ⚠️ Không capture được follower query — DOM gap-fill một lần rồi đóng kênh.`);
                  if (remaining() > 0) {
                    out.leads += await extractPeopleListFromDOM(page, followersUrl, 'follower', saveLeadBatch, remaining(), cancelSignal);
                  }
                  out.finished = true;
                } else {
                  const targetStartCount = scrapedCount;
                  const cursorToResume = cursorsByTarget[targetIdx] || capture.cursor;
                  const replayFrom = async (cursor: string): Promise<void> => {
                    const followerBudget = { remaining: Math.min(600, sessionRequestBudget.remaining), onSpend: sessionRequestBudget.onSpend };
                    const result = await harvestFollowersByCursor(
                      page, capture, cursor, saveLeadBatch,
                      remaining(), cancelSignal, followerBudget,
                      (_n: number, cur: string | null) => {
                        if (cur) setCursorForTarget(targetIdx, cur);
                      },
                      pacingByAccount.get(accountId)?.pacingMs
                    );
                    out.leads += result.newLeads;
                    sessionHttp500 += result.http500;
                    if (result.ended === 'throttled') out.throttled = true;
                    // Tầng 2: dừng chủ động = còn việc, KHÔNG phải bị chặn
                    if (result.ended === 'chain-limit') out.chainLimited = true;
                    if (result.first500AtRequest > 0 && out.first500AtRequest === 0) out.first500AtRequest = result.first500AtRequest;
                    if (result.nextCursor) setCursorForTarget(targetIdx, result.nextCursor);
                    else cursorsByTarget[targetIdx] = null;
                    console.log(`[FB Scraper] ⚡ Cursor replay: +${result.newLeads} leads (kết thúc: ${result.ended}, 500s: ${result.http500}).`);
                  };

                  if (cursorToResume) {
                    // Cursor chia sẻ tồn tại → replay thẳng, bỏ qua cuộn trùng đầu trang
                    await replayFrom(cursorToResume);
                  } else {
                    const passiveResult = await harvestFollowersPassive(
                      page, capture,
                      () => Math.max(0, scrapedCount - targetStartCount),
                      remaining(), cancelSignal,
                      { scrollWaitMs: 4500, requestBudget: sessionRequestBudget, onProgress: (_total, cur) => {
                          if (cur) setCursorForTarget(targetIdx, cur);
                        } }
                    );
                    const passiveDelta = Math.max(0, scrapedCount - targetStartCount);
                    out.leads += passiveDelta;
                    console.log(`[FB Scraper] 🌿 Passive Scroll: +${passiveDelta} leads (kết thúc: ${passiveResult.ended}).`);
                    if (!cancelSignal.cancelled && remaining() > 0 && cursorsByTarget[targetIdx] && (!passiveResult || passiveResult.ended === 'stagnant' || passiveResult.ended === 'done')) {
                      await replayFrom(cursorsByTarget[targetIdx]!);
                    }
                  }
                  // Phân biệt "hết danh sách" vs "chạm quota": engine trả 'done' cho CẢ HAI
                  // (loop thoát vì đủ maxLeads cũng là 'done'). Chỉ đóng kênh khi còn quota
                  // mà danh sách đã hết; chạm quota thì giữ cursor cho chain kế tiếp.
                  const hitQuota = remaining() <= 0;
                  // chain-limit KHÔNG đóng kênh: cursor còn giá trị, chain sau resume tiếp.
                  if (!hitQuota && !out.throttled && !out.chainLimited && !cancelSignal.cancelled) {
                    cursorsByTarget[targetIdx] = null;
                    out.finished = true;
                  }
                }
              } finally {
                detachWithCapture();
              }
            }
          } else {
            // ── KÊNH ENGAGER: reaction + commenters chia queue, discovery single-flight ──
            if (!viewerAccountId) {
              out.finished = true;
            } else {
              const mbasicPage = await newMbasicPage(browserContext);
              try {
                if (task.doDiscovery) {
                  const maxPosts = capability.recommendation === 'engager_only'
                    ? Math.max(150, Math.min(600, Math.ceil((maxLimit - scrapedCount) / 10)))
                    : Math.max(20, Math.min(40, Math.ceil(maxLimit / 50)));
                  const ids = await discoverMbasicPostIds(mbasicPage, currentTarget.cleanUrl, maxPosts, saveLeadBatch, sessionRequestBudget);
                  board.enqueuePosts(targetIdx, ids);
                  board.markDiscoveryDone(targetIdx);
                  console.log(`[FB Scraper] 🔍 Discovery target [${targetIdx + 1}]: ${ids.length} bài vào queue chia pool.`);
                }

                let shardLeads = 0;
                while (remaining() > 0 && !cancelSignal.cancelled && sessionRequestBudget.remaining > 0) {
                  const postId = board.popPost(targetIdx);
                  if (!postId) break;
                  const quota = Math.min(remaining(), maxLimit - scrapedCount);
                  shardLeads += await scrapeMbasicReactionsForPost(mbasicPage, postId, viewerAccountId, quota, saveLeadBatch, sessionRequestBudget);
                  if (remaining() > 0 && sessionRequestBudget.remaining > 0 && !cancelSignal.cancelled) {
                    shardLeads += await scrapeMbasicCommentersForPost(mbasicPage, postId, Math.min(remaining(), maxLimit - scrapedCount), saveLeadBatch, sessionRequestBudget);
                  }
                  board.notePostDrained(targetIdx);
                }
                out.leads += shardLeads;
                console.log(`[FB Scraper] Account #${accountId} engager shard: +${shardLeads} leads.`);
              } finally {
                await mbasicPage.close().catch(() => {});
              }

              // Gap-fill DOM 1 lần khi timeline riêng tư (SĐT + comment) — nguồn phụ
              if (capability.recommendation === 'engager_only' && remaining() > 0 && !engagerDomDone[targetIdx] && !cancelSignal.cancelled) {
                engagerDomDone[targetIdx] = true;
                out.leads += await extractTimelineEngagement(page, currentTarget.cleanUrl, saveLeadBatch, remaining(), cancelSignal);
              }
            }
          }

            await closePage();
          }
        }
      } catch (sessionErr: unknown) {
        const sessionMsg = sessionErr instanceof Error ? sessionErr.message : String(sessionErr);
        console.error(`[FB Scraper] Session error Account #${accountId}:`, sessionMsg);
      } finally {
        // Chốt số đo TRƯỚC khi ghi telemetry: trước đây durationMs được gán SAU khối
        // finally nên mọi bản ghi đều có duration_ms = 0 (leads/giờ luôn không tính được).
        out.requests = sessionRequestsUsed;
        out.http500 = sessionHttp500;
        out.durationMs = Date.now() - chainStartedAt;
        try {
          db.prepare(`
            INSERT INTO scrape_telemetry (job_id, account_id, engine, requests, leads_new, throttle_events, http_500, duration_ms, first_500_at_request)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
          `).run(
            jobId, accountId, `chain_${task.channel}`,
            out.requests || 0, out.leads || 0, out.http500 || 0,
            out.durationMs || 0, out.first500AtRequest || 0
          );
        } catch (telErr: unknown) {
          console.warn(`[FB Scraper] Telemetry insert lỗi:`, telErr instanceof Error ? telErr.message : telErr);
        }
        // Tầng 2 — đếm phiên THÀNH CÔNG (có lead, không bị chặn) để mở khoá warm-up.
        // Chỉ tính khi account thực sự thu được lead, tránh "warm-up" bằng phiên rỗng.
        if (!out.dead && !out.throttled && out.leads > 0) {
          try {
            db.prepare(`UPDATE social_accounts SET warmup_sessions = COALESCE(warmup_sessions, 0) + 1 WHERE id = ?`).run(accountId);
          } catch { /* không chặn job vì lỗi đếm */ }
        }

        // Giải phóng IP trong finally — kể cả khi session lỗi, IP phải trả lại pool.
        ipRegistry.release(sessionLease.ipKey);
        if (browserContext) {
          try { await browserContext.close(); } catch {}
        }
      }
      return out;
    };

    /**
     * Worker: ĐÚNG 1 worker / account cho cả job (không spawn trùng — bug P1).
     * Vòng: chờ hết cooldown → lấy slot → claim task kênh → chạy chain → nhả.
     */
    const runAccountWorker = async (accountId: number): Promise<void> => {
      let pass = 1;
      // Tầng 2 — trạng thái warm-up chỉ đọc lại khi cần (sau mỗi chain có lead).
      let warmupSessions = (db.prepare(`SELECT COALESCE(warmup_sessions,0) AS n FROM social_accounts WHERE id = ?`).get(accountId) as { n: number } | undefined)?.n ?? 0;
      while (!cancelSignal.cancelled && scrapedCount < maxLimit && !pool.get(accountId)!.exhausted) {
        const waitMs = pool.cooldownRemaining(accountId, Date.now());
        if (waitMs > 0) {
          await sleep(Math.min(waitMs + 250, 30_000));
          continue;
        }

        const releaseSlot = await slots.acquire();
        const task = board.claim(accountId);
        if (!task) {
          releaseSlot();
          if (board.isExhausted(accountId)) break;
          await sleep(3000 + Math.floor(Math.random() * 2000));
          continue;
        }

        let outcome: AccountChainOutcome | null = null;
        try {
          const isWarmup = warmupSessions < WARMUP_SESSIONS_REQUIRED;
          console.log(`[FB Scraper] 🔄 Account #${accountId} chain ${pass} → target [${task.targetIdx + 1}/${targetList.length}] kênh [${task.channel}]${isWarmup ? ` (warm-up ${warmupSessions}/${WARMUP_SESSIONS_REQUIRED})` : ''}.`);
          outcome = await runChain(accountId, task, pass, isWarmup);
          // Cập nhật lại bộ đếm sau chain (runChain đã tăng khi thu được lead)
          if (outcome.leads > 0 && !outcome.dead) warmupSessions++;
          if (outcome.finished) board.markFinished(task.targetIdx, task.channel);
        } finally {
          board.release(task, accountId);
          releaseSlot();
        }

        // TẦNG 1 — không giành được IP: KHÔNG phải lỗi của account. Nhường slot, thử
        // lại sau vài giây, và tuyệt đối không tính vào chuỗi 0-lead (tránh loại oan
        // account chỉ vì IP đang bận do account khác dùng chung).
        if (outcome?.ipUnavailable) {
          await sleep(3000 + Math.floor(Math.random() * 4000));
          continue;
        }

        const chainLeads = outcome?.leads ?? 0;
        if (pool.get(accountId)!.exhausted) break;
        if (outcome?.throttled) {
          const throttleCount = (db.prepare(`
            SELECT COUNT(*) as n FROM scrape_telemetry
            WHERE account_id = ? AND http_500 > 0
              AND created_at > datetime('now', '-24 hours')
          `).get(accountId) as { n: number } | undefined)?.n || 0;
          const cooldownMin = throttleCount >= 1 ? 120 : 30;
          db.prepare(`UPDATE social_accounts SET cooldown_until = datetime('now', '+' || ? || ' minutes') WHERE id = ?`).run(cooldownMin, accountId);
          console.warn(`[FB Scraper] Account #${accountId} throttle (lần ${throttleCount + 1}/24h) — cooldown ${cooldownMin} phút, cursor đã giữ.`);
        }

        // P5 — cooldown nền lấy từ telemetry (nếu có), đè bởi luật cứng khi chain
        // rỗng/quota cạn; throttle luôn dùng cooldown ngắn để nhường slot.
        const tunedCooldown = pacingByAccount.get(accountId)?.cooldownMs;
        // Tầng 2 — chain dừng chủ động vì chạm trần chuỗi: account vẫn khoẻ, chỉ cần
        // nhường slot cho session khác rồi quay lại với IP/chuỗi mới. Nghỉ ngắn.
        const cooldownMs = outcome?.chainLimited
          ? 20_000
          : warmupSessions < WARMUP_SESSIONS_REQUIRED
            ? 15 * 60_000 // warm-up: nghỉ dài để hạ độ nóng của account mới
            : outcome?.throttled
              ? 2 * 60_000
              : chainLeads === 0
                ? 5 * 60_000
                : chainLeads >= maxPerAccountQuota
                  ? (tunedCooldown ?? 10 * 60_000)
                  : 60_000;
        pool.noteChainDone(accountId, { now: Date.now(), cooldownMs, unproductive: chainLeads === 0, maxUnproductive: 2 });
        pass++;
        console.log(`[FB Scraper] ⏳ Account #${accountId} chain [${task.channel}] xong (+${chainLeads} leads) — nghỉ ${Math.round(cooldownMs / 1000)}s.`);
      }
    };

    // ── Spawn 1 worker/account; slot semaphore điều tiết browser song song ──
    try {
      const workers = accountQueue.map(id =>
        runAccountWorker(id).catch(err => {
          console.error(`[FB Scraper] Worker Account #${id} crashed:`, err instanceof Error ? err.message : err);
          pool.markExhausted(id);
        })
      );
      await Promise.allSettled(workers);
    } catch (error: unknown) {
      const fatalMsg = error instanceof Error ? error.message : String(error);
      console.error(`[FB Scraper] Fatal error executing job #${jobId}:`, fatalMsg);
      db.prepare(`UPDATE scrape_jobs SET status = 'failed', error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        fatalMsg || 'Lỗi không xác định trong quá trình cào dữ liệu.',
        jobId
      );
      return;
    } finally {
      activeJobSignals.delete(jobId);
    }

    const actualTotal = (db.prepare(`SELECT count(*) as count FROM scraped_job_leads WHERE job_id = ?`).get(jobId) as { count: number } | undefined)?.count || scrapedCount;
    // 0 lead LUÔN là failed kèm lý do cụ thể — "✓ COMPLETED 0" từng khiến job #48
    // trông như thành công trong khi thực chất kênh bị chặn suốt phiên.
    const finalStatus = cancelSignal.cancelled
      ? 'stopped'
      : actualTotal === 0
        ? 'failed'
        : 'completed';
    if (finalStatus === 'failed') {
      let reason: string;
      if (jobBlockReasons.length > 0) {
        reason = Array.from(new Set(jobBlockReasons)).join(' ');
      } else if (rawCandidates > 0) {
        reason = `Đã thấy ${rawCandidates} ứng viên nhưng TẤT CẢ đều trùng lead đã có (INSERT bị dedup). Target có thể đã cào trước đó — dùng target khác hoặc xoá bớt lead cũ nếu muốn cào lại.`;
      } else if (!pool.isAlive()) {
        reason = `Toàn bộ ${pool.exhaustedCount()} account trong pool bị loại (checkpoint / cookie die / 0 lead liên tiếp) — không thu được lead nào. Kiểm tra account, proxy rồi chạy lại.`;
      } else {
        reason = 'Job kết thúc mà không thu được lead nào và không thấy ứng viên nào — kiểm tra lại target/quyền truy cập của account.';
      }
      db.prepare(`UPDATE scrape_jobs SET error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(reason, jobId);
    }
    db.prepare(`UPDATE scrape_jobs SET status = ?, total_count = ?, scraped_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      finalStatus,
      actualTotal,
      actualTotal,
      jobId
    );
    console.log(`[FB Scraper] Job #${jobId} finished! Total leads: ${actualTotal} (Phones: ${phoneCount}). Status: ${finalStatus}`);
    if (finalStatus === 'failed') {
      const jobRow = db.prepare(`SELECT error_msg FROM scrape_jobs WHERE id = ?`).get(jobId) as { error_msg: string | null } | undefined;
      sendDesktopNotification(
        'Cào dữ liệu Facebook không thu được lead ⚠️',
        (jobRow?.error_msg || `Job #${jobId} kết thúc với 0 lead.`).slice(0, 300)
      );
    } else {
      sendDesktopNotification(
        'Hoàn tất cào dữ liệu Facebook 🎯',
        `Job #${jobId} đã thu thập thành công ${actualTotal} leads (${phoneCount} số điện thoại).`
      );
    }
  });
}
