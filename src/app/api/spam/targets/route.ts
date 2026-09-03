import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const targets = db.prepare(`
      SELECT * FROM scrape_targets 
      WHERE workspace_id = ? 
      ORDER BY id DESC
    `).all(workspaceId);

    return NextResponse.json({ success: true, data: targets });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const body = await request.json();
    const targetsToAdd = Array.isArray(body) ? body : [body];

    if (targetsToAdd.length === 0) {
      return NextResponse.json({ success: false, error: 'Không có mục tiêu nào được gửi.' }, { status: 400 });
    }

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO scrape_targets (target_type, target_value, is_active, platform, workspace_id)
      VALUES (?, ?, 1, ?, ?)
    `);

    let insertedCount = 0;
    const insertMany = db.transaction(() => {
      for (const item of targetsToAdd) {
        const type = item.type || 'user';
        const value = (item.value || '').trim();
        const platform = item.platform || 'x';

        if (value) {
          const res = insertStmt.run(type, value, platform, workspaceId);
          if (res.changes > 0) insertedCount++;
        }
      }
    });

    insertMany();

    return NextResponse.json({ 
      success: true, 
      message: `Đã thêm thành công ${insertedCount} mục tiêu cào bài viết.` 
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu ID mục tiêu.' }, { status: 400 });
    }
    
    db.prepare(`DELETE FROM scrape_targets WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
    return NextResponse.json({ success: true, message: 'Đã xóa mục tiêu cào thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { id, action } = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'Thiếu ID mục tiêu.' }, { status: 400 });
    }
    
    const isActive = action === 'resume' ? 1 : 0;
    db.prepare(`UPDATE scrape_targets SET is_active = ? WHERE id = ? AND workspace_id = ?`).run(isActive, id, workspaceId);

    return NextResponse.json({ success: true, message: 'Đã cập nhật trạng thái mục tiêu cào thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
