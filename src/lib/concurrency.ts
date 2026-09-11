/**
 * Bộ điều tiết số lượng trình duyệt Chromium chạy đồng thời (Concurrency Limiter)
 * Tránh trường hợp mở cùng lúc quá nhiều browser ngốn RAM / CPU làm treo máy
 */
export class ConcurrencyLimiter {
  private maxConcurrency: number;
  private activeCount: number = 0;
  private queue: Array<() => void> = [];

  constructor(maxConcurrency: number = 2) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  public setMaxConcurrency(n: number) {
    this.maxConcurrency = Math.max(1, n);
  }

  public getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  public async acquire(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.activeCount--;
        const next = this.queue.shift();
        if (next) {
          this.activeCount++;
          next();
        }
      };
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.activeCount--;
          const next = this.queue.shift();
          if (next) {
            this.activeCount++;
            next();
          }
        });
      });
    });
  }

  public async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  public getStats() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      max: this.maxConcurrency,
    };
  }
}

// Mặc định cho phép tối đa 2 trình duyệt Playwright chạy đồng thời
export const browserLimiter = new ConcurrencyLimiter(2);
// Scrape jobs chạy dài (10-60 phút) — tách limiter riêng để không đói job post/comment
// vốn cần slot browser nhanh. 2 scrape + 2 automation song song.
export const scrapeLimiter = new ConcurrencyLimiter(2);
export default browserLimiter;
