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

    const { platform, campaignType, accountIds, templateIds, scheduledStart } = await request.json();

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

    const campaignId = `CAMP_${(platform || 'X').toUpperCase()}_${Date.now()}`;
    const baseStartTime = scheduledStart ? new Date(scheduledStart) : new Date();

    const insertJobStmt = db.prepare(`
      INSERT INTO jobs (account_id, type, target_url, post_content, scheduled_at, status, campaign_id, workspace_id)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    let jobCount = 0;
    const insertCampaignTx = db.transaction(() => {
      for (let i = 0; i < accountIds.length; i++) {
        const accountId = parseInt(accountIds[i], 10);
        const template = templates[i % templates.length];
        const spunContent = parseSpintax(template.content);
        const scheduledTime = new Date(baseStartTime.getTime() + i * 15000);

        insertJobStmt.run(
          accountId,
          campaignType === 'comment' ? 'comment' : 'post',
          null,
          spunContent,
          scheduledTime.toISOString(),
          campaignId,
          workspaceId
        );
        jobCount++;
      }
    });

    insertCampaignTx();
    localQueue.triggerProcess();

    return NextResponse.json({
      success: true,
      message: `Khởi tạo chiến dịch thành công! Đã lên lịch ${jobCount} tác vụ.`
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
