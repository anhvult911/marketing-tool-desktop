import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const workspace = db.prepare(`
      SELECT w.id, w.name, 'Desktop Local' as "subscriptionPlan", w.created_at as "createdAt",
             'Local Admin' as "ownerName", 'admin@desktop.local' as "ownerEmail",
             (SELECT COUNT(*) FROM social_accounts WHERE workspace_id = w.id) as "accountCount",
             (SELECT COUNT(*) FROM proxies WHERE workspace_id = w.id) as "proxyCount",
             1 as "memberCount"
      FROM workspaces w
      WHERE w.id = ?
    `).get(workspaceId);

    return NextResponse.json({ success: true, workspace });
  } catch (error: any) {
    return NextResponse.json({ error: 'Lỗi hệ thống.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, description } = await request.json();
    if (!name) {
      return NextResponse.json({ error: 'Vui lòng nhập tên Workspace.' }, { status: 400 });
    }

    const res = db.prepare(`
      INSERT INTO workspaces (name, description)
      VALUES (?, ?)
    `).run(name.trim(), description || null);

    return NextResponse.json({ success: true, message: 'Tạo Workspace thành công!', workspaceId: Number(res.lastInsertRowid) });
  } catch (error: any) {
    return NextResponse.json({ error: 'Lỗi hệ thống.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { id, name, description } = await request.json();
    if (!id || !name) {
      return NextResponse.json({ error: 'Thiếu thông tin cập nhật.' }, { status: 400 });
    }

    db.prepare(`UPDATE workspaces SET name = ?, description = ? WHERE id = ?`).run(name.trim(), description || null, id);
    return NextResponse.json({ success: true, message: 'Cập nhật Workspace thành công.' });
  } catch (error: any) {
    return NextResponse.json({ error: 'Lỗi hệ thống.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceIdStr = searchParams.get('id');
    const workspaceId = parseInt(workspaceIdStr || '0', 10);

    if (workspaceId <= 1) {
      return NextResponse.json({ error: 'Không thể xóa Workspace mặc định.' }, { status: 400 });
    }

    const deleteTx = db.transaction(() => {
      db.prepare(`DELETE FROM jobs WHERE workspace_id = ?`).run(workspaceId);
      db.prepare(`DELETE FROM proxies WHERE workspace_id = ?`).run(workspaceId);
      db.prepare(`DELETE FROM social_accounts WHERE workspace_id = ?`).run(workspaceId);
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(workspaceId);
    });
    deleteTx();

    return NextResponse.json({ success: true, message: 'Đã xóa Workspace thành công.' });
  } catch (error: any) {
    return NextResponse.json({ error: 'Lỗi hệ thống.' }, { status: 500 });
  }
}
