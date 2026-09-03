/**
 * Account Sharding & Session Rotation Pool for High-Scale Scraping
 */

export interface ScraperAccountSession {
  id: number;
  platform: string;
  username: string;
  password?: string;
  email?: string;
  user_data_dir: string;
  auth_token?: string;
  proxy?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    protocol?: string;
  };
  cool_down_until?: number;
}

export class AccountPoolManager {
  private coolDownMap: Map<number, number> = new Map(); // AccountID -> Timestamp

  constructor() {}

  /**
   * Fetch all live accounts for a given platform and workspace
   */
  public async getAvailableAccounts(
    db: any, 
    platform: string, 
    workspace_id: number
  ): Promise<ScraperAccountSession[]> {
    const queryPlatform = platform === 'messenger' ? 'facebook' : platform;
    const now = Date.now();

    const accounts = await db`
      SELECT social_accounts.*, 
             proxies.host, proxies.port, proxies.username as proxy_user, proxies.password as proxy_pass, proxies.protocol as proxy_proto
      FROM social_accounts 
      LEFT JOIN proxies ON social_accounts.proxy_id = proxies.id
      WHERE social_accounts.platform = ${queryPlatform} 
        AND social_accounts.status = 'live' 
        AND social_accounts.workspace_id = ${workspace_id}
      ORDER BY social_accounts.id ASC
    ` as any[];

    const result: ScraperAccountSession[] = [];
    for (const acc of accounts) {
      const coolDownUntil = this.coolDownMap.get(acc.id) || 0;
      if (coolDownUntil > now) {
        continue; // Account is currently in cool-down
      }

      result.push({
        id: acc.id,
        platform: acc.platform,
        username: acc.username,
        password: acc.password,
        email: acc.email,
        user_data_dir: acc.user_data_dir,
        auth_token: acc.auth_token,
        proxy: acc.host ? {
          host: acc.host,
          port: acc.port,
          username: acc.proxy_user,
          password: acc.proxy_pass,
          protocol: acc.proxy_proto
        } : undefined
      });
    }

    return result;
  }

  /**
   * Mark an account as rate-limited, placing it on cool-down for N seconds
   */
  public markRateLimited(accountId: number, coolDownSeconds = 900): void {
    const until = Date.now() + coolDownSeconds * 1000;
    this.coolDownMap.set(accountId, until);
    console.log(`[AccountPool] Account #${accountId} rate-limited. Placed on cool-down for ${coolDownSeconds}s.`);
  }

  /**
   * Save pagination state so another account can resume from last_cursor
   */
  public async saveCursorState(
    db: any,
    jobId: number,
    cursor: string | null,
    scrapedCount: number
  ): Promise<void> {
    try {
      await db`
        UPDATE scrape_jobs 
        SET last_cursor = ${cursor}, 
            scraped_count = ${scrapedCount}, 
            updated_at = NOW() 
        WHERE id = ${jobId}
      `;
    } catch (e: any) {
      console.error(`[AccountPool] Failed to save cursor state for job #${jobId}:`, e.message);
    }
  }
}

export const accountPool = new AccountPoolManager();
