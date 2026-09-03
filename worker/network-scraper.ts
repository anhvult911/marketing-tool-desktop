import { BrowserContext, Page } from 'playwright';
import { ScrapedLead } from '../src/lib/dedup';

export interface ScrapeResult {
  leads: ScrapedLead[];
  nextCursor: string | null;
  hasMore: boolean;
  isRateLimited: boolean;
}

export class NetworkScraperEngine {
  /**
   * Parse X (Twitter) GraphQL Followers JSON response
   */
  public static parseXFollowersResponse(json: any): { leads: ScrapedLead[]; nextCursor: string | null } {
    const leads: ScrapedLead[] = [];
    let nextCursor: string | null = null;

    try {
      const instructions = 
        json?.data?.user?.result?.timeline?.timeline?.instructions ||
        json?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
        [];

      for (const inst of instructions) {
        if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
          for (const entry of inst.entries) {
            // Extract Cursor
            if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
              nextCursor = entry.content?.value || entry.content?.itemContent?.value || null;
              continue;
            }

            // Extract User Item
            const userResult = entry.content?.itemContent?.user_results?.result;
            if (userResult && (userResult.__typename === 'User' || userResult.rest_id)) {
              const legacy = userResult.legacy || {};
              const userId = userResult.rest_id || legacy.screen_name;
              const screenName = legacy.screen_name;

              if (userId && screenName) {
                leads.push({
                  platform: 'x',
                  lead_value: `@${screenName}`,
                  display_name: legacy.name || screenName,
                  avatar_url: legacy.profile_image_url_https || undefined,
                  bio: legacy.description || undefined,
                  followers_count: legacy.followers_count || 0,
                  workspace_id: 1,
                  metadata: {
                    user_id: userId,
                    location: legacy.location,
                    created_at: legacy.created_at
                  }
                });
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[NetworkScraper] Error parsing X GraphQL Followers JSON:', e.message);
    }

    return { leads, nextCursor };
  }

  /**
   * Parse Facebook GraphQL Followers / Subscribers JSON response
   */
  public static parseFacebookSubscribersResponse(json: any): { leads: ScrapedLead[]; nextCursor: string | null } {
    const leads: ScrapedLead[] = [];
    let nextCursor: string | null = null;

    try {
      if (!json) return { leads, nextCursor };

      const extractFromConnection = (conn: any) => {
        if (!conn) return;
        if (conn.page_info) {
          if (conn.page_info.has_next_page && conn.page_info.end_cursor) {
            nextCursor = conn.page_info.end_cursor;
          }
        }
        const items = conn.edges || conn.nodes || [];
        for (const item of items) {
          const node = item.node || item;
          if (node && (node.id || node.url || node.profile_url)) {
            const id = (node.id || '').toString();
            if (id.startsWith('Y29tbWVud') || id.startsWith('feedback:') || id.startsWith('comment:')) continue;
            const name = (node.name || node.title?.text || '').trim();
            if (!name || name.startsWith('#') || name.includes('\n')) continue;
            const profileUrl = node.url || node.profile_url || (id ? `https://facebook.com/${id}` : '');
            const avatar = node.profile_picture?.uri || node.profile_picture_depth_0?.uri || node.profile_picture_50?.uri || node.avatar_url || undefined;
            if (profileUrl) {
              leads.push({
                platform: 'facebook',
                lead_value: profileUrl,
                display_name: name,
                avatar_url: avatar,
                workspace_id: 1,
                metadata: {
                  id: id || undefined,
                  raw_type: node.__typename
                }
              });
            }
          }
        }
      };

      // 1. Direct structures (Strictly target-related, ignoring live account's viewer structures)
      extractFromConnection(json?.data?.node?.subscribers);
      extractFromConnection(json?.data?.node?.followers);
      extractFromConnection(json?.data?.node?.page_followers);
      extractFromConnection(json?.data?.node?.page_items);
      extractFromConnection(json?.data?.user?.subscribers);
      extractFromConnection(json?.data?.user?.followers);

      // 2. Comet nested collections (ProfileCometAppCollectionListRenderer)
      const collections = json?.data?.node?.all_collections?.nodes || [];
      for (const col of collections) {
        extractFromConnection(col?.pageItems);
      }
      extractFromConnection(json?.data?.node?.pageItems);

      // 3. Fallback recursive traversal if standard structure wasn't found (excluding live account viewer namespaces)
      const skipBranches = new Set([
        'viewer', 'current_user', 'me', 'viewer_actor', 'left_rail_collections',
        'bookmarks', 'notifications', 'chat_roster', 'friend_suggestions', 'friending',
        'feed', 'news_feed', 'top_contacts', 'buddylist', 'presence', 'viewer_friends',
        'messenger', 'right_rail', 'chat', 'stories', 'feed_units', 'allactivity'
      ]);

      if (leads.length === 0 && typeof json === 'object') {
        const findEdgesRecursive = (obj: any, depth = 0) => {
          if (!obj || depth > 5) return;
          if (obj.page_info && obj.page_info.end_cursor && obj.page_info.has_next_page) {
            nextCursor = obj.page_info.end_cursor;
          }
          if (Array.isArray(obj.edges) && obj.edges.length > 0) {
            extractFromConnection(obj);
          }
          if (Array.isArray(obj.nodes) && obj.nodes.length > 0) {
            extractFromConnection(obj);
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

    } catch (e: any) {
      console.error('[NetworkScraper] Error parsing Facebook GraphQL JSON:', e.message);
    }

    return { leads, nextCursor };
  }

  /**
   * Parse Facebook Group Members GraphQL JSON response (including CometGroupMemberSearch, all_members, admin_and_moderators, etc.)
   */
  public static parseFacebookGroupMembersResponse(json: any): { leads: ScrapedLead[]; nextCursor: string | null } {
    const leads: ScrapedLead[] = [];
    let nextCursor: string | null = null;

    try {
      if (!json) return { leads, nextCursor };

      const extractFromConnection = (conn: any) => {
        if (!conn) return;
        if (conn.page_info) {
          if (conn.page_info.has_next_page && conn.page_info.end_cursor) {
            nextCursor = conn.page_info.end_cursor;
          }
        }
        const items = conn.edges || conn.nodes || [];
        for (const item of items) {
          const node = item.node || item.user || item;
          if (node && (node.id || node.url || node.profile_url)) {
            const id = (node.id || '').toString();
            if (id.startsWith('Y29tbWVud') || id.startsWith('feedback:') || id.startsWith('comment:') || id.startsWith('group:')) continue;
            
            let name = (node.name || node.title?.text || node.text || '').trim();
            if (!name && node.title && typeof node.title === 'string') name = node.title.trim();
            if (!name || name.startsWith('#') || name.includes('\n')) continue;

            const profileUrl = node.url || node.profile_url || (id ? `https://facebook.com/${id}` : '');
            const avatar = node.profile_picture?.uri || node.profile_picture_depth_0?.uri || node.profile_picture_50?.uri || node.avatar_url || undefined;
            if (profileUrl) {
              leads.push({
                platform: 'facebook',
                lead_value: profileUrl,
                display_name: name,
                avatar_url: avatar,
                workspace_id: 1,
                metadata: {
                  id: id || undefined,
                  raw_type: node.__typename
                }
              });
            }
          }
        }
      };

      // 1. Direct group member connections
      extractFromConnection(json?.data?.node?.all_members);
      extractFromConnection(json?.data?.node?.group_member_list);
      extractFromConnection(json?.data?.node?.admin_and_moderator_members);
      extractFromConnection(json?.data?.node?.members_with_things_in_common);
      extractFromConnection(json?.data?.node?.new_members);
      extractFromConnection(json?.data?.node?.friends_in_group);
      extractFromConnection(json?.data?.node?.members_with_high_activity);
      extractFromConnection(json?.data?.node?.search_results);
      extractFromConnection(json?.data?.node?.group_search_results);
      extractFromConnection(json?.data?.node?.group_members);
      extractFromConnection(json?.data?.group?.all_members);
      extractFromConnection(json?.data?.group?.members);

      // 2. Sections pagination (CometGroupMemberSearchSectionPaginationQuery)
      const sections = json?.data?.node?.sections || json?.data?.sections || [];
      if (Array.isArray(sections)) {
        for (const sec of sections) {
          extractFromConnection(sec?.items);
          extractFromConnection(sec?.member_list);
        }
      }

      // 3. Fallback recursive traversal if standard structure wasn't found
      const skipBranches = new Set([
        'viewer', 'current_user', 'me', 'viewer_actor', 'left_rail_collections',
        'bookmarks', 'notifications', 'chat_roster', 'friend_suggestions', 'friending',
        'feed', 'news_feed', 'top_contacts', 'buddylist', 'presence', 'viewer_friends',
        'messenger', 'right_rail', 'chat', 'stories', 'feed_units', 'allactivity'
      ]);

      if (leads.length === 0 && typeof json === 'object') {
        const findEdgesRecursive = (obj: any, depth = 0) => {
          if (!obj || depth > 5) return;
          if (obj.page_info && obj.page_info.end_cursor && obj.page_info.has_next_page) {
            nextCursor = obj.page_info.end_cursor;
          }
          if (Array.isArray(obj.edges) && obj.edges.length > 0) {
            extractFromConnection(obj);
          }
          if (Array.isArray(obj.nodes) && obj.nodes.length > 0) {
            extractFromConnection(obj);
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

    } catch (e: any) {
      console.error('[NetworkScraper] Error parsing Facebook Group Members GraphQL JSON:', e.message);
    }

    return { leads, nextCursor };
  }

  /**
   * Parse Facebook Post Reactions GraphQL JSON response
   */
  public static parseFacebookPostReactionsResponse(json: any): { leads: ScrapedLead[]; nextCursor: string | null } {
    const leads: ScrapedLead[] = [];
    let nextCursor: string | null = null;

    try {
      // Traverse potential Facebook GraphQL structures for reactors
      const reactorsData = 
        json?.data?.node?.reactors || 
        json?.data?.feedback?.reactors || 
        json?.data?.node?.top_reactors ||
        json?.data?.top_reactors || {};

      const pageInfo = reactorsData.page_info;
      if (pageInfo) {
        nextCursor = pageInfo.has_next_page ? pageInfo.end_cursor : null;
      }

      const edges = reactorsData.edges || reactorsData.nodes || [];
      for (const edge of edges) {
        const node = edge.node || edge;
        if (node && (node.id || node.url || node.profile_url)) {
          const id = (node.id || '').toString();
          if (id.startsWith('Y29tbWVud') || id.startsWith('feedback:') || id.startsWith('comment:')) continue;
          const name = (node.name || '').trim();
          if (!name || name.startsWith('#') || name.includes('\n')) continue;
          const profileUrl = node.url || node.profile_url || `https://facebook.com/${id}`;
          leads.push({
            platform: 'facebook',
            lead_value: profileUrl,
            display_name: name,
            avatar_url: node.profile_picture?.uri || node.profile_picture_50?.uri || undefined,
            workspace_id: 1,
            metadata: {
              id: id,
              reaction_type: edge.reaction_type || node.reaction_type || 'LIKE'
            }
          });
        }
      }
    } catch (e: any) {
      console.error('[NetworkScraper] Error parsing Facebook Post Reactions JSON:', e.message);
    }

    return { leads, nextCursor };
  }

  /**
   * Parse Facebook Post Comments GraphQL JSON response
   */
  public static parseFacebookPostCommentsResponse(json: any): { leads: ScrapedLead[]; nextCursor: string | null } {
    const leads: ScrapedLead[] = [];
    let nextCursor: string | null = null;

    try {
      const commentsData = 
        json?.data?.node?.commentators ||
        json?.data?.feedback?.comments ||
        json?.data?.node?.comment_rendering_instance?.comments ||
        json?.data?.comments || {};

      const pageInfo = commentsData.page_info;
      if (pageInfo) {
        nextCursor = pageInfo.has_next_page ? pageInfo.end_cursor : null;
      }

      const edges = commentsData.edges || commentsData.nodes || [];
      for (const edge of edges) {
        const node = edge.node || edge;
        const author = node.author || node.comment_author;
        if (author && (author.id || author.url)) {
          const id = (author.id || '').toString();
          if (id.startsWith('Y29tbWVud') || id.startsWith('feedback:') || id.startsWith('comment:')) continue;
          const name = (author.name || '').trim();
          if (!name || name.startsWith('#') || name.includes('\n')) continue;
          const profileUrl = author.url || `https://facebook.com/${id}`;
          leads.push({
            platform: 'facebook',
            lead_value: profileUrl,
            display_name: name,
            avatar_url: author.profile_picture?.uri || undefined,
            workspace_id: 1,
            metadata: {
              id: id,
              comment_id: node.id
            }
          });
        }
      }
    } catch (e: any) {
      console.error('[NetworkScraper] Error parsing Facebook Post Comments JSON:', e.message);
    }

    return { leads, nextCursor };
  }

  /**
   * Helper to parse any Facebook GraphQL response text (handles standard JSON, for (;;); prefix and NDJSON)
   */
  public static parseFacebookGraphQLText(rawText: string): { leads: ScrapedLead[]; nextCursor: string | null } {
    const leads: ScrapedLead[] = [];
    let nextCursor: string | null = null;
    if (!rawText) return { leads, nextCursor };

    let cleaned = rawText.trim();
    if (cleaned.startsWith('for (;;);')) {
      cleaned = cleaned.substring('for (;;);'.length).trim();
    }

    const tryParseChunk = (chunk: string) => {
      try {
        const json = JSON.parse(chunk);
        const grp = NetworkScraperEngine.parseFacebookGroupMembersResponse(json);
        if (grp.nextCursor) nextCursor = grp.nextCursor;
        leads.push(...grp.leads);

        const sub = NetworkScraperEngine.parseFacebookSubscribersResponse(json);
        if (sub.nextCursor) nextCursor = sub.nextCursor;
        leads.push(...sub.leads);

        const rx = NetworkScraperEngine.parseFacebookPostReactionsResponse(json);
        if (rx.nextCursor) nextCursor = rx.nextCursor;
        leads.push(...rx.leads);

        const cmt = NetworkScraperEngine.parseFacebookPostCommentsResponse(json);
        if (cmt.nextCursor) nextCursor = cmt.nextCursor;
        leads.push(...cmt.leads);
      } catch (e) {}
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

    // Fallback regex scan for user IDs only if displayName is explicitly present (avoiding non-user entity IDs)
    if (leads.length === 0) {
      const userMatches = Array.from(cleaned.matchAll(/"id"\s*:\s*"(\d{8,20})"[^}]*?"name"\s*:\s*"((?:\\.|[^"\\])+)"/g));
      for (const match of userMatches) {
        const uid = match[1];
        let name = match[2] || '';
        try { name = JSON.parse(`"${name}"`).trim(); } catch (e) {}
        if (uid && /^\d{8,20}$/.test(uid) && name && name.length >= 2 && !name.startsWith('#') && !name.includes('\n')) {
          leads.push({
            platform: 'facebook',
            lead_value: `https://facebook.com/${uid}`,
            display_name: name,
            workspace_id: 1,
            metadata: { id: uid }
          });
        }
      }
    }

    return { leads, nextCursor };
  }

  /**
   * Active Direct GraphQL Pagination Loop (High-Speed Fetching via Intercepted Session Credentials)
   */
  public static async scrapeFollowersActiveGraphQL(
    context: BrowserContext,
    platform: string,
    targetUrl: string,
    workspaceId: number,
    targetName: string,
    maxUsers: number = 10000,
    initialCursor?: string | null,
    onProgress?: (scrapedCount: number, newLeads: ScrapedLead[], currentCursor: string | null) => Promise<void>
  ): Promise<ScrapeResult> {
    const page: Page = await context.newPage();
    const collectedLeads: ScrapedLead[] = [];
    const leadMap = new Map<string, ScrapedLead>();

    let latestCursor: string | null = initialCursor || null;
    let isRateLimited = false;
    let hasMore = true;

    // Session headers captured from the first intercepted GraphQL request
    let capturedHeaders: Record<string, string> | null = null;
    let capturedEndpoint: string | null = null;
    let capturedMethod: string = 'GET';
    let capturedPostParams: Record<string, string> | null = null;
    let capturedVariables: any = null;
    let capturedFeatures: any = null;

    // Step 1: Intercept the target's GraphQL request to capture Auth Headers & Query template
    page.on('request', (req) => {
      const url = req.url();
      if (!capturedHeaders && (url.includes('/GraphQL/') || url.includes('/Followers') || url.includes('/graphql') || url.includes('/api/graphql/'))) {
        try {
          const method = (req.method().toUpperCase() === 'POST') ? 'POST' : 'GET';
          const postDataStr = req.postData() || '';

          if (platform === 'facebook') {
            // 1. Strict Blacklist: Must NOT be background personal queries of the live account
            const isBlacklisted = 
              postDataStr.includes('CometNotifications') ||
              postDataStr.includes('CometTopContacts') ||
              postDataStr.includes('CometChat') ||
              postDataStr.includes('Presence') ||
              postDataStr.includes('FriendSuggestions') ||
              postDataStr.includes('Friending') ||
              postDataStr.includes('NewsFeed') ||
              postDataStr.includes('HomeFeed') ||
              postDataStr.includes('Bookmarks') ||
              postDataStr.includes('Stories') ||
              postDataStr.includes('Mercury') ||
              postDataStr.includes('Gemini') ||
              postDataStr.includes('LeftRail') ||
              postDataStr.includes('RightRail') ||
              postDataStr.includes('Jewel') ||
              postDataStr.includes('SearchTypeahead') ||
              postDataStr.includes('MWChat') ||
              postDataStr.includes('MWPresence') ||
              postDataStr.includes('CometModernNewsFeed') ||
              postDataStr.includes('CometFeed');

            if (isBlacklisted) return;

            // 2. Strict Whitelist: Must match follower / subscriber / member query
            const isFollowerQuery = 
              postDataStr.includes('Subscriber') ||
              postDataStr.includes('Follower') ||
              postDataStr.includes('ProfileCometAppCollection') ||
              postDataStr.includes('CollectionList') ||
              postDataStr.includes('PageFollowers') ||
              postDataStr.includes('ProfileFollowers') ||
              postDataStr.includes('PageItems') ||
              postDataStr.includes('GroupCometMembers') ||
              postDataStr.includes('subscribers') ||
              postDataStr.includes('followers');

            if (!isFollowerQuery) return;
          }

          if (platform === 'x') {
            const isXFollowerQuery = url.includes('/Followers') || url.includes('/Following') || url.includes('/UserByRestId') || url.includes('/UserTweets');
            if (!isXFollowerQuery) return;
          }

          capturedHeaders = req.headers();
          capturedEndpoint = url.split('?')[0];
          capturedMethod = method;

          if (capturedMethod === 'POST') {
            if (postDataStr) {
              const parsedParams = new URLSearchParams(postDataStr);
              capturedPostParams = {};
              parsedParams.forEach((val, key) => {
                if (capturedPostParams) capturedPostParams[key] = val;
              });
              const varsStr = parsedParams.get('variables');
              if (varsStr) {
                try { capturedVariables = JSON.parse(varsStr); } catch (e) {}
              }
            }
          } else {
            const urlObj = new URL(url);
            const varsStr = urlObj.searchParams.get('variables');
            const featsStr = urlObj.searchParams.get('features');

            if (varsStr) capturedVariables = JSON.parse(varsStr);
            if (featsStr) capturedFeatures = JSON.parse(featsStr);
          }

          const friendlyName = capturedPostParams?.fb_api_req_friendly_name || capturedVariables?.doc_id || 'FollowerQuery';
          console.log(`[NetworkScraper] ✅ Successfully captured target GraphQL (${capturedMethod}: ${friendlyName}) auth headers & template!`);
        } catch (e) {}
      }
    });

    try {
      console.log(`[NetworkScraper] Navigating to target to capture session headers: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);

      // Trigger initial scroll to force first GraphQL request if needed
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(2000);

      // Step 2: Active GraphQL High-Speed Fetching Loop
      if (capturedHeaders && capturedEndpoint && (capturedVariables || capturedPostParams)) {
        console.log(`[NetworkScraper] 🚀 Starting Active High-Speed GraphQL Pagination Loop for @${targetName} (Platform: ${platform}, Method: ${capturedMethod})...`);

        let currentCursor = initialCursor || capturedVariables?.cursor || null;
        let consecutiveEmptyRequests = 0;

        while (leadMap.size < maxUsers && !isRateLimited && hasMore && consecutiveEmptyRequests < 5) {
          let fetchResult: any = null;

          if (capturedMethod === 'POST' && capturedPostParams) {
            // Facebook POST GraphQL pagination
            const nextVariables: any = Object.assign({}, capturedVariables || {}, { count: 50 });
            if (currentCursor) {
              nextVariables.cursor = currentCursor;
            }
            const postPayload = Object.assign({}, capturedPostParams || {}, { variables: JSON.stringify(nextVariables) });

            fetchResult = await page.evaluate(async ({ url, headers, payload }) => {
              try {
                const bodyParams = new URLSearchParams();
                for (const [k, v] of Object.entries(payload)) {
                  bodyParams.append(k, v as string);
                }

                const res = await fetch(url, {
                  headers: {
                    ...headers,
                    'content-type': 'application/x-www-form-urlencoded'
                  },
                  method: 'POST',
                  body: bodyParams.toString(),
                  credentials: 'include'
                });
                if (res.status === 429) {
                  return { status: 429, text: '' };
                }
                if (!res.ok) {
                  return { status: res.status, text: '' };
                }
                const text = await res.text();
                return { status: 200, text };
              } catch (err: any) {
                return { status: 500, error: err.message };
              }
            }, { url: capturedEndpoint, headers: capturedHeaders, payload: postPayload });

          } else {
            // Twitter/X GET GraphQL pagination
            const nextVariables = { ...capturedVariables, count: 50 };
            if (currentCursor) {
              nextVariables.cursor = currentCursor;
            }

            const queryUrl = new URL(capturedEndpoint);
            queryUrl.searchParams.set('variables', JSON.stringify(nextVariables));
            if (capturedFeatures) {
              queryUrl.searchParams.set('features', JSON.stringify(capturedFeatures));
            }

            fetchResult = await page.evaluate(async ({ url, headers }) => {
              try {
                const res = await fetch(url, {
                  headers,
                  method: 'GET',
                  credentials: 'include'
                });
                if (res.status === 429) {
                  return { status: 429, text: '' };
                }
                if (!res.ok) {
                  return { status: res.status, text: '' };
                }
                const text = await res.text();
                return { status: 200, text };
              } catch (err: any) {
                return { status: 500, error: err.message };
              }
            }, { url: queryUrl.toString(), headers: capturedHeaders });
          }

          if (fetchResult.status === 429) {
            console.warn('[NetworkScraper] Active GraphQL request hit Rate Limit (HTTP 429).');
            isRateLimited = true;
            break;
          }

          if (fetchResult.status !== 200 || !fetchResult.text) {
            console.warn(`[NetworkScraper] Active GraphQL request returned status ${fetchResult.status}. Retrying...`);
            consecutiveEmptyRequests++;
            await page.waitForTimeout(2000);
            continue;
          }

          // Parse response text
          let parsed: { leads: ScrapedLead[]; nextCursor: string | null } = { leads: [], nextCursor: null };
          if (platform === 'x') {
            try {
              const json = JSON.parse(fetchResult.text);
              parsed = NetworkScraperEngine.parseXFollowersResponse(json);
            } catch (e) {}
          } else {
            parsed = NetworkScraperEngine.parseFacebookGraphQLText(fetchResult.text);
          }

          if (parsed.nextCursor) {
            latestCursor = parsed.nextCursor;
            currentCursor = parsed.nextCursor;
          }

          if (parsed.leads.length > 0) {
            consecutiveEmptyRequests = 0;
            const batchUnique: ScrapedLead[] = [];

            for (const lead of parsed.leads) {
              lead.workspace_id = workspaceId;
              lead.source_target = targetName;

              const targetClean = (targetName || '').toLowerCase().trim();
              const leadValClean = (lead.lead_value || '').toLowerCase().trim();
              const dNameClean = (lead.display_name || '').toLowerCase().trim();
              const leadId = (lead.metadata?.id || '').toString().toLowerCase().trim();

              // Strictly exclude target entity itself
              if (
                (targetClean && targetClean !== 'kol' && targetClean !== 'target' && (leadValClean.includes(targetClean) || leadId === targetClean || dNameClean === targetClean))
              ) {
                continue;
              }

              if (!leadMap.has(lead.lead_value)) {
                leadMap.set(lead.lead_value, lead);
                collectedLeads.push(lead);
                batchUnique.push(lead);
              }
            }

            console.log(`[NetworkScraper] Active GraphQL Fetch: +${batchUnique.length} followers (Total: ${leadMap.size}/${maxUsers}, NextCursor: ${latestCursor ? 'YES' : 'NONE'})`);

            if (batchUnique.length > 0 && onProgress) {
              await onProgress(leadMap.size, batchUnique, latestCursor);
            }
          } else {
            consecutiveEmptyRequests++;
            if (!parsed.nextCursor) {
              console.log('[NetworkScraper] Reached end of follower list (No nextCursor).');
              hasMore = false;
              break;
            }
          }

          // Controlled pacing delay (400ms - 800ms) to maximize speed while respecting platform limits
          await page.waitForTimeout(400 + Math.floor(Math.random() * 400));
        }

      } else {
        console.warn('[NetworkScraper] Could not capture GraphQL headers directly. Falling back to scroll interception...');
        return await NetworkScraperEngine.scrapeFollowersInterception(
          context, platform, targetUrl, workspaceId, targetName, maxUsers, initialCursor, onProgress
        );
      }

    } catch (e: any) {
      console.error('[NetworkScraper] Exception during active GraphQL loop:', e.message);
    } finally {
      try {
        await page.close();
      } catch (e) {}
    }

    return {
      leads: collectedLeads,
      nextCursor: latestCursor,
      hasMore,
      isRateLimited
    };
  }

  /**
   * Fallback Passive Scroll Interception Session for Followers
   */
  public static async scrapeFollowersInterception(
    context: BrowserContext,
    platform: string,
    targetUrl: string,
    workspaceId: number,
    targetName: string,
    maxUsers: number = 10000,
    initialCursor?: string | null,
    onProgress?: (scrapedCount: number, newLeads: ScrapedLead[], currentCursor: string | null) => Promise<void>
  ): Promise<ScrapeResult> {
    const page: Page = await context.newPage();
    const collectedLeads: ScrapedLead[] = [];
    const leadMap = new Map<string, ScrapedLead>();

    let latestCursor: string | null = initialCursor || null;
    let isRateLimited = false;
    let hasMore = true;

    page.on('response', async (response) => {
      const url = response.url();
      const status = response.status();

      if (status === 429) {
        console.warn('[NetworkScraper] Rate limit 429 detected on endpoint:', url);
        isRateLimited = true;
        return;
      }

      if (url.includes('/GraphQL/') || url.includes('/Followers') || url.includes('/graphql') || url.includes('/api/graphql/')) {
        try {
          if (platform === 'facebook') {
            const postData = response.request()?.postData() || '';
            const isBlacklisted = 
              postData.includes('CometNotifications') ||
              postData.includes('CometTopContacts') ||
              postData.includes('CometChat') ||
              postData.includes('Presence') ||
              postData.includes('FriendSuggestions') ||
              postData.includes('Friending') ||
              postData.includes('NewsFeed') ||
              postData.includes('HomeFeed') ||
              postData.includes('Bookmarks') ||
              postData.includes('Stories') ||
              postData.includes('Mercury') ||
              postData.includes('Gemini') ||
              postData.includes('LeftRail') ||
              postData.includes('RightRail') ||
              postData.includes('Jewel') ||
              postData.includes('SearchTypeahead') ||
              postData.includes('MWChat') ||
              postData.includes('MWPresence') ||
              postData.includes('CometModernNewsFeed') ||
              postData.includes('CometFeed');

            if (isBlacklisted) return;
          }

          let parsedResult: { leads: ScrapedLead[]; nextCursor: string | null } = { leads: [], nextCursor: null };

          if (platform === 'x') {
            const json = await response.json().catch(() => null);
            if (json) parsedResult = NetworkScraperEngine.parseXFollowersResponse(json);
          } else {
            const text = await response.text().catch(() => '');
            if (text) parsedResult = NetworkScraperEngine.parseFacebookGraphQLText(text);
          }

          if (parsedResult.nextCursor) {
            latestCursor = parsedResult.nextCursor;
          }

          if (parsedResult.leads.length > 0) {
            const batchUnique: ScrapedLead[] = [];
            for (const lead of parsedResult.leads) {
              lead.workspace_id = workspaceId;
              lead.source_target = targetName;

              const targetClean = (targetName || '').toLowerCase().trim();
              const leadValClean = (lead.lead_value || '').toLowerCase().trim();
              const dNameClean = (lead.display_name || '').toLowerCase().trim();
              const leadId = (lead.metadata?.id || '').toString().toLowerCase().trim();

              // Strictly exclude target entity itself
              if (
                (targetClean && targetClean !== 'kol' && targetClean !== 'target' && (leadValClean.includes(targetClean) || leadId === targetClean || dNameClean === targetClean))
              ) {
                continue;
              }

              if (!leadMap.has(lead.lead_value)) {
                leadMap.set(lead.lead_value, lead);
                collectedLeads.push(lead);
                batchUnique.push(lead);
              }
            }

            if (batchUnique.length > 0 && onProgress) {
              await onProgress(leadMap.size, batchUnique, latestCursor);
            }
          }
        } catch (err: any) {}
      }
    });

    try {
      console.log(`[NetworkScraper] Navigating to target: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);

      let consecutiveStagnantScrolls = 0;
      let previousCount = 0;

      while (leadMap.size < maxUsers && !isRateLimited && hasMore && consecutiveStagnantScrolls < 20) {
        // Dispatch wheel events & scroll window + primary containers
        await page.evaluate(() => {
          window.scrollBy(0, 1200);
          const col = document.querySelector('div[data-testid="primaryColumn"]');
          if (col) col.scrollBy(0, 1200);

          const scrollables = Array.from(document.querySelectorAll('div')).filter(el => el.scrollHeight > el.clientHeight && el.clientHeight > 200);
          scrollables.forEach(c => c.scrollBy(0, 1200));
        });
        
        await page.waitForTimeout(1200 + Math.floor(Math.random() * 800));

        if (leadMap.size === previousCount) {
          consecutiveStagnantScrolls++;
        } else {
          consecutiveStagnantScrolls = 0;
          previousCount = leadMap.size;
        }

        if (consecutiveStagnantScrolls >= 18) {
          console.log('[NetworkScraper] No new followers loaded after 18 consecutive scrolls.');
          hasMore = false;
        }
      }

    } catch (e: any) {
      console.error('[NetworkScraper] Exception during navigation/scroll loop:', e.message);
    } finally {
      try {
        await page.close();
      } catch (e) {}
    }

    return {
      leads: collectedLeads,
      nextCursor: latestCursor,
      hasMore,
      isRateLimited
    };
  }

  /**
   * Extract Facebook Numeric Post ID directly from URL patterns (fbid, story_fbid, /posts/ID, /reel/ID, etc.)
   */
  public static extractPostIdFromUrl(url: string): string | null {
    try {
      if (!url) return null;
      const cleanUrl = url.trim();
      const u = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://www.facebook.com/${cleanUrl}`);
      
      const fbid = u.searchParams.get('fbid') || u.searchParams.get('story_fbid') || u.searchParams.get('ft_ent_identifier');
      if (fbid && /^\d+$/.test(fbid)) return fbid;

      const postMatch = cleanUrl.match(/\/(?:posts|permalink|photos|videos|reel|stories)\/(\d{8,25})/);
      if (postMatch) return postMatch[1];

      const setMatch = cleanUrl.match(/fbid=(\d{8,25})/);
      if (setMatch) return setMatch[1];

      const entMatch = cleanUrl.match(/ft_ent_identifier=(\d{8,25})/);
      if (entMatch) return entMatch[1];

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse HTML from mbasic.facebook.com reaction browser page
   */
  public static parseMbasicReactionPage(html: string): {
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

    // 1. Find Next Page Link ("Xem thêm" / "See More" pagination link)
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

    // 2. Extract profile anchors
    const anchorMatches = Array.from(html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
    for (const match of anchorMatches) {
      let href = match[1]?.replace(/&amp;/g, '&') || '';
      let text = match[2]?.replace(/<[^>]+>/g, '').trim() || '';

      if (!href || href.startsWith('#') || !text || text.length < 2 || text.length > 50 || text.includes('\n')) continue;
      if (text.startsWith('#')) continue; // Skip hashtags
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

    return { leads, nextPageUrl };
  }

  /**
   * Scrape deep timeline posts & their full reactors directly from mbasic.facebook.com for Pages & Profiles
   */
  public static async scrapeFanpageTimelineMbasic(
    page: Page,
    targetUrlOrSlug: string,
    viewerAccountId: string,
    maxPosts: number,
    limit: number,
    selfIdentifiers: Set<string>,
    existingMembers: Map<string, { uid: string; displayName: string; avatarUrl: string }>,
    onProgress?: (newLeads: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<number> {
    console.log(`[Mbasic Fanpage Engine] 🚀 Initializing deep timeline harvester for ${targetUrlOrSlug}...`);
    if (viewerAccountId) selfIdentifiers.add(viewerAccountId.toLowerCase());

    const cleanSlug = targetUrlOrSlug.replace(/^(https?:\/\/)?(mbasic\.|www\.|m\.)?facebook\.com\//, '').split('?')[0].replace(/^\/|\/$/g, '');
    let timelineUrl: string | null = `https://mbasic.facebook.com/${cleanSlug}`;
    const discoveredPostIds = new Set<string>();
    let timelinePageNum = 1;
    let addedCount = 0;

    // Step 1: Scan timeline pages to discover all post IDs & reaction links
    while (timelineUrl && discoveredPostIds.size < maxPosts && timelinePageNum <= 20) {
      if (page.isClosed()) break;
      try {
        console.log(`[Mbasic Fanpage Engine] Scanning timeline page ${timelinePageNum}: ${timelineUrl}`);
        await page.goto(timelineUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        const html = await page.content().catch(() => '');

        if (!html || html.includes('checkpoint') || html.includes('login_form')) {
          console.warn(`[Mbasic Fanpage Engine] Checkpoint/Login required on timeline page ${timelinePageNum}`);
          break;
        }

        // Find all reaction browser links in this timeline page
        const reactionMatches = Array.from(html.matchAll(/href="([^"]*\/ufi\/reaction\/profile\/browser\/[^"]*ft_ent_identifier=(\d{8,25})[^"]*)"/gi));
        for (const m of reactionMatches) {
          const postId = m[2];
          if (postId && !discoveredPostIds.has(postId)) {
            discoveredPostIds.add(postId);
          }
        }

        // Also find story.php?story_fbid=... links
        const storyMatches = Array.from(html.matchAll(/href="([^"]*story\.php\?[^"]*story_fbid=(\d{8,25})[^"]*)"/gi));
        for (const m of storyMatches) {
          const postId = m[2];
          if (postId && !discoveredPostIds.has(postId)) {
            discoveredPostIds.add(postId);
          }
        }

        // Also check for post IDs in ft_ent_identifier
        const ftMatches = Array.from(html.matchAll(/ft_ent_identifier=(\d{8,25})/gi));
        for (const m of ftMatches) {
          const postId = m[1];
          if (postId && !discoveredPostIds.has(postId)) {
            discoveredPostIds.add(postId);
          }
        }

        console.log(`[Mbasic Fanpage Engine] Discovered ${discoveredPostIds.size} unique posts so far.`);

        // Find "Xem thêm bài viết" / "Show more posts" timeline pagination link
        const morePostMatch = html.match(/<a\s+[^>]*href="([^"]*(?:\/stories\.php|\/home\.php|\/[^"?]+)\?[^"]*(?:cursor=|sectionLoadingID=|unit_cursor=|cursor_b=)[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
        if (morePostMatch) {
          let rawHref = morePostMatch[1].replace(/&amp;/g, '&');
          timelineUrl = rawHref.startsWith('http') ? rawHref : `https://mbasic.facebook.com${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;
          timelinePageNum++;
          await page.waitForTimeout(400);
        } else {
          timelineUrl = null;
        }
      } catch (e: any) {
        console.warn(`[Mbasic Fanpage Engine] Timeline scan error:`, e.message);
        break;
      }
    }

    console.log(`[Mbasic Fanpage Engine] Total ${discoveredPostIds.size} posts found. Starting deep reaction harvesting on all posts...`);

    // Step 2: Harvest all reactions for each discovered post
    const postList = Array.from(discoveredPostIds);
    for (let i = 0; i < postList.length; i++) {
      if (existingMembers.size >= limit || page.isClosed()) break;
      const pid = postList[i];
      console.log(`[Mbasic Fanpage Engine] Harvesting Post [${i + 1}/${postList.length}] ID: ${pid} (Current Leads: ${existingMembers.size}/${limit})...`);
      
      const postAdded = await NetworkScraperEngine.scrapeMbasicReactionsForPost(
        page,
        pid,
        viewerAccountId,
        limit,
        selfIdentifiers,
        existingMembers,
        onProgress
      );
      addedCount += postAdded;
    }

    return addedCount;
  }

  /**
   * Scrape reactions of a single Facebook Post via mbasic.facebook.com across all reaction types
   */
  public static async scrapeMbasicReactionsForPost(
    page: Page,
    postId: string,
    viewerAccountId: string,
    maxLeads: number,
    selfIdentifiers: Set<string>,
    existingMembers: Map<string, { uid: string; displayName: string; avatarUrl: string }>,
    onProgress?: (newLeads: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<number> {
    console.log(`[Mbasic Harvester] 🚀 Starting Mbasic Reaction Scraping for Post ID: ${postId} (Viewer ID: ${viewerAccountId})...`);
    if (viewerAccountId) {
      selfIdentifiers.add(viewerAccountId.toLowerCase());
    }
    let addedCount = 0;
    let lastSavedCount = existingMembers.size;
    let requestCount = 0;

    // Reaction types: 0 (All), 1 (Like), 2 (Love), 3 (Care), 4 (Haha), 7 (Wow), 8 (Sad), 11 (Angry)
    const reactionTypes = [0, 1, 2, 3, 4, 7, 8, 11];

    for (const rxType of reactionTypes) {
      if (existingMembers.size >= maxLeads || page.isClosed()) break;

      let currentUrl: string | null = `https://mbasic.facebook.com/ufi/reaction/profile/browser/?ft_ent_identifier=${postId}&av=${viewerAccountId}&reaction_type=${rxType}&limit=100`;
      let pageNum = 1;
      let stagnantPages = 0;

      while (currentUrl && existingMembers.size < maxLeads && pageNum <= 30 && stagnantPages < 3) {
        if (page.isClosed()) break;
        requestCount++;

        try {
          const sizeBefore = existingMembers.size;
          await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
          const html = await page.content().catch(() => '');

          if (!html || html.includes('checkpoint') || html.includes('login_form')) {
            console.warn(`[Mbasic Harvester] Received checkpoint or empty response on page ${pageNum} for post ${postId}`);
            break;
          }

          const parsed = NetworkScraperEngine.parseMbasicReactionPage(html);

          const batch: Array<{ uid: string; displayName: string; avatarUrl: string }> = [];
          for (const item of parsed.leads) {
            const uidLower = item.uid.toLowerCase();
            if (!selfIdentifiers.has(uidLower) && !existingMembers.has(item.uid)) {
              const leadObj = { uid: item.uid, displayName: item.displayName, avatarUrl: '' };
              existingMembers.set(item.uid, leadObj);
              batch.push(leadObj);
              addedCount++;
            }
          }

          if (batch.length > 0 && onProgress) {
            await onProgress(batch).catch(() => {});
            lastSavedCount = existingMembers.size;
          }

          console.log(`[Mbasic Harvester] Post ${postId} | rx_type=${rxType} | Page ${pageNum}: +${batch.length} leads (Total: ${existingMembers.size}/${maxLeads})`);

          if (existingMembers.size === sizeBefore) {
            stagnantPages++;
          } else {
            stagnantPages = 0;
          }

          currentUrl = parsed.nextPageUrl;
          pageNum++;

          // Pacing delay (350 - 500ms) with extra pause every 20 requests
          const delay = 350 + Math.floor(Math.random() * 150);
          await page.waitForTimeout(delay);

          if (requestCount % 20 === 0) {
            await page.waitForTimeout(1000);
          }

        } catch (err: any) {
          console.warn(`[Mbasic Harvester] Error on post ${postId} page ${pageNum}:`, err.message);
          break;
        }
      }
    }

    if (existingMembers.size > lastSavedCount && onProgress) {
      const unsaved = Array.from(existingMembers.values()).slice(lastSavedCount);
      await onProgress(unsaved).catch(() => {});
    }

    console.log(`[Mbasic Harvester] ✅ Post ${postId} finished! Added +${addedCount} unique leads.`);
    return addedCount;
  }

  /**
   * Scrape Facebook Group Members via mbasic.facebook.com fallback
   * Immune to client-side GraphQL throttles and React Virtual DOM limitations
   */
  public static async scrapeGroupMembersViaMbasic(
    page: Page,
    targetGroup: string,
    limit: number,
    selfIdentifiers: Set<string>,
    members: Map<string, { uid: string; displayName: string; avatarUrl: string }>,
    onMembersScraped?: (members: Array<{ uid: string; displayName: string; avatarUrl: string }>) => Promise<void>
  ): Promise<number> {
    const initialCount = members.size;
    console.log(`[Mbasic Group Harvester] 🚀 Starting mbasic fallback scraper for ${targetGroup} (Current leads: ${members.size}/${limit})...`);

    // Parse target group identifier or numeric ID
    const targetClean = targetGroup.trim().replace(/\/$/, '');
    let targetId = '';
    if (targetClean.includes('profile.php?id=')) {
      try {
        const u = new URL(targetClean);
        targetId = u.searchParams.get('id') || '';
      } catch (e) {}
    } else {
      const parts = targetClean.split('?')[0].split('/').filter(Boolean);
      targetId = parts[parts.length - 1] || '';
      if (targetId === 'members' && parts.length >= 2) {
        targetId = parts[parts.length - 2];
      }
    }

    let currentUrl: string | null = targetId
      ? `https://mbasic.facebook.com/groups/${targetId}/members/`
      : targetClean.replace(/^(https?:\/\/)?(www\.|m\.)?facebook\.com\//, 'https://mbasic.facebook.com/').replace(/\/$/, '') + '/members/';

    let pageNum = 1;
    let lastSavedSize = members.size;
    let consecutiveEmptyPages = 0;

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

    while (currentUrl && members.size < limit && pageNum <= 150 && consecutiveEmptyPages < 5) {
      if (page.isClosed()) break;
      try {
        console.log(`[Mbasic Group Harvester] Loading page ${pageNum}: ${currentUrl}`);
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));

        const html = await page.content().catch(() => '');
        if (!html || html.includes('checkpoint') || html.includes('login_form')) {
          console.warn(`[Mbasic Group Harvester] Login/Checkpoint required on page ${pageNum}`);
          break;
        }

        const sizeBefore = members.size;

        // 1. Extract member profiles from page
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

          if (uid && !selfIdentifiers.has(uid.toLowerCase()) && !members.has(uid) && !skipKeywords.includes(uid.toLowerCase())) {
            members.set(uid, { uid, displayName: text, avatarUrl: '' });
          }
        }

        const newFound = members.size - sizeBefore;
        console.log(`[Mbasic Group Harvester] Page ${pageNum} harvested +${newFound} leads (Total: ${members.size}/${limit})...`);

        if (newFound === 0) {
          consecutiveEmptyPages++;
        } else {
          consecutiveEmptyPages = 0;
        }

        // Stream incremental chunk
        if (members.size - lastSavedSize >= 25 && onMembersScraped) {
          const unsaved = Array.from(members.values()).slice(lastSavedSize);
          await onMembersScraped(unsaved).catch(() => {});
          lastSavedSize = members.size;
        }

        // 2. Find Next Page Pagination Link ("Xem thêm thành viên" / "See More Members")
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

      } catch (err: any) {
        console.warn(`[Mbasic Group Harvester] Error on page ${pageNum}:`, err.message);
        break;
      }
    }

    if (members.size > lastSavedSize && onMembersScraped) {
      const unsaved = Array.from(members.values()).slice(lastSavedSize);
      await onMembersScraped(unsaved).catch(() => {});
    }

    const totalAdded = members.size - initialCount;
    console.log(`[Mbasic Group Harvester] Completed! Added +${totalAdded} leads via mbasic fallback (Total: ${members.size}/${limit}).`);
    return totalAdded;
  }
}
