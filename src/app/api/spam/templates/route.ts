import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const templates = db.prepare(`
      SELECT id, title as name, content, workspace_id, created_at 
      FROM spam_templates 
      WHERE workspace_id = ?
      ORDER BY id DESC
    `).all(workspaceId);

    return NextResponse.json({ success: true, data: templates });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { name, content } = await request.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ success: false, error: 'Tên mẫu kịch bản không được trống.' }, { status: 400 });
    }
    if (!content || !content.trim()) {
      return NextResponse.json({ success: false, error: 'Nội dung kịch bản không được trống.' }, { status: 400 });
    }

    db.prepare(`
      INSERT INTO spam_templates (title, content, workspace_id)
      VALUES (?, ?, ?)
    `).run(name.trim(), content.trim(), workspaceId);

    return NextResponse.json({ success: true, message: 'Đã lưu mẫu kịch bản thành công.' });
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
      return NextResponse.json({ success: false, error: 'Thiếu ID mẫu.' }, { status: 400 });
    }

    db.prepare(`DELETE FROM spam_templates WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
    return NextResponse.json({ success: true, message: 'Đã xóa mẫu kịch bản thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { id, name, content } = await request.json();

    if (!id || !name || !content) {
      return NextResponse.json({ success: false, error: 'Thiếu thông tin cập nhật.' }, { status: 400 });
    }

    db.prepare(`
      UPDATE spam_templates 
      SET title = ?, content = ? 
      WHERE id = ? AND workspace_id = ?
    `).run(name.trim(), content.trim(), id, workspaceId);

    return NextResponse.json({ success: true, message: 'Đã cập nhật mẫu kịch bản thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
