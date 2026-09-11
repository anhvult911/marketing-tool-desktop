import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';
import { normalizeLeadValue } from '@/lib/lead-normalize';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const platform = (searchParams.get('platform') || '').trim();
    const status = (searchParams.get('status') || '').trim();
    const source = (searchParams.get('source') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.max(1, Math.min(10000, parseInt(searchParams.get('pageSize') || '200', 10) || 200));

    // P4 — lọc/phân trang phía server: trước đây trả LIMIT 10000 rồi UI lọc client
    // → kho 100k lead là treo trình duyệt. Giờ WHERE + LIMIT/OFFSET chạy trong SQLite.
    const where: string[] = ['workspace_id = ?'];
    const params: Array<string | number> = [workspaceId];
    if (q) {
      where.push('(value LIKE ? OR display_name LIKE ? OR source LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (platform && platform !== 'all') {
      // Facebook gộp cả 'social' (link bài seeding) như hành vi cũ của UI
      if (platform === 'facebook') {
        where.push(`(platform = 'facebook' OR platform = 'social')`);
      } else if (platform === 'telegram') {
        where.push(`(platform = 'telegram' OR platform = 'telegram_name')`);
      } else {
        where.push('platform = ?');
        params.push(platform);
      }
    }
    if (status && status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }
    if (source) {
      // 'Danh_Sach_Thủ_Công' là nhóm ngầm của lead không có source
      if (source === 'Danh_Sach_Thủ_Công') {
        where.push(`(source IS NULL OR TRIM(source) = '')`);
      } else {
        where.push('source = ?');
        params.push(source);
      }
    }
    const whereSql = where.join(' AND ');

    const total = (db.prepare(`SELECT COUNT(*) as n FROM spam_leads WHERE ${whereSql}`).get(...params) as { n: number }).n;
    const offset = (page - 1) * pageSize;
    const leads = db.prepare(`
      SELECT * FROM spam_leads
      WHERE ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(case when status = 'pending' then 1 else 0 end), 0) as pending,
        COALESCE(SUM(case when status = 'sent' then 1 else 0 end), 0) as sent,
        COALESCE(SUM(case when status = 'failed' then 1 else 0 end), 0) as failed,
        COALESCE(SUM(case when platform = 'zalo' then 1 else 0 end), 0) as zalo,
        COALESCE(SUM(case when platform = 'whatsapp' then 1 else 0 end), 0) as whatsapp,
        COALESCE(SUM(case when platform = 'telegram' or platform = 'telegram_name' then 1 else 0 end), 0) as telegram,
        COALESCE(SUM(case when platform = 'social' or platform = 'facebook' then 1 else 0 end), 0) as social
      FROM spam_leads
      WHERE workspace_id = ?
    `).get(workspaceId) as { total: number; pending: number; sent: number; failed: number; zalo: number; whatsapp: number; telegram: number; social: number } | undefined;

    // Tập Leads (collections) tổng hợp bằng SQL — thay cho việc UI group 10k lead client-side
    const collectionRows = db.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(source), ''), 'Danh_Sach_Thủ_Công') as name,
        COUNT(*) as total,
        COALESCE(SUM(case when status = 'pending' then 1 else 0 end), 0) as pending,
        COALESCE(SUM(case when status = 'sent' then 1 else 0 end), 0) as sent,
        COALESCE(SUM(case when status = 'failed' then 1 else 0 end), 0) as failed,
        MAX(created_at) as lastUpdated,
        GROUP_CONCAT(DISTINCT platform) as platforms
      FROM spam_leads
      WHERE workspace_id = ?
      GROUP BY name
      ORDER BY total DESC
    `).all(workspaceId) as Array<{ name: string; total: number; pending: number; sent: number; failed: number; lastUpdated: string | null; platforms: string | null }>;

    const collections = collectionRows.map(c => ({
      name: c.name,
      total: c.total,
      pending: c.pending,
      sent: c.sent,
      failed: c.failed,
      lastUpdated: c.lastUpdated || undefined,
      platforms: (c.platforms || '').split(',').filter(Boolean),
    }));

    return NextResponse.json({ 
      success: true, 
      data: leads,
      page,
      pageSize,
      total,
      stats: {
        total: stats?.total || 0,
        pending: stats?.pending || 0,
        sent: stats?.sent || 0,
        failed: stats?.failed || 0,
        zalo: stats?.zalo || 0,
        whatsapp: stats?.whatsapp || 0,
        telegram: stats?.telegram || 0,
        social: stats?.social || 0
      },
      collections
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
    // P4 — chèn kèm khoá chuẩn hoá; chặn trùng ngữ nghĩa (090… vs +8490…,
    // @User vs t.me/user). `value` vẫn UNIQUE để giữ dedup tuyệt đối.
    const insertLeadStmt = db.prepare(`
      INSERT OR IGNORE INTO spam_leads (platform, lead_type, value, status, workspace_id, source, normalized_value)
      SELECT ?, ?, ?, 'pending', ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM spam_leads WHERE workspace_id = ? AND normalized_value = ?
      )
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

        const normalized = normalizeLeadValue(platform, value);
        const res = insertLeadStmt.run(platform, leadType, value, workspaceId, source, normalized, workspaceId, normalized);
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
    const { ids, all, source } = await request.json().catch(() => ({}));

    if (all) {
      db.prepare(`UPDATE spam_leads SET status = 'pending', last_attempt = NULL WHERE workspace_id = ?`).run(workspaceId);
      return NextResponse.json({ success: true, message: 'Đã đặt lại trạng thái về Chờ gửi.' });
    }

    // P4 — reset cả một Tập Leads theo nguồn ở server (UI không cần tải hết id)
    if (source) {
      if (source === 'Danh_Sach_Thủ_Công') {
        db.prepare(`UPDATE spam_leads SET status = 'pending', last_attempt = NULL WHERE workspace_id = ? AND (source IS NULL OR TRIM(source) = '')`).run(workspaceId);
      } else {
        db.prepare(`UPDATE spam_leads SET status = 'pending', last_attempt = NULL WHERE workspace_id = ? AND source = ?`).run(workspaceId, source);
      }
      return NextResponse.json({ success: true, message: `Đã đặt lại trạng thái Tập Leads "${source}" về Chờ gửi.` });
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
