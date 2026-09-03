import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    // Create spam_leads table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS spam_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER DEFAULT 1,
        platform TEXT NOT NULL,
        lead_type TEXT NOT NULL,
        value TEXT NOT NULL UNIQUE,
        status TEXT DEFAULT 'pending',
        source TEXT,
        last_attempt DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const leads = db.prepare(`
      SELECT * FROM spam_leads
      WHERE workspace_id = ? 
      ORDER BY id DESC 
      LIMIT 10000
    `).all(workspaceId);

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(case when status = 'pending' then 1 else 0 end), 0) as pending,
        COALESCE(SUM(case when status = 'sent' then 1 else 0 end), 0) as sent,
        COALESCE(SUM(case when status = 'failed' then 1 else 0 end), 0) as failed,
        COALESCE(SUM(case when platform = 'zalo' then 1 else 0 end), 0) as zalo,
        COALESCE(SUM(case when platform = 'whatsapp' then 1 else 0 end), 0) as whatsapp,
        COALESCE(SUM(case when platform = 'telegram' then 1 else 0 end), 0) as telegram,
        COALESCE(SUM(case when platform = 'social' or platform = 'facebook' then 1 else 0 end), 0) as social
      FROM spam_leads
      WHERE workspace_id = ?
    `).get(workspaceId) as any;

    return NextResponse.json({ 
      success: true, 
      data: leads,
      stats: {
        total: stats?.total || 0,
        pending: stats?.pending || 0,
        sent: stats?.sent || 0,
        failed: stats?.failed || 0,
        zalo: stats?.zalo || 0,
        whatsapp: stats?.whatsapp || 0,
        telegram: stats?.telegram || 0,
        social: stats?.social || 0
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    let rawText = '';
    let source = 'upload';
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File;
      if (!file) {
        return NextResponse.json({ success: false, error: 'Không tìm thấy file tải lên.' }, { status: 400 });
      }
      rawText = await file.text();
      const bodySource = formData.get('source') as string;
      if (bodySource) source = bodySource;
    } else {
      const body = await request.json();
      rawText = body.rawText || '';
      if (body.source) source = body.source;
    }

    if (!rawText.trim()) {
      return NextResponse.json({ success: false, error: 'Dữ liệu nhập vào trống.' }, { status: 400 });
    }

    const lines = rawText.split(/\r?\n/);
    const insertLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (platform, lead_type, value, status, workspace_id, source)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `);

    let count = 0;
    const insertTx = db.transaction(() => {
      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        let platform = 'telegram';
        let leadType = 'username';
        let value = line;

        const isFbUid = /^\d{15,16}$/.test(line);
        const isPhone = /^(\+?[0-9]{9,15})$/.test(line.replace(/[\s\-\(\)]/g, ''));

        if (isFbUid) {
          platform = 'facebook';
          leadType = 'uid';
        } else if (isPhone) {
          platform = source.toLowerCase().includes('wa') ? 'whatsapp' : 'zalo';
          leadType = 'phone';
        } else if (line.startsWith('@') || line.includes('t.me/')) {
          platform = 'telegram';
          leadType = line.includes('joinchat') ? 'group' : 'username';
        } else if (line.startsWith('http')) {
          platform = 'social';
          leadType = 'post_link';
        }

        const res = insertLeadStmt.run(platform, leadType, value, workspaceId, source);
        if (res.changes > 0) count++;
      }
    });

    insertTx();

    return NextResponse.json({
      success: true,
      message: `Đã import thành công ${count} mục tiêu mới.`,
      count
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { id, ids, source, all } = await request.json().catch(() => ({}));

    if (all) {
      db.prepare(`DELETE FROM spam_leads WHERE workspace_id = ?`).run(workspaceId);
      return NextResponse.json({ success: true, message: 'Đã xóa toàn bộ danh bạ.' });
    }

    if (source) {
      db.prepare(`DELETE FROM spam_leads WHERE source = ? AND workspace_id = ?`).run(source, workspaceId);
      return NextResponse.json({ success: true, message: `Đã xóa toàn bộ Tập Leads "${source}".` });
    }

    if (ids && Array.isArray(ids)) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM spam_leads WHERE id IN (${placeholders}) AND workspace_id = ?`).run(...ids.map((i: any) => parseInt(i, 10)), workspaceId);
      return NextResponse.json({ success: true, message: `Đã xóa các mục tiêu đã chọn.` });
    }

    if (id) {
      db.prepare(`DELETE FROM spam_leads WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
      return NextResponse.json({ success: true, message: 'Đã xóa mục tiêu thành công.' });
    }

    return NextResponse.json({ success: false, error: 'Thiếu thông tin xóa.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { ids, all } = await request.json().catch(() => ({}));

    if (all) {
      db.prepare(`UPDATE spam_leads SET status = 'pending', last_attempt = NULL WHERE workspace_id = ?`).run(workspaceId);
      return NextResponse.json({ success: true, message: 'Đã đặt lại trạng thái về Chờ gửi.' });
    }

    if (ids && Array.isArray(ids)) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`UPDATE spam_leads SET status = 'pending', last_attempt = NULL WHERE id IN (${placeholders}) AND workspace_id = ?`).run(...ids.map((i: any) => parseInt(i, 10)), workspaceId);
      return NextResponse.json({ success: true, message: 'Đã đặt lại trạng thái về Chờ gửi.' });
    }

    return NextResponse.json({ success: false, error: 'Thiếu thông tin cập nhật.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
