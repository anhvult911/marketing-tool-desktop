import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const template = db.prepare(`SELECT * FROM post_templates WHERE id = ? AND workspace_id = ?`).get(id, workspaceId);
      if (!template) {
        return NextResponse.json({ success: false, error: 'Không tìm thấy bài viết mẫu.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: template });
    }

    const templates = db.prepare(`SELECT * FROM post_templates WHERE workspace_id = ? ORDER BY id DESC`).all(workspaceId);
    return NextResponse.json({ success: true, data: templates });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { title, content, mediaPaths, platform } = await request.json();

    if (!title || !title.trim()) {
      return NextResponse.json({ success: false, error: 'Tiêu đề không được để trống.' }, { status: 400 });
    }
    if (!content || !content.trim()) {
      return NextResponse.json({ success: false, error: 'Nội dung bài viết không được để trống.' }, { status: 400 });
    }

    const mediaPathsVal = mediaPaths && Array.isArray(mediaPaths) && mediaPaths.length > 0 
      ? JSON.stringify(mediaPaths) 
      : null;

    const res = db.prepare(`
      INSERT INTO post_templates (title, content, media_paths, platform, workspace_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(title.trim(), content.trim(), mediaPathsVal, platform || 'x', workspaceId);

    return NextResponse.json({
      success: true,
      message: 'Đã lưu mẫu bài viết thành công.',
      id: Number(res.lastInsertRowid)
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const { id, title, content, mediaPaths, platform } = await request.json();

    if (!id || !title || !content) {
      return NextResponse.json({ success: false, error: 'Thiếu thông tin cập nhật.' }, { status: 400 });
    }

    const mediaPathsVal = mediaPaths && Array.isArray(mediaPaths) && mediaPaths.length > 0 
      ? JSON.stringify(mediaPaths) 
      : null;

    db.prepare(`
      UPDATE post_templates
      SET title = ?, content = ?, media_paths = ?, platform = ?
      WHERE id = ? AND workspace_id = ?
    `).run(title.trim(), content.trim(), mediaPathsVal, platform || 'x', id, workspaceId);

    return NextResponse.json({ success: true, message: 'Cập nhật bài viết mẫu thành công.' });
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
      return NextResponse.json({ success: false, error: 'Thiếu ID bài viết mẫu.' }, { status: 400 });
    }

    db.prepare(`DELETE FROM post_templates WHERE id = ? AND workspace_id = ?`).run(id, workspaceId);
    return NextResponse.json({ success: true, message: 'Đã xóa bài viết mẫu thành công.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
