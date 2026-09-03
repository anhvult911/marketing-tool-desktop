import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const workspaces = db.prepare(`
      SELECT id, name, description, 'Desktop Local' as subscription_plan, 'Local Admin' as owner_name, 'admin' as role
      FROM workspaces
      ORDER BY id ASC
    `).all();

    return NextResponse.json({ success: true, workspaces });
  } catch (error: any) {
    return NextResponse.json({ error: 'Lỗi hệ thống' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await request.json();
    return NextResponse.json({
      success: true,
      message: 'Chuyển đổi Workspace thành công!',
      activeWorkspaceId: parseInt(workspaceId, 10),
      role: 'admin'
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Lỗi hệ thống' }, { status: 500 });
  }
}
