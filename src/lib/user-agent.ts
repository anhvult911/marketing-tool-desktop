/**
 * User-Agent nhất quán toàn hệ thống.
 *
 * Nguyên tắc: KHÔNG tự chế chuỗi UA — dùng UA thật của trình duyệt sẽ chạy.
 * Lý do: FB so UA claim với dấu hiệu trình duyệt thật (JS engine, features,
 * sec-ch-ua do Chrome tự gắn). UA lệch version binary là detection vector.
 * Headless Chrome còn tự gắn token "HeadlessChrome" trong UA — gỡ bằng cách
 * set UA thật (khớp version binary) cho context.
 *
 * Quan trọng: UA phải khớp BINARY THẬT được dùng cuối cùng. Do fallback chain
 * (Chromium bundled -> msedge -> chrome) có thể đổi binary, hàm này đo UA bằng
 * chính chuỗi đó: lần lượt thử launch đúng như browser-launcher sẽ làm.
 */
import { chromium } from 'playwright';
import { detectBrowserChannel } from './browser-launcher';

let cachedUA: string | null = null;

const FALLBACK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

const uaFromBrowser = async (channel?: string): Promise<string> => {
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  const rawUA = await page.evaluate(() => navigator.userAgent);
  await browser.close();
  // Chỉ thay token "HeadlessChrome" -> "Chrome": phần còn lại (version/engine/
  // platform) là thật của binary, không chế thêm gì.
  return rawUA.replace('HeadlessChrome', 'Chrome');
};

/**
 * UA thật đã gỡ token HeadlessChrome của trình duyệt mà hệ thống sẽ launch.
 * Memoized 1 lần — thử đúng thứ tự fallback của browser-launcher để UA đo
 * được là UA của binary thực sự chạy.
 */
export async function getRealUserAgent(): Promise<string> {
  if (cachedUA) return cachedUA;
  // Thử lần lượt giống launchRobustBrowser: channel phát hiện được -> thử trước;
  // fail -> Edge -> Chrome; cả ba fail -> fallback tĩnh.
  const detected = detectBrowserChannel();
  const attempts: Array<string | undefined> = detected ? [detected, 'msedge', 'chrome'] : [undefined, 'msedge', 'chrome'];
  for (const channel of attempts) {
    try {
      cachedUA = await uaFromBrowser(channel);
      return cachedUA;
    } catch {
      // Binary này không launch được — thử kênh kế trong fallback chain
    }
  }
  cachedUA = FALLBACK_UA;
  return cachedUA;
}

/**
 * UA đồng bộ — trả cache nếu đã populate (getRealUserAgent chạy lúc init),
 * ngược lại fallback tĩnh. Dùng ở nơi không await được.
 */
export function getRealUserAgentSync(): string {
  return cachedUA || FALLBACK_UA;
}
