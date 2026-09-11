import { NextResponse } from 'next/server';
import db, { getSetting, setSetting } from '@/lib/db';
import { getAuthSession } from '@/lib/auth';
import { browserLimiter } from '@/lib/concurrency';

export async function GET(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;

    const workspace = db.prepare(`SELECT name FROM workspaces WHERE id = ?`).get(workspaceId) as any;
    const rawApiKey = getSetting('gemini_api_key', process.env.GEMINI_API_KEY || '').trim();
    const maskedApiKey = rawApiKey 
      ? (rawApiKey.length > 8 ? `${rawApiKey.slice(0, 4)}...${rawApiKey.slice(-4)}` : '****')
      : '';
    const maxConcurrency = getSetting('max_concurrency', '2');
    const maxScrapeSessions = getSetting('max_scrape_sessions', '3');
    return NextResponse.json({ 
      success: true, 
      name: workspace?.name || 'Workspace Mặc định', 
      has_gemini_key: Boolean(rawApiKey),
      max_concurrency: parseInt(maxConcurrency, 10) || 2,
      max_scrape_sessions: Math.max(1, Math.min(6, parseInt(maxScrapeSessions, 10) || 3))
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const { name, gemini_api_key, max_concurrency, max_scrape_sessions } = await request.json();
    if (name) {
      db.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`).run(name.trim(), workspaceId);
    }

    if (gemini_api_key !== undefined) {
      const keyStr = String(gemini_api_key).trim();
      // Chỉ cập nhật nếu người dùng nhập khóa mới (không phải dạng masked chứa '...')
      if (keyStr && !keyStr.includes('...')) {
        setSetting('gemini_api_key', keyStr);
      } else if (keyStr === '') {
        setSetting('gemini_api_key', '');
      }
    }

    if (max_concurrency !== undefined) {
      const num = Math.max(1, Math.min(10, parseInt(max_concurrency, 10) || 2));
      setSetting('max_concurrency', String(num));
      browserLimiter.setMaxConcurrency(num);
    }

    if (max_scrape_sessions !== undefined) {
      const sessions = Math.max(1, Math.min(6, parseInt(max_scrape_sessions, 10) || 3));
      setSetting('max_scrape_sessions', String(sessions));
    }
    return NextResponse.json({ success: true, message: 'Cập nhật cấu hình Workspace thành công!' });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
