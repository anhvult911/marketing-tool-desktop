import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    // Create scraped_posts table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS scraped_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER DEFAULT 1,
        platform TEXT DEFAULT 'x',
        post_url TEXT,
        author TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const logs = db.prepare(`SELECT * FROM scraped_posts WHERE workspace_id = ? ORDER BY id DESC LIMIT 100`).all(workspaceId);
    return NextResponse.json({ success: true, data: logs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    db.prepare(`DELETE FROM scraped_posts WHERE workspace_id = ?`).run(workspaceId);
    return NextResponse.json({ success: true, message: 'Đã xóa sạch nhật ký cào bài viết.' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
