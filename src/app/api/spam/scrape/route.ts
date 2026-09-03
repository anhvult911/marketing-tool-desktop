import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';
import { runFacebookScrapeJob, stopScrapeJob } from '@/lib/facebook-crawler';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (jobId) {
      const leads = db.prepare(`
        SELECT * FROM scraped_job_leads 
        WHERE job_id = ? AND workspace_id = ? 
        ORDER BY id DESC LIMIT 5000
      `).all(parseInt(jobId, 10), workspaceId);
      return NextResponse.json({ success: true, data: leads });
    }

    const jobs = db.prepare(`
      SELECT * FROM scrape_jobs 
      WHERE workspace_id = ? 
      ORDER BY id DESC 
      LIMIT 100
    `).all(workspaceId);

    return NextResponse.json({ success: true, data: jobs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const body = await request.json();
    const { 
      targetGroup, 
      platform = 'facebook', 
      maxLimit = 5000, 
      scrapeType = 'multi_tier',
      accountId,
      accountIds,
      autoImport = true,
      customTag,
      targetCampaignId
    } = body;

    if (!targetGroup || !targetGroup.trim()) {
      return NextResponse.json({ success: false, error: 'Link nhóm hoặc Fanpage mục tiêu không được để trống.' }, { status: 400 });
    }

    const res = db.prepare(`
      INSERT INTO scrape_jobs (
        workspace_id, platform, target_group, status, total_count, scraped_count, 
        auto_import, target_campaign_id, scrape_type, max_limit, custom_tag, 
        account_id, account_ids
      )
      VALUES (?, ?, ?, 'pending', 0, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workspaceId, 
      platform, 
      targetGroup.trim(), 
      autoImport ? 1 : 0, 
      targetCampaignId || null, 
      scrapeType, 
      maxLimit, 
      customTag ? customTag.trim() : null,
      accountId || (accountIds && accountIds.length > 0 ? accountIds[0] : null),
      accountIds ? JSON.stringify(accountIds) : null
    );

    const newJobId = Number(res.lastInsertRowid);

    // Kích hoạt worker cào ngầm bất đồng bộ
    if (platform === 'facebook' || platform === 'messenger') {
      setTimeout(() => {
        runFacebookScrapeJob({
          jobId: newJobId,
          workspaceId,
          platform,
          targetGroup: targetGroup.trim(),
          accountId: accountId || (accountIds && accountIds.length > 0 ? accountIds[0] : undefined),
          accountIds,
          maxLimit,
          autoImport: !!autoImport,
          scrapeType,
          customTag: customTag ? customTag.trim() : undefined,
          targetCampaignId
        }).catch(err => {
          console.error(`[Scrape Route] Worker error on job #${newJobId}:`, err);
        });
      }, 100);
    }

    return NextResponse.json({
      success: true,
      message: 'Đã khởi tạo tiến trình cào dữ liệu và đưa vào hàng đợi xử lý ngầm.',
      data: { id: newJobId }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { jobId, action } = await request.json();

    if (!jobId) {
      return NextResponse.json({ success: false, error: 'Thiếu ID tác vụ.' }, { status: 400 });
    }

    const job = db.prepare(`SELECT * FROM scrape_jobs WHERE id = ? AND workspace_id = ?`).get(jobId, workspaceId) as any;
    if (!job) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy tác vụ.' }, { status: 404 });
    }

    if (action === 'rerun') {
      db.prepare(`UPDATE scrape_jobs SET status = 'pending', total_count = 0, scraped_count = 0, error_msg = NULL WHERE id = ?`).run(jobId);
      
      if (job.platform === 'facebook' || job.platform === 'messenger') {
        setTimeout(() => {
          runFacebookScrapeJob({
            jobId: job.id,
            workspaceId,
            platform: job.platform,
            targetGroup: job.target_group,
            accountId: job.account_id,
            accountIds: job.account_ids ? JSON.parse(job.account_ids) : undefined,
            maxLimit: job.max_limit || 5000,
            autoImport: !!job.auto_import,
            scrapeType: job.scrape_type || 'multi_tier',
            customTag: job.custom_tag,
            targetCampaignId: job.target_campaign_id
          }).catch(err => console.error(err));
        }, 100);
      }

      return NextResponse.json({ success: true, message: 'Đã chạy lại tác vụ cào dữ liệu thành công.' });
    }

    if (action === 'stop' || action === 'cancel') {
      stopScrapeJob(jobId);
      db.prepare(`UPDATE scrape_jobs SET status = 'stopped' WHERE id = ? AND workspace_id = ?`).run(jobId, workspaceId);
      return NextResponse.json({ success: true, message: 'Đã gửi lệnh dừng tiến trình cào.' });
    }

    return NextResponse.json({ success: false, error: 'Hành động không hợp lệ.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { jobId } = await request.json();

    if (!jobId) {
      return NextResponse.json({ success: false, error: 'Thiếu ID tác vụ.' }, { status: 400 });
    }

    stopScrapeJob(jobId);
    db.prepare(`DELETE FROM scraped_job_leads WHERE job_id = ? AND workspace_id = ?`).run(jobId, workspaceId);
    db.prepare(`DELETE FROM scrape_jobs WHERE id = ? AND workspace_id = ?`).run(jobId, workspaceId);
    
    return NextResponse.json({ success: true, message: 'Đã xóa tiến trình cào và dữ liệu liên quan thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

