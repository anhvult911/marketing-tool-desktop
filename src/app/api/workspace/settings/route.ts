import { NextResponse } from 'next/server';
import db, { getSetting, setSetting } from '@/lib/db';
import { getAuthSession } from '@/lib/auth';
import { browserLimiter } from '@/lib/concurrency';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const workspace = db.prepare(`SELECT name FROM workspaces WHERE id = ?`).get(workspaceId) as any;
    const apiKey = getSetting('gemini_api_key', process.env.GEMINI_API_KEY || '');
    const maxConcurrency = getSetting('max_concurrency', '2');

    return NextResponse.json({ 
      success: true, 
      name: workspace?.name || 'Workspace Mặc định', 
      gemini_api_key: apiKey,
      max_concurrency: parseInt(maxConcurrency, 10) || 2
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { name, gemini_api_key, max_concurrency } = await request.json();

    if (name) {
      db.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`).run(name.trim(), workspaceId);
    }

    if (gemini_api_key !== undefined) {
      setSetting('gemini_api_key', String(gemini_api_key).trim());
    }

    if (max_concurrency !== undefined) {
      const num = Math.max(1, Math.min(10, parseInt(max_concurrency, 10) || 2));
      setSetting('max_concurrency', String(num));
      browserLimiter.setMaxConcurrency(num);
    }

    return NextResponse.json({ success: true, message: 'Cập nhật cấu hình Workspace thành công!' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
