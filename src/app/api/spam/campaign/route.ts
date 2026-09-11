import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { parseSpintax } from '@/lib/spintax';
import { getAuthSession } from '@/lib/auth';
import localQueue from '@/lib/queue';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const campaigns = db.prepare(`
      SELECT 
        jobs.campaign_id,
        MIN(jobs.scheduled_at) as scheduled_at,
        jobs.type,
        social_accounts.platform,
        COUNT(*) as total_jobs,
        COALESCE(SUM(CASE WHEN jobs.status = 'pending' THEN 1 ELSE 0 END), 0) as pending_jobs,
        COALESCE(SUM(CASE WHEN jobs.status = 'processing' THEN 1 ELSE 0 END), 0) as processing_jobs,
        COALESCE(SUM(CASE WHEN jobs.status = 'completed' THEN 1 ELSE 0 END), 0) as completed_jobs,
        COALESCE(SUM(CASE WHEN jobs.status = 'failed' THEN 1 ELSE 0 END), 0) as failed_jobs,
        COALESCE(SUM(CASE WHEN jobs.status = 'paused' THEN 1 ELSE 0 END), 0) as paused_jobs,
        GROUP_CONCAT(DISTINCT social_accounts.username) as accounts
      FROM jobs
      LEFT JOIN social_accounts ON jobs.account_id = social_accounts.id
      WHERE jobs.campaign_id IS NOT NULL AND jobs.workspace_id = ?
      GROUP BY jobs.campaign_id, jobs.type, social_accounts.platform
      ORDER BY MIN(jobs.scheduled_at) DESC
    `).all(workspaceId) as any[];

    const formattedCampaigns = campaigns.map(camp => ({
      ...camp,
      accounts: camp.accounts ? camp.accounts.split(',') : []
    }));

    return NextResponse.json({ success: true, data: formattedCampaigns });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const {
      platform = 'facebook',
      campaignType = 'comment',
      accountIds,
      templateIds,
      numLeads,
      leadIds,
      scheduledStart,
      desiredDurationMinutes,
      safetyLevel = 'safe'
    } = await request.json();

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Vui lòng chọn ít nhất 1 tài khoản gửi.' }, { status: 400 });
    }
    if (!templateIds || !Array.isArray(templateIds) || templateIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Vui lòng chọn ít nhất 1 kịch bản mẫu.' }, { status: 400 });
    }

    const tplPlaceholders = templateIds.map(() => '?').join(',');
    const templates = db.prepare(`
      SELECT content FROM spam_templates 
      WHERE id IN (${tplPlaceholders}) AND workspace_id = ?
    `).all(...templateIds.map((id: any) => parseInt(id, 10)), workspaceId) as Array<{ content: string }>;

    if (templates.length === 0) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy mẫu kịch bản hợp lệ.' }, { status: 400 });
    }

    // 1. Phân bổ mục tiêu (Leads) cho chiến dịch
    let targetLeads: Array<{ id: number; value: string; display_name?: string | null; lead_type?: string | null }> = [];

    if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
      const leadPlaceholders = leadIds.map(() => '?').join(',');
      targetLeads = db.prepare(`
        SELECT id, value, display_name, lead_type 
        FROM spam_leads 
        WHERE id IN (${leadPlaceholders}) AND workspace_id = ?
      `).all(...leadIds.map((id: any) => parseInt(id, 10)), workspaceId) as any[];
    } else if (numLeads && numLeads > 0) {
      const targetPlatform = platform === 'messenger' ? 'facebook' : platform;
      targetLeads = db.prepare(`
        SELECT id, value, display_name, lead_type 
        FROM spam_leads 
        WHERE (platform = ? OR (platform = 'social' AND ? = 'facebook')) 
          AND status = 'pending' AND workspace_id = ?
        ORDER BY id ASC 
        LIMIT ?
      `).all(targetPlatform, targetPlatform, workspaceId, numLeads) as any[];
    }

    // Với các chiến dịch comment hoặc message/inbox, bắt buộc phải có mục tiêu (Leads)
    if (targetLeads.length === 0 && campaignType !== 'post') {
      return NextResponse.json({ 
        success: false, 
        error: `Không tìm thấy mục tiêu (Leads) sẵn sàng nào cho nền tảng ${platform.toUpperCase()}. Vui lòng chọn hoặc nạp thêm Leads.` 
      }, { status: 400 });
    }

    // 2. Xác định loại tác vụ chuẩn cho worker
    const resolveJobType = (plat: string, campType: string): string => {
      const p = (plat || 'x').toLowerCase();
      const t = (campType || 'comment').toLowerCase();
      if (t === 'post') {
        if (p === 'threads') return 'threads_post';
        return 'post';
      }
      if (t === 'comment') return 'comment';
      if (t === 'group_post') {
        if (p === 'whatsapp') return 'whatsapp_group_post';
        return 'post';
      }
      if (p === 'zalo') return 'zalo_message';
      if (p === 'telegram') return 'telegram_message';
      if (p === 'whatsapp') return 'whatsapp_message';
      if (p === 'facebook' || p === 'messenger') return 'facebook_message';
      return `${p}_message`;
    };

    const jobType = resolveJobType(platform, campaignType);
    const campaignId = `CAMP_${(platform || 'X').toUpperCase()}_${Date.now()}`;
    const baseStartTime = scheduledStart ? new Date(scheduledStart) : new Date();

    // 3. Tính toán dãn cách an toàn cho từng tài khoản (Safety Level & Desired Duration)
    const totalJobs = targetLeads.length > 0 ? targetLeads.length : accountIds.length;
    const durationMinutes = Math.max(5, desiredDurationMinutes || 120);
    const safeAccsCount = Math.max(1, accountIds.length);
    const leadsPerAccount = Math.ceil(totalJobs / safeAccsCount);

    const rawIntervalMs = leadsPerAccount > 1 
      ? (durationMinutes * 60 * 1000) / (leadsPerAccount - 1)
      : durationMinutes * 60 * 1000;

    const minDelayMsBySafety: Record<string, number> = {
      safe: 8 * 60 * 1000,     // An toàn: 8 phút/lần
      balanced: 4 * 60 * 1000, // Cân bằng: 4 phút/lần
      fast: 2 * 60 * 1000,     // Nhanh: 2 phút/lần
    };
    const minSafeIntervalMs = minDelayMsBySafety[safetyLevel] || (4 * 60 * 1000);
    const accountIntervalMs = Math.max(minSafeIntervalMs, rawIntervalMs);

    const insertJobStmt = db.prepare(`
      INSERT INTO jobs (account_id, type, target_url, post_content, scheduled_at, status, campaign_id, workspace_id)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    const markLeadScheduledStmt = db.prepare(`
      UPDATE spam_leads 
      SET status = 'scheduled', last_attempt = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    let jobCount = 0;
    const insertCampaignTx = db.transaction(() => {
      for (let i = 0; i < totalJobs; i++) {
        const accIdx = i % accountIds.length;
        const accountId = parseInt(accountIds[accIdx], 10);
        const k = Math.floor(i / accountIds.length); // Job thứ k của tài khoản này

        // Dãn cách tài khoản chéo nhau: Acc 0 -> 0s, Acc 1 -> 30s, Acc 2 -> 60s
        const accStaggerOffset = accIdx * 30000 + Math.floor(Math.random() * 8000);
        const scheduledTime = new Date(baseStartTime.getTime() + accStaggerOffset + (k * accountIntervalMs) + Math.floor(Math.random() * 10000));

        const lead = targetLeads.length > 0 ? targetLeads[i] : null;
        const targetUrl = lead ? lead.value : null;

        // Merge tags cá nhân hóa: {name}, {displayName}, {uid}, {phone}
        const placeholders = lead ? {
          name: lead.display_name || 'bạn',
          displayName: lead.display_name || 'bạn',
          uid: lead.value || '',
          phone: lead.value || '',
          platform: platform || 'social',
        } : undefined;

        const template = templates[i % templates.length];
        const spunContent = parseSpintax(template.content, placeholders);

        insertJobStmt.run(
          accountId,
          jobType,
          targetUrl,
          spunContent,
          scheduledTime.toISOString(),
          campaignId,
          workspaceId
        );
        jobCount++;

        if (lead && lead.id) {
          markLeadScheduledStmt.run(lead.id);
        }
      }
    });

    insertCampaignTx();
    localQueue.triggerProcess();

    return NextResponse.json({
      success: true,
      message: `Khởi tạo chiến dịch thành công! Đã lên lịch ${jobCount} tác vụ cho ${accountIds.length} tài khoản, dãn cách an toàn ~${Math.round(accountIntervalMs / 60000)} phút/lần.`,
      data: { campaignId, totalJobs: jobCount, accountIntervalMinutes: Math.round(accountIntervalMs / 60000) }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { campaignId, action } = await request.json();

    if (!campaignId) {
      return NextResponse.json({ success: false, error: 'Thiếu ID chiến dịch.' }, { status: 400 });
    }

    if (action === 'pause') {
      db.prepare(`UPDATE jobs SET status = 'paused' WHERE campaign_id = ? AND status = 'pending' AND workspace_id = ?`).run(campaignId, workspaceId);
      return NextResponse.json({ success: true, message: 'Đã tạm dừng chiến dịch.' });
    }

    if (action === 'resume') {
      const runTime = new Date().toISOString();
      db.prepare(`UPDATE jobs SET status = 'pending', scheduled_at = ? WHERE campaign_id = ? AND workspace_id = ?`).run(runTime, campaignId, workspaceId);
      localQueue.triggerProcess();
      return NextResponse.json({ success: true, message: 'Đã tiếp tục chiến dịch.' });
    }

    if (action === 'delete') {
      db.prepare(`DELETE FROM jobs WHERE campaign_id = ? AND workspace_id = ?`).run(campaignId, workspaceId);
      return NextResponse.json({ success: true, message: 'Đã xóa chiến dịch thành công.' });
    }

    return NextResponse.json({ success: false, error: 'Hành động không hợp lệ.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
