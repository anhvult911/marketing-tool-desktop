import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getTwitterLength } from '@/lib/twitter';
import { getAuthSession } from '@/lib/auth';
import localQueue from '@/lib/queue';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const jobs = db.prepare(`
      SELECT jobs.*, social_accounts.username, social_accounts.platform 
      FROM jobs 
      LEFT JOIN social_accounts ON jobs.account_id = social_accounts.id 
      WHERE jobs.workspace_id = ?
      ORDER BY jobs.id DESC
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

    const { 
      accountIds, 
      content, 
      scheduleType, 
      baseTime, 
      mediaPaths, 
      templateIds, 
      mixMode, 
      staggerPostMinutes,
      telegramTargets,
      zaloTargets,
      whatsappTargets,
      newf319BoxId
    } = await request.json();

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Vui lòng chọn ít nhất một tài khoản.' }, { status: 400 });
    }

    let templatesList: Array<{ content: string; mediaPaths: string[] | null }> = [];
    if (templateIds && Array.isArray(templateIds) && templateIds.length > 0) {
      const placeholders = templateIds.map(() => '?').join(',');
      const dbTemplates = db.prepare(`
        SELECT * FROM post_templates 
        WHERE id IN (${placeholders}) AND workspace_id = ?
      `).all(...templateIds.map((id: any) => parseInt(id, 10)), workspaceId) as any[];
      
      templatesList = dbTemplates.map(t => {
        let mPaths: string[] | null = null;
        if (t.media_paths) {
          try {
            mPaths = JSON.parse(t.media_paths);
          } catch {
            mPaths = t.media_paths.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        }
        return { content: t.content, mediaPaths: mPaths };
      });
    } else {
      if (!content || !content.trim()) {
        return NextResponse.json({ success: false, error: 'Nội dung bài viết không được để trống.' }, { status: 400 });
      }
      templatesList = [{ content, mediaPaths: mediaPaths || null }];
    }
    
    const accPlaceholders = accountIds.map(() => '?').join(',');
    const accounts = db.prepare(`
      SELECT id, platform, username FROM social_accounts 
      WHERE id IN (${accPlaceholders}) AND workspace_id = ?
    `).all(...accountIds.map((id: any) => parseInt(id, 10)), workspaceId) as Array<{ id: number; platform: string; username: string }>;
    
    let start = new Date(baseTime || Date.now());
    const now = new Date();
    if (start.getTime() < now.getTime()) {
      start = now;
    }

    const staggerInterval = parseInt(staggerPostMinutes, 10) || 15;
    let jobCount = 0;

    const insertJobStmt = db.prepare(`
      INSERT INTO jobs (account_id, type, target_url, post_content, media_paths, scheduled_at, status, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    const insertJobsTx = db.transaction(() => {
      let currentScheduledTime = new Date(start.getTime());

      for (let i = 0; i < accountIds.length; i++) {
        const accId = parseInt(accountIds[i], 10);
        const acc = accounts.find(a => a.id === accId);
        const platform = acc ? acc.platform : 'x';

        let type = 'post';
        if (platform === 'zalo') type = 'zalo_message';
        else if (platform === 'whatsapp') type = 'whatsapp_message';
        else if (platform === 'telegram') type = 'telegram_message';
        else if (platform === 'threads') type = 'threads_post';
        else if (platform === 'newf319') type = 'newf319_post';
        else if (['facebook', 'instagram', 'youtube', 'tiktok'].includes(platform)) type = `${platform}_post`;

        let accountBaseTime: Date;
        if (scheduleType === 'staggered') {
          const randomDelayMins = Math.floor(Math.random() * (15 - 5 + 1)) + 5;
          currentScheduledTime = new Date(currentScheduledTime.getTime() + randomDelayMins * 60 * 1000);
          accountBaseTime = new Date(currentScheduledTime.getTime());
        } else if (scheduleType === 'scheduled') {
          accountBaseTime = new Date(start.getTime() + i * 5000);
        } else {
          accountBaseTime = new Date(now.getTime() + i * 5000);
        }

        let assignedTemplates = templatesList;
        if (templatesList.length > 1) {
          if (mixMode === 'round_robin') {
            assignedTemplates = [templatesList[i % templatesList.length]];
          } else if (mixMode === 'random') {
            const randIdx = Math.floor(Math.random() * templatesList.length);
            assignedTemplates = [templatesList[randIdx]];
          }
        }

        for (let j = 0; j < assignedTemplates.length; j++) {
          const t = assignedTemplates[j];
          const mediaPathsValue = t.mediaPaths && t.mediaPaths.length > 0 ? JSON.stringify(t.mediaPaths) : null;
          const jobScheduledTime = new Date(accountBaseTime.getTime() + j * staggerInterval * 60 * 1000);
          
          insertJobStmt.run(accId, type, null, t.content, mediaPathsValue, jobScheduledTime.toISOString(), workspaceId);
          jobCount++;
        }
      }
    });

    insertJobsTx();
    localQueue.triggerProcess();

    return NextResponse.json({ 
      success: true, 
      message: `Đã lên lịch thành công ${jobCount} bài đăng cho ${accountIds.length} tài khoản.` 
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { id, ids } = await request.json();
    
    if (ids && Array.isArray(ids)) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM jobs WHERE id IN (${placeholders}) AND workspace_id = ?`).run(...ids.map((i: any) => parseInt(i, 10)), workspaceId);
      return NextResponse.json({ success: true, message: 'Đã xóa hàng loạt công việc thành công.' });
    }

    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu ID công việc.' }, { status: 400 });
    }

    db.prepare(`DELETE FROM jobs WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
    return NextResponse.json({ success: true, message: 'Đã xóa công việc thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { id, ids, action } = await request.json();

    if (ids && Array.isArray(ids)) {
      const placeholders = ids.map(() => '?').join(',');
      const parsedIds = ids.map((i: any) => parseInt(i, 10));

      if (action === 'pause') {
        db.prepare(`UPDATE jobs SET status = 'paused' WHERE id IN (${placeholders}) AND status = 'pending' AND workspace_id = ?`).run(...parsedIds, workspaceId);
        return NextResponse.json({ success: true, message: 'Đã tạm dừng các tác vụ thành công.' });
      }

      if (action === 'resume' || action === 'run_now') {
        const runTime = new Date().toISOString();
        db.prepare(`UPDATE jobs SET status = 'pending', scheduled_at = ? WHERE id IN (${placeholders}) AND workspace_id = ?`).run(runTime, ...parsedIds, workspaceId);
        localQueue.triggerProcess();
        return NextResponse.json({ success: true, message: 'Đã cập nhật các tác vụ thành công.' });
      }
    }

    if (id) {
      if (action === 'pause') {
        db.prepare(`UPDATE jobs SET status = 'paused' WHERE id = ? AND status = 'pending' AND workspace_id = ?`).run(id, workspaceId);
        return NextResponse.json({ success: true, message: 'Đã tạm dừng tác vụ thành công.' });
      }

      if (action === 'resume' || action === 'run_now') {
        const runTime = new Date().toISOString();
        db.prepare(`UPDATE jobs SET status = 'pending', scheduled_at = ? WHERE id = ? AND workspace_id = ?`).run(runTime, id, workspaceId);
        localQueue.triggerProcess();
        return NextResponse.json({ success: true, message: 'Đã tiếp tục tác vụ thành công.' });
      }
    }

    return NextResponse.json({ success: false, error: 'Hành động không hợp lệ.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
