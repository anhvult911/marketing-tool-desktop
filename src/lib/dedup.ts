/**
 * Fast Memory Deduplication & Batch Inserter for Scraper Leads
 */

export interface ScrapedLead {
  platform: string;
  lead_value: string; // Username, User ID, or Phone/Link
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  followers_count?: number;
  metadata?: Record<string, any>;
  workspace_id: number;
  source_target?: string;
}

export class LeadDeduplicator {
  private seenKeys: Set<string> = new Set();

  constructor() {}

  /**
   * Filter out leads that have already been seen in this session
   */
  public filterUnique(leads: ScrapedLead[]): ScrapedLead[] {
    const uniqueList: ScrapedLead[] = [];
    for (const lead of leads) {
      const key = `${lead.platform.toLowerCase()}:${lead.lead_value.toLowerCase()}`;
      if (!this.seenKeys.has(key)) {
        this.seenKeys.add(key);
        uniqueList.push(lead);
      }
    }
    return uniqueList;
  }

  /**
   * Bulk insert leads into the database using batching & ON CONFLICT IGNORE
   */
  public async batchInsertLeads(db: any, leads: ScrapedLead[], batchSize = 500): Promise<number> {
    if (!leads || leads.length === 0) return 0;
    
    const uniqueLeads = this.filterUnique(leads);
    if (uniqueLeads.length === 0) return 0;

    let insertedCount = 0;

    for (let i = 0; i < uniqueLeads.length; i += batchSize) {
      const batch = uniqueLeads.slice(i, i + batchSize);
      try {
        // Bulk insert query compatible with postgres / sqlite
        for (const item of batch) {
          try {
            await db`
              INSERT INTO spam_leads (
                platform, lead_type, lead_value, display_name, avatar_url, bio, followers_count, workspace_id, source_target, status
              ) VALUES (
                ${item.platform}, 
                'user', 
                ${item.lead_value}, 
                ${item.display_name || null}, 
                ${item.avatar_url || null}, 
                ${item.bio || null}, 
                ${item.followers_count || 0}, 
                ${item.workspace_id}, 
                ${item.source_target || null}, 
                'pending'
              )
              ON CONFLICT DO NOTHING
            `;
            insertedCount++;
          } catch (itemErr: any) {
            // Ignore duplicate key or conflict errors
          }
        }
      } catch (err: any) {
        console.error('[Deduplicator] Batch insert error:', err.message);
      }
    }

    return insertedCount;
  }

  public getSeenCount(): number {
    return this.seenKeys.size;
  }

  public clear(): void {
    this.seenKeys.clear();
  }
}
