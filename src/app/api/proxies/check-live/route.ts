import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthSession } from '@/lib/auth';
import { checkProxyLive } from '@/lib/proxy-utils';

export async function POST(request: Request) {
  try {
    const session = await getAuthSession(request);
    const workspaceId = session?.activeWorkspaceId || 1;
    const body = await request.json().catch(() => ({}));
    const { id } = body;
    const nowStr = new Date().toISOString();

    if (id) {
      const proxy = db.prepare(`SELECT * FROM proxies WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as any;
      if (!proxy) {
        return NextResponse.json({ success: false, error: 'Proxy không tồn tại.' }, { status: 404 });
      }

      const isLive = await checkProxyLive(proxy.host, proxy.port, proxy.username, proxy.password);
      const status = isLive ? 'working' : 'dead';

      db.prepare(`UPDATE proxies SET status = ? WHERE id = ? AND workspace_id = ?`).run(status, id, workspaceId);

      return NextResponse.json({ 
        success: true, 
        isLive, 
        message: `Kiểm tra proxy thành công: Trạng thái ${isLive ? 'HOẠT ĐỘNG' : 'LỖI'}.` 
      });
    } else {
      const proxies = db.prepare(`SELECT * FROM proxies WHERE workspace_id = ?`).all(workspaceId) as any[];
      if (proxies.length === 0) {
        return NextResponse.json({ success: true, message: 'Không có proxy nào để kiểm tra.' });
      }

      const results = await Promise.all(
        proxies.map(async (p) => {
          const isLive = await checkProxyLive(p.host, p.port, p.username, p.password);
          const status = isLive ? 'working' : 'dead';
          db.prepare(`UPDATE proxies SET status = ? WHERE id = ? AND workspace_id = ?`).run(status, p.id, workspaceId);
          return { id: p.id, isLive };
        })
      );

      const workingCount = results.filter(r => r.isLive).length;
      const deadCount = results.length - workingCount;

      return NextResponse.json({ 
        success: true, 
        workingCount,
        deadCount,
        message: `Kiểm tra hoàn tất: ${workingCount} hoạt động, ${deadCount} lỗi.` 
      });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
