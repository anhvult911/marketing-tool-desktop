import { chromium, BrowserContext, Browser } from 'playwright';
import fs from 'fs';
import path from 'path';
import { repairProfileForLaunch, isStartupCrashError } from './profile-lock';

/**
 * Tự động phát hiện trình duyệt khả dụng trên Windows
 * Ưu tiên:
 * 1. Playwright Bundled Chromium (nếu đã cài)
 * 2. Microsoft Edge hệ thống (channel: 'msedge' - có sẵn 100% trên Win 10/11)
 * 3. Google Chrome hệ thống (channel: 'chrome')
 */
export function detectBrowserChannel(): string | undefined {
  if (process.platform !== 'win32') return undefined;

  // 1. Kiểm tra Playwright Chromium cục bộ (2 layout: chrome-win cũ, chrome-win64 mới)
  const localAppData = process.env.LOCALAPPDATA || '';
  const playwrightDir = path.join(localAppData, 'ms-playwright');
  if (fs.existsSync(playwrightDir)) {
    try {
      const items = fs.readdirSync(playwrightDir);
      const hasChromium = items.some((item) => {
        if (!item.startsWith('chromium-')) return false;
        return (
          fs.existsSync(path.join(playwrightDir, item, 'chrome-win', 'chrome.exe')) ||
          fs.existsSync(path.join(playwrightDir, item, 'chrome-win64', 'chrome.exe'))
        );
      });
      if (hasChromium) {
        return undefined; // Đã có Playwright Chromium, sử dụng mặc định
      }
    } catch {}
  }

  // 2. Fallback: Microsoft Edge (có sẵn 100% trên Windows 10 & 11)
  const edgePaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  if (edgePaths.some((p) => fs.existsSync(p))) {
    return 'msedge';
  }

  // 3. Fallback: Google Chrome
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  if (chromePaths.some((p) => fs.existsSync(p))) {
    return 'chrome';
  }

  return undefined;
}

/**
 * Khởi chạy Browser Persistent Context với cơ chế tự phục hồi:
 * Nếu nhân mặc định không tồn tại -> Tự động fallback sang Microsoft Edge -> Google Chrome
 */
export async function launchRobustPersistentContext(
  userDataDir: string,
  launchOpts: any = {}
): Promise<BrowserContext> {
  const detectedChannel = detectBrowserChannel();
  const optsWithChannel = { ...launchOpts };

  if (detectedChannel && !optsWithChannel.channel) {
    optsWithChannel.channel = detectedChannel;
  }

  try {
    return await chromium.launchPersistentContext(userDataDir, optsWithChannel);
  } catch (err: any) {
    // Startup-crash (Chrome update major, crashpad mismatch, "Target ... closed"):
    // repair profile rồi THỬ LẠI CÙNG CHANNEL. Phải xét TRƯỚC channel-flip vì
    // prefix 'browserType.launchPersistentContext' có trong MỌI lỗi launch —
    // nếu lọc executability trước sẽ nuốt nhầm crash này thành channel-flip
    // (đổi Chrome 153 mở profile Edge 152 = tiếp tục crash-mismatch).
    if (isStartupCrashError(err)) {
      console.warn(`[BrowserLauncher] Browser crashed at startup — repairing profile (lockfile + Crashpad) rồi thử lại cùng channel...`);
      repairProfileForLaunch(userDataDir);
      return await chromium.launchPersistentContext(userDataDir, optsWithChannel);
    }

    // Chỉ flip channel khi THẬT SỰ thiếu executable (lỗi cài đặt, không phải crash).
    const isMissingExecutable =
      err.message &&
      (err.message.includes("Executable doesn't exist") ||
       err.message.includes('playwright install'));

    if (isMissingExecutable) {
      console.warn(`[BrowserLauncher] Trình duyệt mặc định không tìm thấy. Thử khởi chạy với Microsoft Edge...`);
      try {
        return await chromium.launchPersistentContext(userDataDir, {
          ...launchOpts,
          channel: 'msedge'
        });
      } catch (edgeErr: any) {
        // Edge cũng crash startup → repair profile rồi thử lại 1 lần với Edge
        if (isStartupCrashError(edgeErr)) {
          console.warn(`[BrowserLauncher] Edge crash at startup — repairing profile rồi thử lại...`);
          repairProfileForLaunch(userDataDir);
          return await chromium.launchPersistentContext(userDataDir, { ...launchOpts, channel: 'msedge' });
        }
        console.warn(`[BrowserLauncher] Edge không phản hồi, thử tiếp tục với Google Chrome...`);
        return await chromium.launchPersistentContext(userDataDir, {
          ...launchOpts,
          channel: 'chrome'
        });
      }
    }

    throw err;
  }
}

/**
 * Khởi chạy Browser tiêu chuẩn (non-persistent) với cơ chế tự phục hồi Edge/Chrome
 */
export async function launchRobustBrowser(launchOpts: any = {}): Promise<Browser> {
  const detectedChannel = detectBrowserChannel();
  const optsWithChannel = { ...launchOpts };

  if (detectedChannel && !optsWithChannel.channel) {
    optsWithChannel.channel = detectedChannel;
  }

  try {
    return await chromium.launch(optsWithChannel);
  } catch (err: any) {
    const isMissingExecutable = 
      err.message && 
      (err.message.includes("Executable doesn't exist") || 
       err.message.includes('playwright install') ||
       err.message.includes('browserType.launch'));

    if (isMissingExecutable) {
      console.warn(`[BrowserLauncher] Trình duyệt mặc định không tìm thấy. Thử khởi chạy với Microsoft Edge...`);
      try {
        return await chromium.launch({ ...launchOpts, channel: 'msedge' });
      } catch (edgeErr: any) {
        console.warn(`[BrowserLauncher] Edge không phản hồi, thử tiếp tục với Google Chrome...`);
        return await chromium.launch({ ...launchOpts, channel: 'chrome' });
      }
    }

    throw err;
  }
}
